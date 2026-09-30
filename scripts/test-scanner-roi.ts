/**
 * CHỐT TÁI PHÁT — máy quét mã: ROI, zoom không vỡ, không quét nhầm QR.
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-scanner-roi
 *
 * BỐI CẢNH (người dùng báo 30/09):
 *  · iPhone: zoom 2x ⇒ KHÔNG QUẤT ĐƯỢC. 1x thì bình thường.
 *  · Android: zoom 2x quét được nhưng kém nhạy hơn 1x.
 *  · Khung nhìn là ô chữ nhật nhưng máy quét TOÀN MÀN ⇒ quét nhầm mã khác / mã QR.
 *  · Không nhìn được toàn cảnh để tự canh vào khung.
 *
 * Bốn nguyên nhân gốc tìm được trong code (xem kế hoạch 2026-09-30-scanner-zoom-roi-fix):
 *  G1 applyConstraints({zoom}) trên iOS đổi định dạng capture, rồi lại crop 50%
 *     lần nữa ⇒ mã quá nhỏ, không giải mã được.
 *  G2 vẽ toàn khung hình rồi giải mã cả khung, khung nhìn cứng w-64 h-44.
 *  G3 CSS scale(2) chỉ chạy khi máy KHÔNG có zoom quang ⇒ hình thu nhỏ khác nhau.
 *  G4 nạp QR_CODE vào POSSIBLE_FORMATS trong khi sách luôn là EAN.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const SRC = 'src/components/scanner/InAppBarcodeScanner.tsx';
const DEC = 'src/lib/barcode-decoder.ts';
const src = readFileSync(SRC, 'utf8');
const dec = readFileSync(DEC, 'utf8');

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

// Trích hàm thuần ra để CHẠY THẬT (không chép lại logic trong test — nếu chép lại
// thì test xanh mà sản phẩm hỏng, đúng bài học gotcha 11).
function extractPure(srcText: string): string {
  const start = srcText.indexOf('export const ROI_BY_ZOOM');
  assert.ok(start > 0, 'không tìm thấy ROI_BY_ZOOM trong component');
  const end = srcText.indexOf('export function InAppBarcodeScanner');
  assert.ok(end > start, 'không tìm thấy phần export function InAppBarcodeScanner');
  return srcText.slice(start, end);
}

console.log('\n=== MÁY QUÉT: VÙNG QUÉT (ROI) + ZOOM KHÔNG VỠ + KHÔNG QUÉT NHẦM ===');

// --- ROI ---
// Bỏ kiểu TypeScript (giữ dạng ESNext để không sinh lệnh gán `exports`), rồi bỏ
// từ khoá `export` vì `vm` chỉ hiểu script thuần, không phải module.
const roiSource = ts
  .transpileModule(extractPure(src), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  .outputText.replace(/\bexport\s+/g, '');
const scope: any = {};
vm.createContext(scope);
vm.runInContext(
  roiSource + '\n({ roiRect, roiToVideoFrame, visibleVideoRect, ROI_BY_ZOOM, ROI_DECODE_WIDTH });',
  scope
);
const mod = vm.runInContext('({ roiRect, roiToVideoFrame, visibleVideoRect, ROI_BY_ZOOM, ROI_DECODE_WIDTH })', scope) as any;

const r1 = mod.roiRect(1);
const r2 = mod.roiRect(2);

ok(r1.w > 0 && r1.h > 0 && r1.w < 1 && r1.h < 1,
   '1. ROI luôn là vùng nhỏ hơn khung hình (không quét tràn ra ngoài)');
ok(
  Math.abs((r1.x + r1.w / 2) - 0.5) < 1e-9 && Math.abs((r1.y + r1.h / 2) - 0.5) < 1e-9,
  '2. ROI CĂN GIỮA (người dùng chỉ cần đưa mã vào giữa khung)'
);
ok(r2.w < r1.w && r2.h < r1.h,
   '3. Zoom 2x = vùng quét HẸP HƠN 1x ⇒ mỗi mã chiếm nhiều pixel hơn ⇒ nhạy hơn',
   `1x = ${r1.w}×${r1.h} · 2x = ${r2.w}×${r2.h}`);
ok(mod.roiRect(99).w === r1.w, '4. Zoom lạ (99) rơi về mặc định, không nổ');

// --- object-cover: khung nhìn và vùng quét phải cùng hệ toạ độ ---
// Video 1920x1080 (16:9) hiển thị trong khung 4:3 ⇒ cắt hai bên.
const visWide = mod.visibleVideoRect(800, 600, 1920, 1080);
ok(visWide.w < 1 && Math.abs(visWide.h - 1) < 1e-9,
   '5. object-cover: video rộng hơn khung nhìn ⇒ nhận ra bị cắt hai bên',
   `w=${visWide.w.toFixed(3)} h=${visWide.h}`);

const fWide = mod.roiToVideoFrame(r1, 800, 600, 1920, 1080);
ok(fWide.w < visWide.w && fWide.x > 0,
   '6. Vùng quét nằm TRONG phần video thực sự hiển thị (không vương ra phần bị cắt)');

// Trường hợp ngược: video cao hơn khung nhìn ⇒ cắt trên dưới.
const visTall = mod.visibleVideoRect(800, 600, 720, 1280);
ok(Math.abs(visTall.w - 1) < 1e-9 && visTall.h < 1,
   '7. object-cover: video cao hơn khung nhìn ⇒ nhận ra bị cắt trên dưới',
   `w=${visTall.w} h=${visTall.h.toFixed(3)}`);

// Kích thước 0 (camera chưa sẵn sàng) không được ném lỗi.
const fZero = mod.roiToVideoFrame(r1, 0, 0, 0, 0);
ok(Number.isFinite(fZero.x) && fZero.w > 0, '8. Kích thước 0 không làm hỏng (camera chưa sẵn sàng)');

// --- G1: KHÔNG còn zoom quang ---
// Nhảy lên zoom quang 2 là thứ làm vỡ iPhone. `zoom: 1` là ĐƯỜNG ĐANG CHẠY TỐT
// (người dùng xác nhận 1x ổn) nên được phép, và phải được ghim lại.
ok(!/zoom:\s*2\b/.test(src) && !/zoom:\s*(?!1\b)\d/.test(src),
   '9. KHÔNG BAO GIỜ nhảy zoom quang lên 2 — đây là nguyên nhân iPhone vỡ zoom 2x');
ok(/applyConstraints\(\{\s*advanced:\s*\[\{\s*zoom:\s*1,/.test(src),
   '9b. Vẫn ghim zoom: 1 (giữ nguyên đường 1x đang chạy tốt, tránh ống siêu rộng)');
ok(!/transform:\s*'scale\(2\)'/.test(src),
   '10. KHÔNG còn CSS scale(2) trên video — hình thu nhỏ giờ nhất quán mọi máy');

// --- G2: khung nhìn lấy từ cùng hàm ROI ---
// Phải kiểm CẢ width lẫn height: chỉ kiểm width thì ghim cứng chiều cao vẫn lọt.
ok(/style=\{\{\s*width:\s*`\$\{roiRect\(zoomLevel\)\.w \* 100\}%`,\s*height:\s*`\$\{roiRect\(zoomLevel\)\.h \* 100\}%`/.test(src),
   '11. Khung nhìn lấy CẢ chiều rộng lẫn chiều cao từ CHÍNH hàm ROI của bộ giải mã');
ok(!/w-64 sm:w-72/.test(src) && !/h-44 sm:h-48/.test(src),
   '12. Đã gỡ khung cứng w-64/h-44 (trước đó khung nhìn ≠ vùng máy quét)');

// --- G3: decode crop theo ROI, không vẽ toàn khung hình ---
ok(/roiToVideoFrame\(\s*roiRect\(zoomLevelRef\.current\)/.test(src),
   '13. Vòng decode quy đổi ROI sang toạ độ khung hình video trước khi crop');
ok(!/zoomLevelRef\.current === 2/.test(src),
   '14. Không còn nhánh crop 50% cứng khi zoom 2x (crop hai lần trên iPhone)');

// --- G4: không quét QR, Ở CẢ HAI ĐƯỜNG ---
// Phải bỏ `QR_CODE` (ZXing) LẪN `'qr_code'` (BarcodeDetector native). Native được
// ưu tiên và chạy suốt phiên trên Android — bỏ mỗi ZXing thì Android vẫn quét
// nhầm QR. So khớp KHÔNG phân biệt hoa thường, vì lỗi này chính là do so khớp
// phân biệt hoa thường mà lọt.
ok(!/qr_code/i.test(dec),
   '15. KHÔNG còn QR ở CẢ ZXing lẫn native (hội chợ đầy mã QR nên gây quét nhầm)');
// Phải khớp ĐÚNG danh sách, không grep cả file: `if (formats.includes('ean_13'))`
// cũng chứa chữ 'ean_13' nên grep rộng sẽ xanh dù native đã mất EAN-13.
ok(/\['ean_13', 'ean_8', 'code_128'\]/.test(dec),
   '16a. Danh sách định dạng NATIVE đủ EAN-13 + EAN-8 + Code 128');
ok(/BarcodeFormat\.EAN_13, zxing\.BarcodeFormat\.EAN_8,/.test(dec)
   && /zxing\.BarcodeFormat\.CODE_128/.test(dec),
   '16b. Danh sách định dạng ZXING đủ EAN-13 + EAN-8 + Code 128');

// --- Không phá luồng cũ ---
ok(/applyConstraints\(\{ advanced:\s*\[\{ zoom: 1, focusMode: 'continuous' \}/.test(src),
   '17. Vẫn giữ focus liên tục (không đổi định dạng capture nên an toàn)');

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Máy quét: khung nhìn = vùng quét, zoom không vỡ, không quét nhầm QR.');
