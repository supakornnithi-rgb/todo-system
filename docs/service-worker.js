const CACHE_NAME = 'todo-system-v2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
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
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// network-first เฉพาะไฟล์ app shell ของเราเอง (same-origin) — ลองโหลดสดจากเน็ตก่อนเสมอเวลามีเน็ต
// (ได้โค้ดเวอร์ชันล่าสุดทันทีทุกครั้งที่ deploy ใหม่ ไม่ต้องคอยขยับเลข CACHE_NAME เอง) แล้วอัปเดต cache
// เงียบๆ ไว้เผื่อออฟไลน์ค่อย fallback มาใช้ cache นี้ — ข้อมูล task ทั้งหมดยิงตรงไป Apps Script เสมอ
// ไม่ผ่าน cache นี้เลย (ถูกกรองออกไปแล้วด้วยเงื่อนไข origin ด้านบน)
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
