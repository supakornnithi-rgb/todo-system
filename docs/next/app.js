// L2P4: เอา API_URL (Apps Script) ออก — ใช้ SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY จาก config.js แทน
// (ตั้งค่าอยู่ใน docs/next/config.js ที่โหลดก่อนไฟล์นี้)

// UX1: ชื่อวัน/เดือนแบบไทยย่อ — ใช้ทั่วทั้งแอป (หัวข้อวัน, ตัวเลือกวันในฟอร์ม capture ฯลฯ)
const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const MONTH_NAMES = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// โทนสีสุภาพชุดเดียวกับธีมหลัก — แต่ละชื่อ project ได้สีคงที่ของตัวเองจากการ hash ชื่อ ไม่ต้องตั้งเอง
// และไม่ต้องเก็บสีไว้ที่ backend (ชื่อเดิม = สีเดิมเสมอ ไม่ว่าจะเปิดจากเครื่องไหน)
const PROJECT_COLORS = [
  { bg: '#e8eef4', fg: '#4d6d8f' }, // น้ำเงิน
  { bg: '#e7f0ea', fg: '#4a7a5f' }, // เขียว
  { bg: '#f4e8ee', fg: '#8f4d6d' }, // ชมพูหม่น
  { bg: '#f4eee2', fg: '#8f6d3f' }, // น้ำตาลทอง
  { bg: '#ece5f4', fg: '#6d4d8f' }, // ม่วง
  { bg: '#f4e2e2', fg: '#8f4040' }, // แดงอิฐ
  { bg: '#e2f0ef', fg: '#3f8f85' }, // ฟ้าอมเขียว (teal)
  { bg: '#e6e5f4', fg: '#4f4d8f' }  // น้ำเงินอมม่วง (indigo)
];

function hashString(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  // ผสมบิตให้กระจายดีขึ้น (MurmurHash3 finalizer) — hash แบบ polynomial เฉยๆ มีจุดอ่อนตรงที่
  // ผลลัพธ์ mod เลขยกกำลัง 2 (ที่นี่คือ mod 8 จำนวนสีในชุด) ขึ้นกับบิตต่ำๆ เท่านั้น ทำให้บางชื่อ
  // (เช่น "CRAFTFITI", "PERSONAL") ดันตกกลุ่มสีเดียวกันหมดโดยบังเอิญ ถ้าไม่ผสมบิตก่อน
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return Math.abs(h);
}

function colorForProject(name) {
  return PROJECT_COLORS[hashString(name) % PROJECT_COLORS.length];
}

// workspace ที่ทำงานแค่ จันทร์-ศุกร์ (ไม่มีวันเสาร์-อาทิตย์ในระบบเลย) — งานที่เลยวันศุกร์ยังไม่เสร็จ
// จะถูก carry-over ไปวันจันทร์ถัดไปเองอยู่แล้วโดย trigger รายสัปดาห์ที่มีอยู่เดิม (เช็คแค่ weekStart
// เก่ากว่าสัปดาห์นี้ ไม่สนว่าอยู่วันไหนในสัปดาห์นั้น) เลยไม่ต้องแก้ backend เพิ่ม แค่ฝั่งแสดงผล/นำทาง
var WEEKDAYS_ONLY_WORKSPACES = ['Office'];

function isWeekdaysOnly(workspace) {
  return WEEKDAYS_ONLY_WORKSPACES.indexOf(workspace) !== -1;
}

function isWeekend(dateIso) {
  var day = parseIso(dateIso).getDay();
  return day === 0 || day === 6;
}

// ---------- date utils (ทำงานบนวันที่ปฏิทินล้วนๆ ไม่ยุ่งกับ timezone ของ string parsing) ----------
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function toIso(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function parseIso(iso) {
  var p = iso.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function todayIso() {
  return toIso(new Date());
}

function addDaysIso(iso, n) {
  var d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

// เลื่อนวัน ±1 ปกติ แต่ถ้า workspace ทำงานแค่ จ-ศ ให้ข้ามเสาร์-อาทิตย์ไปเลย (ศุกร์ -> จันทร์ถัดไป,
// จันทร์ -> ศุกร์ก่อนหน้า)
function addBusinessDaysIso(workspace, iso, direction) {
  var date = addDaysIso(iso, direction);
  if (isWeekdaysOnly(workspace)) {
    while (isWeekend(date)) date = addDaysIso(date, direction);
  }
  return date;
}

function mondayOf(iso) {
  var d = parseIso(iso);
  var day = d.getDay();
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIso(d);
}

function formatDayHeading(iso) {
  var d = parseIso(iso);
  return DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
}

function formatWeekRange(weekStartIso) {
  var start = parseIso(weekStartIso);
  var end = parseIso(addDaysIso(weekStartIso, 6));
  // UX1: สัปดาห์เดียวกัน (เดือนเดียวกัน) โชว์เดือนครั้งเดียวท้ายช่วง เช่น '21–27 ก.ย.'
  // ข้ามเดือน โชว์เดือนของทั้งสองฝั่ง เช่น '29 ก.ย. – 5 ต.ค.'
  if (start.getMonth() === end.getMonth()) {
    return start.getDate() + '–' + end.getDate() + ' ' + MONTH_NAMES[end.getMonth()];
  }
  var startStr = start.getDate() + ' ' + MONTH_NAMES[start.getMonth()];
  var endStr = end.getDate() + ' ' + MONTH_NAMES[end.getMonth()];
  return startStr + ' – ' + endStr;
}

// UX1 (pure, testable): แยก #project shortcut ออกจากชื่องาน — เจอ #token แรกที่แมตช์ชื่อ project ที่มีอยู่
// จริง (เทียบแบบตัดช่องว่าง+ตัวพิมพ์เล็ก) เอาออกจากชื่อ ที่เหลือไม่แตะ (แม้จะมี # อื่นที่ไม่แมตช์ก็ตาม)
function parseProjectHashtag(title, projectNames) {
  var normMap = {};
  (projectNames || []).forEach(function (name) {
    normMap[name.toLowerCase().replace(/\s+/g, '')] = name;
  });
  var re = /#(\S+)/g;
  var match;
  while ((match = re.exec(title)) !== null) {
    var norm = match[1].toLowerCase().replace(/\s+/g, '');
    if (normMap.hasOwnProperty(norm)) {
      var newTitle = (title.slice(0, match.index) + title.slice(match.index + match[0].length))
        .replace(/\s+/g, ' ').trim();
      return { title: newTitle, project: normMap[norm] };
    }
  }
  return { title: title, project: null };
}

// UX1 (pure, testable): ตำแหน่ง reorder จากลิสต์เต็มของวันนั้น (รวม done ที่พับซ่อนอยู่) แทนลำดับการ์ด
// ที่เห็นใน DOM จริงๆ — ต้องตรงกับวิธีที่ backend คำนวณ (setTaskOrder_ ใน Tasks.gs) เป๊ะ
function computeReorderPosition(fullSortedTaskIds, draggedId, targetId, insertAfter) {
  var ids = fullSortedTaskIds.filter(function (id) { return id !== draggedId; });
  var idx = ids.indexOf(targetId);
  if (idx === -1) return null;
  return idx + 1 + (insertAfter ? 1 : 0);
}

// ---------- API ----------
// L2P4: apiGet/apiPost ไม่ยิง fetch เองตรงๆ อีกต่อไป — ห่อ sbApiGet/sbApiPost (docs/next/supabase-api.js)
// แทน คงชื่อฟังก์ชันเดิมไว้ตรงๆ เพื่อไม่ต้องแก้จุดเรียกใช้ที่เหลือทั้งไฟล์เลย ตัด HTML-interstitial retry
// (safeParseJson) ออกเพราะเป็นพฤติกรรมเฉพาะของ Apps Script Web App เท่านั้น ไม่เกี่ยวกับ Supabase
// แต่ยังคง "retry รอบเดียวตอนเน็ตหลุดสำหรับ read" ไว้เหมือนเดิม (adapter throw เมื่อเจอ network error จริง)
function apiGet(params, retriesLeft) {
  if (retriesLeft === undefined) retriesLeft = 2;
  return sbApiGet(params).catch(function (err) {
    if (retriesLeft > 0) {
      return new Promise(function (resolve) { setTimeout(resolve, 500); })
        .then(function () { return apiGet(params, retriesLeft - 1); });
    }
    throw err;
  });
}

// L2P4: apiPost ไม่ retry เอง (กันเขียนซ้ำซ้อน) เหมือนพฤติกรรมเดิม — ห่อ sbApiPost ตรงๆ
function apiPost(action, payload) {
  return sbApiPost(action, payload);
}
// ---------- write queue: optimistic + debounce + merge + retry with backoff + persistence ----------
// หลักการ: UI อัปเดตทันทีเสมอ (optimistic) โดยไม่รอ network เลย ส่วนการยิงจริงไป Apps Script จะถูก
// "รวบ" ต่อ key (เช่น task:<id>) รอเงียบ 600ms ก่อนค่อยส่ง ถ้ามีการแก้ field เดิมซ้ำในช่วงรอ จะ merge
// เป็น POST เดียว ไม่ยิงซ้ำทุกครั้งที่กด — ลด request จริงลงเยอะโดยผู้ใช้ไม่รู้สึกหน่วงเลยเพราะจอ
// เปลี่ยนทันทีอยู่แล้ว ณ ตอนกด
var QUEUE_STORAGE_KEY = STORAGE_PREFIX + 'write_queue'; // L2P4: prefix ts2_ กันชนกับ ts_ ของแอปเดิมที่ origin เดียวกัน
var QUEUE_DEBOUNCE_MS = 600;
var QUEUE_RETRY_BASE_MS = 2000;
var QUEUE_RETRY_MAX_MS = 15000;
var QUEUE_ERROR_RETRY_LIMIT = 3; // backend ตอบ {ok:false} (เช่น LockService timeout) retry ได้กี่ครั้งก่อนยอมแพ้

var queueStore = {};  // key -> { opId, data } ที่ยังไม่ได้ส่ง (คงอยู่ข้าม reload ผ่าน localStorage)
var queueMeta = {};   // key -> { timer, busy, attempts } — สถานะรันไทม์ล้วนๆ ไม่ persist
var inFlightData = {}; // key -> data ที่กำลังส่งอยู่ตอนนี้ (ใช้ตรวจตอน poll ว่าอย่าทับด้วยของ server เก่า)

function generateOpId(key) {
  return key + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function loadQueueFromStorage() {
  try {
    var raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    queueStore = raw ? (JSON.parse(raw) || {}) : {};
  } catch (e) { queueStore = {}; }
}

function persistQueueToStorage() {
  try { localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueStore)); } catch (e) {}
}

function queueMetaFor(key) {
  return queueMeta[key] || (queueMeta[key] = { timer: null, busy: false, attempts: 0 });
}

// key: 'task:<id>' สำหรับแก้ field ของ task เดิม (merge กันได้), 'reorder:<id>' สำหรับจัดลำดับ,
// 'op:<unique>' สำหรับ action แบบครั้งเดียวไม่ merge (addTask/deleteTask/addSubtask/...)
//
// entry ที่ค้างอยู่ (ยังไม่ได้ "confirm" ว่า backend ทำสำเร็จ) จะอยู่ใน queueStore ต่อไปตลอด — ไม่ใช่
// แค่ตอนรอ debounce แต่รวมถึงตอนกำลังส่ง (in-flight) ด้วย เพื่อให้ persist ลง localStorage ครบ ถ้าปิด
// หน้าไปพอดีตอนกำลังส่งอยู่ เปิดใหม่แล้ว flushAll() จะ resume ส่งต่อได้ (ใช้ opId เดิมเป๊ะถ้าไม่มีอะไร
// เปลี่ยนระหว่างนั้น เลยชนกับ idempotency cache ฝั่ง backend ได้ถูกต้องถ้ารอบก่อนจริงๆ สำเร็จไปแล้ว
// แค่ response หลุดหาย) ตัวที่บอกว่า "กำลังส่งอยู่ตอนนี้ในแท็บนี้" คือ queueMeta[key].busy ซึ่งเป็น
// runtime-only ไม่ persist — พอ reload บอกว่า busy=false เสมอ ทำให้ resume ส่งใหม่ได้จริง
function queue(key, fields) {
  var entry = queueStore[key];
  if (!entry) {
    entry = { opId: generateOpId(key), data: {} };
    queueStore[key] = entry;
  } else {
    entry.opId = generateOpId(key); // เนื้อหาเปลี่ยนจากที่เคยส่ง (ถ้าเคยส่ง) แล้ว ใช้ opId ใหม่เสมอ
  }
  Object.assign(entry.data, fields);
  persistQueueToStorage();
  updateQueueStatus();
  scheduleFlush(key);
}

function scheduleFlush(key) {
  var meta = queueMetaFor(key);
  if (meta.busy) return; // มีคำขอค้างอยู่แล้ว จะ flush ต่อเองตอนมันจบถ้ายังมี pending (ดูใน flush())
  clearTimeout(meta.timer);
  meta.timer = setTimeout(function () { flush(key); }, QUEUE_DEBOUNCE_MS);
}

// ตั้ง retry แบบถอยหลังเอ็กซ์โพเนนเชียล 2s,4s,8s,... สูงสุด 15s — ใช้ร่วมกันทั้งตอนเน็ตหลุด
// และตอน backend ตอบ {ok:false} ชั่วคราว (ดู flush()) ถ้ามี queue() ใหม่เข้ามาระหว่างนี้ ก็ merge
// เข้า entry เดิมไปแล้วโดยอัตโนมัติ
function scheduleRetry(key, meta) {
  meta.attempts++;
  var delay = Math.min(QUEUE_RETRY_BASE_MS * Math.pow(2, meta.attempts - 1), QUEUE_RETRY_MAX_MS);
  meta.timer = setTimeout(function () { flush(key); }, delay);
  updateQueueStatus();
}

function flush(key) {
  var meta = queueMetaFor(key);
  clearTimeout(meta.timer);
  meta.timer = null;
  if (meta.busy) return;
  var entry = queueStore[key];
  if (!entry) return;

  meta.busy = true;
  var dispatchedOpId = entry.opId; // ไว้เช็คตอนจบว่ามี intent ใหม่มาทับระหว่างที่ส่งอยู่หรือเปล่า
  inFlightData[key] = entry.data;
  updateQueueStatus();

  sendQueuedEntry(key, entry)
    .then(function (res) {
      delete inFlightData[key];
      meta.busy = false;

      // backend ตอบกลับมาจริง (เชื่อมต่อไม่ได้พัง) แต่ทำไม่สำเร็จ — ส่วนใหญ่เป็น LockService รอเกิน
      // 10 วิแล้ว throw ชั่วคราว ไม่ใช่ข้อผิดพลาดถาวร ให้โอกาส retry แบบเดียวกับเน็ตหลุดก่อนจำนวนหนึ่ง
      // กัน "กดแล้วเฟล ต้องกดเอง" ที่เจอ — เกินจำนวนนี้ค่อยยอมแพ้จริงๆ ผ่าน applyQueueResult ด้านล่าง
      if (!res.ok && meta.attempts < QUEUE_ERROR_RETRY_LIMIT) {
        scheduleRetry(key, meta);
        return;
      }

      meta.attempts = 0;
      // ลบออกจากคิว persisted เฉพาะตอนไม่มีใครมาแก้ทับระหว่างที่ส่งอยู่ (opId ยังตรงกับตอนเริ่มส่ง)
      // ถ้ามี intent ใหม่เข้ามาระหว่างนั้น entry ปัจจุบันจะมี opId ใหม่แล้ว ต้องเก็บไว้ส่งต่อ ไม่ลบทิ้ง
      if (queueStore[key] && queueStore[key].opId === dispatchedOpId) {
        delete queueStore[key];
      }
      persistQueueToStorage();
      applyQueueResult(key, entry, res);
      if (queueStore[key]) flush(key); // มี intent ใหม่ค้างอยู่ ส่งต่อทันที ไม่ต้องรอ debounce ใหม่
      else updateQueueStatus();
    })
    .catch(function () {
      // ส่งไม่สำเร็จ (เชื่อมต่อพังจริง) — entry ยังอยู่ใน queueStore เหมือนเดิม (ไม่เคยลบออกตั้งแต่แรก)
      // retry ไม่จำกัดจำนวนครั้ง (ต่างจากกรณี backend ตอบ {ok:false} ด้านบน) เพราะเน็ตกลับมาเมื่อไหร่ก็ได้
      delete inFlightData[key];
      meta.busy = false;
      scheduleRetry(key, meta);
    });
}

function flushAll() {
  Object.keys(queueStore).forEach(function (key) { flush(key); });
}

function sendQueuedEntry(key, entry) {
  if (key.indexOf('task:') === 0) {
    return apiPost('updateTask', { id: key.slice(5), fields: entry.data, opId: entry.opId });
  }
  if (key.indexOf('reorder:') === 0) {
    return apiPost('setTaskOrder', { id: key.slice(8), position: entry.data.position, opId: entry.opId });
  }
  // op:<unique> — entry.data = { action, params }
  return apiPost(entry.data.action, Object.assign({ opId: entry.opId }, entry.data.params));
}

// เอาผลลัพธ์ที่ backend ยืนยันมาสะท้อนกลับ state.board ให้ตรงของจริง (แทนที่ค่า optimistic ชั่วคราว
// เช่น temp id ของงานที่เพิ่งเพิ่ม ด้วยของจริงจาก server)
function applyQueueResult(key, entry, res) {
  if (!res.ok) {
    showToast('ผิดพลาด: ' + (res.error || 'ไม่ทราบสาเหตุ'));
    loadBoard(); // backend ปฏิเสธจริง (ไม่ใช่แค่เน็ตพัง) โหลดใหม่ให้เห็นสถานะจริงเสมอ
    return;
  }
  if (key.indexOf('task:') === 0) {
    applyTask(res.result);
  } else if (key.indexOf('reorder:') === 0) {
    applyReorder(res.result);
  } else {
    var action = entry.data.action, params = entry.data.params;
    if (action === 'addTask') {
      removeTaskLocal(params.tempId);
      insertTaskLocal(res.result);
    } else if (action === 'addSubtask' || action === 'toggleSubtaskDone') {
      applyTask(res.result.task);
    } else if (action === 'addProject') {
      if (state.board) state.board.projects = res.result;
    } else if (action === 'addDream') {
      if (state.dreamsData) {
        var di = state.dreamsData.findIndex(function (d) { return d.id === params.tempId; });
        if (di !== -1) state.dreamsData[di] = res.result;
      }
      if (document.getElementById('dreams-panel')) renderDreamsPanel();
    } else if (action === 'toggleDreamDone') {
      if (state.dreamsData) {
        var dj = state.dreamsData.findIndex(function (d) { return d.id === res.result.id; });
        if (dj !== -1) state.dreamsData[dj] = res.result;
      }
      if (document.getElementById('dreams-panel')) renderDreamsPanel();
    }
    // deleteTask: ลบออกจากจอไปแล้วตอน optimistic ไม่ต้องทำอะไรเพิ่ม
  }
  refreshUI();
}

// แก้ field ของ task เดียว — อัปเดตจอทันที (optimistic) แล้วค่อยเข้าคิวส่งจริงแบบ debounce+merge
function updateTaskField(task, fields) {
  var localPatch = fields;
  // ย้ายวัน (day เปลี่ยน) ฝั่ง backend ต่อท้ายลำดับของวันใหม่เสมอ (setDay_/updateTask_ ใน Tasks.gs)
  // ตั้ง order ชั่วคราวให้ไปท้ายสุดตอน optimistic ด้วย กัน insertTaskLocal เอา order เดิมจากวันก่อน
  // (ซึ่งอาจตรงกับตำแหน่งกลางๆ ของวันใหม่) มาจัดตำแหน่งผิดจนกว่า server จะยืนยันค่าจริงกลับมา
  if (fields.day && fields.day !== task.day) localPatch = Object.assign({ order: 999999 }, fields);
  upsertTaskLocal(Object.assign({}, task, localPatch));
  refreshUI();
  queue('task:' + task.id, fields); // ส่ง fields เดิมไป backend เท่านั้น ไม่ส่ง order ปลอมที่เติมไว้แค่ฝั่งจอ
}

// จัดลำดับใน state.board ทันที (optimistic) ก่อนเข้าคิวส่งจริง — ลอกวิธีคำนวณตำแหน่งแบบเดียวกับ backend
function reorderTaskLocal(taskId, day, position) {
  if (!state.board) return;
  var dayObj = state.board.days.find(function (d) { return d.date === day; });
  if (!dayObj) return;
  var idx = dayObj.tasks.findIndex(function (t) { return t.id === taskId; });
  if (idx === -1) return;
  var moved = dayObj.tasks.splice(idx, 1)[0];
  var insertAt = Math.max(0, Math.min(Math.round(position) - 1, dayObj.tasks.length));
  dayObj.tasks.splice(insertAt, 0, moved);
}

function queueOp(key, action, params) {
  queue(key, { action: action, params: params });
}

function newOpKey(prefix) {
  return 'op:' + prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ---------- แถบสถานะคิว "saving n…" / "all saved ✓" ----------
var queueStatusHideTimer = null;
function pendingQueueCount() {
  // entry ที่ยังอยู่ใน queueStore นับรวมทั้งที่รอ debounce และที่กำลังส่งอยู่ (busy) แล้วอยู่แล้ว
  // เพราะตอนนี้ flush() ไม่ลบ entry ออกจนกว่าจะ confirm สำเร็จจริง
  return Object.keys(queueStore).length;
}

function updateQueueStatus() {
  var el = document.getElementById('queue-status');
  var n = pendingQueueCount();
  clearTimeout(queueStatusHideTimer);
  if (n > 0) {
    el.textContent = 'saving ' + n + '…';
    el.hidden = false;
    el.classList.remove('saved');
  } else {
    el.textContent = 'all saved ✓';
    el.classList.add('saved');
    el.hidden = false;
    queueStatusHideTimer = setTimeout(function () { el.hidden = true; }, 1500);
  }
}

window.addEventListener('online', flushAll);

// ---------- state ----------
var state = {
  workspace: localStorage.getItem(STORAGE_PREFIX + 'workspace') || 'Personal', // L2P4: ts2_ prefix
  view: localStorage.getItem(STORAGE_PREFIX + 'view') || 'today', // L2P4: ts2_ prefix
  weekStart: mondayOf(todayIso()),
  board: null,
  projectFilter: null,
  expandedTasks: new Set(), // เก็บ id ของ task ที่กางดู subtask อยู่ (UI state ล้วนๆ ไม่ผูกกับ network)
  // UX1: เก็บว่า "workspace|date" ไหนกางดู done tasks อยู่ — ไม่ persist, default พับเก็บเสมอตอนโหลดใหม่
  expandedDoneDays: new Set(),
  workloadExpanded: false,
  historyExpanded: false,
  historyLoading: false,
  historyData: null, // {total, stats:[{name,count,pct}]} — โหลดตอนกดกางครั้งแรกของแต่ละ workspace เท่านั้น
  dreamsData: null, // ลิสต์ TRUE DREAM — แยกอิสระจาก workspace/task ทั้งหมด โหลดครั้งแรกตอนกดเปิดปุ่ม
  dreamsLoading: false
};

// คืนเฉพาะงานที่ตรงกับ project filter ที่เลือกอยู่ (คืนทั้งหมดถ้าไม่ได้เลือก filter)
function filterTasks(tasks) {
  if (!state.projectFilter) return tasks;
  return tasks.filter(function (t) { return t.project === state.projectFilter; });
}

// ---------- แก้ state.board ในเครื่องโดยตรงจากผลลัพธ์ POST เพื่อไม่ต้อง loadBoard() ซ้ำ (เร็วขึ้นเท่าตัว) ----------
function byCreatedAt(a, b) { return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0); }
// ต้องตรงกับ byOrder ฝั่ง backend (Tasks.gs) เป๊ะ — งานในแต่ละวันเรียงตาม order (ตำแหน่งลากจัด) ไม่ใช่เวลาสร้าง
// ใช้ createdAt เป็น tie-breaker เฉยๆ ตอน order เท่ากัน (เผื่องานใหม่ที่ยังไม่ได้ order จริงจาก server)
function byOrder(a, b) { return (a.order || 0) - (b.order || 0) || byCreatedAt(a, b); }

function removeTaskLocal(id) {
  if (!state.board) return;
  state.board.days.forEach(function (d) {
    var idx = d.tasks.findIndex(function (t) { return t.id === id; });
    if (idx !== -1) d.tasks.splice(idx, 1);
  });
  var idx2 = state.board.someday.findIndex(function (t) { return t.id === id; });
  if (idx2 !== -1) state.board.someday.splice(idx2, 1);
}

function insertTaskLocal(task) {
  // เช็ค workspace ด้วยเสมอ — คิวเขียนทำงานเบื้องหลังต่อได้แม้ผู้ใช้จะสลับ workspace ไปแล้วก่อน
  // ที่ addTask/setDay ค้างอยู่จะยืนยันกลับมา ถ้าไม่เช็คจะเผลอแทรก task ผิด workspace เข้าบอร์ดที่
  // กำลังเปิดดูอยู่ได้ (บอร์ดจะดึงกลับมาถูกต้องเองตอน poll/loadBoard ของ workspace นั้นครั้งถัดไป)
  if (!state.board || task.workspace !== state.board.workspace) return;
  if (task.day === 'someday') {
    state.board.someday.push(task);
    state.board.someday.sort(byCreatedAt);
  } else {
    var day = state.board.days.find(function (d) { return d.date === task.day; });
    if (day) {
      day.tasks.push(task);
      day.tasks.sort(byOrder);
    }
    // ถ้า task.day ไม่ได้อยู่ในสัปดาห์ที่กำลังเปิดดูอยู่ตอนนี้ ก็แค่ไม่โผล่ในมุมมองปัจจุบัน ถูกต้องแล้ว
  }
}

// ลบตำแหน่งเดิมแล้วแทรกใหม่ตาม day ล่าสุดของ task — ใช้ได้ทั้งกรณีแก้ field เฉยๆ (day เดิม) และย้ายวัน (day เปลี่ยน)
function upsertTaskLocal(task) {
  removeTaskLocal(task.id);
  insertTaskLocal(task);
}

// ---------- theme ----------
function applyMonthTheme() {
  var humanMonth = new Date().getMonth() + 1;
  document.documentElement.dataset.monthParity = (humanMonth % 2 === 0) ? 'even' : 'odd';
}

// ---------- แถบสถานะ/loading (นับซ้อนกันได้ด้วยตัวนับ กันกรณี action ซ้อน action) ----------
var loadingCount = 0;
function setLoading(active, label) {
  var bar = document.getElementById('loading-bar');
  var status = document.getElementById('status-line');
  if (active) {
    loadingCount++;
    bar.classList.add('active');
    status.textContent = label || 'กำลังโหลด...';
    status.hidden = false;
  } else {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount === 0) {
      bar.classList.remove('active');
      status.hidden = true;
    }
  }
}

// วาดหน้าจอใหม่ทั้งหมดจาก state.board ปัจจุบัน — เรียกได้ทั้งหลัง loadBoard() ยิง network จริง
// และหลังแก้ state.board ในเครื่องตรงๆ แบบ optimistic (ก่อนคิวจะยิงจริงไป backend ด้วยซ้ำ)
function refreshUI() {
  renderTabs();
  renderProjectFilter();
  renderCaptureProjectOptions();
  renderOverdueBanner();
  renderWorkloadOverview();
  renderHistoryOverview();
  renderBoard();
  renderSomeday();
}

// ---------- toast ----------
var toastTimer = null;
function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
}

// ---------- rendering ----------
function renderTabs() {
  document.querySelectorAll('#workspace-tabs .tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.workspace === state.workspace);
  });
  document.querySelectorAll('#view-tabs .tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  });

  var isWeek = state.view === 'week';
  document.body.classList.toggle('view-week', isWeek); // UX1: เปิดโหมดกว้างเต็มจอเฉพาะ Week view บนจอใหญ่
  document.getElementById('week-nav').hidden = !isWeek;
  var isCurrentWeek = state.weekStart === mondayOf(todayIso());
  document.getElementById('today-jump').hidden = !(isWeek && !isCurrentWeek);
  if (isWeek) {
    document.getElementById('week-range').textContent = formatWeekRange(state.weekStart);
  }
}

function applyTask(task) { upsertTaskLocal(task); }

// แตะชื่องานเพื่อแก้ไขแบบ inline — Enter บันทึก, Escape ยกเลิก, คลิกที่อื่น (blur) ถือว่าบันทึกเหมือน Enter
function startTitleEdit(titleEl, task) {
  var input = document.createElement('input');
  input.className = 'task-title-input';
  input.value = task.title;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  var cancelled = false;
  function commit() {
    if (cancelled) return;
    var newTitle = input.value.trim();
    if (!newTitle || newTitle === task.title) {
      refreshUI(); // ไม่มีอะไรเปลี่ยนหรือลบจนว่าง กลับไป render ปกติเฉยๆ
      return;
    }
    updateTaskField(task, { title: newTitle });
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { cancelled = true; refreshUI(); }
  });
}

function subtaskProgressLabel(subtasks) {
  var total = subtasks.length;
  if (total === 0) return 'งานย่อย';
  var done = subtasks.filter(function (s) { return s.done; }).length;
  return done + '/' + total + ' งานย่อย';
}

function subtaskBoxEl(task) {
  var box = document.createElement('div');
  box.className = 'subtask-box';

  (task.subtasks || []).forEach(function (s) {
    var row = document.createElement('div');
    row.className = 'subtask-row' + (s.done ? ' done' : '');

    var sCheck = document.createElement('button');
    sCheck.className = 'subtask-check';
    sCheck.textContent = s.done ? '✓' : '';
    sCheck.addEventListener('click', function () {
      var updatedSubtasks = (task.subtasks || []).map(function (x) {
        return x.id === s.id ? Object.assign({}, x, { done: !x.done }) : x;
      });
      upsertTaskLocal(Object.assign({}, task, { subtasks: updatedSubtasks }));
      refreshUI();
      // L2P4: ส่ง done ที่คำนวณแล้วตรงๆ (set ไม่ใช่ toggle) กันทำสองครั้งพลาดกลับค่าเดิม
      queueOp(newOpKey('togglesub'), 'toggleSubtaskDone', { id: s.id, done: !s.done });
    });

    var sTitle = document.createElement('span');
    sTitle.className = 'subtask-title';
    sTitle.textContent = s.title;

    row.appendChild(sCheck);
    row.appendChild(sTitle);
    box.appendChild(row);
  });

  var form = document.createElement('form');
  form.className = 'subtask-form';
  var input = document.createElement('input');
  input.placeholder = 'เพิ่มงานย่อย…';
  form.appendChild(input);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var subTitle = input.value.trim();
    if (!subTitle) return;
    input.value = '';
    var tempSubId = crypto.randomUUID(); // L2P4: UUID จริงแทน tmp_st_ — ใช้เป็น id จริงได้เลย ไม่ต้องสลับทีหลัง
    var updatedTask = Object.assign({}, task, {
      subtasks: (task.subtasks || []).concat([{
        id: tempSubId, taskId: task.id, title: subTitle, done: false, createdAt: new Date().toISOString()
      }])
    });
    upsertTaskLocal(updatedTask);
    refreshUI();
    // L2P4: ส่ง id (=tempSubId) ไปด้วย ให้ adapter upsert แบบ idempotent ได้ (เดิมไม่เคยส่ง id ของ subtask)
    queueOp(newOpKey('addsub'), 'addSubtask', { taskId: task.id, title: subTitle, id: tempSubId });
  });
  box.appendChild(form);

  return box;
}

// ---------- ลากการ์ดงานย้ายวัน (มุมมอง Week เท่านั้น) ----------
// ใช้ Pointer Events (ตัวเดียวรองรับทั้งเมาส์/นิ้ว) แทน HTML5 drag-and-drop เพราะ drag-and-drop
// มาตรฐานใช้บนมือถือไม่ได้จริง — ต้อง "กดค้าง" ก่อนสักครู่ถึงเริ่มลาก กันการแตะ/เลื่อนหน้าจอปกติ
// กลายเป็นลากโดยไม่ตั้งใจ ปุ่มต่างๆ ในการ์ด (เช็ค, ลูกศร, ลบ ฯลฯ) ยังกดได้ปกติเพราะเช็ค e.target ก่อนเริ่มจับเวลา
var drag = null; // มีการลากได้ทีละ 1 การ์ดเท่านั้นทั้งแอป
var DRAG_HOLD_MS = 350;
// นิ้วคนสั่นตามธรรมชาติเกิน 8px อยู่แล้วตอนกดค้างนิ่งๆ บนจอสัมผัส — ตั้งหลวมพอไม่ให้ยกเลิกการลากไปเอง
// ก่อนจะเริ่ม (ตั้งไว้แน่นแบบเมาส์ไม่ได้ เพราะ touch-action:none บนการ์ดกันการเลื่อนหน้าจอแทนอยู่แล้ว
// จึงไม่มีอะไรต้องป้องกันจากการขยับเล็กน้อยตรงนี้)
var DRAG_MOVE_CANCEL_PX = 24;

function attachDragHandlers(card, task) {
  // ไม่ตั้ง touch-action:none ที่การ์ดทั้งใบ (ต่างจาก handle ⠿ ที่เป็นจุดเล็กๆ) เพราะการ์ดในมุมมอง
  // Week กินพื้นที่เกือบเต็มจอ ถ้ากันการเลื่อนหน้าจอตรงนี้ด้วยจะเลื่อน list ขึ้นลงไม่ได้เลยถ้านิ้วเริ่ม
  // แตะบนการ์ด (นี่คือสาเหตุที่เลื่อนจอค้างบ่อยบนมือถือ) ปล่อยให้เบราว์เซอร์ scroll ได้ตามปกติ แล้วใช้
  // ตัวจับเวลา+ระยะขยับ (เหมือน handle) แยกแยะเอาว่าจะลากหรือแค่เลื่อนจอ
  card.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button, input, form')) return; // ปล่อยให้ปุ่ม/ช่องกรอกทำงานปกติ
    if (e.button !== undefined && e.button !== 0) return; // เมาส์ใช้ได้แค่คลิกซ้าย

    var startX = e.clientX, startY = e.clientY;
    var timer = setTimeout(function () {
      cleanup();
      startDrag(card, task, startX, startY);
    }, DRAG_HOLD_MS);

    function cancelIfMoved(ev) {
      if (Math.abs(ev.clientX - startX) > DRAG_MOVE_CANCEL_PX || Math.abs(ev.clientY - startY) > DRAG_MOVE_CANCEL_PX) {
        clearTimeout(timer);
        cleanup();
      }
    }
    function cleanup() {
      card.removeEventListener('pointermove', cancelIfMoved);
      card.removeEventListener('pointerup', cleanup);
      card.removeEventListener('pointercancel', cleanup);
    }
    function onEnd() {
      clearTimeout(timer);
      cleanup();
    }
    card.addEventListener('pointermove', cancelIfMoved);
    card.addEventListener('pointerup', onEnd, { once: true });
    // เบราว์เซอร์แย่งท่าทางนี้ไปทำ scroll เอง (พบบ่อยบนมือถือเพราะไม่ได้ตั้ง touch-action:none) จะได้
    // pointercancel แทน pointerup/pointermove ต่อเนื่อง — ต้องยกเลิกตัวจับเวลาด้วย ไม่งั้นจะหลุดมาเริ่ม
    // ลากเองตอนที่ผู้ใช้แค่กำลังเลื่อนจอปกติอยู่ (คือสาเหตุที่เลื่อนจอ "ค้าง" ที่เจอ)
    card.addEventListener('pointercancel', onEnd, { once: true });
  });
}

function positionGhost(ghost, x, y) {
  ghost.style.left = (x - ghost.offsetWidth / 2) + 'px';
  ghost.style.top = (y - 24) + 'px';
}

function startDrag(card, task, x, y) {
  if (drag) return;
  card.classList.add('dragging-source');

  var ghost = card.cloneNode(true);
  ghost.className = 'task-card drag-ghost';
  ghost.style.width = card.offsetWidth + 'px';
  document.body.appendChild(ghost);
  positionGhost(ghost, x, y);

  drag = { task: task, ghost: ghost, sourceCard: card, lastTarget: null };
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  positionGhost(drag.ghost, e.clientX, e.clientY);
  drag.ghost.style.display = 'none';
  var el = document.elementFromPoint(e.clientX, e.clientY);
  drag.ghost.style.display = '';
  var section = el && el.closest('.day-section');
  if (drag.lastTarget && drag.lastTarget !== section) {
    drag.lastTarget.classList.remove('drop-target');
  }
  if (section) section.classList.add('drop-target');
  drag.lastTarget = section;
}

function onDragEnd() {
  if (!drag) return;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);

  drag.sourceCard.classList.remove('dragging-source');
  drag.ghost.remove();
  if (drag.lastTarget) drag.lastTarget.classList.remove('drop-target');

  var targetDate = drag.lastTarget && drag.lastTarget.dataset.date;
  var task = drag.task;
  drag = null;

  if (targetDate && targetDate !== task.day) {
    updateTaskField(task, { day: targetDate });
  }
}

// ---------- ลากจัดลำดับภายในวันเดียวกัน (handle เฉพาะ ⠿ — แยกจากลากทั้งการ์ดเพื่อย้ายวันด้านบน) ----------
// ใช้ได้ทั้งมุมมอง Today และ Week เพราะจัดลำดับไม่เกี่ยวกับการย้ายข้ามวัน
var reorderDrag = null;

function attachReorderHandle(handle, card, task) {
  handle.style.touchAction = 'none';

  handle.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    var startX = e.clientX, startY = e.clientY;
    var timer = setTimeout(function () {
      cleanup();
      startReorderDrag(card, task, startX, startY);
    }, DRAG_HOLD_MS);

    function cancelIfMoved(ev) {
      if (Math.abs(ev.clientX - startX) > DRAG_MOVE_CANCEL_PX || Math.abs(ev.clientY - startY) > DRAG_MOVE_CANCEL_PX) {
        clearTimeout(timer);
        cleanup();
      }
    }
    function cleanup() {
      handle.removeEventListener('pointermove', cancelIfMoved);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
    }
    function onEnd() {
      clearTimeout(timer);
      cleanup();
    }
    handle.addEventListener('pointermove', cancelIfMoved);
    handle.addEventListener('pointerup', onEnd, { once: true });
    handle.addEventListener('pointercancel', onEnd, { once: true }); // เผื่อระบบแย่งท่าทางไปกลางคัน
  });
}

function startReorderDrag(card, task, x, y) {
  if (reorderDrag || drag) return;
  card.classList.add('dragging-source');

  var ghost = card.cloneNode(true);
  ghost.className = 'task-card drag-ghost';
  ghost.style.width = card.offsetWidth + 'px';
  document.body.appendChild(ghost);
  positionGhost(ghost, x, y);

  reorderDrag = {
    task: task,
    ghost: ghost,
    sourceCard: card,
    sourceSection: card.closest('.day-section'),
    lastTarget: null,
    insertAfter: false
  };
  document.addEventListener('pointermove', onReorderMove);
  document.addEventListener('pointerup', onReorderEnd);
  document.addEventListener('pointercancel', onReorderEnd);
}

function onReorderMove(e) {
  if (!reorderDrag) return;
  positionGhost(reorderDrag.ghost, e.clientX, e.clientY);
  reorderDrag.ghost.style.display = 'none';
  var el = document.elementFromPoint(e.clientX, e.clientY);
  reorderDrag.ghost.style.display = '';

  if (reorderDrag.lastTarget) reorderDrag.lastTarget.classList.remove('reorder-before', 'reorder-after');

  var overCard = el && el.closest('.task-card');
  if (overCard && overCard !== reorderDrag.sourceCard && overCard.closest('.day-section') === reorderDrag.sourceSection) {
    var rect = overCard.getBoundingClientRect();
    var after = e.clientY > rect.top + rect.height / 2;
    overCard.classList.add(after ? 'reorder-after' : 'reorder-before');
    reorderDrag.lastTarget = overCard;
    reorderDrag.insertAfter = after;
  } else {
    reorderDrag.lastTarget = null;
  }
}

function applyReorder(result) {
  // เช็ค workspace ด้วยเสมอ เผื่อผู้ใช้สลับ workspace ไปแล้วก่อนที่ setTaskOrder ค้างอยู่จะยืนยันกลับมา
  // (เหตุผลเดียวกับ guard ใน insertTaskLocal — กันทับวันของ workspace ที่กำลังเปิดดูอยู่ผิดๆ)
  if (!state.board || result.workspace !== state.board.workspace) return;
  var day = state.board.days.find(function (d) { return d.date === result.day; });
  if (day) day.tasks = result.tasks;
}

function onReorderEnd() {
  if (!reorderDrag) return;
  document.removeEventListener('pointermove', onReorderMove);
  document.removeEventListener('pointerup', onReorderEnd);
  document.removeEventListener('pointercancel', onReorderEnd);

  var sourceCard = reorderDrag.sourceCard;
  var targetCard = reorderDrag.lastTarget;
  var insertAfter = reorderDrag.insertAfter;
  var task = reorderDrag.task;
  var ghost = reorderDrag.ghost;
  reorderDrag = null;

  sourceCard.classList.remove('dragging-source');
  ghost.remove();
  if (targetCard) targetCard.classList.remove('reorder-before', 'reorder-after');
  if (!targetCard) return; // ปล่อยนอกการ์ด/นอกวันเดิม ถือว่ายกเลิก ไม่มีอะไรเปลี่ยน

  // UX1: หาตำแหน่งจากลิสต์เต็มของวันนั้นใน state.board (ไม่ใช่ลำดับการ์ดใน DOM) — done tasks ที่พับซ่อน
  // อยู่ไม่มีการ์ดใน DOM เลย นับ index จาก DOM แบบเดิมจะเพี้ยนทันทีที่มี done ซ่อนอยู่ในวันนั้น
  var targetTaskId = targetCard.dataset.id;
  if (!targetTaskId) return;
  var dayObj = state.board && state.board.days.find(function (d) { return d.date === task.day; });
  if (!dayObj) return;
  var fullIds = dayObj.tasks.map(function (t) { return t.id; }); // เรียงตาม order อยู่แล้ว (ตรงกับที่ UI ใช้)
  var position = computeReorderPosition(fullIds, task.id, targetTaskId, insertAfter);
  if (position === null) return;

  reorderTaskLocal(task.id, task.day, position);
  refreshUI();
  queue('reorder:' + task.id, { position: position });
}

function taskCardEl(task, opts) {
  var card = document.createElement('div');
  card.className = 'task-card' + (task.done ? ' done' : '');
  card.dataset.id = task.id; // UX1: ให้ onReorderEnd หาตำแหน่งจาก id แทน DOM index (ใช้ได้แม้ done ถูกซ่อนอยู่)

  var check = document.createElement('button');
  check.className = 'task-check';
  check.textContent = task.done ? '✓' : '';
  check.setAttribute('aria-label', 'เสร็จ/ยังไม่เสร็จ');
  check.addEventListener('click', function () {
    updateTaskField(task, { done: !task.done });
  });

  var body = document.createElement('div');
  body.className = 'task-body';

  var title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
  title.title = 'แตะเพื่อแก้ชื่องาน';
  title.addEventListener('click', function () { startTitleEdit(title, task); });
  body.appendChild(title);

  var chip = document.createElement('button');
  chip.className = 'project-chip' + (task.project ? '' : ' empty');
  chip.textContent = task.project || '+ project';
  if (task.project) {
    var chipColor = colorForProject(task.project);
    chip.style.background = chipColor.bg;
    chip.style.color = chipColor.fg;
  }
  chip.addEventListener('click', function () { openProjectPicker(task); });
  body.appendChild(chip);

  var isExpanded = state.expandedTasks.has(task.id);
  var subtaskToggle = document.createElement('button');
  subtaskToggle.className = 'subtask-toggle';
  subtaskToggle.textContent = (isExpanded ? '▾ ' : '▸ ') + subtaskProgressLabel(task.subtasks || []);
  subtaskToggle.addEventListener('click', function () {
    if (state.expandedTasks.has(task.id)) state.expandedTasks.delete(task.id);
    else state.expandedTasks.add(task.id);
    refreshUI();
  });
  body.appendChild(subtaskToggle);

  if (isExpanded) {
    body.appendChild(subtaskBoxEl(task));
  }

  var actions = document.createElement('div');
  actions.className = 'task-actions';

  if (opts && opts.somedayItem) {
    var toToday = document.createElement('button');
    toToday.textContent = '↥';
    toToday.title = 'ย้ายขึ้นวันนี้';
    toToday.addEventListener('click', function () {
      var targetDay = todayIso();
      // Office ไม่มีวันเสาร์-อาทิตย์ ถ้าตรงกับวันหยุดพอดี ให้ย้ายไปจันทร์ถัดไปแทน
      if (isWeekdaysOnly(task.workspace) && isWeekend(targetDay)) {
        targetDay = addDaysIso(mondayOf(targetDay), 7);
      }
      updateTaskField(task, { day: targetDay });
      showToast('ย้ายขึ้นวันนี้แล้ว');
    });
    actions.appendChild(toToday);
  } else {
    var prev = document.createElement('button');
    prev.textContent = '←';
    prev.title = 'เลื่อนไปวันก่อนหน้า';
    prev.addEventListener('click', function () {
      updateTaskField(task, { day: addBusinessDaysIso(task.workspace, task.day, -1) });
    });
    var next = document.createElement('button');
    next.textContent = '→';
    next.title = 'เลื่อนไปวันถัดไป';
    next.addEventListener('click', function () {
      updateTaskField(task, { day: addBusinessDaysIso(task.workspace, task.day, 1) });
    });
    var toSomeday = document.createElement('button');
    toSomeday.textContent = '↧';
    toSomeday.title = 'ย้ายไป Someday';
    toSomeday.addEventListener('click', function () {
      updateTaskField(task, { day: 'someday' });
      showToast('ย้ายไป Someday แล้ว');
    });
    actions.appendChild(prev);
    actions.appendChild(next);
    actions.appendChild(toSomeday);
  }

  var del = document.createElement('button');
  del.className = 'delete-btn';
  del.textContent = '🗑';
  del.title = 'ลบงานนี้';
  del.addEventListener('click', function () {
    if (!confirm('ลบงาน "' + task.title + '" เลยไหม? กู้คืนไม่ได้')) return;
    removeTaskLocal(task.id);
    refreshUI();
    queueOp(newOpKey('del'), 'deleteTask', { id: task.id });
  });
  actions.appendChild(del);

  if (!(opts && opts.somedayItem)) {
    var handle = document.createElement('button');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-label', 'กดค้างเพื่อจัดลำดับในวันนี้');
    handle.title = 'กดค้างแล้วลากเพื่อจัดลำดับ';
    card.appendChild(handle);
    attachReorderHandle(handle, card, task);
  }
  card.appendChild(check);
  card.appendChild(body);
  card.appendChild(actions);

  // ลากทั้งการ์ด (แตะที่อื่นนอกปุ่ม/handle) ย้ายวันได้เฉพาะมุมมอง Week และเฉพาะงานที่ผูกกับวัน
  // (ไม่ใช่ someday — ใช้ปุ่ม ↥ แทน) — แยกจาก handle ด้านบนซึ่งใช้จัดลำดับภายในวันเดียวกันเท่านั้น
  if (state.view === 'week' && !(opts && opts.somedayItem)) {
    attachDragHandlers(card, task);
  }

  return card;
}

function daySectionEl(date, tasks, isToday) {
  // UX1: วันที่ผ่านมาแล้ว (ก่อน today ของบอร์ด) หัวข้อจางลง — การ์ดข้างในไม่โดนจาง
  var isPast = !!(state.board && date < state.board.today);

  var section = document.createElement('div');
  section.className = 'day-section' + (isToday ? ' is-today' : '');
  section.dataset.date = date;

  var heading = document.createElement('p');
  heading.className = 'day-heading' + (isToday ? ' is-today' : '') + (isPast ? ' is-past' : '');
  if (isToday) {
    var dot = document.createElement('span');
    dot.className = 'dot';
    heading.appendChild(dot);
  }
  heading.appendChild(document.createTextNode(formatDayHeading(date)));
  if (isToday) {
    var pill = document.createElement('span');
    pill.className = 'today-pill';
    pill.textContent = 'วันนี้';
    heading.appendChild(pill);
  }
  section.appendChild(heading);

  var list = document.createElement('div');
  list.className = 'task-list';

  // UX1: แยกงานที่เสร็จแล้วออกไปพับเก็บต่างหาก (ลิสต์ tasks ที่รับมาเรียงตาม order อยู่แล้ว รักษาลำดับ
  // เดิมไว้ในแต่ละกลุ่ม) — ใช้ได้ทั้งมุมมอง Today และ Week เพราะเรียก daySectionEl ร่วมกัน
  var openTasks = tasks.filter(function (t) { return !t.done; });
  var doneTasks = tasks.filter(function (t) { return t.done; });

  if (tasks.length === 0) {
    var hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'ยังไม่มีงาน';
    list.appendChild(hint);
  } else {
    openTasks.forEach(function (t) { list.appendChild(taskCardEl(t)); });
  }

  if (doneTasks.length > 0) {
    var expandKey = state.workspace + '|' + date;
    var expanded = state.expandedDoneDays.has(expandKey);
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'done-toggle';
    toggle.textContent = '✓ เสร็จแล้ว ' + doneTasks.length + ' งาน ' + (expanded ? '▾' : '▸');
    toggle.addEventListener('click', function () {
      if (expanded) state.expandedDoneDays.delete(expandKey);
      else state.expandedDoneDays.add(expandKey);
      refreshUI();
    });
    list.appendChild(toggle);
    if (expanded) {
      doneTasks.forEach(function (t) { list.appendChild(taskCardEl(t)); });
    }
  }

  section.appendChild(list);
  return section;
}

function renderBoard() {
  var boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  if (!state.board) return;

  var weekdaysOnly = isWeekdaysOnly(state.board.workspace);

  if (state.view === 'today') {
    if (weekdaysOnly && isWeekend(state.board.today)) {
      var weekendHint = document.createElement('p');
      weekendHint.className = 'empty-hint';
      weekendHint.textContent = 'วันหยุดสุดสัปดาห์ ไม่มีงาน Office วันนี้';
      boardEl.appendChild(weekendHint);
      return;
    }
    var todayDay = state.board.days.find(function (d) { return d.date === state.board.today; });
    if (todayDay) {
      boardEl.appendChild(daySectionEl(todayDay.date, filterTasks(todayDay.tasks), true));
    }
  } else {
    var grid = document.createElement('div');
    grid.className = 'week-grid' + (weekdaysOnly ? ' week-grid--5' : ''); // UX1: Office เห็นแค่ จ-ศ ให้กริด 5 คอลัมน์
    state.board.days.forEach(function (d) {
      if (weekdaysOnly && isWeekend(d.date)) return; // Office ไม่มีวันเสาร์-อาทิตย์ให้โชว์
      grid.appendChild(daySectionEl(d.date, filterTasks(d.tasks), d.date === state.board.today));
    });
    boardEl.appendChild(grid);
  }
}

function renderSomeday() {
  var listEl = document.getElementById('someday-list');
  listEl.innerHTML = '';
  if (!state.board) return;
  var tasks = filterTasks(state.board.someday);
  if (tasks.length === 0) {
    var hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = state.board.someday.length === 0 ? 'ยังไม่มีงานใน Someday' : 'ไม่มีงานของ project นี้ใน Someday';
    listEl.appendChild(hint);
    return;
  }
  tasks.forEach(function (t) {
    listEl.appendChild(taskCardEl(t, { somedayItem: true }));
  });
}

// ---------- project filter chips ----------
function renderProjectFilter() {
  var el = document.getElementById('project-filter');
  el.innerHTML = '';
  var projects = (state.board && state.board.projects) || [];
  if (projects.length === 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;

  var allBtn = document.createElement('button');
  allBtn.className = 'filter-chip' + (state.projectFilter ? '' : ' active');
  allBtn.textContent = 'ทั้งหมด';
  allBtn.addEventListener('click', function () {
    state.projectFilter = null;
    renderProjectFilter();
    renderCaptureProjectOptions();
    renderBoard();
    renderSomeday();
  });
  el.appendChild(allBtn);

  projects.forEach(function (name) {
    var btn = document.createElement('button');
    var isActive = state.projectFilter === name;
    btn.className = 'filter-chip' + (isActive ? ' active' : '');
    btn.textContent = name;
    var chipColor = colorForProject(name);
    btn.style.background = chipColor.bg;
    btn.style.color = chipColor.fg;
    if (isActive) btn.style.boxShadow = 'inset 0 0 0 2px ' + chipColor.fg;
    btn.addEventListener('click', function () {
      state.projectFilter = name;
      renderProjectFilter();
      renderCaptureProjectOptions();
      renderBoard();
      renderSomeday();
    });
    el.appendChild(btn);
  });
}

// ---------- UX1: project picker ตอนเพิ่มงานใหม่ (capture form) ----------
// ตัวเลือก = 'ไม่มี project' + state.board.projects ตามลำดับ พรีเซตค่า project ล่าสุดที่ใช้ต่อ workspace
// (เก็บใน localStorage) แต่ถ้าผู้ใช้เลือกค่าอื่นค้างอยู่แล้วจากการ render ครั้งก่อน (ยังอยู่ในลิสต์จริง)
// ให้คงค่านั้นไว้ ไม่ดึงกลับไปเป็นค่า default ทุกครั้งที่ re-render
function renderCaptureProjectOptions() {
  var select = document.getElementById('capture-project');
  if (!select) return;
  var projects = (state.board && state.board.projects) || [];
  var prevValue = select.value;
  var keepPrev = prevValue !== '' && projects.indexOf(prevValue) !== -1;

  select.innerHTML = '';
  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'ไม่มี project';
  select.appendChild(noneOpt);
  projects.forEach(function (name) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  if (keepPrev) {
    select.value = prevValue;
    return;
  }
  var stored = localStorage.getItem(STORAGE_PREFIX + 'last_project_' + state.workspace);
  select.value = (stored && projects.indexOf(stored) !== -1) ? stored : '';
}

// ---------- ภาพรวมงานค้างต่อ project (สัดส่วนงานยังไม่เสร็จของสัปดาห์ที่กำลังดูอยู่ + someday) ----------
var NO_PROJECT_LABEL = '(ไม่มี project)';
var NO_PROJECT_COLOR = '#a8a196';

function computeWorkloadStats() {
  var pending = [];
  state.board.days.forEach(function (d) { d.tasks.forEach(function (t) { if (!t.done) pending.push(t); }); });
  state.board.someday.forEach(function (t) { if (!t.done) pending.push(t); });

  var counts = {};
  pending.forEach(function (t) {
    var key = t.project || NO_PROJECT_LABEL;
    counts[key] = (counts[key] || 0) + 1;
  });

  var total = pending.length;
  return Object.keys(counts)
    .map(function (name) { return { name: name, count: counts[name], pct: total ? Math.round(counts[name] / total * 100) : 0 }; })
    .sort(function (a, b) { return b.count - a.count; });
}

function renderWorkloadOverview() {
  var el = document.getElementById('workload-section');
  el.innerHTML = '';
  if (!state.board) return;

  var stats = computeWorkloadStats();
  var total = stats.reduce(function (s, x) { return s + x.count; }, 0);

  var toggle = document.createElement('button');
  toggle.className = 'workload-toggle';
  toggle.textContent = (state.workloadExpanded ? '▾ ' : '▸ ') + 'ภาพรวมงานค้าง' + (total ? ' (' + total + ' งาน)' : '');
  toggle.addEventListener('click', function () {
    state.workloadExpanded = !state.workloadExpanded;
    renderWorkloadOverview();
  });
  el.appendChild(toggle);

  if (!state.workloadExpanded) return;

  if (total === 0) {
    var hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'ไม่มีงานค้างในสัปดาห์นี้ 🎉';
    el.appendChild(hint);
    return;
  }

  var bar = document.createElement('div');
  bar.className = 'workload-bar';
  stats.forEach(function (s) {
    var seg = document.createElement('span');
    seg.style.width = s.pct + '%';
    seg.style.background = s.name === NO_PROJECT_LABEL ? NO_PROJECT_COLOR : colorForProject(s.name).fg;
    bar.appendChild(seg);
  });
  el.appendChild(bar);

  var list = document.createElement('div');
  list.className = 'workload-list';
  stats.forEach(function (s) {
    var row = document.createElement('div');
    row.className = 'workload-row';

    var dot = document.createElement('span');
    dot.className = 'workload-dot';
    dot.style.background = s.name === NO_PROJECT_LABEL ? NO_PROJECT_COLOR : colorForProject(s.name).fg;

    var label = document.createElement('span');
    label.className = 'workload-label';
    label.textContent = s.name;

    var value = document.createElement('span');
    value.className = 'workload-value';
    value.textContent = s.count + ' งาน · ' + s.pct + '%';

    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(value);
    list.appendChild(row);
  });
  el.appendChild(list);
}

// ---------- ประวัติงานเสร็จแล้ว (ทุกสัปดาห์ย้อนหลัง ไม่ใช่แค่สัปดาห์ปัจจุบัน) ----------
// โหลดแบบ lazy ตอนกดกางครั้งแรกของแต่ละ workspace เท่านั้น (คนละ endpoint จาก getBoard เพราะต้อง
// อ่านทั้งชีต ไม่ได้อ่านแค่สัปดาห์เดียว) แล้ว cache ไว้ใน state.historyData จนกว่าจะสลับ workspace
function renderHistoryOverview() {
  var el = document.getElementById('history-section');
  el.innerHTML = '';

  var toggle = document.createElement('button');
  toggle.className = 'workload-toggle';
  toggle.textContent = (state.historyExpanded ? '▾ ' : '▸ ') + 'ประวัติงานเสร็จแล้ว' +
    (state.historyData ? ' (' + state.historyData.total + ' งาน)' : '');
  toggle.addEventListener('click', function () {
    state.historyExpanded = !state.historyExpanded;
    if (state.historyExpanded && !state.historyData) {
      loadHistory();
    } else {
      renderHistoryOverview();
    }
  });
  el.appendChild(toggle);

  if (!state.historyExpanded) return;

  if (state.historyLoading) {
    var loadingHint = document.createElement('p');
    loadingHint.className = 'empty-hint';
    loadingHint.textContent = 'กำลังโหลด...';
    el.appendChild(loadingHint);
    return;
  }

  if (!state.historyData || state.historyData.total === 0) {
    var hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'ยังไม่มีงานที่เสร็จเลย';
    el.appendChild(hint);
    return;
  }

  var bar = document.createElement('div');
  bar.className = 'workload-bar';
  state.historyData.stats.forEach(function (s) {
    var seg = document.createElement('span');
    seg.style.width = s.pct + '%';
    seg.style.background = s.name === NO_PROJECT_LABEL ? NO_PROJECT_COLOR : colorForProject(s.name).fg;
    bar.appendChild(seg);
  });
  el.appendChild(bar);

  var list = document.createElement('div');
  list.className = 'workload-list';
  state.historyData.stats.forEach(function (s) {
    var row = document.createElement('div');
    row.className = 'workload-row';

    var dot = document.createElement('span');
    dot.className = 'workload-dot';
    dot.style.background = s.name === NO_PROJECT_LABEL ? NO_PROJECT_COLOR : colorForProject(s.name).fg;

    var label = document.createElement('span');
    label.className = 'workload-label';
    label.textContent = s.name;

    var value = document.createElement('span');
    value.className = 'workload-value';
    value.textContent = s.count + ' งาน · ' + s.pct + '%';

    row.appendChild(dot);
    row.appendChild(label);
    row.appendChild(value);
    list.appendChild(row);
  });
  el.appendChild(list);
}

function loadHistory() {
  state.historyLoading = true;
  renderHistoryOverview();
  setLoading(true, 'กำลังโหลดประวัติ...');
  apiGet({ action: 'getProjectHistory', workspace: state.workspace })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error || 'โหลดประวัติไม่สำเร็จ');
      state.historyData = res.data;
    })
    .catch(function (err) {
      showToast('ผิดพลาด: ' + err.message);
      state.historyExpanded = false;
    })
    .then(function () {
      state.historyLoading = false;
      setLoading(false);
      renderHistoryOverview();
    });
}

// ---------- overdue banner ----------
function renderOverdueBanner() {
  var el = document.getElementById('overdue-banner');
  if (!state.board) { el.hidden = true; return; }
  var count = 0;
  state.board.days.forEach(function (d) {
    if (d.date < state.board.today) {
      d.tasks.forEach(function (t) { if (!t.done) count++; });
    }
  });
  if (count === 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = '⚠️ มีงานค้างจากวันก่อนหน้ายังไม่เสร็จ ' + count + ' งาน';
}

// ---------- capture day picker ----------
// ตัวเลือกวันของฟอร์ม quick capture อิงสัปดาห์ปัจจุบันจริงเสมอ (ไม่อิงสัปดาห์ที่กำลังเปิดดูอยู่ใน
// มุมมอง Week) เพราะ requirement คือ "เลือกวันในสัปดาห์นี้ได้ ไม่เลือกก็ลงวันนี้" — ค่า default รีเซ็ต
// กลับเป็นวันนี้ทุกครั้งหลังเพิ่มงานสำเร็จ ไม่ค้างค่าที่เลือกไว้ก่อนหน้า
function renderCaptureDayOptions() {
  var select = document.getElementById('capture-day');
  select.innerHTML = '';
  var monday = mondayOf(todayIso());
  var today = todayIso();
  var weekdaysOnly = isWeekdaysOnly(state.workspace);
  var dates = [];
  for (var i = 0; i < 7; i++) {
    var date = addDaysIso(monday, i);
    if (weekdaysOnly && isWeekend(date)) continue; // Office เลือกได้แค่ จ-ศ
    dates.push(date);
  }
  dates.forEach(function (date) {
    var opt = document.createElement('option');
    opt.value = date;
    opt.textContent = (date === today ? 'วันนี้' : formatDayHeading(date));
    select.appendChild(opt);
  });
  // ถ้าวันนี้เป็นเสาร์-อาทิตย์และ workspace ทำงานแค่ จ-ศ (ไม่มีตัวเลือก "วันนี้" ให้เลือก)
  // ให้ default ไปวันศุกร์ก่อนหน้า (วันทำการล่าสุดในสัปดาห์นี้) แทน
  select.value = dates.indexOf(today) !== -1 ? today : dates[dates.length - 1];
}

// ---------- project picker ----------
function openProjectPicker(task) {
  closeProjectPicker();

  var backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.id = 'picker-backdrop';
  backdrop.addEventListener('click', closeProjectPicker);

  var picker = document.createElement('div');
  picker.className = 'project-picker';
  picker.id = 'picker-panel';

  var h3 = document.createElement('h3');
  h3.textContent = 'เลือก project สำหรับ "' + task.title + '"';
  picker.appendChild(h3);

  var optionList = document.createElement('div');
  optionList.className = 'option-list';

  if (task.project) {
    var clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ เอาออก';
    clearBtn.addEventListener('click', function () {
      closeProjectPicker();
      updateTaskField(task, { project: '' });
    });
    optionList.appendChild(clearBtn);
  }

  (state.board.projects || []).forEach(function (name) {
    var btn = document.createElement('button');
    btn.textContent = name;
    var chipColor = colorForProject(name);
    btn.style.background = chipColor.bg;
    btn.style.color = chipColor.fg;
    btn.style.borderColor = 'transparent';
    btn.addEventListener('click', function () {
      closeProjectPicker();
      updateTaskField(task, { project: name });
    });
    optionList.appendChild(btn);
  });
  picker.appendChild(optionList);

  var form = document.createElement('form');
  var input = document.createElement('input');
  input.placeholder = '+ เพิ่ม project ใหม่';
  var submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'เพิ่ม';
  form.appendChild(input);
  form.appendChild(submit);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = input.value.trim();
    if (!name) return;
    closeProjectPicker();
    // เพิ่มชื่อ project ใหม่เข้า master list ในเครื่องทันที + ตั้งให้ task นี้เลย (สอง action นี้เป็น
    // อิสระจากกันฝั่ง backend อยู่แล้ว ไม่ต้องรอ addProject สำเร็จก่อนค่อยตั้ง project ให้ task)
    if (state.board && state.board.projects.indexOf(name) === -1) {
      state.board.projects.push(name);
    }
    updateTaskField(task, { project: name });
    queueOp(newOpKey('addproj'), 'addProject', { workspace: state.workspace, projectName: name });
  });
  picker.appendChild(form);

  var actions = document.createElement('div');
  actions.className = 'picker-actions';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = 'ปิด';
  closeBtn.addEventListener('click', closeProjectPicker);
  actions.appendChild(closeBtn);
  picker.appendChild(actions);

  document.body.appendChild(backdrop);
  document.body.appendChild(picker);
}

function closeProjectPicker() {
  var b = document.getElementById('picker-backdrop');
  var p = document.getElementById('picker-panel');
  if (b) b.remove();
  if (p) p.remove();
}

// ---------- TRUE DREAM — ลิสต์ความฝันส่วนตัว แยกอิสระจาก workspace/task ทั้งหมด ----------
// ไม่ขีดฆ่าตอนติ๊กเสร็จเหมือน task (นี่คือความฝัน ไม่ใช่ภาระ) แต่โชว์วันที่ทำสำเร็จแทน พร้อม toast ฉลอง
var DREAM_MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function formatDreamDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.getDate() + ' ' + DREAM_MONTHS_TH[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

function openDreamsPanel() {
  if (!state.dreamsData) {
    loadDreams();
  } else {
    renderDreamsPanel();
  }
}

function loadDreams() {
  state.dreamsLoading = true;
  renderDreamsPanel();
  apiGet({ action: 'getDreams' })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error || 'โหลด TRUE DREAM ไม่สำเร็จ');
      state.dreamsData = res.data;
    })
    .catch(function (err) { showToast('ผิดพลาด: ' + err.message); })
    .then(function () {
      state.dreamsLoading = false;
      renderDreamsPanel();
    });
}

function dreamRowEl(dream) {
  var row = document.createElement('div');
  row.className = 'dream-row' + (dream.done ? ' done' : '');

  var check = document.createElement('button');
  check.className = 'dream-check';
  check.textContent = dream.done ? '🎉' : '';
  check.setAttribute('aria-label', 'ทำสำเร็จแล้ว/ยังไม่สำเร็จ');
  check.addEventListener('click', function () {
    var nowDone = !dream.done;
    var idx = state.dreamsData.findIndex(function (d) { return d.id === dream.id; });
    if (idx !== -1) {
      state.dreamsData[idx] = Object.assign({}, dream, {
        done: nowDone,
        completedAt: nowDone ? new Date().toISOString() : ''
      });
    }
    renderDreamsPanel();
    if (nowDone) showToast('🎉 ยินดีด้วย! ความฝันข้อนี้เป็นจริงแล้ว');
    // L2P4: ส่ง done ที่คำนวณแล้วตรงๆ (set ไม่ใช่ toggle)
    queueOp(newOpKey('toggledream'), 'toggleDreamDone', { id: dream.id, done: nowDone });
  });
  row.appendChild(check);

  var body = document.createElement('div');
  body.className = 'dream-body';
  var title = document.createElement('div');
  title.className = 'dream-title';
  title.textContent = dream.title;
  body.appendChild(title);
  if (dream.done) {
    var dateEl = document.createElement('div');
    dateEl.className = 'dream-date';
    dateEl.textContent = '🎉 สำเร็จเมื่อ ' + formatDreamDate(dream.completedAt);
    body.appendChild(dateEl);
  }
  row.appendChild(body);

  return row;
}

function renderDreamsPanel() {
  closeDreamsPanel();

  var backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.id = 'dreams-backdrop';
  backdrop.addEventListener('click', closeDreamsPanel);

  var panel = document.createElement('div');
  panel.className = 'dreams-panel';
  panel.id = 'dreams-panel';

  var h3 = document.createElement('h3');
  h3.textContent = '🌟 TRUE DREAM';
  panel.appendChild(h3);

  if (state.dreamsLoading) {
    var loadingHint = document.createElement('p');
    loadingHint.className = 'empty-hint';
    loadingHint.textContent = 'กำลังโหลด...';
    panel.appendChild(loadingHint);
  } else if (state.dreamsData) {
    var list = document.createElement('div');
    list.className = 'dreams-list';
    state.dreamsData.forEach(function (dream) { list.appendChild(dreamRowEl(dream)); });
    panel.appendChild(list);

    var form = document.createElement('form');
    form.className = 'dreams-add-form';
    var input = document.createElement('input');
    input.placeholder = '+ เพิ่มความฝันใหม่…';
    form.appendChild(input);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = input.value.trim();
      if (!title) return;
      input.value = '';
      var tempId = crypto.randomUUID(); // L2P4: UUID จริงแทน tmp_dream_
      state.dreamsData.push({ id: tempId, title: title, done: false, completedAt: '', createdAt: new Date().toISOString() });
      renderDreamsPanel();
      queueOp(newOpKey('adddream'), 'addDream', { title: title, tempId: tempId });
    });
    panel.appendChild(form);
  }

  var closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = 'ปิด';
  closeBtn.addEventListener('click', closeDreamsPanel);
  panel.appendChild(closeBtn);

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
}

function closeDreamsPanel() {
  var b = document.getElementById('dreams-backdrop');
  var p = document.getElementById('dreams-panel');
  if (b) b.remove();
  if (p) p.remove();
}

// ---------- data loading ----------
// เก็บบอร์ดล่าสุดของแต่ละ workspace ไว้ใน localStorage — ใช้โชว์ทันทีตอนเปิดแอป/สลับ workspace
// ระหว่างรอข้อมูลสดจริงจาก network (รู้สึกเร็วขึ้นมาก แม้ network เองจะช้าเท่าเดิมก็ตาม)
function cacheBoard(board) {
  // L2P4: ts2_ prefix กันชนกับ ts_cache_<workspace> ของแอปเดิมที่ origin เดียวกัน
  try { localStorage.setItem(STORAGE_PREFIX + 'cache_' + board.workspace, JSON.stringify(board)); } catch (e) {}
}

function tryRenderFromCache(workspace) {
  try {
    var raw = localStorage.getItem(STORAGE_PREFIX + 'cache_' + workspace); // L2P4: ts2_ prefix
    if (!raw) return;
    state.board = JSON.parse(raw);
    refreshUI();
  } catch (e) {}
}

function loadBoard() {
  setLoading(true, 'กำลังโหลดข้อมูล...');
  return apiGet({ action: 'getBoard', workspace: state.workspace, weekStart: state.weekStart })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error || 'โหลดข้อมูลไม่สำเร็จ');
      // ใช้ merge เดียวกับตอน poll เสมอ (ไม่ใช่แค่ทับ state.board ตรงๆ) กัน task ที่เพิ่ง optimistic
      // เพิ่ม/แก้/ลบไว้แล้วยังอยู่ในคิวไม่ทันส่งเสร็จ หายวับไปตอนโหลดบอร์ดรอบแรกหลังเปิดหน้าใหม่
      mergeServerBoard(res.data);
      lastBoardSignature = boardSignature(res.data); // sync baseline ให้ poll รอบถัดไปเทียบถูกจุด
      cacheBoard(state.board);
      refreshUI();
    })
    .catch(function (err) {
      showToast('ผิดพลาด: ' + err.message);
    })
    .then(function () {
      setLoading(false);
    });
}

// ---------- polling: เช็คข้อมูลใหม่จาก server เป็นระยะ ไม่ต้องรอผู้ใช้กดอะไรเอง ----------
// เทียบลายเซ็น JSON ก่อนเสมอ ไม่ re-render ถ้าไม่มีอะไรเปลี่ยนจริง (กันจอกระพริบ/เปลืองแรงเปล่าๆ)
// และตอน merge ต้อง "ป้องกัน" ไม่ให้ข้อมูลเก่าจาก server ทับสิ่งที่เรากำลังแก้/ลบ/เพิ่มค้างอยู่ในคิว
var POLL_INTERVAL_MS = 60000; // L2P4: เดิม 4500ms — ตอนนี้ Realtime เป็นตัวหลัก อันนี้เหลือไว้เป็น safety net เฉยๆ
var lastBoardSignature = null;

function boardSignature(board) {
  return JSON.stringify(board);
}

function findTaskAnywhereLocal(id) {
  if (!state.board) return null;
  for (var i = 0; i < state.board.days.length; i++) {
    var found = state.board.days[i].tasks.find(function (t) { return t.id === id; });
    if (found) return found;
  }
  return state.board.someday.find(function (t) { return t.id === id; }) || null;
}

function collectDirtyTaskIds() {
  var ids = new Set();
  Object.keys(queueStore).forEach(function (k) { if (k.indexOf('task:') === 0) ids.add(k.slice(5)); });
  Object.keys(inFlightData).forEach(function (k) { if (k.indexOf('task:') === 0) ids.add(k.slice(5)); });
  return ids;
}

function scanOneOffOps(predicate) {
  var out = [];
  function scan(dataObj) { if (dataObj && predicate(dataObj)) out.push(dataObj); }
  Object.keys(queueStore).forEach(function (k) { if (k.indexOf('op:') === 0) scan(queueStore[k].data); });
  Object.keys(inFlightData).forEach(function (k) { if (k.indexOf('op:') === 0) scan(inFlightData[k]); });
  return out;
}

function collectPendingDeleteIds() {
  var ids = new Set();
  scanOneOffOps(function (d) { return d.action === 'deleteTask'; })
    .forEach(function (d) { ids.add(d.params.id); });
  return ids;
}

// task ที่เพิ่งเพิ่มแบบ optimistic แต่ server ยังไม่ยืนยันกลับมา (ยังเป็น temp id อยู่) — ต้องเติมกลับ
// เข้าไปในบอร์ดที่ได้จาก server ทุกครั้งที่ poll ไม่งั้นจะหายวับไปจากจอจนกว่า addTask จะสำเร็จจริง
function collectPendingCreates() {
  var creates = [];
  scanOneOffOps(function (d) { return d.action === 'addTask'; })
    .forEach(function (d) {
      var t = findTaskAnywhereLocal(d.params.tempId);
      if (t) creates.push(t);
    });
  return creates;
}

function mergeServerBoard(serverBoard) {
  var dirtyIds = collectDirtyTaskIds();
  var deleteIds = collectPendingDeleteIds();
  var pendingCreates = collectPendingCreates();
  var prevBoard = state.board;

  function protect(tasks, findLocal) {
    return tasks
      .filter(function (t) { return !deleteIds.has(t.id); })
      .map(function (t) {
        if (!dirtyIds.has(t.id)) return t;
        var local = findLocal(t.id);
        return local || t; // ยังมีการแก้ไขค้างอยู่ในคิวสำหรับ task นี้ ใช้ของเครื่องไปก่อน ไม่ทับด้วยของ server
      });
  }

  serverBoard.days.forEach(function (d) {
    var localDay = prevBoard && prevBoard.days.find(function (ld) { return ld.date === d.date; });
    d.tasks = protect(d.tasks, function (id) {
      return localDay && localDay.tasks.find(function (t) { return t.id === id; });
    });
  });
  serverBoard.someday = protect(serverBoard.someday, function (id) {
    return prevBoard && prevBoard.someday.find(function (t) { return t.id === id; });
  });

  state.board = serverBoard;
  pendingCreates.forEach(function (t) { insertTaskLocal(t); });
}

function pollBoard() {
  if (document.hidden) return; // แท็บไม่ได้เปิดดูอยู่ ไม่ต้อง poll เปลืองเปล่าๆ
  apiGet({ action: 'getBoard', workspace: state.workspace, weekStart: state.weekStart })
    .then(function (res) {
      if (!res.ok) return;
      var sig = boardSignature(res.data);
      if (sig === lastBoardSignature) return; // ไม่มีอะไรเปลี่ยนจาก server เลย ไม่ต้อง re-render
      lastBoardSignature = sig;
      mergeServerBoard(res.data);
      cacheBoard(state.board);
      refreshUI();
    })
    .catch(function () { /* poll เงียบๆ พังไม่ต้องแจ้งเตือนรบกวน ลองใหม่รอบถัดไปเอง */ });
}

// L2P4: กันตั้ง interval ซ้อน — bootApp() อาจถูกเรียกอีกรอบหลังออกจากระบบแล้ว login ใหม่
var pollingTimer = null;
function startPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(pollBoard, POLL_INTERVAL_MS);
}

document.getElementById('dreams-btn').addEventListener('click', openDreamsPanel);

// ---------- events ----------
document.getElementById('workspace-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.workspace = btn.dataset.workspace;
  state.projectFilter = null; // project คนละชุดกันต่อ workspace เลยรีเซ็ต filter ทุกครั้งที่สลับ
  state.historyData = null; // ประวัติเป็นของแต่ละ workspace แยกกัน ต้องโหลดใหม่ตอนสลับ
  state.historyExpanded = false;
  localStorage.setItem(STORAGE_PREFIX + 'workspace', state.workspace); // L2P4: ts2_ prefix
  renderCaptureDayOptions(); // Office เลือกได้แค่ จ-ศ ต้องคำนวณตัวเลือกใหม่ทุกครั้งที่สลับ workspace
  renderCaptureProjectOptions(); // UX1: project เป็นคนละชุดต่อ workspace ต้องรีเซ็ต/พรีเซตค่าล่าสุดใหม่ด้วย
  tryRenderFromCache(state.workspace); // โชว์ของล่าสุดที่เคยเห็นทันที ระหว่างรอข้อมูลสดจริง
  loadBoard();
  renderTabs();
});

document.getElementById('view-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.view = btn.dataset.view;
  localStorage.setItem(STORAGE_PREFIX + 'view', state.view); // L2P4: ts2_ prefix
  renderTabs();
  renderBoard();
});

document.getElementById('week-prev').addEventListener('click', function () {
  state.weekStart = addDaysIso(state.weekStart, -7);
  loadBoard();
});
document.getElementById('week-next').addEventListener('click', function () {
  state.weekStart = addDaysIso(state.weekStart, 7);
  loadBoard();
});
document.getElementById('today-jump').addEventListener('click', function () {
  state.weekStart = mondayOf(todayIso());
  loadBoard();
});

document.getElementById('capture-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = document.getElementById('capture-input');
  var daySelect = document.getElementById('capture-day');
  var projectSelect = document.getElementById('capture-project');
  var rawTitle = input.value.trim();
  if (!rawTitle) return;
  var day = daySelect.value || todayIso();

  // UX1: #token ที่แมตช์ชื่อ project ที่มีอยู่จริงชนะค่าที่เลือกจาก dropdown เสมอ — ถ้าไม่แมตช์อะไรเลย
  // ใช้ค่าจาก dropdown ตามปกติ
  var selectedProject = projectSelect ? projectSelect.value : '';
  var projectNames = (state.board && state.board.projects) || [];
  var parsed = parseProjectHashtag(rawTitle, projectNames);
  var title = parsed.title;
  var project = parsed.project !== null ? parsed.project : selectedProject;
  // พิมพ์แค่ "#kopor" อย่างเดียว ตัด tag ออกแล้วชื่อจะว่าง (DB ไม่รับ title ว่าง) — คงข้อความเดิมไว้แทน
  if (!title) title = rawTitle;

  input.value = '';
  renderCaptureDayOptions(); // รีเซ็ตกลับเป็นวันนี้ให้ครั้งถัดไป ไม่ค้างวันที่เพิ่งเลือก

  // UX1: เก็บค่าที่ "เลือกจาก dropdown" เป็นค่า default ครั้งถัดไปของ workspace นี้เสมอ — ไม่ใช่ค่าที่แมตช์
  // จาก hashtag (คนละความตั้งใจกัน hashtag คือทางลัดเฉพาะงานนี้ครั้งเดียว)
  try { localStorage.setItem(STORAGE_PREFIX + 'last_project_' + state.workspace, selectedProject); } catch (err) {}

  var tempId = crypto.randomUUID(); // L2P4: UUID จริงแทน tmp_<ts>_<rand> — เป็น id จริงถาวร ไม่ต้องสลับทีหลัง
  insertTaskLocal({
    id: tempId, workspace: state.workspace, title: title, project: project, day: day,
    weekStart: (day === 'someday') ? '' : mondayOf(day), done: false,
    createdAt: new Date().toISOString(), completedAt: '', order: 999999, subtasks: []
  });
  refreshUI();
  queueOp(newOpKey('add'), 'addTask', { workspace: state.workspace, title: title, day: day, tempId: tempId, project: project });
});

document.getElementById('someday-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = document.getElementById('someday-input');
  var title = input.value.trim();
  if (!title) return;
  input.value = '';

  var tempId = crypto.randomUUID(); // L2P4: UUID จริงแทน tmp_<ts>_<rand>
  insertTaskLocal({
    id: tempId, workspace: state.workspace, title: title, project: '', day: 'someday',
    weekStart: '', done: false, createdAt: new Date().toISOString(), completedAt: '', order: 0, subtasks: []
  });
  refreshUI();
  queueOp(newOpKey('add'), 'addTask', { workspace: state.workspace, title: title, day: 'someday', tempId: tempId });
});

// ---------- L2P4: login gate + realtime ----------
// booted กันบูตซ้ำ (ข้อ 4c.6 ของแผน — "boots exactly once, guard against double boot") เผื่อ sbGetSession()
// กับ auth state change ยิงมาทับเวลากัน
var booted = false;
var realtimeUnsubscribe = null;
var realtimeDebounceTimer = null;

function showLoginOverlay() {
  var el = document.getElementById('login-overlay');
  if (el) el.hidden = false;
}
function hideLoginOverlay() {
  var el = document.getElementById('login-overlay');
  if (el) el.hidden = true;
}

// L2P4: debounce 400ms ก่อนสั่ง pollBoard() จริง กัน event ถี่ๆ จาก Realtime (เช่นลาก reorder หลายแถวรวด)
// ยิง pollBoard() รัวเกินจำเป็น — pollBoard เองก็เทียบ signature อีกชั้นก่อน re-render อยู่แล้ว
function debouncedPollBoard() {
  clearTimeout(realtimeDebounceTimer);
  realtimeDebounceTimer = setTimeout(pollBoard, 400);
}

function bootApp() {
  if (booted) return;
  booted = true;
  renderCaptureDayOptions();
  loadQueueFromStorage(); // งานที่ยังไม่ได้ส่งจากรอบก่อน (ปิดหน้าไปตอนกำลังส่งอยู่) ค้างไว้ใน localStorage
  tryRenderFromCache(state.workspace); // โชว์ของล่าสุดที่เคยเห็นทันที ระหว่างรอข้อมูลสดจริง
  loadBoard().then(function () {
    // L2P4: subscribe Realtime หลัง boot สำเร็จรอบแรก แทนที่การ poll ถี่ทุก 4.5 วิแบบเดิม
    if (!realtimeUnsubscribe) realtimeUnsubscribe = sbSubscribeChanges(debouncedPollBoard);
  });
  flushAll(); // ส่งของที่ค้างจากรอบก่อนต่อทันที
  startPolling(); // ยังคง poll ทุก 60 วิเป็น safety net เผื่อ Realtime หลุด/พลาด event
}

// L2P4: ฟอร์ม login — ต้องมีปุ่ม submit จริง (ไม่งั้น Enter/Go บนมือถือกดไม่ทำงานเมื่อฟอร์มมีมากกว่า 1 ช่อง)
var loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('login-email').value.trim();
    var password = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');
    var btn = document.getElementById('login-submit');
    errEl.textContent = '';
    btn.disabled = true;
    sbSignIn(email, password)
      .then(function (res) {
        btn.disabled = false;
        if (res.error) {
          // AuthRetryableFetchError (หรือไม่มี status เลย) = เน็ตหลุด/ต่อ Supabase ไม่ได้จริงๆ
          // ส่วน error อื่น (เช่น 400 invalid_credentials) = อีเมล/รหัสผ่านผิด
          if (res.error.name === 'AuthRetryableFetchError' || !res.error.status) {
            errEl.textContent = 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง';
          } else {
            errEl.textContent = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
          }
          return;
        }
        hideLoginOverlay();
        bootApp();
      })
      .catch(function () {
        btn.disabled = false;
        errEl.textContent = 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง';
      });
  });
}

// L2P4: ปุ่มออกจากระบบ
var logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', function () {
    if (!confirm('ออกจากระบบ?')) return;
    sbSignOut();
  });
}

// L2P4: SIGNED_OUT (ออกเองหรือ session หมดอายุ) -> โชว์ overlay ทับ (บอร์ดที่ cache ไว้จะยังเห็นลางๆ ข้างหลังได้)
sbOnAuthChange(function (event) {
  if (event === 'SIGNED_OUT') {
    booted = false;
    if (realtimeUnsubscribe) { realtimeUnsubscribe(); realtimeUnsubscribe = null; }
    showLoginOverlay();
  }
});

// ---------- init ----------
applyMonthTheme();
renderTabs();

// L2P4: badge บอกว่าเป็นเวอร์ชันทดสอบ (แสดงเฉพาะตอนรันใต้ /next/ — ดู config.js:IS_TEST_BUILD)
if (IS_TEST_BUILD) {
  var testBadge = document.getElementById('test-badge');
  if (testBadge) testBadge.hidden = false;
}

// L2P4: ต้อง login ก่อนเสมอถึงจะ boot บอร์ดได้ — เช็ค session ที่มีอยู่แล้ว (persistSession ใน supabase-api.js)
// ก่อน ถ้ามีอยู่แล้วบูตทันทีไม่ต้องให้ผู้ใช้ล็อกอินซ้ำทุกครั้งที่เปิดแอป
sbGetSession().then(function (session) {
  if (session) {
    hideLoginOverlay();
    bootApp();
  } else {
    showLoginOverlay();
  }
});

// L2P4: รีเฟรชบอร์ดตอนกลับมาเปิดแท็บ (visible) และตอนเน็ตกลับมา — เสริม Realtime/poll safety net
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && booted) pollBoard();
});
window.addEventListener('online', function () { if (booted) pollBoard(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').catch(function () {});
  });
}
