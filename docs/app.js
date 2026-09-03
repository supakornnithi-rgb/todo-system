// ตั้งค่า URL ของ Apps Script Web App ตรงนี้จุดเดียว — ไม่ใช่ความลับ (เห็นได้จาก network tab อยู่แล้ว
// เพราะเป็นเว็บ static ล้วนๆ ไม่มี backend server มาซ่อนให้) แค่รวมไว้ที่เดียวให้แก้ง่ายเวลา deploy ใหม่
const API_URL = 'https://script.google.com/macros/s/AKfycbx5hw8L7HkglAbqxWlSWWkJ6tAF8tXMKD5CrVt-iw6RXqDlYXZSlDmvsKmIbWJIeEz3/exec';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  var startStr = start.getDate() + ' ' + MONTH_NAMES[start.getMonth()];
  var endStr = end.getDate() + ' ' + MONTH_NAMES[end.getMonth()];
  return startStr + ' – ' + endStr;
}

// ---------- API ----------
// หมายเหตุ: บางครั้ง (มักเป็นตอนเปิดแอปครั้งแรกในเบราว์เซอร์ session ใหม่) Google จะตอบหน้า HTML
// เช็คความปลอดภัยกลับมาแทน JSON ในการยิง request ครั้งแรกสุด แล้วครั้งถัดไปจะปกติทันที — เป็นพฤติกรรม
// ที่รู้กันของ Apps Script Web App ไม่ใช่ error จริง จึง parse แบบปลอดภัย (ไม่ throw จาก .json() ตรงๆ)
// แล้วให้ apiGet retry เองอัตโนมัติได้ (อ่านอย่างเดียว ปลอดภัย) ส่วน apiPost ไม่ retry เอง
// (กันเขียนซ้ำซ้อน) แต่แจ้ง error ชัดเจนให้ผู้ใช้กดใหม่เอง
function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function apiGet(params, retriesLeft) {
  if (retriesLeft === undefined) retriesLeft = 2;
  var qs = new URLSearchParams(params).toString();
  return fetch(API_URL + '?' + qs)
    .then(function (r) { return r.text(); })
    .then(function (text) {
      var json = safeParseJson(text);
      if (json) return json;
      if (retriesLeft > 0) {
        return new Promise(function (resolve) { setTimeout(resolve, 500); })
          .then(function () { return apiGet(params, retriesLeft - 1); });
      }
      throw new Error('เชื่อมต่อ Apps Script ไม่สำเร็จ ลองรีเฟรชหน้าใหม่อีกครั้ง');
    });
}

function apiPost(action, payload) {
  var body = Object.assign({ action: action }, payload);
  // ใช้ text/plain แทน application/json เพื่อเลี่ยง CORS preflight (Apps Script Web App ตอบ OPTIONS ไม่ได้)
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.text(); })
    .then(function (text) {
      var json = safeParseJson(text);
      if (json) return json;
      throw new Error('เชื่อมต่อไม่สำเร็จ ลองกดใหม่อีกครั้ง');
    });
}


// ---------- state ----------
var state = {
  workspace: localStorage.getItem('ts_workspace') || 'Personal',
  view: localStorage.getItem('ts_view') || 'today',
  weekStart: mondayOf(todayIso()),
  board: null,
  projectFilter: null,
  expandedTasks: new Set(), // เก็บ id ของ task ที่กางดู subtask อยู่ (UI state ล้วนๆ ไม่ผูกกับ network)
  workloadExpanded: false
};

// คืนเฉพาะงานที่ตรงกับ project filter ที่เลือกอยู่ (คืนทั้งหมดถ้าไม่ได้เลือก filter)
function filterTasks(tasks) {
  if (!state.projectFilter) return tasks;
  return tasks.filter(function (t) { return t.project === state.projectFilter; });
}

// ---------- แก้ state.board ในเครื่องโดยตรงจากผลลัพธ์ POST เพื่อไม่ต้อง loadBoard() ซ้ำ (เร็วขึ้นเท่าตัว) ----------
function byCreatedAt(a, b) { return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0); }

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
  if (!state.board) return;
  if (task.day === 'someday') {
    state.board.someday.push(task);
    state.board.someday.sort(byCreatedAt);
  } else {
    var day = state.board.days.find(function (d) { return d.date === task.day; });
    if (day) {
      day.tasks.push(task);
      day.tasks.sort(byCreatedAt);
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
// และหลัง mutate() แก้ state.board ในเครื่องตรงๆ (optimistic update) โดยไม่ต้องยิง network ซ้ำ
function refreshUI() {
  renderTabs();
  renderProjectFilter();
  renderOverdueBanner();
  renderWorkloadOverview();
  renderBoard();
  renderSomeday();
}

/**
 * ทุก action ที่แก้ข้อมูล (POST) เรียกผ่านตัวนี้ให้หมด
 * ถ้าสำเร็จและมี opts.apply (แก้ state.board ในเครื่องได้เอง เช่น toggleDone) จะอัปเดตหน้าจอจาก
 * ผลลัพธ์ที่ได้กลับมาทันที ไม่ยิง network ซ้ำรอบสอง — เร็วขึ้นประมาณครึ่งหนึ่งเทียบของเดิมที่ reload ทุกครั้ง
 * ถ้าไม่มี opts.apply (เช่น compound action) หรือเกิด error/เชื่อมต่อพัง จะ loadBoard() ใหม่เสมอ
 * เพื่อให้เห็นสถานะจริงบนชีต (เชื่อมต่อพังไม่ได้แปลว่างานไม่ถูกบันทึกจริง — Apps Script อาจเขียนสำเร็จ
 * ไปแล้วแค่ตอบกลับมาไม่ถึง)
 */
function mutate(promise, opts) {
  opts = opts || {};
  setLoading(true, opts.loadingLabel || 'กำลังบันทึก...');
  return promise.then(function (res) {
    if (!res.ok) {
      showToast('ผิดพลาด: ' + (res.error || 'ไม่ทราบสาเหตุ'));
      return loadBoard();
    }
    if (opts.successToast) showToast(opts.successToast);
    if (opts.apply) {
      opts.apply(res.result);
      refreshUI();
    } else {
      return loadBoard();
    }
  }).catch(function (err) {
    showToast(err.message);
    return loadBoard();
  }).then(function () {
    setLoading(false);
  });
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
  document.getElementById('week-nav').hidden = !isWeek;
  var isCurrentWeek = state.weekStart === mondayOf(todayIso());
  document.getElementById('today-jump').hidden = !(isWeek && !isCurrentWeek);
  if (isWeek) {
    document.getElementById('week-range').textContent = formatWeekRange(state.weekStart);
  }
}

function applyTask(task) { upsertTaskLocal(task); }

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
      mutate(apiPost('toggleSubtaskDone', { id: s.id }), {
        apply: function (result) { applyTask(result.task); }
      });
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
    mutate(apiPost('addSubtask', { taskId: task.id, title: subTitle }), {
      apply: function (result) { applyTask(result.task); }
    });
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
  card.style.touchAction = 'none';

  card.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button, input, form')) return; // ปล่อยให้ปุ่ม/ช่องกรอกทำงานปกติ
    if (e.button !== undefined && e.button !== 0) return; // เมาส์ใช้ได้แค่คลิกซ้าย

    var startX = e.clientX, startY = e.clientY;
    var timer = setTimeout(function () {
      card.removeEventListener('pointermove', cancelIfMoved);
      card.removeEventListener('pointerup', cancelTimer);
      startDrag(card, task, startX, startY);
    }, DRAG_HOLD_MS);

    function cancelIfMoved(ev) {
      if (Math.abs(ev.clientX - startX) > DRAG_MOVE_CANCEL_PX || Math.abs(ev.clientY - startY) > DRAG_MOVE_CANCEL_PX) {
        clearTimeout(timer);
        card.removeEventListener('pointermove', cancelIfMoved);
      }
    }
    function cancelTimer() {
      clearTimeout(timer);
      card.removeEventListener('pointermove', cancelIfMoved);
      card.removeEventListener('pointerup', cancelTimer);
    }
    card.addEventListener('pointermove', cancelIfMoved);
    card.addEventListener('pointerup', cancelTimer, { once: true });
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
    mutate(apiPost('setDay', { id: task.id, day: targetDate }), { apply: applyTask });
  }
}

function taskCardEl(task, opts) {
  var card = document.createElement('div');
  card.className = 'task-card' + (task.done ? ' done' : '');

  var check = document.createElement('button');
  check.className = 'task-check';
  check.textContent = task.done ? '✓' : '';
  check.setAttribute('aria-label', 'เสร็จ/ยังไม่เสร็จ');
  check.addEventListener('click', function () {
    mutate(apiPost('toggleDone', { id: task.id }), { apply: applyTask });
  });

  var body = document.createElement('div');
  body.className = 'task-body';

  var title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
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
      mutate(apiPost('setDay', { id: task.id, day: todayIso() }), { successToast: 'ย้ายขึ้นวันนี้แล้ว', apply: applyTask });
    });
    actions.appendChild(toToday);
  } else {
    var prev = document.createElement('button');
    prev.textContent = '←';
    prev.title = 'เลื่อนไปวันก่อนหน้า';
    prev.addEventListener('click', function () {
      mutate(apiPost('setDay', { id: task.id, day: addDaysIso(task.day, -1) }), { apply: applyTask });
    });
    var next = document.createElement('button');
    next.textContent = '→';
    next.title = 'เลื่อนไปวันถัดไป';
    next.addEventListener('click', function () {
      mutate(apiPost('setDay', { id: task.id, day: addDaysIso(task.day, 1) }), { apply: applyTask });
    });
    var toSomeday = document.createElement('button');
    toSomeday.textContent = '↧';
    toSomeday.title = 'ย้ายไป Someday';
    toSomeday.addEventListener('click', function () {
      mutate(apiPost('setDay', { id: task.id, day: 'someday' }), { successToast: 'ย้ายไป Someday แล้ว', apply: applyTask });
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
    mutate(apiPost('deleteTask', { id: task.id }), { apply: function () { removeTaskLocal(task.id); } });
  });
  actions.appendChild(del);

  card.appendChild(check);
  card.appendChild(body);
  card.appendChild(actions);

  // ลากย้ายวันได้เฉพาะมุมมอง Week และเฉพาะงานที่ผูกกับวัน (ไม่ใช่ someday — ใช้ปุ่ม ↥ แทน)
  if (state.view === 'week' && !(opts && opts.somedayItem)) {
    attachDragHandlers(card, task);
  }

  return card;
}

function daySectionEl(date, tasks, isToday) {
  var section = document.createElement('div');
  section.className = 'day-section';
  section.dataset.date = date;

  var heading = document.createElement('p');
  heading.className = 'day-heading' + (isToday ? ' is-today' : '');
  if (isToday) {
    var dot = document.createElement('span');
    dot.className = 'dot';
    heading.appendChild(dot);
  }
  heading.appendChild(document.createTextNode(formatDayHeading(date)));
  section.appendChild(heading);

  var list = document.createElement('div');
  list.className = 'task-list';
  if (tasks.length === 0) {
    var hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'ยังไม่มีงาน';
    list.appendChild(hint);
  } else {
    tasks.forEach(function (t) { list.appendChild(taskCardEl(t)); });
  }
  section.appendChild(list);
  return section;
}

function renderBoard() {
  var boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  if (!state.board) return;

  if (state.view === 'today') {
    var todayDay = state.board.days.find(function (d) { return d.date === state.board.today; });
    if (todayDay) {
      boardEl.appendChild(daySectionEl(todayDay.date, filterTasks(todayDay.tasks), true));
    }
  } else {
    var grid = document.createElement('div');
    grid.className = 'week-grid';
    state.board.days.forEach(function (d) {
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
      renderBoard();
      renderSomeday();
    });
    el.appendChild(btn);
  });
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
  for (var i = 0; i < 7; i++) {
    var date = addDaysIso(monday, i);
    var opt = document.createElement('option');
    opt.value = date;
    opt.textContent = (date === today ? 'วันนี้' : formatDayHeading(date));
    select.appendChild(opt);
  }
  select.value = today;
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
      mutate(apiPost('setProject', { id: task.id, project: '' }), { apply: applyTask });
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
      mutate(apiPost('setProject', { id: task.id, project: name }), { apply: applyTask });
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
    mutate(
      apiPost('addProject', { workspace: state.workspace, projectName: name })
        .then(function (res) {
          if (!res.ok) return res;
          return apiPost('setProject', { id: task.id, project: name });
        })
    );
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

// ---------- data loading ----------
// เก็บบอร์ดล่าสุดของแต่ละ workspace ไว้ใน localStorage — ใช้โชว์ทันทีตอนเปิดแอป/สลับ workspace
// ระหว่างรอข้อมูลสดจริงจาก network (รู้สึกเร็วขึ้นมาก แม้ network เองจะช้าเท่าเดิมก็ตาม)
function cacheBoard(board) {
  try { localStorage.setItem('ts_cache_' + board.workspace, JSON.stringify(board)); } catch (e) {}
}

function tryRenderFromCache(workspace) {
  try {
    var raw = localStorage.getItem('ts_cache_' + workspace);
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
      state.board = res.data;
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

// ---------- events ----------
document.getElementById('workspace-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.workspace = btn.dataset.workspace;
  state.projectFilter = null; // project คนละชุดกันต่อ workspace เลยรีเซ็ต filter ทุกครั้งที่สลับ
  localStorage.setItem('ts_workspace', state.workspace);
  tryRenderFromCache(state.workspace); // โชว์ของล่าสุดที่เคยเห็นทันที ระหว่างรอข้อมูลสดจริง
  loadBoard();
  renderTabs();
});

document.getElementById('view-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.view = btn.dataset.view;
  localStorage.setItem('ts_view', state.view);
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
  var title = input.value.trim();
  if (!title) return;
  var day = daySelect.value || todayIso();
  input.value = '';
  renderCaptureDayOptions(); // รีเซ็ตกลับเป็นวันนี้ให้ครั้งถัดไป ไม่ค้างวันที่เพิ่งเลือก
  mutate(apiPost('addTask', { workspace: state.workspace, title: title, day: day }), { apply: insertTaskLocal });
});

document.getElementById('someday-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = document.getElementById('someday-input');
  var title = input.value.trim();
  if (!title) return;
  input.value = '';
  mutate(apiPost('addTask', { workspace: state.workspace, title: title, day: 'someday' }), { apply: insertTaskLocal });
});

// ---------- init ----------
applyMonthTheme();
renderTabs();
renderCaptureDayOptions();
tryRenderFromCache(state.workspace); // โชว์ของล่าสุดที่เคยเห็นทันที ระหว่างรอข้อมูลสดจริง
loadBoard(); // apiGet มี retry ในตัวอยู่แล้วเผื่อเจอ interstitial ตอนเปิดแอปครั้งแรก ไม่ต้องยิง warm-up แยกอีกรอบ

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').catch(function () {});
  });
}
