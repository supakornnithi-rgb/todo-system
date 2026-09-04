/**
 * ประตูเข้า Web App — doGet รับคำขออ่านข้อมูล, doPost รับคำสั่งแก้ข้อมูล
 * ทั้งคู่คืนค่าเป็น JSON เสมอ รูปแบบ {ok: true, ...} หรือ {ok: false, error: "..."}
 */

function doGet(e) {
  try {
    var action = e.parameter.action;
    if (action === 'getBoard') {
      var data = getBoard_(e.parameter.workspace, e.parameter.weekStart);
      return jsonResponse_({ ok: true, data: data });
    }
    if (action === 'getProjectHistory') {
      var history = getProjectHistory_(e.parameter.workspace);
      return jsonResponse_({ ok: true, data: history });
    }
    if (action === 'getDreams') {
      return jsonResponse_({ ok: true, data: getDreams_() });
    }
    throw new Error('ไม่รู้จัก action: ' + action);
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

/**
 * ทุกการเขียนล็อกด้วย LockService กันสอง request ชนกันแก้แถวเดียวกันพร้อมกัน (frontend ส่งมาจาก
 * คิว retry/merge ก็อาจมีมากกว่า 1 คำขอค้างอยู่ในเวลาใกล้กันได้) และเช็ค opId ผ่าน CacheService ก่อน
 * เสมอ — ถ้าเคยประมวลผล opId นี้ไปแล้ว (client อาจ retry เพราะ response หลุดหายทั้งที่ backend
 * เขียนสำเร็จไปแล้วจริง) จะคืนผลลัพธ์เดิมที่ cache ไว้ ไม่ทำซ้ำ กัน addTask/addSubtask ซ้ำซ้อน
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  var response;
  try {
    lock.waitLock(10000);
    var body = JSON.parse(e.postData.contents);
    var opId = body.opId;
    var cache = CacheService.getScriptCache();

    if (opId) {
      var cached = cache.get('op_' + opId);
      if (cached) {
        return jsonResponse_(JSON.parse(cached));
      }
    }

    var result = dispatchAction_(body);
    response = { ok: true, result: result };
    if (opId) cache.put('op_' + opId, JSON.stringify(response), 21600); // 6 ชม. (สูงสุดที่ CacheService รองรับ)
  } catch (err) {
    response = { ok: false, error: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* ไม่ได้ล็อกไว้ตั้งแต่แรกก็ไม่เป็นไร */ }
  }
  return jsonResponse_(response);
}

function dispatchAction_(body) {
  switch (body.action) {
    case 'addTask': return addTask_(body);
    case 'toggleDone': return toggleDone_(body.id);
    case 'setDay': return setDay_(body.id, body.day);
    case 'setTaskOrder': return setTaskOrder_(body.id, body.position);
    case 'deleteTask': return deleteTask_(body.id);
    case 'setTitle': return setTitle_(body.id, body.title);
    case 'setProject': return setProject_(body.id, body.project);
    case 'updateTask': return updateTask_(body.id, body.fields);
    case 'addProject': return addProject_(body.workspace, body.projectName);
    case 'addSubtask': return addSubtask_(body.taskId, body.title);
    case 'toggleSubtaskDone': return toggleSubtaskDone_(body.id);
    case 'addDream': return addDream_(body.title);
    case 'toggleDreamDone': return toggleDreamDone_(body.id);
    default: throw new Error('ไม่รู้จัก action: ' + body.action);
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
