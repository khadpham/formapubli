// formapubli OS - Resilient Offline Service Worker
const CACHE_NAME = 'formapubli-cache-v2';
// KHÔNG precache '/': HTML trang phụ thuộc phiên đăng nhập. Cache nó lại
// khiến sau login/logout người dùng vẫn thấy màn hình cũ và phải bấm 2 lần.
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Không cache các request API hoặc mutation POST/PUT/DELETE
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return;
  }

  // Navigation = HTML app shell, PHỤ THUỘC PHIÊN ĐĂNG NHẬP.
  // Phải ưu tiên mạng: trả cache cũ khiến sau login/logout người dùng vẫn thấy
  // màn hình cũ và phải bấm 2 lần (bug #2). Vẫn ghi cache để offline mở được app.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Stale-while-revalidate cho tài nguyên tĩnh
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Trả về cache nếu mạng mất kết nối
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
