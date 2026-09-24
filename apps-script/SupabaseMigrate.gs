/**
 * ย้ายข้อมูลครั้งเดียวจาก Google Sheets ไป Supabase (เตรียมของก่อนแอพเปลี่ยนไปใช้ Supabase จริง)
 * ลำดับการรัน (จากหน้า Apps Script editor เลือกชื่อฟังก์ชันแล้วกด Run): testSupabaseConnection()
 * ก่อน แล้วค่อย migrateToSupabaseDryRun() ดูรายงานให้แน่ใจ สุดท้ายค่อย migrateToSupabase() จริง
 * อ่านจาก Sheets อย่างเดียว ไม่แก้ชีต — ทุกฟังก์ชันในไฟล์นี้ไม่มีการเขียนกลับ Google Sheets เลย
 * migrateToSupabase() ปลอดภัยที่จะรันซ้ำได้เสมอ (มันล้างของเดิมของ owner แล้วเขียนใหม่ทุกครั้ง)
 * — จนกว่าแอพเวอร์ชันใหม่จะเริ่มเขียนข้อมูลเองลง Supabase โดยตรง (มี guard กันไว้ให้ ดูจุดที่ 1
 * ใน migrateToSupabase() ด้านล่าง)
 */

// ---------- ตัวช่วยแปลงค่า (pure function ล้วนๆ ไม่มี Apps Script service — เทสต์ได้ใน node) ----------

function isDone_(v) {
  return v === true || v === 'TRUE' || v === 'true';
}

// เช็คว่าเป็น Date object ด้วย Object.prototype.toString แทน "instanceof Date" ตรงๆ เพราะ
// instanceof ผูกกับ constructor ของ realm/context ที่สร้างมัน (เช่นตอนรันเทสต์ผ่าน node:vm
// ที่ค่า Date ของฝั่งเทสต์กับของโค้ดในนี้คนละ constructor กัน instanceof จะได้ false ทั้งที่เป็น Date จริง)
function isDateObj_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

// Sheets คืนวันที่มาเป็น Date object บ้าง string บ้าง แปลงทุกอย่างให้เป็น ISO timestamp เดียวกัน
// ถ้าแปลงไม่ได้ (ว่าง/format แปลกๆ) คืน null แล้วให้ผู้เรียกใส่ fallback เอาเอง
function toTs_(v) {
  if (isDateObj_(v)) return v.toISOString();
  if (typeof v === 'string' && v.trim() !== '') {
    var d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function isPositiveInt_(v) {
  if (v === '' || v === null || v === undefined) return false;
  var n = Number(v);
  return !isNaN(n) && n === Math.floor(n) && n >= 1;
}

/**
 * แปลงข้อมูลดิบจาก Sheets (readRows_) ให้เป็น payload พร้อมส่งเข้า Supabase
 * ฟังก์ชันนี้จงใจไม่แตะ Apps Script service ใดๆ เลย (ไม่มี Utilities/Logger/SpreadsheetApp)
 * เพื่อให้ node ทดสอบ logic การแปลงได้ตรงๆ โดยไม่ต้องจำลอง Apps Script ทั้งระบบ
 * newUuid/isoDate/nowIso ถูก inject เข้ามาจากผู้เรียก (Apps Script ส่ง Utilities.getUuid/toIso_ จริง
 * ส่วน node test ส่ง stub เข้ามาแทน)
 */
function buildMigrationPayload_(data, ownerId, newUuid, isoDate, nowIso) {
  var skipped = [];
  var warnings = [];

  // ===== Tasks =====
  var outTasks = [];
  var taskIdMap = {}; // legacyId (string) -> uuid ใหม่ — เก็บเฉพาะ task ที่รอดจนถูกเก็บจริงเท่านั้น
  (data.tasks || []).forEach(function (t) {
    var legacyId = String(t.id);

    if (t.workspace !== 'Personal' && t.workspace !== 'Office') {
      skipped.push({ table: 'tasks', legacyId: legacyId, reason: 'workspace ไม่ถูกต้อง (ต้องเป็น Personal หรือ Office)' });
      return;
    }
    var title = String(t.title == null ? '' : t.title).trim();
    if (title === '') {
      skipped.push({ table: 'tasks', legacyId: legacyId, reason: 'title ว่าง' });
      return;
    }
    if (taskIdMap.hasOwnProperty(legacyId)) {
      skipped.push({ table: 'tasks', legacyId: legacyId, reason: 'id ซ้ำ (เก็บแถวแรกไว้)' });
      return;
    }

    var rawDay = t.day;
    var day;
    if (isDateObj_(rawDay)) {
      day = isoDate(rawDay);
    } else if (typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay)) {
      day = rawDay;
    } else if (rawDay === 'someday') {
      day = null;
    } else if (rawDay === '') {
      day = null;
      warnings.push({ table: 'tasks', legacyId: legacyId, note: 'day ว่าง → ย้ายไป someday' });
    } else {
      skipped.push({ table: 'tasks', legacyId: legacyId, reason: 'day รูปแบบไม่ถูกต้อง (ได้รับ: ' + rawDay + ')' });
      return;
    }

    // ถ้ามีวันจริง และ order เป็นเลขจำนวนเต็ม >= 1 ก็ยังใช้ลำดับเดิมได้ ไม่งั้นปล่อย null ให้ DB
    // trigger ต่อท้ายลำดับให้เอง (ดู DB triggers ใน context ของแผน) กันเลขลำดับชนกันเอง
    var sortOrder = (day !== null && isPositiveInt_(t.order)) ? Number(t.order) : null;

    var done = isDone_(t.done);

    // createdAt ว่าง/อ่านไม่ได้ ใช้เวลาปัจจุบัน (nowIso) แทน เพื่อให้แถวยังมี timestamp ใช้งานได้
    // (ไม่ใช้ null เพราะคอลัมน์ created_at ฝั่ง Supabase เป็น not null) แล้วเตือนไว้เผื่อต้องตามแก้
    var createdRaw = toTs_(t.createdAt);
    var createdAt = createdRaw || nowIso;
    if (!createdRaw) warnings.push({ table: 'tasks', legacyId: legacyId, note: 'createdAt ว่าง/อ่านไม่ได้ → ใช้เวลาปัจจุบันแทน' });

    var completedAt = null;
    if (done) {
      var completedRaw = toTs_(t.completedAt);
      completedAt = completedRaw || createdAt;
      if (!completedRaw) warnings.push({ table: 'tasks', legacyId: legacyId, note: 'done=true แต่ completedAt ว่าง/อ่านไม่ได้ → ใช้ createdAt แทน' });
    }

    var row = {
      id: newUuid(),
      legacy_id: legacyId,
      user_id: ownerId,
      workspace: t.workspace,
      title: title,
      project: String(t.project == null ? '' : t.project).trim(),
      day: day,
      sort_order: sortOrder,
      done: done,
      completed_at: completedAt,
      created_at: createdAt
    };
    taskIdMap[legacyId] = row.id;
    outTasks.push(row);
  });

  // เรียงตาม created_at จากเก่าไปใหม่ ก่อนส่ง เพื่อให้แถวที่ DB ต้องจัดลำดับเอง (sort_order = null)
  // ได้ลำดับที่สมเหตุสมผล (เรียงตามเวลาสร้างเดิม ไม่ใช่ลำดับสุ่มตามที่อ่านมาจากชีต)
  outTasks.sort(function (a, b) {
    if (a.created_at < b.created_at) return -1;
    if (a.created_at > b.created_at) return 1;
    return 0;
  });

  // ===== Subtasks =====
  var outSubtasks = [];
  var seenSubtaskIds = {};
  (data.subtasks || []).forEach(function (s) {
    var legacyId = String(s.id);

    if (!taskIdMap.hasOwnProperty(String(s.taskId))) {
      skipped.push({ table: 'subtasks', legacyId: legacyId, reason: 'งานหลักไม่มีอยู่/ถูกข้าม' });
      return;
    }
    var title = String(s.title == null ? '' : s.title).trim();
    if (title === '') {
      skipped.push({ table: 'subtasks', legacyId: legacyId, reason: 'title ว่าง' });
      return;
    }
    if (seenSubtaskIds.hasOwnProperty(legacyId)) {
      skipped.push({ table: 'subtasks', legacyId: legacyId, reason: 'id ซ้ำ (เก็บแถวแรกไว้)' });
      return;
    }
    seenSubtaskIds[legacyId] = true;

    var createdRaw = toTs_(s.createdAt);
    var createdAt = createdRaw || nowIso;
    if (!createdRaw) warnings.push({ table: 'subtasks', legacyId: legacyId, note: 'createdAt ว่าง/อ่านไม่ได้ → ใช้เวลาปัจจุบันแทน' });

    outSubtasks.push({
      id: newUuid(),
      legacy_id: legacyId,
      user_id: ownerId,
      task_id: taskIdMap[String(s.taskId)],
      title: title,
      done: isDone_(s.done),
      created_at: createdAt
    });
  });

  // ===== Projects (ไม่มี id ในชีตเดิม — ใช้ชื่อ project เป็นตัวอ้างอิงตอน log รายการที่ข้าม) =====
  var outProjects = [];
  var seenProjectKeys = {};
  (data.projects || []).forEach(function (p) {
    var name = String(p.projectName == null ? '' : p.projectName).trim();
    var refId = name || '(ไม่มีชื่อ)';

    if (p.workspace !== 'Personal' && p.workspace !== 'Office') {
      skipped.push({ table: 'projects', legacyId: refId, reason: 'workspace ไม่ถูกต้อง (ต้องเป็น Personal หรือ Office)' });
      return;
    }
    if (name === '') {
      skipped.push({ table: 'projects', legacyId: refId, reason: 'ชื่อ project ว่าง' });
      return;
    }
    var key = p.workspace + '|' + name;
    if (seenProjectKeys.hasOwnProperty(key)) {
      skipped.push({ table: 'projects', legacyId: refId, reason: 'ซ้ำ' });
      return;
    }
    seenProjectKeys[key] = true;

    var createdRaw = toTs_(p.createdAt);
    var createdAt = createdRaw || nowIso;
    if (!createdRaw) warnings.push({ table: 'projects', legacyId: refId, note: 'createdAt ว่าง/อ่านไม่ได้ → ใช้เวลาปัจจุบันแทน' });

    outProjects.push({
      id: newUuid(),
      user_id: ownerId,
      workspace: p.workspace,
      name: name,
      created_at: createdAt
    });
  });

  // ===== Dreams =====
  var outDreams = [];
  var seenDreamIds = {};
  (data.dreams || []).forEach(function (d) {
    var legacyId = String(d.id);
    var title = String(d.title == null ? '' : d.title).trim();
    if (title === '') {
      skipped.push({ table: 'dreams', legacyId: legacyId, reason: 'title ว่าง' });
      return;
    }
    if (seenDreamIds.hasOwnProperty(legacyId)) {
      skipped.push({ table: 'dreams', legacyId: legacyId, reason: 'id ซ้ำ (เก็บแถวแรกไว้)' });
      return;
    }
    seenDreamIds[legacyId] = true;

    var done = isDone_(d.done);
    var createdRaw = toTs_(d.createdAt);
    var createdAt = createdRaw || nowIso;
    if (!createdRaw) warnings.push({ table: 'dreams', legacyId: legacyId, note: 'createdAt ว่าง/อ่านไม่ได้ → ใช้เวลาปัจจุบันแทน' });

    var completedAt = null;
    if (done) {
      var completedRaw = toTs_(d.completedAt);
      completedAt = completedRaw || createdAt;
      if (!completedRaw) warnings.push({ table: 'dreams', legacyId: legacyId, note: 'done=true แต่ completedAt ว่าง/อ่านไม่ได้ → ใช้ createdAt แทน' });
    }

    outDreams.push({
      id: newUuid(),
      legacy_id: legacyId,
      user_id: ownerId,
      title: title,
      done: done,
      completed_at: completedAt,
      created_at: createdAt
    });
  });

  return {
    tasks: outTasks,
    subtasks: outSubtasks,
    projects: outProjects,
    dreams: outDreams,
    skipped: skipped,
    warnings: warnings
  };
}

// ---------- อ่านข้อมูลดิบจาก Sheets (อ่านอย่างเดียว ไม่เขียน) ----------

// ห่อ Utilities.getUuid ไว้ในฟังก์ชันของเราเอง — ส่ง method ของ service ออกไปเรียกแบบหลุด object
// (ไม่มี Utilities. นำหน้า) ไม่รับประกันว่าจะทำงานใน Apps Script
function newUuid_() {
  return Utilities.getUuid();
}

function readSheetsForMigration_() {
  return {
    tasks: readRows_(TASKS_SHEET),
    subtasks: readRows_(SUBTASKS_SHEET),
    projects: readRows_(PROJECTS_SHEET),
    dreams: readRows_(DREAMS_SHEET)
  };
}

// ---------- รายงานผล (Logger.log ภาษาไทยทั้งหมด อ่านง่ายสำหรับคนไม่เขียนโปรแกรม) ----------

function logMigrationPlan_(payload, rawData) {
  var tables = [
    { key: 'tasks', label: 'Tasks', rawCount: rawData.tasks.length },
    { key: 'subtasks', label: 'Subtasks', rawCount: rawData.subtasks.length },
    { key: 'projects', label: 'Projects', rawCount: rawData.projects.length },
    { key: 'dreams', label: 'Dreams', rawCount: rawData.dreams.length }
  ];

  Logger.log('===== แผนการย้ายข้อมูล =====');
  tables.forEach(function (t) {
    var copyCount = payload[t.key].length;
    var skipCount = payload.skipped.filter(function (s) { return s.table === t.key; }).length;
    Logger.log(t.label + ': ในชีตมี ' + t.rawCount + ' แถว, จะย้าย ' + copyCount + ' แถว, ข้าม ' + skipCount + ' แถว');
  });

  var doneCount = payload.tasks.filter(function (t) { return t.done; }).length;
  var somedayCount = payload.tasks.filter(function (t) { return t.day === null; }).length;
  var nullOrderOnRealDay = payload.tasks.filter(function (t) { return t.day !== null && t.sort_order === null; }).length;
  Logger.log('Tasks เพิ่มเติม: เสร็จแล้ว ' + doneCount + ' งาน, ไปอยู่ someday ' + somedayCount + ' งาน, มีวันจริงแต่ไม่มีลำดับ(ให้ DB จัดต่อท้ายเอง) ' + nullOrderOnRealDay + ' งาน');

  Logger.log('----- รายการที่ข้าม (' + payload.skipped.length + ' รายการ) -----');
  payload.skipped.forEach(function (s) {
    Logger.log('ข้าม [' + s.table + '] id เดิม=' + s.legacyId + ' เหตุผล: ' + s.reason);
  });

  Logger.log('----- คำเตือน (' + payload.warnings.length + ' รายการ) -----');
  var shown = payload.warnings.slice(0, 30);
  shown.forEach(function (w) {
    Logger.log('เตือน [' + w.table + '] id เดิม=' + w.legacyId + ': ' + w.note);
  });
  if (payload.warnings.length > 30) {
    Logger.log('...และอีก ' + (payload.warnings.length - 30) + ' รายการ');
  }
}

// ---------- ฟังก์ชันที่รันจากหน้า Apps Script editor ได้ (ไม่มี _ ต่อท้าย = ขึ้น Run menu) ----------

/**
 * เช็คว่า config ครบและเชื่อมต่อ Supabase ได้จริงหรือยัง (อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น)
 * รันตัวนี้เป็นอันดับแรกเสมอ ก่อน migrateToSupabaseDryRun() และ migrateToSupabase()
 */
function testSupabaseConnection() {
  try {
    var url = getSupabaseUrl_();
    var ownerId = getSupabaseOwnerId_();
    var key = getSupabaseSecretKey_();
    // ห้าม log key เต็มๆ เด็ดขาด — โชว์แค่ 10 ตัวแรก + ความยาวทั้งหมด พอให้เช็คว่าตั้งค่าถูกไฟล์
    var masked = key.slice(0, 10) + '…(ยาว ' + key.length + ' ตัวอักษร)';

    Logger.log('SUPABASE_URL: ' + url);
    Logger.log('SUPABASE_OWNER_ID: ' + ownerId);
    Logger.log('SUPABASE_SECRET_KEY: ' + masked);

    ['tasks', 'subtasks', 'projects', 'dreams'].forEach(function (table) {
      var count = supabaseCount_(table);
      Logger.log('จำนวนแถวใน ' + table + ' ตอนนี้: ' + count + ' แถว');
    });

    Logger.log('✅ เชื่อมต่อ Supabase สำเร็จ');
  } catch (e) {
    Logger.log('❌ เชื่อมต่อ Supabase ไม่สำเร็จ: ' + e.message);
    throw e;
  }
}

/**
 * อ่านข้อมูลจาก Sheets + แปลงตามกติกาทั้งหมด แล้วรายงานว่าจะย้ายอะไรบ้าง — ไม่เขียนอะไรลง Supabase
 * หรือ Sheets เลยแม้แต่นิดเดียว (ยิง Supabase เฉพาะ GET เพื่ออ่านจำนวนแถวปัจจุบันมาโชว์เทียบ)
 * ควรรันตัวนี้ดูผลให้แน่ใจก่อนรัน migrateToSupabase() จริงเสมอ
 */
function migrateToSupabaseDryRun() {
  var rawData = readSheetsForMigration_();
  var payload = buildMigrationPayload_(rawData, getSupabaseOwnerId_(), newUuid_, toIso_, new Date().toISOString());
  logMigrationPlan_(payload, rawData);

  Logger.log('----- จำนวนแถวใน Supabase ตอนนี้ (ก่อนย้ายจริง) -----');
  ['tasks', 'subtasks', 'projects', 'dreams'].forEach(function (table) {
    Logger.log(table + ': ' + supabaseCount_(table) + ' แถว');
  });

  Logger.log('🔎 DRY RUN — ยังไม่ได้เขียนอะไรลง Supabase');
  return payload;
}

/**
 * ย้ายข้อมูลจริง: ล้างของเดิมของ owner นี้ใน Supabase แล้วเขียนใหม่ทั้งหมด จากนั้นตรวจนับให้แน่ใจว่าตรงกัน
 * ปลอดภัยที่จะกดรันซ้ำได้เสมอ เพราะขั้นตอนนี้ล้าง+เขียนใหม่ทุกครั้ง ไม่ใช่การเพิ่มทับ
 */
function migrateToSupabase() {
  // 1. Guard กันย้ายทับข้อมูลที่แอพเวอร์ชันใหม่สร้างขึ้นเองแล้ว (แถวที่แอพใหม่สร้างจะไม่มี legacy_id
  // เพราะมันไม่ได้มาจาก Sheets) ถ้าเจอแบบนี้แปลว่าย้ายไปแล้วรอบหนึ่ง แอพเริ่มใช้งานจริงแล้ว ห้ามลบทับ
  var tasksFromNewApp = supabaseCount_('tasks', 'legacy_id=is.null');
  var dreamsFromNewApp = supabaseCount_('dreams', 'legacy_id=is.null');
  if (tasksFromNewApp > 0 || dreamsFromNewApp > 0) {
    throw new Error('พบข้อมูลที่สร้างจากแอพใหม่แล้ว — ยกเลิกเพื่อไม่ให้ลบทับ');
  }

  var rawData = readSheetsForMigration_();
  var ownerId = getSupabaseOwnerId_();
  var payload = buildMigrationPayload_(rawData, ownerId, newUuid_, toIso_, new Date().toISOString());
  logMigrationPlan_(payload, rawData);

  try {
    // 2. ล้างข้อมูลเดิมของ owner คนนี้ก่อนเขียนใหม่ — ลำดับ tasks -> projects -> dreams ตามที่ตกลงกัน
    // (ลบ tasks จะ cascade ไปลบ subtasks และ line_index ของ task นั้นให้เองผ่าน FK ไม่ต้องลบแยก)
    Logger.log('----- ล้างข้อมูลเดิมใน Supabase -----');
    supabaseRequest_('DELETE', '/rest/v1/tasks?user_id=eq.' + ownerId, null, null);
    Logger.log('ลบ tasks เดิม (พ่วง subtasks จาก cascade) แล้ว');
    supabaseRequest_('DELETE', '/rest/v1/projects?user_id=eq.' + ownerId, null, null);
    Logger.log('ลบ projects เดิมแล้ว');
    supabaseRequest_('DELETE', '/rest/v1/dreams?user_id=eq.' + ownerId, null, null);
    Logger.log('ลบ dreams เดิมแล้ว');

    // 3. เขียนข้อมูลใหม่ — ต้องเป็น tasks ก่อน subtasks เสมอ เพราะ subtasks อ้าง task_id (FK)
    // ต้องมี task ปลายทางอยู่แล้วก่อนถึงจะ insert subtask ได้
    Logger.log('----- เขียนข้อมูลใหม่ลง Supabase -----');
    Logger.log('tasks: ส่งไป ' + supabaseInsertBatched_('tasks', payload.tasks) + ' แถว');
    Logger.log('subtasks: ส่งไป ' + supabaseInsertBatched_('subtasks', payload.subtasks) + ' แถว');
    Logger.log('projects: ส่งไป ' + supabaseInsertBatched_('projects', payload.projects) + ' แถว');
    Logger.log('dreams: ส่งไป ' + supabaseInsertBatched_('dreams', payload.dreams) + ' แถว');
  } catch (e) {
    Logger.log('❌ เขียนข้อมูลไม่สำเร็จระหว่างทาง: ' + e.message);
    Logger.log('ไม่ต้องตกใจ — รัน migrateToSupabase() ซ้ำได้ทันที เพราะขั้นตอนนี้ล้างของเดิมแล้วเขียนใหม่ทุกครั้งอยู่แล้ว');
    throw e;
  }

  // 4. ตรวจนับ: เทียบจำนวนที่ควรมี (จาก payload ที่สร้างไว้) กับจำนวนจริงที่อยู่ใน Supabase ตอนนี้
  Logger.log('----- ตรวจสอบผลลัพธ์ -----');
  var checks = [
    { label: 'tasks', expected: payload.tasks.length, actual: supabaseCount_('tasks') },
    { label: 'subtasks', expected: payload.subtasks.length, actual: supabaseCount_('subtasks') },
    { label: 'projects', expected: payload.projects.length, actual: supabaseCount_('projects') },
    { label: 'dreams', expected: payload.dreams.length, actual: supabaseCount_('dreams') },
    { label: 'tasks (เสร็จแล้ว)', expected: payload.tasks.filter(function (t) { return t.done; }).length, actual: supabaseCount_('tasks', 'done=eq.true') },
    { label: 'tasks (someday)', expected: payload.tasks.filter(function (t) { return t.day === null; }).length, actual: supabaseCount_('tasks', 'day=is.null') }
  ];

  var allOk = true;
  Logger.log('ตาราง | ควรมี | มีจริง | ผล');
  checks.forEach(function (c) {
    var ok = c.expected === c.actual;
    if (!ok) allOk = false;
    Logger.log(c.label + ' | ' + c.expected + ' | ' + c.actual + ' | ' + (ok ? '✅' : '❌'));
  });

  if (allOk) {
    Logger.log('✅ ย้ายข้อมูลสำเร็จ ตัวเลขตรงทุกตาราง');
  } else {
    Logger.log('❌ ตัวเลขไม่ตรง — ส่ง log นี้ให้ Claude ดู');
    throw new Error('ตัวเลขหลังย้ายข้อมูลไม่ตรงกับแผน (ดูรายละเอียดใน Logger.log ด้านบน)');
  }
}
