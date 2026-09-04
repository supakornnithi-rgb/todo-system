/**
 * LINE Messaging API — ส่งสรุปงานประจำวัน (9:00/16:00) ผ่าน Flex Message และรับคำสั่งตอบกลับ
 * ผ่าน webhook เป็นข้อความธรรมดา (เลื่อน/someday/เสร็จ/เพิ่ม) ดู handleLineWebhook_ เป็นจุดเข้าจาก Code.gs
 *
 * Apps Script Web App อ่าน HTTP header ไม่ได้เลย จึงตรวจสอบ X-Line-Signature ตามมาตรฐานของ LINE
 * ไม่ได้ (ข้อจำกัดของแพลตฟอร์ม) — ใช้ userId allowlist แทน (ดู getLineUserId_ ใน Config.gs) ร่วมกับ
 * URL ของ webhook ที่เป็นสตริงสุ่มยาวไม่มีใครเดาได้ เพียงพอสำหรับ bot ส่วนตัวที่มีผู้ใช้คนเดียว
 *
 * ทุกครั้งที่ส่งสรุปใหม่ จะล้างแท็บ LineIndex แล้วเลขที่ผู้ใช้ตอบกลับมาอ้างอิงชุดล่าสุดเสมอ
 * (กันตอบกลับอ้างเลขจากข้อความเก่าที่หมดอายุแล้ว) เลขรวมชุดเดียว Personal ต่อด้วย Office
 */

var LINE_INDEX_SHEET = 'LineIndex';
var LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
var LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

var LINE_DAY_WORDS = {
  'จันทร์': 1, 'อังคาร': 2, 'พุธ': 3, 'พฤหัส': 4, 'พฤหัสบดี': 4,
  'ศุกร์': 5, 'เสาร์': 6, 'อาทิตย์': 0
};

var LINE_COMMAND_HELP =
  'วิธีตอบกลับ:\n' +
  'เลื่อน 2 ศุกร์\n' +
  'เลื่อน 2,3 ศุกร์\n' +
  'someday 2\n' +
  'เสร็จ 2 (หรือกดปุ่ม ✓ ในการ์ด)\n' +
  '+of ข้อความ\n' +
  '+psn ข้อความ';

// ---------- Webhook ----------

/** ประตูเข้าจาก Code.gs — รับ body ทั้งก้อนที่ LINE ส่งมา (มี events เป็น array เสมอ แม้ตอน "Verify") */
function handleLineWebhook_(body) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    (body.events || []).forEach(processLineEvent_);
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* ไม่ได้ล็อกไว้ตั้งแต่แรกก็ไม่เป็นไร */ }
  }
  return jsonResponse_({ ok: true });
}

// รับได้ทั้งข้อความพิมพ์เอง (message) และปุ่มในการ์ด (postback) — ปุ่ม "✓" ส่ง data เป็นสตริง
// คำสั่งเดียวกับที่พิมพ์เอง (เช่น "เสร็จ 5") จึงไหลผ่าน executeLineCommand_ เส้นทางเดียวกันได้เลย
function processLineEvent_(event) {
  var text;
  if (event.type === 'message' && event.message && event.message.type === 'text') {
    text = (event.message.text || '').trim();
  } else if (event.type === 'postback' && event.postback) {
    text = (event.postback.data || '').trim();
  } else {
    return;
  }

  var userId = event.source && event.source.userId;
  if (!userId) return;

  // กันประมวลผลซ้ำถ้า LINE ส่ง event เดิมมาซ้ำ (retry ตอน webhook ตอบช้า/ไม่ตอบ 200 ทัน)
  var cache = CacheService.getScriptCache();
  var cacheKey = 'line_evt_' + event.webhookEventId;
  if (event.webhookEventId) {
    if (cache.get(cacheKey)) return;
    cache.put(cacheKey, '1', 21600);
  }

  var replyToken = event.replyToken;

  var ownerId = getLineUserId_();
  if (!ownerId) {
    // ยังไม่เคยตั้งค่า LINE_USER_ID — บอก userId ของคนที่พิมพ์มากลับไป เอาไปตั้งค่าเองในสเต็ปแรก
    replyOrPushLineText_(userId, replyToken, 'ยังไม่ได้ตั้งค่า LINE_USER_ID ครับ\nuserId ของคุณคือ:\n' + userId +
      '\n\nเอาค่านี้ไปใส่ Script Properties ชื่อ LINE_USER_ID แล้วลองพิมพ์คำสั่งใหม่อีกครั้ง');
    return;
  }
  if (userId !== ownerId) return; // ไม่ใช่เจ้าของ ไม่ตอบสนอง

  var replyText;
  try {
    replyText = executeLineCommand_(text);
  } catch (err) {
    // ทำไม่สำเร็จ แจ้งทันทีเสมอ ไม่ว่าจะพิมพ์เองหรือกดปุ่ม (ไม่เอาไป debounce กันพลาดแล้วไม่รู้ตัว)
    replyOrPushLineText_(userId, replyToken, 'ทำคำสั่งไม่สำเร็จ: ' + err.message + '\n\n' + LINE_COMMAND_HELP);
    return;
  }

  if (event.type === 'postback') {
    // กดปุ่ม ✓ สำเร็จ → เข้าคิว debounce 1 นาที แทนตอบทันที เผื่อกดรัวหลายปุ่มติดกัน
    // (ทำงานจริงเสร็จแล้วตอนนี้ setDay_/updateTask_ ข้างใน executeLineCommand_ เขียนชีตไปแล้ว
    // แค่ "ข้อความยืนยัน" ที่ถูก batch ไว้ ไม่ใช่ตัวงานเอง)
    queueLineDoneBatch_(replyText);
    return;
  }
  replyOrPushLineText_(userId, replyToken, replyText);
}

// ---------- Debounce ข้อความยืนยันจากปุ่ม ----------

var LINE_PENDING_BATCH_KEY = 'line_pending_done_batch';
var LINE_DEBOUNCE_FN = 'flushLineDoneBatch';
var LINE_DEBOUNCE_MS = 60 * 1000;

function queueLineDoneBatch_(message) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(LINE_PENDING_BATCH_KEY);
  var list = raw ? JSON.parse(raw) : [];
  list.push(message);
  cache.put(LINE_PENDING_BATCH_KEY, JSON.stringify(list), 300); // เผื่อ trigger หลุด เก็บไว้ 5 นาที

  // debounce: ยกเลิก trigger เดิม (ถ้ามี) แล้วตั้งใหม่นับ 1 นาทีจากการกดล่าสุดเสมอ (เหมือน debounce
  // ฝั่ง frontend PWA ที่ใช้ setTimeout ธรรมดา แต่ฝั่งนี้ execution จบทันทีทุกครั้ง ต้องใช้ trigger แทน)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === LINE_DEBOUNCE_FN) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(LINE_DEBOUNCE_FN).timeBased().after(LINE_DEBOUNCE_MS).create();
}

/**
 * เรียกจาก trigger แบบครั้งเดียว (ลบตัวเองอัตโนมัติหลังรันเสร็จ) 1 นาทีหลังกดปุ่มล่าสุด
 * ต้องส่งผ่าน push เท่านั้น (กินโควตา 1 ข้อความ ต่อ "ชุดที่กด" ไม่ใช่ต่อปุ่ม) เพราะ replyToken
 * ของทุก tap หมดอายุไปนานแล้วตอนนี้ — reply ใช้ได้แค่ตอบทันทีในการทำงานเดียวกันเท่านั้น
 */
function flushLineDoneBatch() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(LINE_PENDING_BATCH_KEY);
  if (!raw) return;
  cache.remove(LINE_PENDING_BATCH_KEY);

  var ownerId = getLineUserId_();
  var list = JSON.parse(raw);
  if (!ownerId || list.length === 0) return;

  var text = 'อัปเดตสถานะแล้ว:\n' + list.join('\n');
  callLinePush_(ownerId, [{ type: 'text', text: text }]);
}

// ---------- คำสั่งตอบกลับ ----------

function executeLineCommand_(text) {
  var parts = text.split(/\s+/).filter(function (p) { return p; });
  if (parts.length === 0) throw new Error('ข้อความว่าง');
  var cmd = parts[0];

  if (cmd === 'เลื่อน') {
    if (parts.length !== 3) throw new Error('รูปแบบ: เลื่อน <เลข> <วัน>');
    return runLineMove_(parts[1], parts[2]);
  }
  if (cmd === 'someday') {
    if (parts.length !== 2) throw new Error('รูปแบบ: someday <เลข>');
    return runLineSomeday_(parts[1]);
  }
  if (cmd === 'เสร็จ') {
    if (parts.length !== 2) throw new Error('รูปแบบ: เสร็จ <เลข>');
    return runLineDone_(parts[1]);
  }
  if (cmd === '+psn' || cmd === '+of') {
    if (parts.length < 2) throw new Error('รูปแบบ: ' + cmd + ' <ข้อความ>');
    return runLineAdd_(cmd.slice(1), parts.slice(1).join(' '));
  }
  throw new Error('ไม่รู้จักคำสั่ง "' + cmd + '"');
}

// รองรับ "2" / "2,3" / "2-4" / "2,4-6"
function parseLineNumbers_(str) {
  var nums = [];
  str.split(',').forEach(function (token) {
    if (token.indexOf('-') !== -1) {
      var range = token.split('-').map(Number);
      for (var n = range[0]; n <= range[1]; n++) nums.push(n);
    } else {
      nums.push(Number(token));
    }
  });
  nums.forEach(function (n) {
    if (!n || isNaN(n)) throw new Error('เลขงานไม่ถูกต้อง: "' + str + '"');
  });
  return nums;
}

// แปลงเลขที่ผู้ใช้พิมพ์กลับเป็น taskId จริงผ่านแท็บ LineIndex (ชุดล่าสุดที่ส่งไปเท่านั้น)
function resolveLineNumbers_(numbers) {
  var rows = readRows_(LINE_INDEX_SHEET);
  var map = {};
  rows.forEach(function (r) { map[Number(r.number)] = r; });
  return numbers.map(function (n) {
    var row = map[n];
    if (!row) throw new Error('ไม่พบเลขงาน ' + n + ' ในข้อความล่าสุด');
    return row;
  });
}

function dateOfWeekday_(dayIndex) {
  var monday = mondayOf_(todayIso_());
  var days = weekDays_(monday); // days[0]=จันทร์ ... days[6]=อาทิตย์
  var offset = (dayIndex === 0) ? 6 : dayIndex - 1;
  return days[offset];
}

function runLineMove_(numbersStr, dayWord) {
  var dayIndex = LINE_DAY_WORDS[dayWord];
  if (dayIndex === undefined) {
    throw new Error('ไม่รู้จักชื่อวัน "' + dayWord + '" (ใช้: จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์)');
  }
  var targetDate = dateOfWeekday_(dayIndex);
  var rows = resolveLineNumbers_(parseLineNumbers_(numbersStr));
  var titles = rows.map(function (r) { return setDay_(r.taskId, targetDate).title; });
  return '✅ เลื่อน ' + titles.length + ' งาน (' + titles.join(', ') + ') ไปวัน' + dayWord + 'แล้ว';
}

function runLineSomeday_(numbersStr) {
  var rows = resolveLineNumbers_(parseLineNumbers_(numbersStr));
  var titles = rows.map(function (r) { return setDay_(r.taskId, 'someday').title; });
  return '✅ ย้าย ' + titles.length + ' งาน (' + titles.join(', ') + ') ไป someday แล้ว';
}

function runLineDone_(numbersStr) {
  var rows = resolveLineNumbers_(parseLineNumbers_(numbersStr));
  var titles = rows.map(function (r) { return updateTask_(r.taskId, { done: true }).title; });
  return '✅ เสร็จแล้ว ' + titles.length + ' งาน (' + titles.join(', ') + ')';
}

function runLineAdd_(wsWord, title) {
  var workspace = (wsWord === 'of') ? 'Office' : (wsWord === 'psn') ? 'Personal' : null;
  if (!workspace) throw new Error('ต้องระบุ of หรือ psn เท่านั้น (เช่น "เพิ่ม of ส่งรายงาน")');
  if (!title) throw new Error('ต้องระบุข้อความงาน');
  var t = addTask_({ workspace: workspace, title: title, day: todayIso_() });
  return '✅ เพิ่มงาน "' + t.title + '" เข้า ' + workspace + ' วันนี้แล้ว';
}

// ---------- สรุปงานประจำวัน ----------

/**
 * เรียกจาก trigger เวลา 9:00/16:00 (ดู installLineTriggers ใน Triggers.gs) หรือรันเองจากหน้า
 * editor เพื่อทดสอบได้ทันที ล้าง LineIndex เดิมแล้วสร้างชุดเลขใหม่ทุกครั้งที่เรียก
 */
function sendDailySummary() {
  var ownerId = getLineUserId_();
  if (!ownerId) {
    Logger.log('ยังไม่ได้ตั้งค่า LINE_USER_ID ข้ามการส่งสรุปวันนี้ (ต้องพิมพ์คุยกับ bot ครั้งแรกก่อน)');
    return;
  }

  var personal = collectLineTasks_('Personal');
  var office = collectLineTasks_('Office');

  clearLineIndex_();
  var n = 1;
  var numbered = personal.concat(office).map(function (t) {
    var row = { number: n, task: t };
    appendRow_(LINE_INDEX_SHEET, {
      number: n, taskId: t.id, workspace: t.workspace,
      dateKey: todayIso_(), createdAt: new Date().toISOString()
    });
    n++;
    return row;
  });

  var personalNumbered = numbered.filter(function (x) { return x.task.workspace === 'Personal'; });
  var officeNumbered = numbered.filter(function (x) { return x.task.workspace === 'Office'; });
  pushLineFlex_(ownerId, buildDailySummaryFlex_(personalNumbered, officeNumbered));
}

// งานวันนี้ + งานค้าง (วันก่อนหน้าในสัปดาห์นี้ที่ยังไม่เสร็จ) เรียงตามวันที่แล้วตามลำดับเดิมในแต่ละวัน
function collectLineTasks_(workspace) {
  var board = getBoard_(workspace, todayIso_());
  var tasks = [];
  board.days.forEach(function (d) {
    if (d.date > board.today) return;
    d.tasks.forEach(function (t) { if (!t.done) tasks.push(t); });
  });
  return tasks;
}

function clearLineIndex_() {
  var sheet = getSheet_(LINE_INDEX_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
}

function buildDailySummaryFlex_(personalNumbered, officeNumbered) {
  var todayLabel = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM');
  var total = personalNumbered.length + officeNumbered.length;

  var bodyContents = [
    { type: 'text', text: 'งานวันนี้ (' + todayLabel + ')', weight: 'bold', size: 'md' },
    buildLineTaskSection_('Personal', personalNumbered),
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

function buildLineTaskSection_(label, numberedTasks) {
  var lines = numberedTasks.length === 0
    ? [{ type: 'text', text: '(ไม่มีงาน)', size: 'sm', color: '#AAAAAA' }]
    : numberedTasks.map(buildLineTaskRow_);

  return {
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    contents: [{ type: 'text', text: label, size: 'xs', color: '#888888', weight: 'bold' }].concat(lines)
  };
}

// แถวงานแต่ละอัน + ปุ่ม "✓" กดแล้วส่ง postback data เป็นคำสั่ง "เสร็จ <เลข>" แบบเดียวกับพิมพ์เอง
// (ดู processLineEvent_) กดแล้วจะได้ข้อความยืนยันกลับมาเสมอ ไม่ใช่แค่กดเงียบๆ ไม่รู้ผล
function buildLineTaskRow_(x) {
  return {
    type: 'box',
    layout: 'horizontal',
    alignItems: 'center',
    contents: [
      { type: 'text', text: x.number + '. ' + x.task.title, size: 'sm', wrap: true, flex: 1 },
      {
        type: 'button', style: 'link', height: 'sm', gravity: 'center',
        action: { type: 'postback', label: '✓', data: 'เสร็จ ' + x.number, displayText: 'เสร็จ ' + x.number }
      }
    ]
  };
}

// ---------- เรียก LINE Messaging API ----------

/**
 * ข้อความตอบกลับ event ที่เพิ่งเข้ามา (พิมพ์คำสั่ง/กดปุ่ม) ใช้ reply API ก่อนเสมอ เพราะไม่นับ
 * โควตาข้อความฟรีของแผน LINE OA (ต่างจาก push ที่นับทุกข้อความ) ถ้า reply ใช้ไม่ได้ (เช่น
 * replyToken หมดอายุเพราะ Apps Script ตอบช้ากว่าปกติ) จะ fallback ไป push แทนให้อัตโนมัติ
 */
function replyOrPushLineText_(userId, replyToken, text) {
  var messages = [{ type: 'text', text: text }];
  if (replyToken && callLineReply_(replyToken, messages)) return;
  callLinePush_(userId, messages);
}

function pushLineFlex_(userId, flexMessage) {
  callLinePush_(userId, [flexMessage]);
}

// คืน true ถ้าส่งสำเร็จ, false ถ้าไม่สำเร็จ (ให้ผู้เรียกตัดสินใจ fallback เอง)
function callLineReply_(replyToken, messages) {
  var token = getLineChannelAccessToken_();
  var res = UrlFetchApp.fetch(LINE_REPLY_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) return true;
  Logger.log('LINE reply ล้มเหลว (' + res.getResponseCode() + '): ' + res.getContentText() + ' — fallback ไป push แทน');
  return false;
}

function callLinePush_(userId, messages) {
  var token = getLineChannelAccessToken_();
  var res = UrlFetchApp.fetch(LINE_PUSH_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: messages }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('LINE push ล้มเหลว (' + res.getResponseCode() + '): ' + res.getContentText());
  }
}
