/**
 * ฟังก์ชันดูแลระบบ รันเองครั้งคราวจากหน้า editor เท่านั้น ไม่ผูกกับ Web App
 */

// ลบข้อมูลทดสอบทั้งหมดในแท็บ Tasks, Projects, Subtasks (เก็บแถวหัวตารางไว้) — ใช้ตอนเคลียร์ข้อมูลก่อนเริ่มใช้งานจริง
function resetTestData() {
  [TASKS_SHEET, PROJECTS_SHEET, SUBTASKS_SHEET].forEach(function (name) {
    var sheet = getSheet_(name);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  });
  Logger.log('ลบข้อมูลทดสอบใน Tasks และ Projects เรียบร้อย (เหลือแค่แถวหัวตาราง)');
}

// รันครั้งเดียวเพื่อสร้างแท็บ Subtasks (ถ้ายังไม่มี) พร้อมหัวตาราง — ต้องรันก่อนใช้ฟีเจอร์งานย่อยได้
function setupSubtasksSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SUBTASKS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SUBTASKS_SHEET);
  }
  var header = ['id', 'taskId', 'title', 'done', 'createdAt'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  Logger.log('สร้างแท็บ "' + SUBTASKS_SHEET + '" พร้อมหัวตารางเรียบร้อยแล้ว');
}

/**
 * รันครั้งเดียวเพื่อเพิ่มคอลัมน์ "order" ในแท็บ Tasks (ถ้ายังไม่มี) แล้วเติมเลขลำดับให้งานเก่าทุกงาน
 * ที่มีอยู่แล้ว (เรียงตาม createdAt เดิมภายในแต่ละ workspace+day) — ต้องรันก่อนใช้ฟีเจอร์ลากจัดลำดับได้
 * งาน someday ไม่ต้องมี order (เว้นว่างไว้ตามปกติ)
 */
function migrateTaskOrder() {
  var sheet = getSheet_(TASKS_SHEET);
  var header = getHeader_(sheet);
  if (header.indexOf('order') === -1) {
    sheet.getRange(1, header.length + 1).setValue('order');
  }

  var groups = {};
  readRows_(TASKS_SHEET).map(normalizeTaskRow_).forEach(function (t) {
    if (t.day === 'someday') return;
    var key = t.workspace + '|' + t.day;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  var updated = 0;
  Object.keys(groups).forEach(function (key) {
    groups[key]
      .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; })
      .forEach(function (t, i) {
        updateRowFields_(TASKS_SHEET, t.__row, { order: i + 1 });
        updated++;
      });
  });

  Logger.log('เติมค่า order ให้งานเก่าเรียบร้อย: ' + updated + ' งาน');
}

// รันครั้งเดียวเพื่อสร้างแท็บ Dreams (ถ้ายังไม่มี) พร้อมหัวตาราง แล้วเติมลิสต์ TRUE DREAM เริ่มต้นให้
// (ข้ามการเติมถ้ามีข้อมูลอยู่แล้ว กันรันซ้ำแล้วได้ข้อมูลซ้อนกัน)
function setupDreamsSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(DREAMS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DREAMS_SHEET);
  }
  var header = ['id', 'title', 'done', 'completedAt', 'createdAt'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]);

  if (sheet.getLastRow() > 1) {
    Logger.log('แท็บ Dreams มีข้อมูลอยู่แล้ว ข้ามการเติมลิสต์เริ่มต้น');
    return;
  }

  var seedTitles = [
    "Build business that can support people around me grow up together.",
    "Create our working environment.",
    "Marry with Pink.",
    "Go to Japan for holiday with unlimited budget.",
    "Play Ragnarok Online with my girlfriend.",
    "Build condominium project.",
    "Build hotel project.",
    "Retire before age at 50.",
    "Share all of my experience to next gen.",
    "Build something that give advantages to people in real life.",
    "Craate some single music that p'Sing is the main singer band group",
    "Repay for Na'Kae",
    "Repay for E'Niew",
    "Repay for Sakao"
  ];
  seedTitles.forEach(function (title, i) {
    sheet.appendRow([
      'dream_' + new Date().getTime() + '_' + i,
      title, false, '', new Date().toISOString()
    ]);
  });
  Logger.log('สร้างแท็บ Dreams และเติมลิสต์เริ่มต้น ' + seedTitles.length + ' รายการเรียบร้อยแล้ว');
}
