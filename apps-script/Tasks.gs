/**
 * Logic หลักของ task/project ทั้งหมด — ฟังก์ชันพวกนี้ไม่รู้จัก HTTP เลย
 * เรียกได้ทั้งจาก Code.gs (doGet/doPost) และจากฟังก์ชันทดสอบใน Tests.gs โดยตรง
 */

var TASKS_SHEET = 'Tasks';
var PROJECTS_SHEET = 'Projects';
var SUBTASKS_SHEET = 'Subtasks';
var VALID_WORKSPACES = ['Personal', 'Office'];

function assertWorkspace_(workspace) {
  if (VALID_WORKSPACES.indexOf(workspace) === -1) {
    throw new Error('workspace ต้องเป็น Personal หรือ Office เท่านั้น (ได้รับ: ' + workspace + ')');
  }
}

function newTaskId_() {
  return 't_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);
}

// แปลง row จาก sheet ให้เป็น object สะอาดๆ สำหรับส่งกลับเป็น JSON
// subtasks ใส่เข้ามาจากนอกฟังก์ชัน (แล้วแต่ที่เรียก) เพื่อไม่ต้อง query ซ้ำทุกครั้งที่แปลง task เดียว
function cleanTask_(t, subtasks) {
  return {
    id: t.id,
    workspace: t.workspace,
    title: t.title,
    project: t.project || '',
    day: t.day,
    weekStart: t.weekStart || '',
    done: t.done === true || t.done === 'TRUE',
    createdAt: t.createdAt,
    completedAt: t.completedAt || '',
    subtasks: subtasks || []
  };
}

function cleanSubtask_(s) {
  return {
    id: s.id,
    taskId: s.taskId,
    title: s.title,
    done: s.done === true || s.done === 'TRUE',
    createdAt: s.createdAt
  };
}

function normalizeSubtaskRow_(s) {
  if (s.createdAt instanceof Date) s.createdAt = s.createdAt.toISOString();
  return s;
}

function getSubtasksForTask_(taskId) {
  return readRows_(SUBTASKS_SHEET)
    .filter(function (s) { return s.taskId === taskId; })
    .map(normalizeSubtaskRow_)
    .map(cleanSubtask_);
}

// อ่าน Subtasks ทั้งชีตครั้งเดียว จัดกลุ่มตาม taskId — ใช้ตอน getBoard_ กันไม่ต้อง query ซ้ำทีละ task
function getSubtasksMap_() {
  var map = {};
  readRows_(SUBTASKS_SHEET).map(normalizeSubtaskRow_).forEach(function (s) {
    var clean = cleanSubtask_(s);
    if (!map[clean.taskId]) map[clean.taskId] = [];
    map[clean.taskId].push(clean);
  });
  return map;
}

/**
 * Google Sheets ชอบแปลง string ที่หน้าตาเหมือนวันที่ (เช่น "2026-09-01") ให้กลายเป็น
 * Date object เองอัตโนมัติตอนเขียนลงชีต ทำให้ตอนอ่านกลับมาไม่ตรงกับ string ที่โค้ดคาดหวัง
 * ฟังก์ชันนี้แปลงกลับให้เป็น string ตามฟอร์แมตที่ระบบใช้เสมอ กันปัญหานี้ทุกจุดที่อ่านจากชีต
 */
function normalizeTaskRow_(t) {
  if (t.day instanceof Date) t.day = toIso_(t.day);
  if (t.weekStart instanceof Date) t.weekStart = toIso_(t.weekStart);
  if (t.createdAt instanceof Date) t.createdAt = t.createdAt.toISOString();
  if (t.completedAt instanceof Date) t.completedAt = t.completedAt.toISOString();
  return t;
}

function findTaskRow_(id) {
  var rows = readRows_(TASKS_SHEET);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return normalizeTaskRow_(rows[i]);
  }
  throw new Error('ไม่พบงาน id: ' + id);
}

/**
 * ดึงข้อมูลบอร์ดของสัปดาห์หนึ่ง (7 วัน) + someday + master list project ของ workspace นั้น
 * weekStartIso ไม่ใส่ก็ได้ (จะ default เป็นสัปดาห์ปัจจุบัน), ใส่วันไหนก็ได้ในสัปดาห์นั้น (จะปัดไปวันจันทร์ให้เอง
 */
function getBoard_(workspace, weekStartIso) {
  assertWorkspace_(workspace);
  var monday = mondayOf_(weekStartIso || todayIso_());
  var days = weekDays_(monday);

  var byDay = {};
  days.forEach(function (d) { byDay[d] = []; });
  var someday = [];
  var subtasksMap = getSubtasksMap_();

  readRows_(TASKS_SHEET)
    .filter(function (t) { return t.workspace === workspace; })
    .map(normalizeTaskRow_)
    .forEach(function (t) {
      if (t.day === 'someday') {
        someday.push(cleanTask_(t, subtasksMap[t.id]));
      } else if (byDay.hasOwnProperty(t.day)) {
        byDay[t.day].push(cleanTask_(t, subtasksMap[t.id]));
      }
    });

  function byCreatedAt(a, b) { return a.createdAt < b.createdAt ? -1 : 1; }
  Object.keys(byDay).forEach(function (d) { byDay[d].sort(byCreatedAt); });
  someday.sort(byCreatedAt);

  var projects = readRows_(PROJECTS_SHEET)
    .filter(function (p) { return p.workspace === workspace; })
    .map(function (p) { return p.projectName; });

  return {
    workspace: workspace,
    weekStart: monday,
    today: todayIso_(),
    days: days.map(function (d) { return { date: d, tasks: byDay[d] }; }),
    someday: someday,
    projects: projects
  };
}

/**
 * เพิ่มงานใหม่ — day ไม่ใส่ = วันนี้, ใส่ "someday" = ไปช่อง Someday/Note, project ไม่ใส่ก็ได้
 */
function addTask_(params) {
  assertWorkspace_(params.workspace);
  if (!params.title) throw new Error('ต้องระบุ title');
  var day = params.day || todayIso_();
  var weekStart = (day === 'someday') ? '' : mondayOf_(day);

  var task = {
    id: newTaskId_(),
    workspace: params.workspace,
    title: params.title,
    project: params.project || '',
    day: day,
    weekStart: weekStart,
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: ''
  };
  appendRow_(TASKS_SHEET, task);
  return cleanTask_(task, []);
}

function toggleDone_(id) {
  var t = findTaskRow_(id);
  var nowDone = !(t.done === true || t.done === 'TRUE');
  var completedAt = nowDone ? new Date().toISOString() : '';
  updateRowFields_(TASKS_SHEET, t.__row, { done: nowDone, completedAt: completedAt });
  t.done = nowDone;
  t.completedAt = completedAt;
  return cleanTask_(t, getSubtasksForTask_(id));
}

/**
 * ย้ายวันของงาน — ใช้ได้ทั้งกดลูกศร (client คำนวณวันใหม่แล้วส่งมา), ย้ายลง someday (day="someday"),
 * หรือดึงจาก someday กลับขึ้นบอร์ด (ส่งวันที่ตรงๆ)
 */
function setDay_(id, day) {
  if (!day) throw new Error('ต้องระบุ day');
  var t = findTaskRow_(id);
  var weekStart = (day === 'someday') ? '' : mondayOf_(day);
  updateRowFields_(TASKS_SHEET, t.__row, { day: day, weekStart: weekStart });
  t.day = day;
  t.weekStart = weekStart;
  return cleanTask_(t, getSubtasksForTask_(id));
}

// ลบ task ถาวร (กู้คืนไม่ได้) พร้อมลบ subtask ของ task นั้นทิ้งด้วย กันข้อมูลกำพร้าค้างในชีต Subtasks
function deleteTask_(id) {
  var t = findTaskRow_(id);
  var subRows = readRows_(SUBTASKS_SHEET).filter(function (s) { return s.taskId === id; });
  // ลบจากแถวท้ายสุดไล่ขึ้นไปหน้า กันเลขแถวเลื่อนระหว่างลบหลายแถวพร้อมกัน
  subRows.sort(function (a, b) { return b.__row - a.__row; })
    .forEach(function (s) { getSheet_(SUBTASKS_SHEET).deleteRow(s.__row); });
  getSheet_(TASKS_SHEET).deleteRow(t.__row);
  return { id: id };
}

function setProject_(id, project) {
  var t = findTaskRow_(id);
  updateRowFields_(TASKS_SHEET, t.__row, { project: project || '' });
  t.project = project || '';
  return cleanTask_(t, getSubtasksForTask_(id));
}

/**
 * เพิ่มงานย่อยให้ task หลัก — คืนทั้งงานย่อยที่สร้างและ task หลัก (มี subtasks ล่าสุดติดมาด้วย)
 * ให้ frontend อัปเดตหน้าจอได้จากผลลัพธ์เดียว ไม่ต้อง reload ทั้งบอร์ด
 */
function addSubtask_(taskId, title) {
  if (!taskId) throw new Error('ต้องระบุ taskId');
  if (!title) throw new Error('ต้องระบุ title');
  findTaskRow_(taskId); // เช็คว่า task แม่มีอยู่จริงก่อน ไม่งั้น throw

  var subtask = {
    id: 'st_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000),
    taskId: taskId,
    title: title,
    done: false,
    createdAt: new Date().toISOString()
  };
  appendRow_(SUBTASKS_SHEET, subtask);

  var t = findTaskRow_(taskId);
  return { subtask: cleanSubtask_(subtask), task: cleanTask_(t, getSubtasksForTask_(taskId)) };
}

function findSubtaskRow_(id) {
  var rows = readRows_(SUBTASKS_SHEET);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return normalizeSubtaskRow_(rows[i]);
  }
  throw new Error('ไม่พบงานย่อย id: ' + id);
}

/**
 * ติ๊กเสร็จ/ยังไม่เสร็จงานย่อย — ถ้าติ๊กแล้วงานย่อยครบทุกอันของ task นั้นเสร็จหมด จะติ๊กงานหลักให้
 * เสร็จอัตโนมัติไปด้วย (ตามที่ตกลงกันไว้) แต่ไม่ทำย้อนกลับ (ไม่ยกเลิกงานหลักเองแม้ภายหลังจะไปติ๊ก
 * งานย่อยกลับเป็นไม่เสร็จ กันพฤติกรรมเซอร์ไพรส์ผู้ใช้)
 */
function toggleSubtaskDone_(id) {
  var s = findSubtaskRow_(id);
  var nowDone = !(s.done === true || s.done === 'TRUE');
  updateRowFields_(SUBTASKS_SHEET, s.__row, { done: nowDone });
  s.done = nowDone;

  var siblings = getSubtasksForTask_(s.taskId);
  var t = findTaskRow_(s.taskId);
  var isTaskDone = (t.done === true || t.done === 'TRUE');
  var allSubtasksDone = siblings.length > 0 && siblings.every(function (x) { return x.done; });

  if (allSubtasksDone && !isTaskDone) {
    var completedAt = new Date().toISOString();
    updateRowFields_(TASKS_SHEET, t.__row, { done: true, completedAt: completedAt });
    t.done = true;
    t.completedAt = completedAt;
  }

  return { subtask: cleanSubtask_(s), task: cleanTask_(t, siblings) };
}

/**
 * เพิ่ม project ใหม่เข้า master list ของ workspace (ไม่เพิ่มซ้ำถ้ามีชื่อนี้อยู่แล้ว)
 * คืนค่า master list ล่าสุดทั้งหมดของ workspace นั้นกลับไป
 */
function addProject_(workspace, projectName) {
  assertWorkspace_(workspace);
  if (!projectName) throw new Error('ต้องระบุ projectName');

  var existing = readRows_(PROJECTS_SHEET).filter(function (p) { return p.workspace === workspace; });
  var already = existing.some(function (p) { return p.projectName === projectName; });

  if (!already) {
    appendRow_(PROJECTS_SHEET, {
      workspace: workspace,
      projectName: projectName,
      createdAt: new Date().toISOString()
    });
  }

  return readRows_(PROJECTS_SHEET)
    .filter(function (p) { return p.workspace === workspace; })
    .map(function (p) { return p.projectName; });
}
