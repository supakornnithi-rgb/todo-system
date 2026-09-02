/**
 * Logic + การติดตั้ง trigger อัตโนมัติทุกวันจันทร์
 * ยกงานที่ยังไม่เสร็จ (done=false) จากสัปดาห์ก่อนๆ มาไว้ที่วันจันทร์ของสัปดาห์ปัจจุบัน
 * เทียบ weekStart แบบ "น้อยกว่าสัปดาห์นี้" (ไม่ใช่แค่ "เท่ากับสัปดาห์ที่แล้ว") เผื่อกรณี trigger
 * ไม่ทำงานตามกำหนดสักครั้ง พอรันรอบถัดไปจะไล่เก็บงานที่ตกค้างจากทุกสัปดาห์ก่อนหน้าให้ครบ
 * งาน someday (weekStart ว่าง) จะไม่ถูกแตะเลย
 */
function weeklyCarryOver() {
  var thisMonday = mondayOf_(todayIso_());
  var movedCount = 0;

  readRows_(TASKS_SHEET).map(normalizeTaskRow_).forEach(function (t) {
    var isDone = (t.done === true || t.done === 'TRUE');
    var isBoardTask = t.day !== 'someday' && t.weekStart;
    if (isBoardTask && t.weekStart < thisMonday && !isDone) {
      updateRowFields_(TASKS_SHEET, t.__row, { day: thisMonday, weekStart: thisMonday });
      movedCount++;
    }
  });

  Logger.log('carry-over เสร็จสิ้น: ยกงาน ' + movedCount + ' รายการมาไว้ที่วันจันทร์ ' + thisMonday);
  return movedCount;
}

/**
 * รันฟังก์ชันนี้ครั้งเดียวจากหน้า editor เพื่อติดตั้ง trigger อัตโนมัติทุกวันจันทร์
 * (ลบ trigger เดิมที่ชื่อซ้ำก่อนเสมอ กันเผลอรันซ้ำแล้วได้ trigger ซ้อนกันหลายอัน)
 */
function installWeeklyTrigger() {
  removeWeeklyTrigger();
  ScriptApp.newTrigger('weeklyCarryOver')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(0)
    .create();
  Logger.log('ติดตั้ง trigger สำเร็จ: weeklyCarryOver จะรันอัตโนมัติทุกวันจันทร์ช่วงเที่ยงคืน-ตี 1 (Asia/Bangkok)');
}

function removeWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyCarryOver') {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction() + ' (' + t.getEventType() + ')';
  });
  Logger.log('Triggers ที่ติดตั้งอยู่ตอนนี้: ' + JSON.stringify(triggers));
}
