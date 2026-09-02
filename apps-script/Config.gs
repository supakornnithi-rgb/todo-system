/**
 * ค่า config ทั้งหมด (Spreadsheet ID, LINE token ฯลฯ) เก็บผ่าน Script Properties
 * ห้าม hardcode ตรงๆ ในโค้ด — ตั้งค่าที่ Apps Script UI: Project Settings > Script Properties
 */

function getSpreadsheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('ยังไม่ได้ตั้งค่า Script Property "SPREADSHEET_ID" — ไปที่ Project Settings > Script Properties');
  }
  return id;
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getSpreadsheetId_());
}

/**
 * รันฟังก์ชันนี้จากหน้า Apps Script editor (เลือกชื่อฟังก์ชันแล้วกด Run)
 * เพื่อเช็คว่าเชื่อมต่อกับ Google Sheet ถูกต้องหรือยัง แล้วดูผลที่ Execution log
 */
function testConnection() {
  var ss = getSpreadsheet_();
  Logger.log('เชื่อมต่อสำเร็จ: ' + ss.getName());
  var sheetNames = ss.getSheets().map(function (s) { return s.getName(); });
  Logger.log('พบแท็บทั้งหมด: ' + sheetNames.join(', '));
}
