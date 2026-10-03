/**
 * scripts/run-real-manual-gift-test.ts — chạy SUITE QUÀ TAY ("Tặng thêm")
 * (`?mode=gift`) trên component THẬT, trong Chrome headless.
 *
 * Tách khỏi `run-real-pos-terminal-test.ts` vì suite POS cũ đang hỏng sẵn trên
 * main (Test 2 + Test 6) và không được nối vào runner nào — đặt test tính năng
 * mới vào đó thì không bao giờ chạy tới. Suite này tự dựng trạng thái, chạy độc
 * lập, và là bằng chứng bắt buộc cho mọi thay đổi luồng quà tay.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const tempDir = process.env.TEMP || 'C:\\Users\\PC\\AppData\\Local\\Temp';
const bundlePath = path.join(tempDir, 'manual-gift-test-bundle.js');
const htmlPath = path.join(tempDir, 'manual-gift-test.html');

console.log('1. Bundling PosCheckoutTerminal (mode=gift) with esbuild...');
execSync(
  `npx esbuild scripts/browser-pos-terminal-test.tsx --bundle --platform=browser --jsx=automatic --outfile="${bundlePath}" --define:process.env.NODE_ENV='"test"'`,
  { stdio: 'inherit' }
);

console.log('2. Writing HTML harness...');
fs.writeFileSync(
  htmlPath,
  `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manual Gift Approval Component Test</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>.font-mono { font-family: monospace; }</style>
</head>
<body class="bg-slate-100 p-2 text-slate-800">
  <!-- p-3 khớp sản xuất: MasterAppShell bọc POS trong main.p-3, còn bên trong POS
       có khối "-mx-3 px-3" cân bằng đúng lớp padding đó. Thiếu nó thì mọi phép đo
       bề rộng trong suite này lệch 12px so với app thật. -->
  <div id="root" class="p-3"></div>
  <div id="test-logs" style="font-family: monospace; white-space: pre-wrap; display: none;"></div>
  <script src="file:///${bundlePath.replace(/\\/g, '/')}"></script>
</body>
</html>`,
  'utf8'
);

console.log('3. Running in Chrome Headless...');
// Cửa sổ RỘNG (desktop): ở mobile, `PosCheckoutTerminal` CỐ TÌNH ẩn danh mục
// (scan-first, `showCatalogGrid`) ⇒ không có thẻ sách để bấm "+ Thêm" và giỏ
// rỗng ⇒ mọi khẳng định về chốt đơn sẽ pass nhầm.
const domOutput = execSync(
  `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --window-size=1280,900 --virtual-time-budget=8000 --dump-dom "file:///${htmlPath.replace(/\\/g, '/')}?mode=gift"`,
  { encoding: 'utf8' }
);

const logMatches = domOutput.match(/<div class="test-log">([^<]*)<\/div>/g) || [];
for (const m of logMatches) {
  console.log(m.replace(/<div class="test-log">/, '').replace(/<\/div>/, ''));
}

const passMatch = domOutput.match(/ALL MANUAL GIFT TESTS PASSED \((\d+\/\d+)\)/);
if (!passMatch) {
  console.error('\n❌ SUITE QUÀ TAY KHÔNG XANH');
  const debugFile = path.join(tempDir, 'manual-gift-test-debug.html');
  fs.writeFileSync(debugFile, domOutput, 'utf8');
  console.error('Debug DOM:', debugFile);
  process.exit(1);
}

console.log(`\n>>> QUÀ TAY QUA DUYỆT: ${passMatch[1]} PASS <<<`);
