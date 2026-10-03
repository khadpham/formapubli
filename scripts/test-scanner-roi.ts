/**
 * CHỐT TÁI PHÁT — máy quét mã: ZOOM PHÓNG HÌNH + khung quét bất biến.
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-scanner-roi
 *
 * BỐI CẢNH (người dùng báo 30/09, HAI LẦN):
 *  Lần 1: iPhone zoom 2x không quét được; khung nhìn là ô nhỏ nhưng máy quét
 *         toàn khung ⇒ quét nhầm mã khác/QR.
 *  Lần 2 (sau khi đã deploy & thử thật): tôi làm zoom = THU HẸP VÙNG ĐỌC.
 *         Người dùng nói đúng — đó là "phóng to/thu nhỏ cái frame quét", KHÔNG
 *         phải zoom. Zoom phải phóng CẢNH CAMERA, còn khung quét phải giữ
 *         nguyên kích thước trên màn hình ở mọi mức zoom.
 *  Yêu cầu thêm: mở camera phải xem được TOÀN BỘ màn hình điện thoại.
 *
 * HỢP ĐỒNG ĐƯỢC CHỐT Ở ĐÂY (đổi ý thì đổi file này trước, đừng sửa âm thầm):
 *  1. `roiRect(elW, elH)` KHÔNG nhận tham số zoom. Zoom đổi hình, không đổi ROI.
 *  2. Khung nhìn và bộ giải mã cùng dùng MỘT `roi`, tính từ kích thước ô xem đã đo.
 *  3. Zoom camera thật ⇒ `displayScale = 1` (khung hình đã bị thu sẵn).
 *     Zoom bằng CSS ⇒ `displayScale = 2` để bù khi quy đổi toạ độ crop.
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
  const start = srcText.indexOf('export const ROI_BOX_ASPECT');
  assert.ok(start > 0, 'không tìm thấy ROI_BOX_ASPECT trong component');
  const end = srcText.indexOf('export function InAppBarcodeScanner');
  assert.ok(end > start, 'không tìm thấy phần export function InAppBarcodeScanner');
  return srcText.slice(start, end);
}

console.log('\n=== MÁY QUÉT: ZOOM PHÓNG HÌNH · KHUNG QUÉT BẤT BIẾN · KHÔNG QUÉT NHẦM ===');

// Bỏ kiểu TypeScript (giữ dạng ESNext để không sinh lệnh gán `exports`), rồi bỏ
// từ khoá `export` vì `vm` chỉ hiểu script thuần, không phải module.
const roiSource = ts
  .transpileModule(extractPure(src), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  .outputText.replace(/\bexport\s+/g, '');
const scope: any = {};
vm.createContext(scope);
vm.runInContext(roiSource, scope);
const roiRect = vm.runInContext('roiRect', scope) as (w: number, h: number) => any;
const visibleVideoRect = vm.runInContext('visibleVideoRect', scope) as (...a: number[]) => any;
const roiToVideoFrame = vm.runInContext('roiToVideoFrame', scope) as (...a: number[]) => any;

// --- ROI hình học: căn giữa, đúng tỉ lệ, không tràn ---
const wide = roiRect(1200, 500);   // ngang
const tall = roiRect(390, 844);    // dọc, kiểu điện thoại full screen
const square = roiRect(800, 800);

ok(wide.w > 0 && wide.h > 0 && wide.w <= 1 && wide.h <= 1,
   '1. ROI luôn nằm trong khung hình');
ok(
  [wide, tall, square].every(r => Math.abs((r.x + r.w / 2) - 0.5) < 1e-9
    && Math.abs((r.y + r.h / 2) - 0.5) < 1e-9),
  '2. ROI CĂN GIỮA ở mọi dáng màn hình (người dùng chỉ cần đưa mã vào giữa khung)'
);
ok(Math.abs((wide.w * 1200) / (wide.h * 500) - 1.45) < 0.01,
   '3. Khung quét giữ tỉ lệ ~1.45 (dáng khung ngắm) khi màn hình rộng',
   `rộng: ${(wide.w * 1200).toFixed(0)}x${(wide.h * 500).toFixed(0)}px`);
ok(tall.h <= 0.62 + 1e-9 && tall.w <= 0.86 + 1e-9,
   '4. Màn hình dọc cao ⇒ khung quét bị CHẶN chiều cao, không thành hộp dọc khổng lồ',
   `dọc 390x844: ${(tall.w * 390).toFixed(0)}x${(tall.h * 844).toFixed(0)}px`);
ok(Math.abs((tall.w * 390) / (tall.h * 844) - 1.45) < 0.01,
   '5. Khi bị chặn, khung quét vẫn giữ tỉ lệ ~1.45 (không bị bóp méo)');
const degenerate = roiRect(0, 0);
ok(Number.isFinite(degenerate.x) && degenerate.w > 0,
   '6. Kích thước 0 (chưa kịp bố trí) không làm hỏng');

// --- ROI KHÔNG ĐỤNG VÀO ZOOM (đây là chỗ lần trước làm sai) ---
ok(!/roiRect\s*\(\s*zoom/.test(src),
   '7. KHÔNG chỗ nào gọi roiRect(zoom…) — zoom không được thu hẹp vùng đọc');
ok(!/ROI_BY_ZOOM/.test(src),
   '8. Không còn bảng ROI theo zoom (nguyên nhân lần trước zoom chỉ thu frame quét)');
ok(/style=\{\{\s*width:\s*`\$\{roi\.w \* 100\}%`,\s*height:\s*`\$\{roi\.h \* 100\}%`/.test(src),
   '9. Khung nhìn vẽ đúng bằng `roi` mà bộ giải mã dùng (một nguồn sự thật)');
ok(/roiToVideoFrame\(\s*roiRect\(vs\.w, vs\.h\)/.test(src),
   '10. Bộ giải mã dùng CÙNG công thức roiRect(vs.w, vs.h) như khung nhìn');
ok(!/zoomLevelRef\.current === 2/.test(src),
   '11. Không còn nhánh crop 50% cứng khi zoom 2x (iPhone bị crop hai lần)');

// --- Zoom phóng HÌNH: camera thật trước, CSS sau ---
ok(/applyConstraints\(\{ advanced: \[\{ zoom: next \} as any\] \}\)/.test(src),
   '12. Bấm zoom sẽ đặt ràng buộc zoom của CAMERA (phóng ảnh thật)');
ok(/setCameraZoomWorks\(true\)/.test(src) && /setCameraZoomWorks\(false\)/.test(src),
   '13. Có nhánh dự phòng khi máy không nhận ràng buộc zoom');
ok(/!cameraZoomWorks && zoomLevel > 1/.test(src) && /transform: `scale\(\$\{zoomLevel\}\)`/.test(src),
   '14. Máy không zoom được ⇒ phóng HÌNH bằng CSS (vẫn là phóng cảnh, không phải thu vùng đọc)');
ok(/const displayScale = cameraZoomWorks \|\| zoomLevel === 1 \? 1 : zoomLevel/.test(src),
   '15. displayScale = 1 khi camera đã zoom thật, = mức zoom khi phóng bằng CSS');
ok(/displayScaleRef\.current\s*\n?\s*,\s*\n?\s*$/m.test(src) || /roiToVideoFrame\([\s\S]{0,240}displayScaleRef\.current/.test(src),
   '16. displayScale được truyền vào roiToVideoFrame để bù tỉ lệ khi phóng bằng CSS');

// --- Toán: phóng CSS 2x thì vùng quét phải bù lại, khung trên màn hình không đổi ---
// 800x600 ô xem, video 1920x1080 (16:9) ⇒ cover cắt hai bên.
const v1 = visibleVideoRect(800, 600, 1920, 1080, 1);
ok(v1.w < 1 && Math.abs(v1.h - 1) < 1e-9,
   '17. object-cover: video rộng hơn ô xem ⇒ nhận ra bị cắt hai bên',
   `w=${v1.w.toFixed(3)} h=${v1.h}`);

const v2 = visibleVideoRect(800, 600, 1920, 1080, 2);
ok(Math.abs(v2.w - v1.w / 2) < 1e-9 && Math.abs(v2.h - v1.h / 2) < 1e-9
   && Math.abs((v2.x + v2.w / 2) - (v1.x + v1.w / 2)) < 1e-9,
   '18. CSS scale 2x ⇒ chỉ thấy PHẦN GIỮA, đúng một nửa theo mỗi trục');

// Quan trọng nhất: tỉ lệ ROI so với vùng nhìn phải GIỮ NGUYÊN khi phóng 2x,
// tức là khung người dùng thấy không đổi trên màn hình.
const r = roiRect(800, 600);
const f1 = roiToVideoFrame(r, 800, 600, 1920, 1080, 1);
const f2 = roiToVideoFrame(r, 800, 600, 1920, 1080, 2);
ok(Math.abs(f1.w / v1.w - f2.w / v2.w) < 1e-9 && Math.abs(f1.h / v1.h - f2.h / v2.h) < 1e-9,
   '19. PHÓNG 2x KHÔNG đổi tỉ lệ khung quét trên màn hình (đúng ý người dùng)',
   `1x: ${(f1.w / v1.w * 100).toFixed(1)}% x ${(f1.h / v1.h * 100).toFixed(1)}% · 2x: ${(f2.w / v2.w * 100).toFixed(1)}% x ${(f2.h / v2.h * 100).toFixed(1)}%`);
ok(Math.abs(f2.w - f1.w / 2) < 1e-9,
   '20. Nhưng pixel thật trong khung hình lại TĂNG gấp đôi ⇒ mã to lên, dễ giải mã');

const vTall = visibleVideoRect(800, 600, 720, 1280, 1);
ok(Math.abs(vTall.w - 1) < 1e-9 && vTall.h < 1,
   '21. object-cover: video cao hơn ô xem ⇒ nhận ra bị cắt trên dưới',
   `w=${vTall.w} h=${vTall.h.toFixed(3)}`);
const fTall = roiToVideoFrame(r, 800, 600, 720, 1280, 1);
ok(fTall.x >= vTall.x - 1e-9 && fTall.y >= vTall.y - 1e-9
   && fTall.x + fTall.w <= vTall.x + vTall.w + 1e-9
   && fTall.y + fTall.h <= vTall.y + vTall.h + 1e-9,
   '21b. Vùng quét luôn nằm TRONG phần video thực sự hiển thị, không vương ra phần bị cắt');

// --- Xem TOÀN MÀN HÌNH ---
ok(!/max-w-lg/.test(src) && !/aspect-\[4\/3\]/.test(src) && !/sm:aspect-video/.test(src),
   '22. Đã gỡ max-w-lg và khung cố định 4:3 (trước đó chỉ chiếm một mảng nhỏ)');
ok(/fixed inset-0 z-\[70\] bg-black flex flex-col/.test(src),
   '23. Máy quét chiếm TOÀN MÀN HÌNH');
ok(/ref=\{viewRef\} className="relative flex-1 min-h-0 bg-black overflow-hidden"/.test(src),
   '24. Ô xem camera giãn hết chỗ còn lại giữa thanh tiêu đề và thanh nút');
ok(/const measure = \(\) => \{[\s\S]{0,200}clientWidth/.test(src) && /new ResizeObserver/.test(src),
   '25. Ô xem được đo bằng ResizeObserver nên ROI khớp cả khi xoay màn hình');

// --- Vẫn giữ: focus liên tục, không quét QR ---
ok(!/qr_code/i.test(dec),
   '26. KHÔNG còn QR ở CẢ ZXing lẫn native (hội chợ đầy mã QR nên gây quét nhầm)');
ok(/\['ean_13', 'ean_8', 'code_128'\]/.test(dec),
   '27. Danh sách định dạng NATIVE đủ EAN-13 + EAN-8 + Code 128');
ok(/BarcodeFormat\.EAN_13, zxing\.BarcodeFormat\.EAN_8,/.test(dec)
   && /zxing\.BarcodeFormat\.CODE_128/.test(dec),
   '28. Danh sách định dạng ZXING đủ EAN-13 + EAN-8 + Code 128');
ok(/focusMode: 'continuous'/.test(src), '29. Vẫn giữ focus liên tục');

// --- Nút Xem Giỏ & Thanh Toán trong máy quét (30/09) ---
const pos = readFileSync('src/components/pos/PosCheckoutTerminal.tsx', 'utf8');

ok(/id="btn-scanner-go-checkout"/.test(src), '30. Máy quét có nút Xem Giỏ & Thanh Toán');
ok(/from-emerald-500 to-teal-600/.test(src),
   '31. Nút giỏ MÀU XANH đúng kiểu nút giỏ ở màn POS (cùng gradient emerald→teal)');
ok(/<ShoppingCart className="w-5 h-5" \/>/.test(src)
   && /Xem Giỏ & Thanh Toán \(\$\{cartCount\} cuốn\)/.test(src),
   '32. Có icon giỏ và hiện số cuốn trong giỏ');
ok(/disabled=\{!onGoToCheckout \|\| cartCount === 0\}/.test(src)
   && /Giỏ Hàng Trống/.test(src),
   '33. Giỏ trống thì nút khoá, không bấm nhầm được');
ok(/onClick=\{\(\) => \{\s*stopCamera\(\);\s*onGoToCheckout\?\.\(\);\s*\}\}/.test(src),
   '34. Bấm nút sẽ tắt camera TRƯỚC rồi mới đi thanh toán');
ok(!/RotateCw/.test(src) && !/Camera Sau/.test(src),
   '35. Đã bỏ nút Camera Sau/Trước (máy quét luôn dùng camera sau)');
ok(!/facingMode === 'environment' \? 'Camera Sau'/.test(src),
   '36. Không còn nhãn chuyển camera trong UI');

// --- POS nối đúng, và ĐI QUA ĐƯỜNG CÓ KIỂM SOÁT ---
ok(/onGoToCheckout=\{goToCheckoutFromScanner\}/.test(pos)
   && /cartCount=\{totalCopies\}/.test(pos),
   '37. POS truyền đúng callback và số cuốn (totalCopies, không phải cart.length)');
// PHẢI khoanh đúng hàm: nút giỏ xanh ở màn POS cũng gọi
// `setIsMobileCheckoutSheetOpen(true)`, nên khớp cả file sẽ xanh dù hàm của máy
// quét đã không mở hộp nữa (đã dính đúng lỗi này một lần).
const goStart = pos.indexOf('const goToCheckoutFromScanner = () => {');
// Cắt theo cặp ngoặc ngoài cùng để không phụ thuộc câu chữ comment phía sau.
let goEnd = -1;
if (goStart > 0) {
  let depth = 0;
  for (let i = pos.indexOf('{', goStart); i < pos.length; i++) {
    if (pos[i] === '{') depth++;
    else if (pos[i] === '}') {
      depth--;
      if (depth === 0) { goEnd = i + 1; break; }
    }
  }
}
ok(goStart > 0 && goEnd > goStart && goEnd - goStart < 1200,
   '37b. Khoanh đúng hàm điều hướng của nút giỏ trong máy quét (cắt theo cặp ngoặc)');
const goToCheckout = goStart > 0 && goEnd > goStart ? pos.slice(goStart, goEnd) : '';
ok(/setIsMobileCheckoutSheetOpen\(true\)/.test(goToCheckout)
   && /Chi tiết Đơn & Thanh toán/.test(pos),
   '38. Nút giỏ mở ĐÚNG hộp "Chi tiết Đơn & Thanh toán" (cùng hộp nút giỏ xanh ở màn POS mở), không phải chốt thẳng');
ok(/window\.matchMedia\('\(min-width: 1024px\)'\)\.matches/.test(goToCheckout)
   && /handleCheckoutButtonClick\(\)/.test(goToCheckout),
   '39. Hộp đó chỉ hiện trên dọc (lg:hidden) ⇒ desktop phải rơi về đường thanh toán thẳng, không bấm lệnh mà thấy không');
ok(/setIsScannerOpen\(false\)/.test(goToCheckout) && /setTimeout/.test(goToCheckout),
   '40. Đóng scanner TRƯỚC, chờ một nhịp rồi mới mở hộp thanh toán');
ok(/isScannerOpen \|\|/.test(pos),
   '41. handleCheckout có chặn khi scanner còn mở — nếu thiếu bước chờ, bấm nút sẽ im lặng');
ok(/\{isMobileCheckoutSheetOpen && mounted && createPortal\(/.test(pos)
   && /lg:hidden/.test(pos.slice(pos.indexOf('{isMobileCheckoutSheetOpen && mounted'))),
   '42. Hộp thanh toán thật sự tồn tại và là bản dọc — nút giỏ bám đúng hộp đang dùng');

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Máy quét: zoom phóng cảnh, khung quét bất biến, xem hết màn hình, không quét nhầm QR.');
