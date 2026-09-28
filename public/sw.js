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
//
// 4) Nút "Làm mới" ở tab Kho bấm không ăn, dữ liệu đứng yên.
//    Nguyên nhân: nhánh cache-first bắt MỌI GET cùng origin không phải
//    navigate — trong đó có payload RSC của Next.js app-router. RSC là
//    DỮ LIỆU theo PHIÊN (router.refresh() để lấy số liệu mới từ server),
//    nhưng SW lại cache-first → trả lại bản cũ từ CacheStorage, transferSize
//    = 0, server KHÔNG nhận request nào. Người dùng bấm refresh, UI quay
//    spinner, số liệu y nguyên.
//    Sửa: nhận diện request RSC và BỎ QUA HOÀN TOÀN (return, không
//    respondWith) → trình duyệt tự đi mạng, đúng như không có SW.
//    Đây là điểm quan trọng nhất của cả file: dữ liệu KHÔNG BAO GIỜ được
//    phục vụ từ cache. Chỉ tài nguyên tĩnh bất biến mới được cache.
//
// PHIÊN BẢN CACHE (BUILD) phải tăng mỗi khi ĐỔI CHÍNH SÁCH CACHE.
// Lý do: SW đã cài trên máy người dùng là một FILE ĐÃ CŨ — trình duyệt
// không tự tải lại sw.js cho tới lần đăng nhập có SW mới. Cache cũ vẫn
// nằm trong CacheStorage. Đổi tên cache (BUILD) làm activate xoá sạch bản
// cũ, và install/activate mới chạy với file mới. Giữ nguyên BUILD thì bản
// vá không bao giờ tới máy đã cài PWA.
const BUILD = 'v5';
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

// Next.js app-router đánh dấu mọi request dữ liệu RSC (navigate mềm,
// router.refresh(), prefetch) bằng header `RSC: 1` KÈM query `_rsc=<hash>`.
// Ngoài ra các request tới cache phân đoạn nằm dưới đường dẫn `/_rsc/`.
// Bất kỳ dấu hiệu nào cũng đủ: bỏ sót thì lại quay về bug dữ liệu đứng yên.
function isRscRequest(req, url) {
  if (req.headers && req.headers.get('rsc') === '1') return true;
  if (url.searchParams.has('_rsc')) return true;
  if (url.pathname.startsWith('/_rsc/')) return true;
  return false;
}

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

  // RSC = DỮ LIỆU app, theo phiên đăng nhập. Tuyệt đối không cache, không
  // respondWith — để trình duyệt tự đi mạng. Đây là fix bug "nút Làm mới
  // ở tab Kho không ăn" (bug #4 ở đầu file).
  if (isRscRequest(req, url)) return;

  // Điều hướng = HTML của app shell theo PHIÊN. Luôn lấy mạng trước.
  // Offline thì mới rơi về cache, và cache chỉ có asset tĩnh nên coi như
  // không có offline shell — thà hiện thông báo hơn là chạy code cũ.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req));
    return;
  }

  // Tài nguyên TĨNH: cache-first (tên file có hash nên bất biến), nền
  // nếu thiếu. Không dùng stale-while-revalidate vì nó giữ HTML/JS cũ.
  // Chỉ asset tĩnh mới tới đây: mọi request dữ liệu (RSC, /api/) đã bị
  // bỏ qua ở trên, nên cache này KHÔNG BAO GIỜ chứa dữ liệu nghiệp vụ.
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
