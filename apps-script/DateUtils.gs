/**
 * ฟังก์ชันช่วยจัดการวันที่ทั้งหมด ยึด timezone Asia/Bangkok เสมอ (กำหนดใน appsscript.json ด้วย)
 * ทุกวันที่ในระบบเก็บเป็น string รูปแบบ ISO "yyyy-MM-dd" เท่านั้น เพื่อเทียบ/เรียงลำดับง่าย
 */

function todayIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function toIso_(date) {
  return Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
}

function parseIso_(iso) {
  var parts = iso.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// หาวันจันทร์ของสัปดาห์ที่ iso นั้นอยู่
function mondayOf_(iso) {
  var d = parseIso_(iso);
  var day = d.getDay(); // 0=อาทิตย์, 1=จันทร์, ..., 6=เสาร์
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIso_(d);
}

function addDaysIso_(iso, n) {
  var d = parseIso_(iso);
  d.setDate(d.getDate() + n);
  return toIso_(d);
}

// รายวันที่ 7 วัน (จันทร์-อาทิตย์) ของสัปดาห์ที่ weekStartIso (ต้องเป็นวันจันทร์) อยู่
function weekDays_(weekStartIso) {
  var days = [];
  for (var i = 0; i < 7; i++) {
    days.push(addDaysIso_(weekStartIso, i));
  }
  return days;
}
