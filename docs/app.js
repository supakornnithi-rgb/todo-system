// ตั้งค่า URL ของ Apps Script Web App ตรงนี้จุดเดียว — ไม่ใช่ความลับ (เห็นได้จาก network tab อยู่แล้ว
// เพราะเป็นเว็บ static ล้วนๆ ไม่มี backend server มาซ่อนให้) แค่รวมไว้ที่เดียวให้แก้ง่ายเวลา deploy ใหม่
const API_URL = 'https://script.google.com/macros/s/AKfycbx5hw8L7HkglAbqxWlSWWkJ6tAF8tXMKD5CrVt-iw6RXqDlYXZSlDmvsKmIbWJIeEz3/exec';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

// ยิง request เปล่าๆ ไว้ "อุ่นเครื่อง" การเชื่อมต่อตอนเปิดแอปครั้งแรก ไม่สนใจผลลัพธ์
function warmUpApi() {
  return fetch(API_URL).catch(function () {});
}

// ---------- state ----------
var state = {
  workspace: localStorage.getItem('ts_workspace') || 'Personal',
  view: localStorage.getItem('ts_view') || 'today',
  weekStart: mondayOf(todayIso()),
  board: null
};

// ---------- theme ----------
function applyMonthTheme() {
  var humanMonth = new Date().getMonth() + 1;
  document.documentElement.dataset.monthParity = (humanMonth % 2 === 0) ? 'even' : 'odd';
}

// ทุก action ที่แก้ข้อมูล (POST) เรียกผ่านตัวนี้ให้หมด — เช็ค res.ok ให้อัตโนมัติ,
// โชว์ toast แจ้ง error ถ้าพัง, และ reload บอร์ดใหม่ให้ถ้าสำเร็จ
function mutate(promise, successToast) {
  return promise.then(function (res) {
    if (!res.ok) { showToast('ผิดพลาด: ' + (res.error || 'ไม่ทราบสาเหตุ')); return; }
    if (successToast) showToast(successToast);
  }).catch(function (err) {
    // การเชื่อมต่อพังไม่ได้แปลว่างานไม่ถูกบันทึก (Apps Script อาจเขียนสำเร็จไปแล้วแค่ตอบกลับไม่ถึง)
    // เลย reload บอร์ดเสมอไม่ว่าจะสำเร็จหรือพัง เพื่อให้เห็นสถานะจริงบนชีตเสมอ ไม่ค้างข้อมูลเก่า
    showToast(err.message);
  }).then(function () {
    loadBoard();
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

function taskCardEl(task, opts) {
  var card = document.createElement('div');
  card.className = 'task-card' + (task.done ? ' done' : '');

  var check = document.createElement('button');
  check.className = 'task-check';
  check.textContent = task.done ? '✓' : '';
  check.setAttribute('aria-label', 'เสร็จ/ยังไม่เสร็จ');
  check.addEventListener('click', function () {
    mutate(apiPost('toggleDone', { id: task.id }));
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
  chip.addEventListener('click', function () { openProjectPicker(task); });
  body.appendChild(chip);

  var actions = document.createElement('div');
  actions.className = 'task-actions';

  if (opts && opts.somedayItem) {
    var toToday = document.createElement('button');
    toToday.textContent = '↥';
    toToday.title = 'ย้ายขึ้นวันนี้';
    toToday.addEventListener('click', function () {
      mutate(apiPost('setDay', { id: task.id, day: todayIso() }), 'ย้ายขึ้นวันนี้แล้ว');
    });
    actions.appendChild(toToday);
  } else {
    var prev = document.createElement('button');
    prev.textContent = '←';
    prev.title = 'เลื่อนไปวันก่อนหน้า';
    prev.addEventListener('click', function () {
      mutate(apiPost('setDay', { id: task.id, day: addDaysIso(task.day, -1) }));
    });
    var next = document.createElement('button');
    next.textContent = '→';
    next.title = 'เลื่อนไปวันถัดไป';
    next.addEventListener('click', function () {
      mutate(apiPost('setDay', { id: task.id, day: addDaysIso(task.day, 1) }));
    });
    var toSomeday = document.createElement('button');
    toSomeday.textContent = '↧';
    toSomeday.title = 'ย้ายไป Someday';
    toSomeday.addEventListener('click', function () {
      mutate(apiPost('setDay', { id: task.id, day: 'someday' }), 'ย้ายไป Someday แล้ว');
    });
    actions.appendChild(prev);
    actions.appendChild(next);
    actions.appendChild(toSomeday);
  }

  card.appendChild(check);
  card.appendChild(body);
  card.appendChild(actions);
  return card;
}

function daySectionEl(day, isToday) {
  var section = document.createElement('div');
  section.className = 'day-section';

  var heading = document.createElement('p');
  heading.className = 'day-heading' + (isToday ? ' is-today' : '');
  if (isToday) {
    var dot = document.createElement('span');
    dot.className = 'dot';
    heading.appendChild(dot);
  }
  heading.appendChild(document.createTextNode(formatDayHeading(day.date)));
  section.appendChild(heading);

  var list = document.createElement('div');
  list.className = 'task-list';
  if (day.tasks.length === 0) {
    var hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'ยังไม่มีงาน';
    list.appendChild(hint);
  } else {
    day.tasks.forEach(function (t) { list.appendChild(taskCardEl(t)); });
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
      boardEl.appendChild(daySectionEl(todayDay, true));
    }
  } else {
    var grid = document.createElement('div');
    grid.className = 'week-grid';
    state.board.days.forEach(function (d) {
      grid.appendChild(daySectionEl(d, d.date === state.board.today));
    });
    boardEl.appendChild(grid);
  }
}

function renderSomeday() {
  var listEl = document.getElementById('someday-list');
  listEl.innerHTML = '';
  if (!state.board || state.board.someday.length === 0) {
    var hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'ยังไม่มีงานใน Someday';
    listEl.appendChild(hint);
    return;
  }
  state.board.someday.forEach(function (t) {
    listEl.appendChild(taskCardEl(t, { somedayItem: true }));
  });
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
      mutate(apiPost('setProject', { id: task.id, project: '' }));
    });
    optionList.appendChild(clearBtn);
  }

  (state.board.projects || []).forEach(function (name) {
    var btn = document.createElement('button');
    btn.textContent = name;
    btn.addEventListener('click', function () {
      closeProjectPicker();
      mutate(apiPost('setProject', { id: task.id, project: name }));
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
function loadBoard() {
  apiGet({ action: 'getBoard', workspace: state.workspace, weekStart: state.weekStart })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.board = res.data;
      renderTabs();
      renderBoard();
      renderSomeday();
    })
    .catch(function (err) {
      showToast('ผิดพลาด: ' + err.message);
    });
}

// ---------- events ----------
document.getElementById('workspace-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  state.workspace = btn.dataset.workspace;
  localStorage.setItem('ts_workspace', state.workspace);
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
  var title = input.value.trim();
  if (!title) return;
  input.value = '';
  mutate(apiPost('addTask', { workspace: state.workspace, title: title }));
});

document.getElementById('someday-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = document.getElementById('someday-input');
  var title = input.value.trim();
  if (!title) return;
  input.value = '';
  mutate(apiPost('addTask', { workspace: state.workspace, title: title, day: 'someday' }));
});

// ---------- init ----------
applyMonthTheme();
renderTabs();
warmUpApi().then(loadBoard);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').catch(function () {});
  });
}
