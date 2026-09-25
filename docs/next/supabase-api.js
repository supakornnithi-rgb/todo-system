// ---------- adapter: ห่อ Supabase ให้ app.js เห็นเหมือนเดิมทุกอย่าง (เอกสารคือ relay/L2P4-WEB-PLAN.md §4b) ----------
// เป้าหมาย: sbApiGet/sbApiPost ต้องคืน envelope รูปแบบเดียวกับ apiGet/apiPost เดิมที่ยิงไป Apps Script
// เป๊ะ ๆ ({ok:true,data:...} / {ok:true,result:...} / {ok:false,error:...}) เพื่อให้ docs/next/app.js
// แทบไม่ต้องแก้อะไรเลยนอกจากเปลี่ยนจุดเรียก network
//
// ทุกอย่างในไฟล์นี้ห่อด้วย IIFE ไม่พึ่งพา global function จาก app.js (แม้จะโหลดก่อน app.js เสมอ ก็ยัง
// มี date-util ของตัวเองแยกต่างหาก กันปัญหาลำดับโหลดสคริปต์แล้วเผื่อ config เปลี่ยนในอนาคต)
(function () {
  'use strict';

  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  // ---------- date utils (คัดลอกตรรกะเดียวกับ docs/app.js ทุกฟังก์ชัน แยกเป็น local ของ adapter เอง) ----------
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function toIsoLocal(date) { return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()); }
  function parseIsoLocal(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function todayIsoLocal() { return toIsoLocal(new Date()); }
  function addDaysIsoLocal(iso, n) { var d = parseIsoLocal(iso); d.setDate(d.getDate() + n); return toIsoLocal(d); }

  // Postgres ส่ง timestamptz กลับมาเป็น "...+00:00" หรือมี microsecond ต่อท้าย — new Date(x).toISOString()
  // normalize ให้เป็น "...Z" เสมอ กัน byCreatedAt (เทียบแบบ string, ดู byCreatedAt ด้านล่าง) ผิดพลาด
  function iso(x) { return new Date(x).toISOString(); }

  function byCreatedAt(a, b) { return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0); }
  // ต้องตรงกับ byOrder ฝั่ง docs/app.js (app.js:409) เป๊ะ — ใช้ createdAt เป็น tie-breaker ตอน order เท่ากัน
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0) || byCreatedAt(a, b); }

  // ---------- pure mapping helpers (export ที่ window.SbMap ให้ node test เรียกตรงได้) ----------
  function rowToSubtask(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      title: row.title,
      done: !!row.done,
      createdAt: iso(row.created_at)
    };
  }

  function rowToTask(row) {
    return {
      id: row.id,
      workspace: row.workspace,
      title: row.title,
      project: row.project || '',
      day: row.day || 'someday',
      weekStart: row.week_start || '',
      done: !!row.done,
      createdAt: iso(row.created_at),
      completedAt: row.completed_at ? iso(row.completed_at) : '',
      order: row.sort_order == null ? 0 : row.sort_order,
      subtasks: (row.subtasks || []).map(rowToSubtask).sort(byCreatedAt)
    };
  }

  function rowToDream(row) {
    return {
      id: row.id,
      title: row.title,
      done: !!row.done,
      completedAt: row.completed_at ? iso(row.completed_at) : '',
      createdAt: iso(row.created_at)
    };
  }

  // UX2: numDays default 7 (เดิม) แต่ actionGetBoard ตอนนี้ขอ 14 วันเสมอ (จ.สัปดาห์นี้ .. อา.สัปดาห์หน้า)
  // ให้ planner pane เห็น "พรุ่งนี้..+6" ได้ครบทุกกรณี (ดู rollingDays ใน app.js) — ต้อง deterministic เพราะ
  // app.js เทียบ boardSignature ด้วย JSON.stringify (ดู app.js:1555-1557 เดิม)
  function buildBoard(workspace, weekStart, today, taskRows, projectRows, numDays) {
    numDays = numDays || 7;
    var days = [];
    for (var i = 0; i < numDays; i++) days.push(addDaysIsoLocal(weekStart, i));

    var byDay = {};
    days.forEach(function (d) { byDay[d] = []; });
    var someday = [];

    (taskRows || []).map(rowToTask).forEach(function (t) {
      if (t.day === 'someday') {
        someday.push(t);
      } else if (byDay.hasOwnProperty(t.day)) {
        byDay[t.day].push(t);
      }
      // งานนอกสัปดาห์ที่ขอ (ไม่ใช่ someday) ไม่ต้องใส่ที่ไหนเลย — เหมือน getBoard_ เดิม (Tasks.gs:113)
    });

    days.forEach(function (d) { byDay[d].sort(byOrder); });
    someday.sort(byCreatedAt);

    var projects = (projectRows || [])
      .slice()
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0); })
      .map(function (p) { return p.name; });

    return {
      workspace: workspace,
      weekStart: weekStart,
      today: today,
      days: days.map(function (d) { return { date: d, tasks: byDay[d] }; }),
      someday: someday,
      projects: projects
    };
  }

  // ทำตาม getProjectHistory_ (Tasks.gs:149-166) เป๊ะ: นับ task ที่เสร็จแล้วต่อ project, ' (ไม่มี project)'
  // สำหรับ project ว่าง, pct ปัดเศษด้วย Math.round, เรียง desc ตาม count
  function buildHistory(rows) {
    var counts = {};
    (rows || []).forEach(function (t) {
      var key = t.project || '(ไม่มี project)';
      counts[key] = (counts[key] || 0) + 1;
    });

    var total = (rows || []).length;
    var stats = Object.keys(counts)
      .map(function (name) { return { name: name, count: counts[name], pct: total ? Math.round(counts[name] / total * 100) : 0 }; })
      .sort(function (a, b) { return b.count - a.count; });

    return { total: total, stats: stats };
  }

  window.SbMap = {
    rowToTask: rowToTask,
    rowToSubtask: rowToSubtask,
    rowToDream: rowToDream,
    buildBoard: buildBoard,
    buildHistory: buildHistory,
    iso: iso
  };

  // ---------- error contract ----------
  // supabase-js (postgrest-js) ไม่เคย reject promise เอง แม้ fetch จะล้มเหลวจริง (offline/DNS พัง) —
  // มันจับไว้แล้ว resolve เป็น { error: { code: '', message: 'TypeError: Failed to fetch', ... } } แทน
  // (ตรวจสอบจาก source ของ @supabase/postgrest-js@2 PostgrestBuilder.then แล้ว) ส่วน error จริงจาก
  // Postgres/PostgREST (validation, RLS, unique constraint ฯลฯ) จะมี error.code ไม่ว่างเสมอ (เช่น
  // '23505', '42501', 'PGRST116') เราจึงใช้ "error.code ว่างหรือไม่" แยกสองกรณีนี้ออกจากกัน:
  //   - code ว่าง (หรือไม่มี code เลย) => ถือเป็นปัญหาเครือข่าย => throw ให้ตรงตาม error contract ของแผน
  //     (ให้ retry logic เดิมของ app.js ฝั่ง read ทำงานเหมือนตอนเจอ fetch TypeError)
  //   - code ไม่ว่าง => เป็น error จริงจาก DB => คืน {ok:false, error: <ข้อความ + code>}
  function mapPgError(err) {
    var msg = (err && err.message) || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
    var code = err && err.code;
    return code ? (msg + ' (' + code + ')') : msg;
  }

  function runQuery(builder) {
    return Promise.resolve(builder).then(function (result) {
      if (result && result.error) {
        if (!result.error.code) {
          throw new Error((result.error.message) || 'เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง');
        }
        return { ok: false, error: mapPgError(result.error) };
      }
      return { ok: true, data: result.data };
    });
    // หมายเหตุ: ไม่ต้อง try/catch ครอบ Promise.resolve(builder) เพิ่ม เพราะ postgrest-js ไม่ throw เอง
    // (ดูหมายเหตุด้านบน) แต่ถ้ามี exception จริง ๆ หลุดออกมา (เช่น bug ใน .then callback) มันจะ reject
    // ตามปกติอยู่แล้ว ซึ่งก็ตรงกับ error contract ที่ต้องการ (throw ให้ผู้เรียกจัดการ) พอดี
  }

  // อ่านหน้าละ 1000 แถวจนกว่าจะหมด — ใช้กับ getProjectHistory ตามที่แผนระบุ (Tasks.gs เดิมสแกนทั้งชีต
  // ไม่มีขีดจำกัด แต่ PostgREST จำกัดแถวต่อ request เริ่มต้น เราจึง page เองให้ได้ผลลัพธ์ครบเหมือนเดิม)
  function paginateAll(queryFn) {
    var pageSize = 1000;
    var all = [];
    function loop(from) {
      var to = from + pageSize - 1;
      return runQuery(queryFn(from, to)).then(function (res) {
        if (!res.ok) return res;
        all = all.concat(res.data);
        if (res.data.length < pageSize) return { ok: true, data: all };
        return loop(from + pageSize);
      });
    }
    return loop(0);
  }

  // ---------- reads ----------
  // UX2 Task 1: ขอ 14 วัน (จ.สัปดาห์นี้ .. อา.สัปดาห์หน้า) แทน 7 วันเดิม — planner pane ต้องเห็นวันได้ถึง
  // today+6 เสมอ ซึ่งกรณี today เป็นอาทิตย์ (index 6 นับจาก Monday ของสัปดาห์นี้) จะไปถึง index 12 พอดี
  // อยู่ในหน้าต่าง 14 วัน [0..13] เสมอ ไม่ต้องขยับ weekStart เลย
  var BOARD_WINDOW_DAYS = 14;
  function actionGetBoard(params) {
    var workspace = params.workspace;
    var weekStart = params.weekStart;
    var days = [];
    for (var i = 0; i < BOARD_WINDOW_DAYS; i++) days.push(addDaysIsoLocal(weekStart, i));
    var mon = days[0], sun = days[BOARD_WINDOW_DAYS - 1];

    var tasksQuery = sb.from('tasks')
      .select('*, subtasks(*)')
      .eq('workspace', workspace)
      .or('day.is.null,and(day.gte.' + mon + ',day.lte.' + sun + ')');

    var projectsQuery = sb.from('projects')
      .select('name,created_at')
      .eq('workspace', workspace);

    // ยิงสองคำขอพร้อมกัน (runQuery แต่ละตัวเริ่ม fetch ทันทีตอนถูกเรียก ไม่ต้องรอกัน)
    return Promise.all([runQuery(tasksQuery), runQuery(projectsQuery)])
      .then(function (results) {
        var taskRes = results[0], projRes = results[1];
        if (!taskRes.ok) return taskRes;
        if (!projRes.ok) return projRes;
        var board = buildBoard(workspace, weekStart, todayIsoLocal(), taskRes.data, projRes.data, BOARD_WINDOW_DAYS);
        return { ok: true, data: board };
      });
  }

  function actionGetProjectHistory(params) {
    var workspace = params.workspace;
    return paginateAll(function (from, to) {
      return sb.from('tasks').select('project').eq('workspace', workspace).eq('done', true).range(from, to);
    }).then(function (res) {
      if (!res.ok) return res;
      return { ok: true, data: buildHistory(res.data) };
    });
  }

  function actionGetDreams() {
    return runQuery(sb.from('dreams').select('*').order('created_at')).then(function (res) {
      if (!res.ok) return res;
      return { ok: true, data: res.data.map(rowToDream) };
    });
  }

  function sbApiGet(params) {
    var action = params && params.action;
    if (action === 'getBoard') return actionGetBoard(params);
    if (action === 'getProjectHistory') return actionGetProjectHistory(params);
    if (action === 'getDreams') return actionGetDreams(params);
    return Promise.resolve({ ok: false, error: 'unknown action' });
  }

  // ---------- writes ----------
  // addTask: upsert idempotent ด้วย id = tempId ที่ฝั่ง client สุ่มมา (crypto.randomUUID() ใน app.js
  // หลังแก้ตามข้อ 4c.2) ignoreDuplicates ทำให้ retry ซ้ำได้โดยไม่มี error/แถวซ้ำ
  function actionAddTask(payload) {
    var day = payload.day === 'someday' ? null : payload.day;
    return runQuery(
      sb.from('tasks').upsert(
        { id: payload.tempId, workspace: payload.workspace, title: payload.title, project: payload.project || '', day: day }, // UX1: project มาจาก capture form (dropdown หรือ #hashtag)
        { onConflict: 'id', ignoreDuplicates: true }
      )
    ).then(function (res) {
      if (!res.ok) return res;
      // upsert+ignoreDuplicates ไม่คืนแถวตอนชนกัน (ON CONFLICT DO NOTHING ไม่มี RETURNING) ต้อง select แยก
      return runQuery(sb.from('tasks').select('*, subtasks(*)').eq('id', payload.tempId).single())
        .then(function (res2) {
          if (!res2.ok) return res2;
          return { ok: true, result: rowToTask(res2.data) };
        });
    });
  }

  // updateTask: map fields -> patch, ส่งเฉพาะ key ที่มีจริง, 'someday' -> null, order -> sort_order
  function actionUpdateTask(payload) {
    var fields = payload.fields || {};
    var patch = {};
    if (fields.hasOwnProperty('title')) patch.title = fields.title;
    if (fields.hasOwnProperty('project')) patch.project = fields.project;
    if (fields.hasOwnProperty('day')) patch.day = (fields.day === 'someday') ? null : fields.day;
    if (fields.hasOwnProperty('done')) patch.done = fields.done;
    if (fields.hasOwnProperty('order')) patch.sort_order = fields.order;

    return runQuery(
      sb.from('tasks').update(patch).eq('id', payload.id).select('*, subtasks(*)')
    ).then(function (res) {
      if (!res.ok) return res;
      if (!res.data || res.data.length === 0) {
        // 0 แถว = งานนี้ยังไม่มีจริงตอนนี้ (เช่น addTask ที่คู่กันยังไม่ confirm) ให้ queue retry ส่งใหม่เอง
        return { ok: false, error: 'ไม่พบงาน (อาจยังบันทึกไม่เสร็จ)' };
      }
      return { ok: true, result: rowToTask(res.data[0]) };
    });
  }

  // setTaskOrder: เรียก RPC ให้ backend renumber ให้ก่อน แล้วค่อย select ทั้งวันนั้นกลับมาส่งให้ applyReorder
  function actionSetTaskOrder(payload) {
    return runQuery(sb.rpc('set_task_order', { p_task_id: payload.id, p_position: payload.position }))
      .then(function (res) {
        if (!res.ok) return res;
        // ต้องรู้ workspace+day ของ task นี้ก่อนถึงจะ select siblings ทั้งวันได้
        return runQuery(sb.from('tasks').select('workspace, day').eq('id', payload.id).single())
          .then(function (res2) {
            if (!res2.ok) return res2;
            var workspace = res2.data.workspace, day = res2.data.day;
            return runQuery(
              sb.from('tasks').select('*, subtasks(*)').eq('workspace', workspace).eq('day', day)
            ).then(function (res3) {
              if (!res3.ok) return res3;
              var tasks = res3.data.map(rowToTask).sort(byOrder);
              return { ok: true, result: { day: day, workspace: workspace, tasks: tasks } };
            });
          });
      });
  }

  // deleteTask: ลบด้วย id ตรงๆ — 0 แถว (ลบไปแล้วรอบก่อน) ก็ยังถือว่าสำเร็จ (idempotent)
  function actionDeleteTask(payload) {
    return runQuery(sb.from('tasks').delete().eq('id', payload.id)).then(function (res) {
      if (!res.ok) return res;
      return { ok: true, result: { id: payload.id } };
    });
  }

  // addSubtask: id มาจาก client แล้ว (ต่างจาก addTask ที่ id=tempId เหมือนกัน — ดู 4c.2 ของแผน)
  function actionAddSubtask(payload) {
    return runQuery(
      sb.from('subtasks').upsert(
        { id: payload.id, task_id: payload.taskId, title: payload.title },
        { onConflict: 'id', ignoreDuplicates: true }
      )
    ).then(function (res) {
      if (!res.ok) return res;
      return runQuery(sb.from('subtasks').select('*').eq('id', payload.id).single())
        .then(function (subRes) {
          if (!subRes.ok) return subRes;
          return runQuery(sb.from('tasks').select('*, subtasks(*)').eq('id', payload.taskId).single())
            .then(function (taskRes) {
              if (!taskRes.ok) return taskRes;
              return { ok: true, result: { subtask: rowToSubtask(subRes.data), task: rowToTask(taskRes.data) } };
            });
        });
    });
  }

  // toggleSubtaskDone: SET ค่าที่ระบุมาตรงๆ (ไม่ toggle) — idempotent ตามแผน แล้ว re-select task แม่
  // เพราะ trigger DB อาจ auto-complete task แม่ไปแล้วระหว่างนี้
  function actionToggleSubtaskDone(payload) {
    return runQuery(
      sb.from('subtasks').update({ done: payload.done }).eq('id', payload.id).select('*')
    ).then(function (res) {
      if (!res.ok) return res;
      if (!res.data || res.data.length === 0) {
        return { ok: false, error: 'ไม่พบงานย่อย (อาจยังบันทึกไม่เสร็จ)' };
      }
      var subtask = rowToSubtask(res.data[0]);
      return runQuery(sb.from('tasks').select('*, subtasks(*)').eq('id', subtask.taskId).single())
        .then(function (taskRes) {
          if (!taskRes.ok) return taskRes;
          return { ok: true, result: { subtask: subtask, task: rowToTask(taskRes.data) } };
        });
    });
  }

  // addProject: upsert ด้วย unique(user_id,workspace,name), ignoreDuplicates กันซ้ำ แล้วคืน list ปัจจุบัน
  function actionAddProject(payload) {
    return sb.auth.getSession().then(function (sessionRes) {
      var userId = sessionRes && sessionRes.data && sessionRes.data.session && sessionRes.data.session.user
        ? sessionRes.data.session.user.id
        : undefined;
      return runQuery(
        sb.from('projects').upsert(
          { workspace: payload.workspace, name: payload.projectName, user_id: userId },
          { onConflict: 'user_id,workspace,name', ignoreDuplicates: true }
        )
      );
    }).then(function (res) {
      if (!res.ok) return res;
      return runQuery(sb.from('projects').select('name,created_at').eq('workspace', payload.workspace))
        .then(function (res2) {
          if (!res2.ok) return res2;
          var names = res2.data
            .slice()
            .sort(function (a, b) { return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0); })
            .map(function (p) { return p.name; });
          return { ok: true, result: names };
        });
    });
  }

  // addDream: เหมือน addTask — upsert idempotent ด้วย id=tempId แล้ว select แยกกลับมา
  function actionAddDream(payload) {
    return runQuery(
      sb.from('dreams').upsert({ id: payload.tempId, title: payload.title }, { onConflict: 'id', ignoreDuplicates: true })
    ).then(function (res) {
      if (!res.ok) return res;
      return runQuery(sb.from('dreams').select('*').eq('id', payload.tempId).single())
        .then(function (res2) {
          if (!res2.ok) return res2;
          return { ok: true, result: rowToDream(res2.data) };
        });
    });
  }

  // toggleDreamDone: SET ค่าที่ระบุมาตรงๆ เช่นเดียวกับ toggleSubtaskDone
  function actionToggleDreamDone(payload) {
    return runQuery(
      sb.from('dreams').update({ done: payload.done }).eq('id', payload.id).select('*')
    ).then(function (res) {
      if (!res.ok) return res;
      if (!res.data || res.data.length === 0) {
        return { ok: false, error: 'ไม่พบความฝัน (อาจยังบันทึกไม่เสร็จ)' };
      }
      return { ok: true, result: rowToDream(res.data[0]) };
    });
  }

  function sbApiPost(action, payload) {
    payload = payload || {};
    if (action === 'addTask') return actionAddTask(payload);
    if (action === 'updateTask') return actionUpdateTask(payload);
    if (action === 'setTaskOrder') return actionSetTaskOrder(payload);
    if (action === 'deleteTask') return actionDeleteTask(payload);
    if (action === 'addSubtask') return actionAddSubtask(payload);
    if (action === 'toggleSubtaskDone') return actionToggleSubtaskDone(payload);
    if (action === 'addProject') return actionAddProject(payload);
    if (action === 'addDream') return actionAddDream(payload);
    if (action === 'toggleDreamDone') return actionToggleDreamDone(payload);
    return Promise.resolve({ ok: false, error: 'unknown action' });
  }

  // ---------- realtime ----------
  // subscribe ช่องเดียว รับทุก event (*) ของ tasks/subtasks/projects — ไม่ต้องแยกจัดการทีละ event เพราะ
  // เราแค่อยากรู้ว่า "มีอะไรเปลี่ยน" แล้วให้ app.js ไป pollBoard() ดึงข้อมูลจริงมาทับเองแบบ debounce
  function sbSubscribeChanges(onChange) {
    var channel = sb.channel('l2p4-board-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subtasks' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
      .subscribe();
    return function unsubscribe() { sb.removeChannel(channel); };
  }

  // ---------- auth ----------
  function sbGetSession() {
    return sb.auth.getSession().then(function (res) { return res.data.session; });
  }
  function sbSignIn(email, password) {
    return sb.auth.signInWithPassword({ email: email, password: password });
  }
  function sbSignOut() {
    return sb.auth.signOut();
  }
  function sbOnAuthChange(cb) {
    return sb.auth.onAuthStateChange(function (event, session) { cb(event, session); });
  }

  window.sbApiGet = sbApiGet;
  window.sbApiPost = sbApiPost;
  window.sbSubscribeChanges = sbSubscribeChanges;
  window.sbGetSession = sbGetSession;
  window.sbSignIn = sbSignIn;
  window.sbSignOut = sbSignOut;
  window.sbOnAuthChange = sbOnAuthChange;
})();
