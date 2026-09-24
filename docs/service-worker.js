// L2P4: ชื่อ cache ต้องไม่ชนกับของแอปเดิมที่ docs/ root — ต่อ prefix ตาม scope ของตัวเอง
// ('.../next/' -> 'todo-system-next-v3', root -> 'todo-system-v3') เพื่อให้ทั้งสอง service worker
// อยู่ร่วม origin เดียวกันได้โดยไม่ลบ cache ของกันและกันตอน activate (ดู activate ด้านล่าง)
const CACHE_NAME = 'todo-system-' + (self.registration.scope.indexOf('/next/') !== -1 ? 'next-' : '') + 'v3';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './supabase-api.js',
  './vendor/supabase.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // L2P4: ลบเฉพาะ cache ที่ขึ้นต้นด้วย prefix เดียวกับตัวเองเท่านั้น (เช่นตัวนี้เป็น next ก็ลบแค่
  // 'todo-system-next-*' ตัวเก่าๆ ของตัวเอง) ห้ามลบ cache ของแอปอีกตัว (root ใช้ 'todo-system-v...'
  // ไม่มี 'next-' อยู่ในชื่อ จึงไม่ตรงกับ prefix นี้แน่นอน — กันสอง service worker แย่งลบ cache กันเอง
  var prefix = CACHE_NAME.indexOf('todo-system-next-') === 0 ? 'todo-system-next-' : 'todo-system-v';
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k.indexOf(prefix) === 0 && k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// network-first เฉพาะไฟล์ app shell ของเราเอง (same-origin) — ลองโหลดสดจากเน็ตก่อนเสมอเวลามีเน็ต
// (ได้โค้ดเวอร์ชันล่าสุดทันทีทุกครั้งที่ deploy ใหม่ ไม่ต้องคอยขยับเลข CACHE_NAME เอง) แล้วอัปเดต cache
// เงียบๆ ไว้เผื่อออฟไลน์ค่อย fallback มาใช้ cache นี้ — ข้อมูล task ทั้งหมดยิงตรงไป Supabase เสมอ
// (ไม่ผ่าน cache นี้เลย เพราะเป็น non-GET หรือ cross-origin ถูกกรองออกไปแล้วด้วยเงื่อนไขด้านบน)
// ห้ามเปลี่ยนเป็น cache-first เด็ดขาด — เป็นกฎของโปรเจกต์
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return res;
      })
      .catch(function () { return caches.match(event.request); })
  );
});
