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
function collectLineTasksSupabase_(workspace, todayIso, userId) {
  // L2P7: รับ userId ของผู้รับแต่ละคน ถ้าไม่ส่งมา fallback เป็นเจ้าของเดิม
  var ownerId = userId || getSupabaseOwnerId_();
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
 * L2P7: คืนรายชื่อผู้รับสรุปงาน [{line_user_id, user_id, display_name}] จากตาราง line_users
 * ถ้าตารางว่างหรืออ่านไม่ได้ (error) fallback เป็นเจ้าของคนเดียวแบบเดิม (LINE_USER_ID + SUPABASE_OWNER_ID)
 * ถ้า LINE_USER_ID ว่างด้วย ก็คืนลิสต์ว่าง (ไม่มีใครให้ส่ง)
 */
function getLineRecipients_() {
  try {
    var res = supabaseRequest_('GET', '/rest/v1/line_users?select=line_user_id,user_id,display_name', null, null);
    var rows = JSON.parse(res.text);
    if (rows && rows.length > 0) return rows;
    Logger.log('ตาราง line_users ว่าง — ใช้เจ้าของคนเดียวแทน');
  } catch (err) {
    Logger.log('อ่าน line_users ไม่สำเร็จ (' + err.message + ') — ใช้เจ้าของคนเดียวแทน');
  }
  var ownerLineUserId = getLineUserId_(); // Config.gs
  if (!ownerLineUserId) return [];
  return [{ line_user_id: ownerLineUserId, user_id: getSupabaseOwnerId_(), display_name: 'owner' }];
}

/**
 * L2P8: ตรวจสอบว่า recipient เป็นของเจ้าของ (Bank) หรือไม่
 * เทียบกับ LINE user id หลัก (Ueecd92962b4513ea94bf1f53e7634ff1),
 * LINE_USER_ID ใน Script Properties, หรือ SUPABASE_OWNER_ID ใน Script Properties
 */
function isOwnerRecipient_(recipient) {
  if (!recipient) return false;
  var hardcodedOwnerLineId = 'Ueecd92962b4513ea94bf1f53e7634ff1';
  if (recipient.line_user_id === hardcodedOwnerLineId) return true;
  try {
    var ownerLineId = getLineUserId_();
    if (ownerLineId && recipient.line_user_id === ownerLineId) return true;
  } catch (e1) {}
  try {
    var ownerUserId = getSupabaseOwnerId_();
    if (ownerUserId && recipient.user_id === ownerUserId) return true;
  } catch (e2) {}
  return false;
}

/**
 * L2P8: ตรวจสอบว่าเป็นวันหยุดเสาร์-อาทิตย์หรือไม่ (0 = อาทิตย์, 6 = เสาร์)
 */
function isWeekendIso_(iso) {
  var d = parseIso_(iso);
  var day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * L2P8: สร้าง Flex Message สรุปงานประจำวันเฉพาะกลุ่ม Office เท่านั้น (ไม่แสดงส่วน Personal เลย)
 * สำหรับส่งให้เจ้าของ (Bank) ตามความต้องการใช้งาน
 */
function buildOfficeOnlySummaryFlex_(officeNumbered) {
  var todayLabel = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM');
  var total = officeNumbered.length;

  var bodyContents = [
    { type: 'text', text: 'งานวันนี้ (' + todayLabel + ')', weight: 'bold', size: 'md' },
    buildLineTaskSection_('Office', officeNumbered),
    { type: 'separator', margin: 'md' },
    { type: 'text', text: LINE_COMMAND_HELP, size: 'xs', color: '#888888', margin: 'md', wrap: true }
  ];

  return {
    type: 'flex',
    altText: 'งานวันนี้ ' + total + ' รายการ',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents }
    }
  };
}

/**
 * เหมือน sendDailySummary() ทุกขั้นตอน ต่างกันแค่แหล่งข้อมูล: อ่านงานจาก Supabase (ไม่ใช่ Sheets) แล้ว
 * แทนที่แถว line_index ของผู้รับใน Supabase (ลบของเดิมทั้งหมดก่อน insert ชุดใหม่) แทนการล้าง/เขียน
 * แท็บ LineIndex — Flex builder และ push ใช้ตัวเดิมจาก Line.gs ตรงๆ ไม่มีการพอร์ตซ้ำ
 * L2P7: วนส่งให้ทุกคนใน line_users (แต่ละคนมี try/catch ของตัวเอง ล้มเหลวคนหนึ่งไม่กระทบคนอื่น)
 * L2P8: สำหรับเจ้าของ (Bank) ส่งเฉพาะวันจันทร์-ศุกร์ (ข้ามเสาร์-อาทิตย์) และสรุปเฉพาะงาน Office เท่านั้น
 * (คนอื่น เช่น Pink ยังคงได้รับทั้ง Personal และ Office ทุกวันจันทร์-อาทิตย์ตามปกติ)
 */
function sendDailySummarySupabase() {
  var recipients = getLineRecipients_();
  if (!recipients.length) {
    Logger.log('ไม่มีผู้รับสรุปงาน (line_users ว่างและยังไม่ได้ตั้งค่า LINE_USER_ID) ข้ามการส่งสรุปวันนี้');
    return;
  }

  var todayIso = todayIso_(); // DateUtils.gs
  recipients.forEach(function (r) {
    var name = r.display_name || r.line_user_id;
    try {
      var isOwner = isOwnerRecipient_(r);
      if (isOwner && isWeekendIso_(todayIso)) {
        Logger.log('ข้ามการส่งสรุปงานให้ ' + name + ' (วันหยุดเสาร์-อาทิตย์ แจ้งเฉพาะจันทร์-ศุกร์)');
        return;
      }

      if (isOwner) {
        var office = collectLineTasksSupabase_('Office', todayIso, r.user_id);

        // แทนที่ line_index เดิมทั้งหมดของผู้รับคนนี้
        supabaseRequest_('DELETE', '/rest/v1/line_index?user_id=eq.' + r.user_id, null, null);

        var n = 1;
        var indexRows = [];
        var officeNumbered = office.map(function (t) {
          var row = { number: n, task: t };
          indexRows.push({
            user_id: r.user_id,
            number: n,
            task_id: t.id,
            workspace: t.workspace,
            date_key: todayIso
          });
          n++;
          return row;
        });

        if (indexRows.length > 0) supabaseInsertBatched_('line_index', indexRows); // SupabaseClient.gs

        // ส่ง Flex ที่มีเฉพาะ Office
        pushLineFlex_(r.line_user_id, buildOfficeOnlySummaryFlex_(officeNumbered));

        Logger.log('ส่งสรุปงานประจำวันผ่าน Supabase สำเร็จ ให้ ' + name + ' (Office เท่านั้น): Office ' + office.length + ' งาน');
      } else {
        var personal = collectLineTasksSupabase_('Personal', todayIso, r.user_id);
        var office = collectLineTasksSupabase_('Office', todayIso, r.user_id);

        // แทนที่ line_index เดิมทั้งหมดของผู้รับคนนี้ (เหมือน clearLineIndex_ ใน Line.gs:275-279) กันตอบกลับ
        // อ้างเลขจากข้อความเก่าที่หมดอายุแล้ว
        supabaseRequest_('DELETE', '/rest/v1/line_index?user_id=eq.' + r.user_id, null, null);

        var n = 1;
        var indexRows = [];
        var numbered = personal.concat(office).map(function (t) {
          var row = { number: n, task: t };
          indexRows.push({
            user_id: r.user_id,
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
        pushLineFlex_(r.line_user_id, buildDailySummaryFlex_(personalNumbered, officeNumbered));

        Logger.log('ส่งสรุปงานประจำวันผ่าน Supabase สำเร็จ ให้ ' + name + ': Personal ' + personal.length +
          ' งาน, Office ' + office.length + ' งาน, รวม ' + numbered.length + ' รายการ');
      }
    } catch (err) {
      Logger.log('ส่งสรุปงานให้ ' + name + ' ไม่สำเร็จ (ข้ามไปคนถัดไป): ' + err.message);
    }
  });
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
