import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\ceb23bea-db7c-4257-801e-e11bfb62fe7e';
const reportDir = path.join(process.cwd(), 'reports', 'wave3-pos-ui');
const tempDir = process.env.TEMP || 'C:\\Users\\PC\\AppData\\Local\\Temp';

if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

// Mock book data
const sampleBooks = [
  { id: '1', code: 'BOOK-01', title: 'Muôn Kiếp Nhân Sinh - Tập 1 (Tái Bản Đặc Biệt)', author: 'Nguyên Phong', coverPrice: 168000, stock: 12 },
  { id: '2', code: 'BOOK-02', title: 'Cây Cam Ngọt Của Tôi', author: 'José Mauro de Vasconcelos', coverPrice: 108000, stock: 5 },
  { id: '3', code: 'BOOK-03', title: 'Hiểu Về Trái Tim', author: 'Thích Minh Niệm', coverPrice: 145000, stock: 8 },
  { id: '4', code: 'BOOK-04', title: 'Đắc Nhân Tâm (Khổ Lớn)', author: 'Dale Carnegie', coverPrice: 98000, stock: 20 },
  { id: '5', code: 'BOOK-05', title: 'Nhà Giả Kim', author: 'Paulo Coelho', coverPrice: 79000, stock: 15 },
  { id: '6', code: 'BOOK-06', title: 'Hành Trình Về Phương Đông', author: 'Baird T. Spalding', coverPrice: 120000, stock: 0 }
];

function generatePosHtml(viewportWidth: number, isCashier: boolean, isExpanded: boolean) {
  const booksToRender = isExpanded ? sampleBooks : sampleBooks.slice(0, 4);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${viewportWidth}, initial-scale=1.0">
  <title>POS Terminal - Mobile 2x2 Grid (#11)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-slate-100 p-2 sm:p-4 text-slate-800 antialiased min-h-screen">
  <div class="max-w-[${viewportWidth}px] mx-auto space-y-3">
    <!-- Topbar Header -->
    <div class="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">POS</span>
        <div>
          <div class="text-xs font-bold text-slate-900">Quầy Thu Ngân Hội Chợ</div>
          <div class="text-[10px] text-slate-500 font-mono">Vai trò: <span class="font-bold text-indigo-600">${isCashier ? 'ROLE_CASHIER' : 'ROLE_MANAGER'}</span></div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        ${!isCashier ? `
        <!-- Nút Chốt Ngày (Chỉ hiện cho Manager / Owner - Ticket #3-UI button) -->
        <button type="button" class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-amber-600 text-white shadow-sm">
          <span>📅 Chốt Ngày</span>
        </button>
        ` : `
        <!-- Ticket #3: Ẩn nút Chốt Ngày đối với Cashier -->
        <span class="text-[10px] text-slate-400 italic bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">Khóa chốt ngày</span>
        `}
      </div>
    </div>

    <!-- Scanner Bar -->
    <button class="w-full min-h-[44px] px-4 rounded-2xl bg-emerald-600 text-white text-xs font-extrabold shadow-md flex items-center justify-center gap-2">
      📷 Quét mã thêm vào giỏ
    </button>

    <!-- Catalog Header -->
    <div class="flex items-center justify-between px-1">
      <span class="text-xs font-extrabold text-slate-800">Danh mục (${sampleBooks.length})</span>
      <button type="button" class="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 min-h-[36px] px-2">
        ${isExpanded ? 'Thu gọn ▲' : 'Xem tất cả (6) ▼'}
      </button>
    </div>

    <!-- 2-COL CATALOG GRID (#11) -->
    <div class="grid grid-cols-2 gap-2 sm:gap-3">
      ${booksToRender.map(b => {
        const isOutOfStock = b.stock <= 0;
        return `
        <div title="${b.title}" class="p-2.5 bg-white rounded-2xl border transition-all flex flex-col justify-between select-none min-h-[110px] ${
          isOutOfStock ? 'opacity-50 border-slate-200 bg-slate-50/60' : 'border-slate-200/80 shadow-sm'
        }">
          <div>
            <div class="flex items-center justify-between gap-1 mb-1">
              <span class="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-mono font-black truncate max-w-[65px]">
                ${b.code}
              </span>
              <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                b.stock > 10 ? 'bg-emerald-50 text-emerald-700' : b.stock > 0 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
              }">
                Tồn: ${b.stock}
              </span>
            </div>
            <h4 title="${b.title}" class="text-xs font-bold text-slate-900 line-clamp-2 leading-snug break-words">
              ${b.title}
            </h4>
            <p title="${b.author}" class="text-[11px] text-slate-500 truncate mt-0.5">
              ${b.author}
            </p>
          </div>

          <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 gap-1">
            <span class="text-[11px] font-black text-emerald-700 font-mono truncate">
              ${b.coverPrice.toLocaleString('vi-VN')} đ
            </span>
            <button type="button" ${isOutOfStock ? 'disabled' : ''} aria-label="Thêm ${b.title} vào giỏ" class="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 shrink-0 min-h-[32px]">
              + Thêm
            </button>
          </div>
        </div>
        `;
      }).join('')}
    </div>

    <!-- Cart Summary Bar Mockup -->
    <div class="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm mt-3">
      <div class="flex justify-between items-center text-xs">
        <span class="font-bold text-slate-700">Giỏ hàng: 2 sản phẩm</span>
        <span class="font-mono font-black text-emerald-700 text-sm">276.000 đ</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

console.log('Rendering Wave 3 POS UI Screenshots with Google Chrome Headless...');

const viewports = [
  { name: 'pos-mobile-320px', width: 320, height: 600, isCashier: true, isExpanded: false },
  { name: 'pos-mobile-375px', width: 375, height: 620, isCashier: true, isExpanded: false },
  { name: 'pos-mobile-390px', width: 390, height: 640, isCashier: true, isExpanded: false },
  { name: 'pos-manager-topbar', width: 390, height: 640, isCashier: false, isExpanded: true }
];

for (const vp of viewports) {
  const html = generatePosHtml(vp.width, vp.isCashier, vp.isExpanded);
  const tempHtml = path.join(tempDir, `${vp.name}.html`);
  fs.writeFileSync(tempHtml, html, 'utf8');

  const artifactOutput = path.join(artifactDir, `${vp.name}.png`);
  const reportOutput = path.join(reportDir, `${vp.name}.png`);

  const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --window-size=${vp.width},${vp.height} --screenshot="${artifactOutput}" "file:///${tempHtml.replace(/\\/g, '/')}"`;
  execSync(cmd, { stdio: 'pipe' });

  // Copy to report folder
  fs.copyFileSync(artifactOutput, reportOutput);
  console.log(`✓ Generated screenshot: ${vp.name}.png (${vp.width}x${vp.height})`);
}

console.log('\nWave 3 UI Screenshot generation complete!');
