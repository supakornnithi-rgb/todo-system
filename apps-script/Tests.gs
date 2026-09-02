/**
 * ฟังก์ชันทดสอบ — รันจากหน้า Apps Script editor ได้เลย (เลือกชื่อฟังก์ชันแล้วกด Run)
 * ใช้เช็คว่า logic ทำงานถูกก่อนจะไป deploy เป็น Web App จริง
 * รันแล้วดูผลที่ "Execution log" และเปิด Google Sheet ดูว่าแถวข้อมูลถูกเขียนจริงไหม
 */

function test_addProjectAndTask() {
  var projects = addProject_('Personal', 'ทดสอบระบบ');
  Logger.log('Project list ของ Personal ตอนนี้: ' + JSON.stringify(projects));

  var task = addTask_({ workspace: 'Personal', title: 'ลองเพิ่มงานทดสอบ', project: 'ทดสอบระบบ' });
  Logger.log('เพิ่มงานสำเร็จ: ' + JSON.stringify(task));

  var toggled = toggleDone_(task.id);
  Logger.log('กดเสร็จแล้ว: ' + JSON.stringify(toggled));
}

function test_getBoard() {
  var board = getBoard_('Personal', null);
  Logger.log('บอร์ดสัปดาห์ปัจจุบันของ Personal: ' + JSON.stringify(board, null, 2));
}

function test_weeklyCarryOver() {
  var task = addTask_({ workspace: 'Office', title: 'งานทดสอบ carry-over' });
  var oldDay = addDaysIso_(todayIso_(), -14);
  setDay_(task.id, oldDay);
  Logger.log('ตั้งงานทดสอบให้ค้างอยู่ 2 สัปดาห์ก่อน: ' + oldDay);

  var moved = weeklyCarryOver();
  Logger.log('จำนวนงานที่ถูกยกมาสัปดาห์นี้: ' + moved);

  var board = getBoard_('Office', null);
  var counts = board.days.map(function (d) { return d.date + ': ' + d.tasks.length + ' งาน'; });
  Logger.log('จำนวนงานแต่ละวันของ Office สัปดาห์นี้ (หลัง carry-over): ' + counts.join(', '));
}

function test_someday() {
  var task = addTask_({ workspace: 'Office', title: 'งานไม่รีบ ทดสอบ someday', day: 'someday' });
  Logger.log('เพิ่มงาน someday สำเร็จ: ' + JSON.stringify(task));

  var moved = setDay_(task.id, todayIso_());
  Logger.log('ดึงจาก someday ขึ้นมาไว้วันนี้: ' + JSON.stringify(moved));
}
