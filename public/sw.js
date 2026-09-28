// formapubli OS - Resilient Offline Service Worker
//
// BA LỖI ĐÃ SỬA (báo cáo người dùng, 27/09):
//
// 1) "TypeError: Failed to convert value to 'Response'" + beacon.min.js ERR_FAILED
//    Nguyên nhân: nhánh stale-while-revalidate bắt MỌI request GET kể cả
//    cross-origin (static.cloudflareinsights.com). Khi mạng chặn, .catch()
//    trả về `cachedResponse` = undefined, rồi đưa vào respondWith →
//    không phải Response → browser ném lỗi và request fail.
//    Sửa: chỉ intercept request CÙNG ORIGIN. Request ngoài domain thì để
//    browser tự xử lý.
//
// 2) Trang TỰ TẢI LẠI, mất sạch thao tác đang làm.
//    Nguyên nhân: CACHE_NAME là hằng số 'v2' không đổi theo bản deploy.
//    Sau mỗi lần deploy, HTML cũ trong cache vẫn trỏ tới tên chunk đã bị
//    xoá → app shell hỏng → Next.js tự hard-reload để cứu → mất dữ liệu.
//    Sửa: (a) KHÔNG cache HTML điều hướng, luôn ưu tiên mạng; (b) cache
//    tĩnh có khoá theo phiên bản; (c) mainnet không phục vụ bản cũ từ cache.
//
// 3) Đăng nhập xong thấy màn cũ (bug #2 cũ): đã xử lý bằng cách không
//    cache HTML và bỏ qua toàn bộ /api/.

const BUILD = 'v4';
const CACHE_NAME = `formapubli-cache-${BUILD}`;

// Nguyên tắc: app này có PHIÊN ĐĂNG NHẬP. Không được phục vụ HTML cũ,
// vì HTML cũ = shell cũ + logic cũ, dẫn tới lệch phiên và mất thao tác.
// Chỉ cache tài nguyên tĩnh bất biến (icon, manifest, asset có hash tên).
// v4: manifest trỏ icon PNG (iOS không nhận SVG cho apple-touch-icon) → cache
// PNG để app cài offline không trắng màn hình chính.
const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // CHỈ xử lý GET cùng origin. Mọi thứ khác (POST/PUT/DELETE, /api/,
  // và mọi request cross-origin như beacon) để trình duyệt tự lo.
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Điều hướng = HTML của app shell theo PHIÊN. Luôn lấy mạng trước.
  // Offline thì mới rơi về cache, và cache chỉ có asset tĩnh nên coi như
  // không có offline shell — thà hiện thông báo hơn là chạy code cũ.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req));
    return;
  }

  // Tài nguyên tĩnh: cache-first (tên file có hash nên bất biến), nền
  // nếu thiếu. Không dùng stale-while-revalidate vì nó giữ HTML/JS cũ.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});
