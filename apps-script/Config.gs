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

function getLineChannelAccessToken_() {
  var v = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!v) throw new Error('ยังไม่ได้ตั้งค่า Script Property "LINE_CHANNEL_ACCESS_TOKEN"');
  return v;
}

// ยังไม่ได้ใช้ตรวจสอบ signature จริง เพราะ Apps Script Web App อ่าน HTTP header ไม่ได้เลย
// (ข้อจำกัดของแพลตฟอร์ม ไม่มี e.headers ใน doPost) เก็บค่านี้ไว้เผื่ออนาคตแพลตฟอร์มรองรับ
function getLineChannelSecret_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET') || '';
}

// userId ของเจ้าของโปรเจกต์เอง ไว้กรองไม่ให้คนอื่นสั่งงาน bot ได้ (ดู processLineEvent_ ใน Line.gs)
// ตั้งค่าทีหลังตอนทดสอบครั้งแรก (bot จะพิมพ์ userId กลับมาให้เองถ้ายังไม่เคยตั้งค่า)
function getLineUserId_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_USER_ID') || null;
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
