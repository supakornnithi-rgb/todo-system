/**
 * ตัวช่วยอ่าน/เขียนชีตแบบ generic — อิงชื่อคอลัมน์จากแถวหัวตาราง (แถวที่ 1)
 * แทนที่จะ hardcode เลขคอลัมน์ (A, B, C...) เพื่อกันโค้ดพังถ้ามีคนสลับ/เพิ่มคอลัมน์ในชีตทีหลัง
 */

function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบแท็บชื่อ "' + name + '" ใน Google Sheet');
  return sheet;
}

function getHeader_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

// อ่านทุกแถว คืนเป็น array ของ object {ชื่อคอลัมน์: ค่า} พร้อมเลขแถวจริงใน __row (ใช้ตอน update)
function readRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { __row: i + 1 };
    for (var c = 0; c < header.length; c++) {
      obj[header[c]] = values[i][c];
    }
    rows.push(obj);
  }
  return rows;
}

// เพิ่มแถวใหม่จาก object — เติมค่าตามชื่อคอลัมน์ที่ตรงกับ header เท่านั้น
function appendRow_(sheetName, rowObject) {
  var sheet = getSheet_(sheetName);
  var header = getHeader_(sheet);
  var row = header.map(function (col) {
    return rowObject[col] !== undefined ? rowObject[col] : '';
  });
  sheet.appendRow(row);
}

// แก้บางฟิลด์ของแถวที่ระบุ (rowNumber = เลขแถวจริงในชีต ไม่ใช่ index)
function updateRowFields_(sheetName, rowNumber, fields) {
  var sheet = getSheet_(sheetName);
  var header = getHeader_(sheet);
  Object.keys(fields).forEach(function (key) {
    var colIndex = header.indexOf(key);
    if (colIndex === -1) throw new Error('ไม่พบคอลัมน์ "' + key + '" ในแท็บ ' + sheetName);
    sheet.getRange(rowNumber, colIndex + 1).setValue(fields[key]);
  });
}
