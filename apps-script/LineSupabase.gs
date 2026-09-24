/**
 * สรุปงานประจำวันผ่าน LINE (รุ่นอ่าน/เขียน Supabase) — ใช้แทน sendDailySummary() ใน Line.gs ตอน
 * switch-over มาใช้ Supabase เป็น backend หลัก โดย Line.gs เดิม (รวมถึงตัว webhook รับคำสั่ง) ไม่ถูกแตะ
 * เลยสักบรรทัด — ไฟล์นี้แค่เพิ่มฟังก์ชันคู่ขนานที่อ่านงานจาก Supabase แทน Google Sheets แล้วเขียนเลขที่
 * ผู้ใช้ตอบกลับได้ (line_index) ลง Supabase แทนแท็บ LineIndex ทุกอย่างอื่น (Flex builder, push, การนับ
 * เลขต่อเนื่อง Personal ต่อด้วย Office) เหมือนเดิมทุกประการ — ใช้ buildDailySummaryFlex_/pushLineFlex_
 * ตัวเดิมจาก Line.gs ตรงๆ
 *
 * วันที่ switch-over จริง: รันฟังก์ชัน installLineTriggersSupabase() ครั้งเดียวจากหน้า editor
 * (จะลบ trigger เดิมของ sendDailySummary ทิ้งให้เอง แล้วติดตั้ง sendDailySummarySupabase แทนที่ 9:00/16:00)
 * ถ้าต้องการย้อนกลับไปใช้ Sheets เหมือนเดิม ให้รัน revertLineTriggersToSheets()
 */

// ---------- อ่านงานจาก Supabase (พอร์ตจาก collectLineTasks_ ใน Line.gs:265-273 + getBoard_ ใน Tasks.gs:97-130) ----------

/**
 * คืนงานของ workspace หนึ่ง ที่จะโชว์ในสรุปวันนี้: งานวันนี้ + งานค้าง (วันก่อนหน้าในสัปดาห์นี้ที่ยังไม่
 * เสร็จ) เรียงตามวันที่ก่อน แล้วตามลำดับ sort_order ภายในวันเดียวกัน (เหมือน getBoard_/collectLineTasks_
 * เป๊ะ) ไม่รวมงาน someday (query กรอง day ไว้ในช่วง [จันทร์สัปดาห์นี้, todayIso] อยู่แล้ว งาน someday มี
 * day เป็น null จึงไม่ตรงเงื่อนไข gte/lte และไม่ติดมาอยู่แล้วโดยธรรมชาติของ PostgREST)
 */
function collectLineTasksSupabase_(workspace, todayIso) {
  var ownerId = getSupabaseOwnerId_();
  var monday = mondayOf_(todayIso); // DateUtils.gs

  var path = '/rest/v1/tasks?select=id,title,project,day,done,sort_order,created_at' +
    '&user_id=eq.' + ownerId +
    '&workspace=eq.' + workspace +
    '&day=gte.' + monday +
    '&day=lte.' + todayIso;
  var res = supabaseRequest_('GET', path, null, null);
  var rows = JSON.parse(res.text);

  // ทำเหมือน collectLineTasks_ (Line.gs:265-273): เอาเฉพาะที่ !done และ day <= today (query กรองมาแล้ว
  // แต่เช็คซ้ำกันพลาด) แล้วเรียง day ก่อน จากนั้น sort_order ในวันเดียวกัน (เหมือน byOrder ใน Tasks.gs:119)
  var tasks = rows.filter(function (t) {
    return !t.done && t.day && t.day <= todayIso;
  });

  function byCreatedAt(a, b) { return a.created_at < b.created_at ? -1 : (a.created_at > b.created_at ? 1 : 0); }
  function byOrder(a, b) { return ((a.sort_order || 0) - (b.sort_order || 0)) || byCreatedAt(a, b); }
  tasks.sort(function (a, b) {
    if (a.day < b.day) return -1;
    if (a.day > b.day) return 1;
    return byOrder(a, b);
  });

  // field names ตรงกับที่ buildDailySummaryFlex_/buildLineTaskRow_ ใน Line.gs ใช้ (แค่ x.task.title)
  // แต่คงชื่อฟิลด์อื่นให้ตรงกับ cleanTask_ (Tasks.gs:23-37) ไว้ด้วยเผื่อ debug/ใช้ต่อในอนาคต
  return tasks.map(function (t) {
    return {
      id: t.id,
      workspace: workspace,
      title: t.title,
      project: t.project || '',
      day: t.day,
      order: t.sort_order || 0
    };
  });
}

// ---------- สรุปงานประจำวัน (พอร์ตจาก sendDailySummary ใน Line.gs:237-262) ----------

/**
 * เหมือน sendDailySummary() ทุกขั้นตอน ต่างกันแค่แหล่งข้อมูล: อ่านงานจาก Supabase (ไม่ใช่ Sheets) แล้ว
 * แทนที่แถว line_index ของเจ้าของใน Supabase (ลบของเดิมทั้งหมดก่อน insert ชุดใหม่) แทนการล้าง/เขียน
 * แท็บ LineIndex — Flex builder และ push ใช้ตัวเดิมจาก Line.gs ตรงๆ ไม่มีการพอร์ตซ้ำ
 */
function sendDailySummarySupabase() {
  var ownerLineUserId = getLineUserId_(); // Config.gs — ผู้รับ push ฝั่ง LINE
  if (!ownerLineUserId) {
    Logger.log('ยังไม่ได้ตั้งค่า LINE_USER_ID ข้ามการส่งสรุปวันนี้ (ต้องพิมพ์คุยกับ bot ครั้งแรกก่อน)');
    return;
  }

  var todayIso = todayIso_(); // DateUtils.gs
  var personal = collectLineTasksSupabase_('Personal', todayIso);
  var office = collectLineTasksSupabase_('Office', todayIso);

  var supabaseOwnerId = getSupabaseOwnerId_();
  // แทนที่ line_index เดิมทั้งหมดของเจ้าของ (เหมือน clearLineIndex_ ใน Line.gs:275-279) กันตอบกลับอ้าง
  // เลขจากข้อความเก่าที่หมดอายุแล้ว
  supabaseRequest_('DELETE', '/rest/v1/line_index?user_id=eq.' + supabaseOwnerId, null, null);

  var n = 1;
  var indexRows = [];
  var numbered = personal.concat(office).map(function (t) {
    var row = { number: n, task: t };
    indexRows.push({
      user_id: supabaseOwnerId,
      number: n,
      task_id: t.id,
      workspace: t.workspace,
      date_key: todayIso
    });
    n++;
    return row;
  });

  if (indexRows.length > 0) supabaseInsertBatched_('line_index', indexRows); // SupabaseClient.gs

  var personalNumbered = numbered.filter(function (x) { return x.task.workspace === 'Personal'; });
  var officeNumbered = numbered.filter(function (x) { return x.task.workspace === 'Office'; });

  // ใช้ Flex builder และตัวส่ง push เดิมจาก Line.gs ตรงๆ (ไม่พอร์ตซ้ำ)
  pushLineFlex_(ownerLineUserId, buildDailySummaryFlex_(personalNumbered, officeNumbered));

  Logger.log('ส่งสรุปงานประจำวันผ่าน Supabase สำเร็จ: Personal ' + personal.length +
    ' งาน, Office ' + office.length + ' งาน, รวม ' + numbered.length + ' รายการ');
}

// ---------- ติดตั้ง/ถอด trigger สำหรับวัน switch-over ----------

/**
 * รันฟังก์ชันนี้ครั้งเดียวจากหน้า editor ตอน switch-over วันจริง — ลบ trigger เดิมของ sendDailySummary
 * (Sheets), sendDailySummarySupabase (กันซ้อนถ้าเคยรันมาก่อน) และ flushLineDoneBatch (debounce เดิม
 * ที่ไม่ใช้แล้วเพราะ Edge Function ใหม่ reply ทันทีทุกครั้ง) แล้วติดตั้ง sendDailySummarySupabase ให้รัน
 * อัตโนมัติทุกวัน 9:00 และ 16:00 (Asia/Bangkok) เหมือน installLineTriggers เดิมทุกประการ
 */
function installLineTriggersSupabase() {
  removeLineSupabaseTriggers_();
  [9, 16].forEach(function (hour) {
    ScriptApp.newTrigger('sendDailySummarySupabase')
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
  });
  Logger.log('ติดตั้ง trigger สำเร็จ: sendDailySummarySupabase จะรันอัตโนมัติทุกวัน 9:00 และ 16:00 (Asia/Bangkok)');
}

// ลบ trigger ของ sendDailySummary (Sheets เดิม), sendDailySummarySupabase (กันซ้อน) และ flushLineDoneBatch
// (debounce เดิมที่เลิกใช้แล้ว) — เรียกจากทั้ง installLineTriggersSupabase และ revertLineTriggersToSheets
function removeLineSupabaseTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendDailySummary' || fn === 'sendDailySummarySupabase' || fn === 'flushLineDoneBatch') {
      ScriptApp.deleteTrigger(t);
    }
  });
}

/**
 * ย้อนกลับไปใช้สรุปงานจาก Sheets เหมือนเดิม (rollback) — ลบ trigger ของ sendDailySummarySupabase แล้ว
 * เรียก installLineTriggers() ตัวเดิมใน Triggers.gs เพื่อติดตั้ง sendDailySummary (Sheets) กลับมาใหม่
 */
function revertLineTriggersToSheets() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailySummarySupabase') {
      ScriptApp.deleteTrigger(t);
    }
  });
  installLineTriggers(); // Triggers.gs — ติดตั้ง sendDailySummary (Sheets) กลับมา
  Logger.log('ย้อนกลับไปใช้ sendDailySummary (Sheets) เรียบร้อย');
}
