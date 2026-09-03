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
    throw new Error('ไม่รู้จัก action: ' + action);
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var result;
    switch (body.action) {
      case 'addTask':
        result = addTask_(body);
        break;
      case 'toggleDone':
        result = toggleDone_(body.id);
        break;
      case 'setDay':
        result = setDay_(body.id, body.day);
        break;
      case 'deleteTask':
        result = deleteTask_(body.id);
        break;
      case 'setTitle':
        result = setTitle_(body.id, body.title);
        break;
      case 'setProject':
        result = setProject_(body.id, body.project);
        break;
      case 'addProject':
        result = addProject_(body.workspace, body.projectName);
        break;
      case 'addSubtask':
        result = addSubtask_(body.taskId, body.title);
        break;
      case 'toggleSubtaskDone':
        result = toggleSubtaskDone_(body.id);
        break;
      default:
        throw new Error('ไม่รู้จัก action: ' + body.action);
    }
    return jsonResponse_({ ok: true, result: result });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
