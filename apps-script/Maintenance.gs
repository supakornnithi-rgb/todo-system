/**
 * ฟังก์ชันดูแลระบบ รันเองครั้งคราวจากหน้า editor เท่านั้น ไม่ผูกกับ Web App
 */

// ลบข้อมูลทดสอบทั้งหมดในแท็บ Tasks และ Projects (เก็บแถวหัวตารางไว้) — ใช้ตอนเคลียร์ข้อมูลก่อนเริ่มใช้งานจริง
function resetTestData() {
  [TASKS_SHEET, PROJECTS_SHEET].forEach(function (name) {
    var sheet = getSheet_(name);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  });
  Logger.log('ลบข้อมูลทดสอบใน Tasks และ Projects เรียบร้อย (เหลือแค่แถวหัวตาราง)');
}
