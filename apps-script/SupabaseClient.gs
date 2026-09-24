/**
 * ตัวเชื่อมต่อ Supabase (PostgREST) แบบ reusable — ใช้ได้ทั้งงานย้ายข้อมูล (phase นี้) และ
 * งานเขียน/อ่านจริงในเฟสถัดไปที่แอพเปลี่ยนไปใช้ Supabase แทน Google Sheets
 * ค่า config (URL / secret key / owner uuid) เก็บผ่าน Script Properties เท่านั้น ห้าม hardcode
 * ยืนยันตัวตนด้วย secret key (service role) ผ่าน header "apikey" อย่างเดียว — ห้ามส่ง Authorization
 * เพราะ secret key ตัวนี้ bypass RLS อยู่แล้ว ส่ง Authorization ซ้ำจะทำให้ PostgREST งงว่าจะยึด role ไหน
 */

var SUPABASE_UUID_REGEX_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSupabaseUrl_() {
  var v = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  if (!v) {
    throw new Error('ยังไม่ได้ตั้งค่า Script Property "SUPABASE_URL" — ไปที่ Project Settings > Script Properties');
  }
  return v.replace(/\/+$/, '');
}

// ห้าม log ค่านี้เด็ดขาด (ดู testSupabaseConnection ใน SupabaseMigrate.gs ที่ mask ค่าก่อน log)
function getSupabaseSecretKey_() {
  var v = PropertiesService.getScriptProperties().getProperty('SUPABASE_SECRET_KEY');
  if (!v) {
    throw new Error('ยังไม่ได้ตั้งค่า Script Property "SUPABASE_SECRET_KEY" — ไปที่ Project Settings > Script Properties');
  }
  return v;
}

function getSupabaseOwnerId_() {
  var v = PropertiesService.getScriptProperties().getProperty('SUPABASE_OWNER_ID');
  if (!v) {
    throw new Error('ยังไม่ได้ตั้งค่า Script Property "SUPABASE_OWNER_ID" — ไปที่ Project Settings > Script Properties');
  }
  if (!SUPABASE_UUID_REGEX_.test(v)) {
    throw new Error('Script Property "SUPABASE_OWNER_ID" ไม่ใช่ uuid ที่ถูกต้อง (ได้รับ: ' + v + ')');
  }
  return v;
}

/**
 * ยิง request ไป PostgREST หนึ่งครั้ง — path ต้องขึ้นต้นด้วย "/rest/v1/..."
 * ใช้ muteHttpExceptions เสมอ เพื่อให้เราจัดการ error เป็นข้อความไทยเองแทนที่จะโยน HTTP error ดิบๆ
 * คืนค่าเป็น {code, text, headers} เสมอเมื่อสำเร็จ (code < 300) — ถ้า code >= 300 จะ throw ให้เลย
 */
function supabaseRequest_(method, path, body, extraHeaders) {
  var headers = { apikey: getSupabaseSecretKey_() };
  var options = {
    method: method,
    headers: headers,
    muteHttpExceptions: true
  };
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.payload = JSON.stringify(body);
  }
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
  }
  options.headers = headers;

  var url = getSupabaseUrl_() + path;
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code >= 300) {
    // ข้อความ error ต้องไม่มี key หลุดไป — path ไม่เคยมี key อยู่แล้ว (key อยู่ใน header เท่านั้น)
    throw new Error('Supabase ' + method + ' ' + path + ' → ' + code + ': ' + text.slice(0, 500));
  }

  return { code: code, text: text, headers: res.getAllHeaders() };
}

/**
 * นับจำนวนแถวในตาราง โดยไม่ต้องดึงข้อมูลจริงมาทั้งหมด (select=id&limit=1 + Prefer: count=exact)
 * ตัวเลขจริงอยู่ใน header "Content-Range" รูปแบบ "0-0/57" หรือไม่มีแถวเลยจะเป็น "ดอกจัน/0" (เครื่องหมาย * ตามด้วย /0)
 * ชื่อ header ตัวพิมพ์เล็ก/ใหญ่ไม่แน่นอนขึ้นกับ runtime เลยต้องเทียบแบบ case-insensitive
 */
function supabaseCount_(table, filterQuery) {
  var path = '/rest/v1/' + table + '?select=id&limit=1' + (filterQuery ? '&' + filterQuery : '');
  var res = supabaseRequest_('GET', path, null, { Prefer: 'count=exact' });

  var headers = res.headers || {};
  var contentRange = null;
  Object.keys(headers).forEach(function (key) {
    if (key.toLowerCase() === 'content-range') contentRange = headers[key];
  });

  if (!contentRange) {
    throw new Error('Supabase GET ' + path + ' ไม่มี header Content-Range กลับมา — parse จำนวนแถวไม่ได้');
  }
  var parts = String(contentRange).split('/');
  var total = parseInt(parts[1], 10);
  return isNaN(total) ? 0 : total;
}

/**
 * insert เป็นชุด (batch) กันข้อมูลเยอะเกินไปจน request เดียวใหญ่เกินไป/timeout
 * ทุก object ในชุดเดียวกันต้อง key ตรงกันหมดทุกตัว — PostgREST ตีความ key แรกของ array เป็น
 * โครงสร้างคอลัมน์ของทั้งชุด ถ้า row ไหน key ไม่ครบ/เกิน จะถูกเติม null หรือ error แบบเงียบๆ โดยไม่รู้ตัว
 * เช็คตรงนี้ก่อน POST เสมอ เพื่อดักปัญหาตั้งแต่ต้นทาง ไม่ปล่อยให้ไปพังที่ Supabase
 */
function supabaseInsertBatched_(table, rows, batchSize) {
  batchSize = batchSize || 200;
  if (!rows || rows.length === 0) return 0;

  var expectedKeys = Object.keys(rows[0]).sort().join(',');
  rows.forEach(function (row, i) {
    var keys = Object.keys(row).sort().join(',');
    if (keys !== expectedKeys) {
      throw new Error('supabaseInsertBatched_(' + table + '): key ของแถวที่ ' + i + ' ไม่ตรงกับแถวแรก (' + keys + ' vs ' + expectedKeys + ')');
    }
  });

  var sent = 0;
  for (var i = 0; i < rows.length; i += batchSize) {
    var chunk = rows.slice(i, i + batchSize);
    supabaseRequest_('POST', '/rest/v1/' + table, chunk, { Prefer: 'return=minimal' });
    sent += chunk.length;
  }
  return sent;
}
