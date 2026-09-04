/**
 * TRUE DREAM — ลิสต์ความฝันส่วนตัว แยกอิสระจาก Tasks/Projects/workspace ใดๆ ทั้งสิ้น
 * ติ๊กแล้วไม่ขีดฆ่าเหมือน task ทั่วไป (เพราะเป็นความฝัน ไม่ใช่ภาระ) แต่โชว์วันที่ทำสำเร็จแทน
 */
var DREAMS_SHEET = 'Dreams';

function cleanDream_(d) {
  return {
    id: d.id,
    title: d.title,
    done: d.done === true || d.done === 'TRUE',
    completedAt: d.completedAt || '',
    createdAt: d.createdAt
  };
}

function normalizeDreamRow_(d) {
  if (d.completedAt instanceof Date) d.completedAt = d.completedAt.toISOString();
  if (d.createdAt instanceof Date) d.createdAt = d.createdAt.toISOString();
  return d;
}

function getDreams_() {
  return readRows_(DREAMS_SHEET).map(normalizeDreamRow_).map(cleanDream_);
}

function addDream_(title) {
  if (!title) throw new Error('ต้องระบุ title');
  var dream = {
    id: 'dream_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000),
    title: title,
    done: false,
    completedAt: '',
    createdAt: new Date().toISOString()
  };
  appendRow_(DREAMS_SHEET, dream);
  return cleanDream_(dream);
}

function findDreamRow_(id) {
  var rows = readRows_(DREAMS_SHEET);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return normalizeDreamRow_(rows[i]);
  }
  throw new Error('ไม่พบความฝัน id: ' + id);
}

function toggleDreamDone_(id) {
  var d = findDreamRow_(id);
  var nowDone = !(d.done === true || d.done === 'TRUE');
  var completedAt = nowDone ? new Date().toISOString() : '';
  updateRowFields_(DREAMS_SHEET, d.__row, { done: nowDone, completedAt: completedAt });
  d.done = nowDone;
  d.completedAt = completedAt;
  return cleanDream_(d);
}
