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
