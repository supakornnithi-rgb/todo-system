// logic.js — ตรรกะล้วนๆ ของ LINE webhook (ไม่แตะ Deno/Node API ใดๆ เลย นอกจาก Web Crypto ที่มีทั้งสองฝั่ง)
// พอร์ตมาจาก apps-script/Line.gs แบบคำต่อคำ (ดูเลขบรรทัดอ้างอิงในคอมเมนต์แต่ละจุด) ยกเว้น 2 จุดที่ตั้งใจ
// เปลี่ยนพฤติกรรม: (1) ปุ่ม ✓ ตอบกลับทันทีทุกครั้งแทนการ debounce 1 นาทีแบบเดิม (2) ข้อความตอบปุ่ม ✓
// เปลี่ยนรูปแบบเป็น "✓ เสร็จ: <ชื่องาน>" ต่อบรรทัด (ดู formatPostbackDoneReply ด้านล่าง)
// ไฟล์นี้ import ได้ทั้งจาก Deno (index.ts) และ Node (node tests) เพราะเป็น ES module ธรรมดา

// ---------- ค่าคงที่ (พอร์ตจาก Line.gs:17-29) ----------

export const LINE_DAY_WORDS = { // Line.gs:17-20
  'จันทร์': 1, 'อังคาร': 2, 'พุธ': 3, 'พฤหัส': 4, 'พฤหัสบดี': 4,
  'ศุกร์': 5, 'เสาร์': 6, 'อาทิตย์': 0
};

export const LINE_COMMAND_HELP = // Line.gs:22-29
  'วิธีตอบกลับ:\n' +
  'เลื่อน 2 ศุกร์\n' +
  'เลื่อน 2,3 ศุกร์\n' +
  'someday 2\n' +
  'เสร็จ 2 (หรือกดปุ่ม ✓ ในการ์ด)\n' +
  '+of ข้อความ\n' +
  '+psn ข้อความ';

// ---------- แปลงเลขงาน "2" / "2,3" / "2-4" / "2,4-6" (พอร์ตจาก Line.gs:165-179 parseLineNumbers_) ----------

export function parseLineNumbers(str) {
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

// ---------- แปลข้อความ/postback data เป็นคำสั่ง (พอร์ตจาก Line.gs:140-162 executeLineCommand_) ----------
//
// ต่างจากต้นฉบับตรงที่ executeLineCommand_ ใช้ throw ล้วนๆ แล้วให้ผู้เรียก (processLineEvent_) จับ error
// เอง ที่นี่พอร์ตให้เป็นฟังก์ชัน pure ที่ "คืนค่า" เสมอแทนการ throw ออกไปนอกฟังก์ชัน เพื่อให้ index.ts
// เอาไปสร้างข้อความตอบกลับที่ตรงกับต้นฉบับได้ง่าย ๆ (คำสั่งที่รู้จักแต่พารามิเตอร์ผิด -> {type:'error'},
// คำสั่งที่ไม่รู้จักเลย (เช่น garbage input) -> {type:'help'} ตรงกับ Line.gs:161 ที่สุดท้ายก็ไปเข้า
// help text เดียวกันในข้อความตอบกลับอยู่ดี ดู formatReply ด้านล่าง)
export function parseCommand(text) {
  var parts = String(text || '').split(/\s+/).filter(function (p) { return p; }); // Line.gs:141
  if (parts.length === 0) return { type: 'error', message: 'ข้อความว่าง' }; // Line.gs:142

  var cmd = parts[0]; // Line.gs:143
  var KNOWN_COMMANDS = ['เลื่อน', 'someday', 'เสร็จ', '+psn', '+of']; // Line.gs:145,149,153,157
  if (KNOWN_COMMANDS.indexOf(cmd) === -1) {
    // ไม่รู้จักคำสั่งเลย (case-sensitive เหมือนต้นฉบับ เช่น "SOMEDAY" ก็ไม่รู้จักด้วย) — Line.gs:161
    return { type: 'help', cmd: cmd };
  }

  try {
    if (cmd === 'เลื่อน') { // Line.gs:145-148, 200-209
      if (parts.length !== 3) throw new Error('รูปแบบ: เลื่อน <เลข> <วัน>'); // Line.gs:146
      var dayWord = parts[2];
      var dayIndex = LINE_DAY_WORDS[dayWord]; // Line.gs:201
      if (dayIndex === undefined) { // Line.gs:202-204
        throw new Error('ไม่รู้จักชื่อวัน "' + dayWord + '" (ใช้: จันทร์ อังคาร พุธ พฤหัส ศุกร์ เสาร์ อาทิตย์)');
      }
      return { type: 'move', numbers: parseLineNumbers(parts[1]), dayIndex: dayIndex, dayWord: dayWord };
    }

    if (cmd === 'someday') { // Line.gs:149-151, 211-215
      if (parts.length !== 2) throw new Error('รูปแบบ: someday <เลข>'); // Line.gs:150
      return { type: 'someday', numbers: parseLineNumbers(parts[1]) };
    }

    if (cmd === 'เสร็จ') { // Line.gs:153-155, 217-221
      if (parts.length !== 2) throw new Error('รูปแบบ: เสร็จ <เลข>'); // Line.gs:154
      return { type: 'done', numbers: parseLineNumbers(parts[1]) };
    }

    // cmd === '+psn' || cmd === '+of' — Line.gs:157-160, 223-229
    if (parts.length < 2) throw new Error('รูปแบบ: ' + cmd + ' <ข้อความ>'); // Line.gs:158
    var workspace = (cmd === '+of') ? 'Office' : 'Personal'; // Line.gs:224
    return { type: 'add', workspace: workspace, title: parts.slice(1).join(' ') };
  } catch (err) {
    return { type: 'error', message: err.message };
  }
}

// ---------- วันที่ (พอร์ตจาก apps-script/DateUtils.gs + Line.gs:193-198 dateOfWeekday_) ----------
//
// ต้นฉบับใช้ Utilities.formatDate/parseIso_ ของ Apps Script ที่อิง timezone เครื่องรัน (ตั้งเป็น
// Asia/Bangkok ใน appsscript.json) ที่นี่ไม่มี Utilities ให้ใช้ จึงคำนวณด้วยเลขล้วน ๆ บน UTC แทน
// (ปลอดภัยกว่าอิง timezone ของเครื่องที่รัน Node/Deno) โดยตีความ todayIso ที่รับเข้ามาเป็น "วันที่ตามผล
// ปฏิทิน Asia/Bangkok" อยู่แล้ว (ผู้เรียกต้องคำนวณผ่าน bangkokTodayIso ก่อนส่งเข้ามา) จึงไม่ต้องแปลง
// timezone ซ้ำในฟังก์ชันนี้อีก

function parseIsoUtc_(iso) {
  var parts = iso.split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function toIsoUtc_(date) {
  return date.toISOString().slice(0, 10);
}

// พอร์ตจาก DateUtils.gs:20-26 mondayOf_
function mondayOfIso_(iso) {
  var d = parseIsoUtc_(iso);
  var day = d.getUTCDay(); // 0=อาทิตย์, 1=จันทร์, ..., 6=เสาร์
  var diff = (day === 0) ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return toIsoUtc_(d);
}

// พอร์ตจาก DateUtils.gs:28-32 addDaysIso_
function addDaysIsoUtc_(iso, n) {
  var d = parseIsoUtc_(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIsoUtc_(d);
}

// dayIndex: 0=อาทิตย์ 1=จันทร์ ... 6=เสาร์ (ค่าจาก LINE_DAY_WORDS) — พอร์ตจาก Line.gs:193-198
export function dateOfWeekday(dayIndex, todayIso) {
  var monday = mondayOfIso_(todayIso);
  var offset = (dayIndex === 0) ? 6 : dayIndex - 1; // Line.gs:196
  return addDaysIsoUtc_(monday, offset);
}

// วันนี้ตามปฏิทิน Asia/Bangkok (UTC+7 คงที่ ไม่มี DST) คำนวณด้วยเลขล้วน ๆ จาก epoch ms
// nowMs = Date.now() ของผู้เรียก (รับเป็นพารามิเตอร์เพื่อให้ฟังก์ชัน pure/เทสต์ได้)
export function bangkokTodayIso(nowMs) {
  var bkk = new Date(nowMs + 7 * 3600 * 1000);
  return bkk.toISOString().slice(0, 10);
}

// ---------- ข้อความตอบกลับ (คัดลอกคำไทยจาก Line.gs ทุกตัวอักษร ยกเว้นจุดที่ระบุไว้) ----------

export function formatMoveReply(titles, dayWord) { // Line.gs:208
  return '✅ เลื่อน ' + titles.length + ' งาน (' + titles.join(', ') + ') ไปวัน' + dayWord + 'แล้ว';
}

export function formatSomedayReply(titles) { // Line.gs:214
  return '✅ ย้าย ' + titles.length + ' งาน (' + titles.join(', ') + ') ไป someday แล้ว';
}

export function formatDoneReply(titles) { // Line.gs:220 (พิมพ์คำสั่ง "เสร็จ <เลข>" เอง)
  return '✅ เสร็จแล้ว ' + titles.length + ' งาน (' + titles.join(', ') + ')';
}

// ใหม่ (ตามคำสั่งเจ้าของโปรเจกต์ใน CONTEXT ของแผน): ปุ่ม ✓ ตอบทันทีทุกครั้ง ไม่ debounce/รวม batch
// เหมือน Line.gs เดิม (queueLineDoneBatch_/flushLineDoneBatch ที่ Line.gs:98-136) ข้อความบรรทัดละงาน
export function formatPostbackDoneReply(titles) {
  return titles.map(function (t) { return '✓ เสร็จ: ' + t; }).join('\n');
}

export function formatAddReply(title, workspace) { // Line.gs:228
  return '✅ เพิ่มงาน "' + title + '" เข้า ' + workspace + ' วันนี้แล้ว';
}

// พอร์ตจาก processLineEvent_ catch block — Line.gs:82-85 "ทำคำสั่งไม่สำเร็จ: <err.message>\n\n<help>"
export function formatErrorReply(message) {
  return 'ทำคำสั่งไม่สำเร็จ: ' + message + '\n\n' + LINE_COMMAND_HELP;
}

// คำสั่งที่ไม่รู้จักเลย (Line.gs:161 'ไม่รู้จักคำสั่ง "<cmd>"' โยนเข้า catch เดียวกับด้านบน)
export function formatUnknownCommandReply(cmd) {
  return formatErrorReply('ไม่รู้จักคำสั่ง "' + cmd + '"');
}

// เลขงานที่ผู้ใช้พิมพ์มาไม่พบในชุดล่าสุด — พอร์ตจาก resolveLineNumbers_ (Line.gs:182-191, ข้อความบรรทัด 188)
export function formatMissingNumberReply(n) {
  return formatErrorReply('ไม่พบเลขงาน ' + n + ' ในข้อความล่าสุด');
}

/**
 * จุดรวมสร้างข้อความตอบกลับ — dispatcher เดียวที่ index.ts เรียกใช้ (พารามิเตอร์ data ขึ้นกับ type):
 *   move:         { titles, dayWord }
 *   someday:      { titles }
 *   done:         { titles }              (พิมพ์คำสั่ง "เสร็จ <เลข>" เอง)
 *   postbackDone: { titles }              (กดปุ่ม ✓ ในการ์ด — ข้อความคนละแบบกับ done ด้านบน)
 *   add:          { title, workspace }
 *   error:        { message }             (พารามิเตอร์ผิด/เลขงานไม่ถูกต้อง ฯลฯ — ดู parseCommand)
 *   help:         { cmd }                 (คำสั่งที่ไม่รู้จักเลย)
 */
export function formatReply(type, data) {
  data = data || {};
  switch (type) {
    case 'move': return formatMoveReply(data.titles, data.dayWord);
    case 'someday': return formatSomedayReply(data.titles);
    case 'done': return formatDoneReply(data.titles);
    case 'postbackDone': return formatPostbackDoneReply(data.titles);
    case 'add': return formatAddReply(data.title, data.workspace);
    case 'error': return formatErrorReply(data.message);
    case 'help': return formatUnknownCommandReply(data.cmd);
    default: return LINE_COMMAND_HELP;
  }
}

// ---------- ตรวจลายเซ็น X-Line-Signature (Web Crypto — มีทั้งใน Deno และ Node ผ่าน globalThis.crypto) ----------

function arrayBufferToBase64_(buf) {
  var bytes = new Uint8Array(buf);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// เทียบสตริงแบบ constant-time (ป้องกัน timing attack) — ต้องยาวเท่ากันเท่านั้นถึงจะเทียบทีละ char
function timingSafeEqualStr_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * signatureB64 = X-Line-Signature ตามที่ได้รับมาตรงๆ (base64 ของ HMAC-SHA256(key=channel secret,
 * message=raw request body bytes)) — คืน true ถ้าตรงกัน, false ถ้าลายเซ็นขาด/ไม่ตรง/secret ผิด
 * rawBody ต้องเป็น "ข้อความดิบ" ก่อน JSON.parse เท่านั้น (แปลงเป็น object แล้วลายเซ็นจะไม่ตรงอีกต่อไป)
 */
export async function verifyLineSignature(secret, rawBody, signatureB64) {
  if (!signatureB64) return false;
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  var sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  var expectedB64 = arrayBufferToBase64_(sigBuf);
  return timingSafeEqualStr_(expectedB64, signatureB64);
}
