/**
 * Courier: ดึงข้อมูลจาก Supabase มาเขียนทับลง Google Sheets ทุก 15 นาที (รันผ่าน trigger)
 * โหมด shadow (ค่าเริ่มต้น) เขียนลงแท็บ SB_Tasks/SB_Subtasks/SB_Projects/SB_Dreams เท่านั้น
 * โหมด live (ตั้ง Script Property SYNC_TARGET = 'live') เขียนทับแท็บจริง Tasks/Subtasks/
 * Projects/Dreams ทุก 15 นาที — ถ้าใครพิมพ์แก้ในชีตตรงๆ ระหว่างนั้น ค่านั้นจะหายไปตอนรันรอบถัดไป
 * โหมด live เท่านั้นที่ทำ archive งานเก่าเกิน 2 ปีไปแท็บ Archive_Tasks/Archive_Subtasks แล้วลบออกจาก Supabase
 * ลำดับการรัน: 1) วาง L2P3_db_size.sql ใน Supabase SQL Editor แล้ว Run
 *              2) รัน syncSupabaseToSheets() มือ ดู Logger.log ให้ชัวร์ก่อน
 *              3) รัน compareShadowWithLive() เทียบ SB_ กับแท็บจริงให้ตรงกัน
 *              4) รัน installSupabaseSyncTrigger() ให้รันอัตโนมัติทุก 15 นาที
 */

// ---------- ค่าคงที่ ----------

var SYNC_HEADERS_ = {
  Tasks: ['id', 'workspace', 'title', 'project', 'day', 'weekStart', 'done', 'createdAt', 'completedAt', 'order'],
  Subtasks: ['id', 'taskId', 'title', 'done', 'createdAt'],
  Projects: ['workspace', 'projectName', 'createdAt'],
  Dreams: ['id', 'title', 'done', 'completedAt', 'createdAt']
};

var SYNC_LOG_SHEET_ = 'SyncLog';
var SYNC_LOG_HEADER_ = ['time', 'target', 'tasks', 'subtasks', 'projects', 'dreams', 'orphans', 'archived', 'dbUsagePct', 'durationMs', 'status', 'error'];
var SYNC_LOG_MAX_ROWS_ = 500;

var ARCHIVE_TASKS_SHEET_ = 'Archive_Tasks';
var ARCHIVE_SUBTASKS_SHEET_ = 'Archive_Subtasks';
var ARCHIVE_AGE_MS_ = 2 * 365 * 24 * 3600 * 1000;

// ---------- ตัวช่วย (2a) ----------

function getSyncTarget_() {
  var v = PropertiesService.getScriptProperties().getProperty('SYNC_TARGET');
  return v === 'live' ? 'live' : 'shadow';
}

function syncTabName_(base, target) {
  return target === 'live' ? base : ('SB_' + base);
}

// ดึงทุกแถวของ table ที่เป็นของ owner คนเดียว (single-user app) แบบแบ่งหน้า (PostgREST คืนสูงสุด 1000
// แถวต่อ request) วนจนกว่าจะได้หน้าที่มีแถวน้อยกว่า limit — ไม่ทำเช่นนี้จะได้ข้อมูลไม่ครบเงียบๆ
function supabaseSelectAll_(table) {
  var ownerId = getSupabaseOwnerId_();
  var limit = 1000;
  var offset = 0;
  var out = [];
  while (true) {
    var path = '/rest/v1/' + table + '?select=*&user_id=eq.' + ownerId +
      '&order=created_at.asc,id.asc&limit=' + limit + '&offset=' + offset;
    var res = supabaseRequest_('GET', path, null, null);
    var page = JSON.parse(res.text);
    out = out.concat(page);
    if (page.length < limit) break;
    offset += limit;
  }
  return out;
}

// สร้างแท็บใหม่พร้อมแถวหัวตาราง ถ้ายังไม่มี — ถ้ามีอยู่แล้วคืนกลับเฉยๆ ไม่แตะอะไรทั้งสิ้น
function getOrCreateSheet_(name, header) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return sheet;
}

// ---------- ตัวแปลงข้อมูลล้วนๆ (2b) — ห้ามแตะ Apps Script service ใดๆ เทสต์ได้ใน node ----------

/**
 * db = {tasks, subtasks, projects, dreams} ตามที่ supabaseSelectAll_ คืนมา (array ของ object จาก REST)
 * คืน { Tasks, Subtasks, Projects, Dreams, orphans } — object ทั้ง 4 ตารางคีย์ตามชื่อคอลัมน์ชีตเดิม
 */
function mapSupabaseToSheetRows_(db) {
  db = db || {};
  var dbTasks = db.tasks || [];
  var dbSubtasks = db.subtasks || [];
  var dbProjects = db.projects || [];
  var dbDreams = db.dreams || [];

  // id ที่เขียนลงชีต = legacy_id ถ้ามี ไม่งั้นใช้ uuid ตรงๆ — เก็บ map ไว้ให้ subtask หา parent ต่อ
  var taskWrittenId_ = {};
  var outTasks = dbTasks.map(function (t) {
    var writtenId = t.legacy_id || t.id;
    taskWrittenId_[t.id] = writtenId;
    return {
      id: writtenId,
      workspace: t.workspace,
      title: t.title,
      project: t.project || '',
      day: t.day || 'someday',
      weekStart: t.week_start || '',
      done: !!t.done,
      createdAt: t.created_at,
      completedAt: t.completed_at || '',
      order: (t.sort_order === null || t.sort_order === undefined) ? '' : t.sort_order
    };
  });
  outTasks.sort(function (a, b) {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  var orphans = 0;
  var outSubtasks = [];
  dbSubtasks.forEach(function (s) {
    var parentWrittenId = taskWrittenId_[s.task_id];
    if (parentWrittenId === undefined) {
      orphans++;
      return; // งานหลักหายไป (ถูกลบ/archive ไปแล้วแต่ subtask หลุดมา) — ทิ้ง subtask นี้
    }
    outSubtasks.push({
      id: s.legacy_id || s.id,
      taskId: parentWrittenId,
      title: s.title,
      done: !!s.done,
      createdAt: s.created_at
    });
  });
  outSubtasks.sort(function (a, b) {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });

  var outProjects = dbProjects.map(function (p) {
    return { workspace: p.workspace, projectName: p.name, createdAt: p.created_at };
  });
  outProjects.sort(function (a, b) {
    if (a.workspace < b.workspace) return -1;
    if (a.workspace > b.workspace) return 1;
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });

  var outDreams = dbDreams.map(function (d) {
    return {
      id: d.legacy_id || d.id,
      title: d.title,
      done: !!d.done,
      completedAt: d.completed_at || '',
      createdAt: d.created_at
    };
  });
  outDreams.sort(function (a, b) {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });

  return { Tasks: outTasks, Subtasks: outSubtasks, Projects: outProjects, Dreams: outDreams, orphans: orphans };
}

// ---------- ตัวเลือก archive ล้วนๆ (2c) ----------

/**
 * dbTasks/dbSubtasks = array ดิบจาก Supabase (ก่อน map), nowMs = เวลาปัจจุบันเป็น ms
 * คืน {tasks, subtasks} เฉพาะที่เข้าเกณฑ์ archive (done=true และ completed_at เก่ากว่า 2 ปี)
 */
function selectArchive_(dbTasks, dbSubtasks, nowMs) {
  var cutoffMs = nowMs - ARCHIVE_AGE_MS_;
  var archivedTasks = (dbTasks || []).filter(function (t) {
    return t.done === true && !!t.completed_at && Date.parse(t.completed_at) < cutoffMs;
  });
  var archivedIds = {};
  archivedTasks.forEach(function (t) { archivedIds[t.id] = true; });
  var archivedSubtasks = (dbSubtasks || []).filter(function (s) { return !!archivedIds[s.task_id]; });
  return { tasks: archivedTasks, subtasks: archivedSubtasks };
}

// ---------- เขียนตารางลงชีต (2d) ----------

/**
 * เขียน rowObjects (object คีย์ตามชื่อคอลัมน์) ลง sheet โดยใช้แถวหัวตารางที่มีอยู่แล้วถ้ามี ไม่งั้นใช้ header
 * ที่ส่งมา — เขียนแถวใหม่ก่อนเสมอ (setValues) แล้วค่อยล้างแถวที่เหลือด้านล่างทีหลัง (clearContent) กันแท็บ
 * ว่างเปล่าตรงกลางขั้นตอน ใช้ setValues 1 ครั้ง + clearContent อย่างมาก 1 ครั้งต่อการเรียกหนึ่งครั้ง
 */
function writeTable_(sheet, header, rowObjects) {
  var lastCol = sheet.getLastColumn();
  var useHeader = header;
  if (lastCol > 0) {
    var existingHeader = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (existingHeader && existingHeader.length > 0) useHeader = existingHeader;
  }

  var oldLastRow = sheet.getLastRow();
  var newCount = rowObjects.length;

  if (newCount > 0) {
    var values = rowObjects.map(function (obj) {
      return useHeader.map(function (col) { return obj[col] !== undefined ? obj[col] : ''; });
    });
    sheet.getRange(2, 1, values.length, useHeader.length).setValues(values);
    var newLastRow = 1 + values.length;
    if (oldLastRow > newLastRow) {
      sheet.getRange(newLastRow + 1, 1, oldLastRow - newLastRow, useHeader.length).clearContent();
    }
  } else if (oldLastRow > 1) {
    sheet.getRange(2, 1, oldLastRow - 1, useHeader.length).clearContent();
  }
}

// เพิ่มแถวต่อท้าย (ไม่ล้างของเดิม) ใช้สำหรับ SyncLog และ Archive_* — setValues ครั้งเดียวต่อการเรียก
function appendMappedRows_(sheet, header, rowObjects) {
  if (!rowObjects || rowObjects.length === 0) return;
  var lastCol = sheet.getLastColumn();
  var useHeader = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : header;
  var lastRow = sheet.getLastRow();
  var values = rowObjects.map(function (obj) {
    return useHeader.map(function (col) { return obj[col] !== undefined ? obj[col] : ''; });
  });
  sheet.getRange(lastRow + 1, 1, values.length, useHeader.length).setValues(values);
}

function existingIdSet_(sheetName) {
  var set = {};
  readRows_(sheetName).forEach(function (r) { set[String(r.id)] = true; });
  return set;
}

function chunkArray_(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function appendSyncLogRow_(row) {
  var sheet = getOrCreateSheet_(SYNC_LOG_SHEET_, SYNC_LOG_HEADER_);
  appendMappedRows_(sheet, SYNC_LOG_HEADER_, [row]);
  var dataRows = sheet.getLastRow() - 1;
  if (dataRows > SYNC_LOG_MAX_ROWS_) {
    sheet.deleteRows(2, dataRows - SYNC_LOG_MAX_ROWS_);
  }
}

// ---------- Courier หลัก (2e) ----------

/**
 * รันมือหรือผ่าน trigger ทุก 15 นาที — ดึงข้อมูลทั้งหมดจาก Supabase ก่อน แล้วค่อยเขียนชีต (ถ้าดึงพลาด
 * กลางทางจะไม่แตะชีตเลยสักแท็บ) โหมด live เท่านั้นที่ archive งานเก่า + ลบออกจาก Supabase
 */
function syncSupabaseToSheets() {
  var startMs = Date.now();
  var target = getSyncTarget_();
  var counts = { tasks: 0, subtasks: 0, projects: 0, dreams: 0, orphans: 0, archived: 0 };
  var dbUsagePct = 'n/a';
  var lock = null;

  try {
    var db = {
      tasks: supabaseSelectAll_('tasks'),
      subtasks: supabaseSelectAll_('subtasks'),
      projects: supabaseSelectAll_('projects'),
      dreams: supabaseSelectAll_('dreams')
    };

    // ล็อกเฉพาะโหมด live และเฉพาะช่วงเขียนชีต (หลังดึงข้อมูลเสร็จแล้ว) — lock ตัวนี้คือตัวเดียวกับที่ API เดิม
    // ใช้ตอนเขียน Tasks ถ้าถือไว้ตลอดช่วงดึงจาก Supabase จะทำให้แอพเดิมรอ/เฟลโดยไม่จำเป็น ส่วนโหมด shadow
    // เขียนคนละแท็บกับ API เดิมอยู่แล้ว ไม่ต้องล็อก
    if (target === 'live') {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }

    if (target === 'live') {
      var archive = selectArchive_(db.tasks, db.subtasks, Date.now());
      if (archive.tasks.length > 0) {
        var archiveTasksSheet = getOrCreateSheet_(ARCHIVE_TASKS_SHEET_, SYNC_HEADERS_.Tasks);
        var archiveSubtasksSheet = getOrCreateSheet_(ARCHIVE_SUBTASKS_SHEET_, SYNC_HEADERS_.Subtasks);

        // ใช้ mapper ตัวเดียวกันกับข้อมูลหลัก — เพราะ subtask ทุกตัวใน archive.subtasks มี parent
        // อยู่ใน archive.tasks แน่นอนอยู่แล้ว (selectArchive_ กรองมาแบบนั้น) จึงไม่มี orphan เกิดขึ้นตรงนี้
        var archiveMapped = mapSupabaseToSheetRows_({ tasks: archive.tasks, subtasks: archive.subtasks, projects: [], dreams: [] });

        var existingArchiveTaskIds = existingIdSet_(ARCHIVE_TASKS_SHEET_);
        var existingArchiveSubtaskIds = existingIdSet_(ARCHIVE_SUBTASKS_SHEET_);

        var newArchiveTasks = archiveMapped.Tasks.filter(function (r) { return !existingArchiveTaskIds[String(r.id)]; });
        var newArchiveSubtasks = archiveMapped.Subtasks.filter(function (r) { return !existingArchiveSubtaskIds[String(r.id)]; });

        appendMappedRows_(archiveTasksSheet, SYNC_HEADERS_.Tasks, newArchiveTasks);
        appendMappedRows_(archiveSubtasksSheet, SYNC_HEADERS_.Subtasks, newArchiveSubtasks);

        SpreadsheetApp.flush(); // ยืนยันว่า append ลง Archive_* เขียนจริงแล้ว ก่อนลบออกจาก Supabase

        var idsToDelete = archive.tasks.map(function (t) { return t.id; });
        chunkArray_(idsToDelete, 100).forEach(function (chunk) {
          supabaseRequest_('DELETE', '/rest/v1/tasks?id=in.(' + chunk.join(',') + ')', null, null);
        });

        var archivedTaskIdSet = {};
        archive.tasks.forEach(function (t) { archivedTaskIdSet[t.id] = true; });
        db.tasks = db.tasks.filter(function (t) { return !archivedTaskIdSet[t.id]; });
        db.subtasks = db.subtasks.filter(function (s) { return !archivedTaskIdSet[s.task_id]; });

        counts.archived = archive.tasks.length;
      }
    }

    var mapped = mapSupabaseToSheetRows_(db);
    counts.tasks = mapped.Tasks.length;
    counts.subtasks = mapped.Subtasks.length;
    counts.projects = mapped.Projects.length;
    counts.dreams = mapped.Dreams.length;
    counts.orphans = mapped.orphans;

    writeTable_(getOrCreateSheet_(syncTabName_('Tasks', target), SYNC_HEADERS_.Tasks), SYNC_HEADERS_.Tasks, mapped.Tasks);
    writeTable_(getOrCreateSheet_(syncTabName_('Subtasks', target), SYNC_HEADERS_.Subtasks), SYNC_HEADERS_.Subtasks, mapped.Subtasks);
    writeTable_(getOrCreateSheet_(syncTabName_('Projects', target), SYNC_HEADERS_.Projects), SYNC_HEADERS_.Projects, mapped.Projects);
    writeTable_(getOrCreateSheet_(syncTabName_('Dreams', target), SYNC_HEADERS_.Dreams), SYNC_HEADERS_.Dreams, mapped.Dreams);

    try {
      var res = supabaseRequest_('POST', '/rest/v1/rpc/db_size_bytes', {});
      var bytes = Number(JSON.parse(res.text));
      if (!isNaN(bytes)) {
        dbUsagePct = Math.round((bytes / (500 * 1024 * 1024)) * 1000) / 10;
      }
    } catch (usageErr) {
      dbUsagePct = 'n/a'; // ดูขนาด DB ไม่ได้ไม่ถือว่า sync ล้มเหลว
    }

    var durationMs = Date.now() - startMs;
    appendSyncLogRow_({
      time: new Date().toISOString(),
      target: target,
      tasks: counts.tasks,
      subtasks: counts.subtasks,
      projects: counts.projects,
      dreams: counts.dreams,
      orphans: counts.orphans,
      archived: counts.archived,
      dbUsagePct: dbUsagePct,
      durationMs: durationMs,
      status: 'OK',
      error: ''
    });

    Logger.log('ซิงค์สำเร็จ (โหมด ' + target + '): tasks ' + counts.tasks + ', subtasks ' + counts.subtasks +
      ', projects ' + counts.projects + ', dreams ' + counts.dreams + ', orphan subtask ' + counts.orphans +
      ' ตัว, archive ' + counts.archived + ' งาน, ใช้พื้นที่ DB ' + dbUsagePct + '%, ใช้เวลา ' + durationMs + ' ms');
  } catch (err) {
    var errMsg = String(err && err.message ? err.message : err).slice(0, 300);
    try {
      appendSyncLogRow_({
        time: new Date().toISOString(),
        target: target,
        tasks: counts.tasks,
        subtasks: counts.subtasks,
        projects: counts.projects,
        dreams: counts.dreams,
        orphans: counts.orphans,
        archived: counts.archived,
        dbUsagePct: dbUsagePct,
        durationMs: Date.now() - startMs,
        status: 'ERROR',
        error: errMsg
      });
    } catch (logErr) {
      Logger.log('บันทึกแถว ERROR ลง SyncLog ไม่สำเร็จ: ' + logErr.message);
    }
    Logger.log('❌ ซิงค์ล้มเหลว: ' + errMsg);
    throw err; // โยนต่อ ให้อีเมลแจ้งความล้มเหลวของ Apps Script ทำงาน
  } finally {
    if (lock) lock.releaseLock();
  }
}

// ---------- ตรวจความตรงกัน Shadow vs Live (2f) — อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น ----------

function normalizeSyncDone_(v) {
  return v === true || v === 'TRUE';
}

function normalizeSyncOrder_(v) {
  if (v === '' || v === null || v === undefined) return '';
  return String(v);
}

function normalizeSyncDateOnly_(v) {
  if (isDateObj_(v)) return toIso_(v);
  if (typeof v === 'string') return v.trim();
  return (v === null || v === undefined) ? '' : String(v);
}

function normalizeSyncTimestamp_(v) {
  if (isDateObj_(v)) return v.toISOString();
  if (typeof v === 'string') return v.trim();
  return (v === null || v === undefined) ? '' : String(v);
}

function normalizeSyncStr_(v) {
  if (typeof v === 'string') return v.trim();
  return (v === null || v === undefined) ? '' : String(v);
}

var SYNC_COMPARE_FIELDS_ = {
  Tasks: [
    { field: 'workspace', normalize: normalizeSyncStr_ },
    { field: 'title', normalize: normalizeSyncStr_ },
    { field: 'project', normalize: normalizeSyncStr_ },
    { field: 'day', normalize: normalizeSyncDateOnly_ },
    { field: 'done', normalize: normalizeSyncDone_ },
    { field: 'order', normalize: normalizeSyncOrder_ },
    // completedAt: เทียบแค่ "มีค่าหรือไม่" ไม่เทียบตัวเลขวินาที (ดู CONTEXT: "completedAt present or not")
    { field: 'completedAt', normalize: function (v) { return normalizeSyncTimestamp_(v) !== ''; } }
  ],
  Subtasks: [
    { field: 'taskId', normalize: normalizeSyncStr_ },
    { field: 'title', normalize: normalizeSyncStr_ },
    { field: 'done', normalize: normalizeSyncDone_ }
  ],
  Dreams: [
    { field: 'title', normalize: normalizeSyncStr_ },
    { field: 'done', normalize: normalizeSyncDone_ }
  ]
};

function syncKeyById_(row) { return String(row.id); }
function syncKeyByProject_(row) { return String(row.workspace) + '|' + String(row.projectName); }

function compareSyncTable_(label, liveRows, shadowRows, fields, keyFn) {
  var liveByKey = {};
  liveRows.forEach(function (r) { liveByKey[keyFn(r)] = r; });
  var shadowByKey = {};
  shadowRows.forEach(function (r) { shadowByKey[keyFn(r)] = r; });

  var onlyLive = Object.keys(liveByKey).filter(function (k) { return !shadowByKey.hasOwnProperty(k); });
  var onlyShadow = Object.keys(shadowByKey).filter(function (k) { return !liveByKey.hasOwnProperty(k); });

  var diffRows = [];
  Object.keys(liveByKey).forEach(function (k) {
    if (!shadowByKey.hasOwnProperty(k)) return;
    var l = liveByKey[k], s = shadowByKey[k];
    var diffFields = [];
    fields.forEach(function (f) {
      if (f.normalize(l[f.field]) !== f.normalize(s[f.field])) diffFields.push(f.field);
    });
    if (diffFields.length > 0) diffRows.push({ id: k, fields: diffFields });
  });

  Logger.log('--- ' + label + ' --- live: ' + liveRows.length + ' แถว, shadow: ' + shadowRows.length + ' แถว');
  if (onlyLive.length) Logger.log(label + ': มีเฉพาะใน live (' + onlyLive.length + ' รายการ): ' + onlyLive.slice(0, 20).join(', '));
  if (onlyShadow.length) Logger.log(label + ': มีเฉพาะใน shadow (' + onlyShadow.length + ' รายการ): ' + onlyShadow.slice(0, 20).join(', '));
  if (diffRows.length) {
    Logger.log(label + ': แถวที่ค่าต่างกัน (' + diffRows.length + ' แถว) แสดง 20 แถวแรก:');
    diffRows.slice(0, 20).forEach(function (d) {
      Logger.log('  id=' + d.id + ' ฟิลด์ที่ต่าง: ' + d.fields.join(', '));
    });
  }

  return onlyLive.length + onlyShadow.length + diffRows.length;
}

function compareSyncProjects_(liveRows, shadowRows) {
  var liveKeys = {};
  liveRows.forEach(function (r) { liveKeys[syncKeyByProject_(r)] = true; });
  var shadowKeys = {};
  shadowRows.forEach(function (r) { shadowKeys[syncKeyByProject_(r)] = true; });

  var onlyLive = Object.keys(liveKeys).filter(function (k) { return !shadowKeys[k]; });
  var onlyShadow = Object.keys(shadowKeys).filter(function (k) { return !liveKeys[k]; });

  Logger.log('--- Projects --- live: ' + liveRows.length + ' แถว, shadow: ' + shadowRows.length + ' แถว');
  if (onlyLive.length) Logger.log('Projects: มีเฉพาะใน live (' + onlyLive.length + ' รายการ): ' + onlyLive.slice(0, 20).join(', '));
  if (onlyShadow.length) Logger.log('Projects: มีเฉพาะใน shadow (' + onlyShadow.length + ' รายการ): ' + onlyShadow.slice(0, 20).join(', '));

  return onlyLive.length + onlyShadow.length;
}

/**
 * ตรวจความตรงกันระหว่างแท็บจริง (Tasks/Subtasks/Projects/Dreams) กับแท็บ shadow (SB_*) — อ่านอย่างเดียว
 * ไม่เขียนอะไรทั้งสิ้น ควรรันหลังจาก syncSupabaseToSheets() อย่างน้อยหนึ่งรอบ (ไม่งั้นแท็บ SB_* จะยังไม่มี)
 */
function compareShadowWithLive() {
  Logger.log('===== ตรวจสอบความตรงกันระหว่างแท็บจริงกับแท็บ shadow (SB_) — โหมดปัจจุบัน: ' + getSyncTarget_() + ' =====');

  var liveTasks = readRows_(TASKS_SHEET);
  var shadowTasks = readRows_('SB_' + TASKS_SHEET);
  var liveSubtasks = readRows_(SUBTASKS_SHEET);
  var shadowSubtasks = readRows_('SB_' + SUBTASKS_SHEET);
  var liveProjects = readRows_(PROJECTS_SHEET);
  var shadowProjects = readRows_('SB_' + PROJECTS_SHEET);
  var liveDreams = readRows_(DREAMS_SHEET);
  var shadowDreams = readRows_('SB_' + DREAMS_SHEET);

  var totalDiffs = 0;
  totalDiffs += compareSyncTable_('Tasks', liveTasks, shadowTasks, SYNC_COMPARE_FIELDS_.Tasks, syncKeyById_);
  totalDiffs += compareSyncTable_('Subtasks', liveSubtasks, shadowSubtasks, SYNC_COMPARE_FIELDS_.Subtasks, syncKeyById_);
  totalDiffs += compareSyncProjects_(liveProjects, shadowProjects);
  totalDiffs += compareSyncTable_('Dreams', liveDreams, shadowDreams, SYNC_COMPARE_FIELDS_.Dreams, syncKeyById_);

  if (totalDiffs === 0) {
    Logger.log('✅ ตรงกันทั้งหมด');
  } else {
    Logger.log('⚠️ พบความต่าง ' + totalDiffs + ' จุด');
  }
}

// ---------- ติดตั้ง/ถอด trigger (2g) — ตามสไตล์ installLineTriggers/removeLineTriggers ใน Triggers.gs ----------

/**
 * รันฟังก์ชันนี้ครั้งเดียวจากหน้า editor เพื่อติดตั้ง trigger ให้ syncSupabaseToSheets รันอัตโนมัติทุก 15
 * นาที (ลบ trigger เดิมที่ชื่อซ้ำก่อนเสมอ กันเผลอรันซ้ำแล้วได้ trigger ซ้อนกันหลายอัน)
 */
function installSupabaseSyncTrigger() {
  removeSupabaseSyncTrigger();
  ScriptApp.newTrigger('syncSupabaseToSheets')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('ติดตั้ง trigger สำเร็จ: syncSupabaseToSheets จะรันอัตโนมัติทุก 15 นาที (โหมดปัจจุบัน: ' + getSyncTarget_() + ')');
}

function removeSupabaseSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncSupabaseToSheets') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('ลบ trigger syncSupabaseToSheets (ถ้ามี) เรียบร้อย');
}
