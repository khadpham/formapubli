import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\ceb23bea-db7c-4257-801e-e11bfb62fe7e';
const tempDir = process.env.TEMP || 'C:\\Users\\PC\\AppData\\Local\\Temp';

// HTML 1: BatchTransferModal with Bulk Action Toolbar & Checkboxes
const batchTransferHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Batch Transfer Modal - Bulk Edit (#5)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-slate-900/60 p-8 flex items-center justify-center min-h-screen">
  <div class="bg-white rounded-3xl shadow-2xl max-w-4xl w-full border border-slate-100 overflow-hidden">
    <!-- Modal Header -->
    <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
      <div class="flex items-center gap-2.5">
        <div class="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
          ⇄
        </div>
        <div>
          <h2 class="text-base font-bold text-slate-900">
            Phiếu Chuyển Kho Hàng Loạt
          </h2>
          <p class="text-xs text-slate-500">
            Xuất nhanh danh sách N đầu sách sang kho hội chợ hoặc kho chi nhánh với 1 chứng từ PCK duy nhất
          </p>
        </div>
      </div>
      <button class="p-1.5 rounded-full text-slate-400 hover:text-slate-700 bg-slate-100 text-sm font-bold w-8 h-8 flex items-center justify-center">✕</button>
    </div>

    <!-- Modal Body -->
    <div class="p-6 space-y-4">
      <!-- Form chọn kho nguồn & kho đích -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
        <div>
          <label class="text-xs font-bold text-slate-700 block mb-1.5">Kho Nguồn (Xuất Hàng)</label>
          <div class="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800">
            Kho Âu Cơ (KHO_AU_CO)
          </div>
        </div>
        <div>
          <label class="text-xs font-bold text-slate-700 block mb-1.5">Kho Đích (Nhập Hàng) — <span class="text-indigo-600">Được chọn tự động từ CTA</span></label>
          <div class="px-3 py-2 bg-indigo-50/50 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-900 flex items-center justify-between">
            <span>Gian Hàng Hội Chợ Sách 2026 (KHO_HOI_CHO_2026)</span>
            <span class="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded font-mono">MỚI TẠO</span>
          </div>
        </div>
      </div>

      <!-- Bulk Actions Toolbar (#5) -->
      <div class="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs shadow-xs">
        <div class="flex items-center gap-3">
          <span class="font-semibold text-slate-700">
            Đã chọn: <strong class="text-indigo-600 font-mono text-sm">2</strong> / 3 dòng
          </span>
          <button class="text-indigo-600 hover:text-indigo-800 font-medium hover:underline">
            Chọn tất cả
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Áp dụng SL hàng loạt -->
          <div class="flex items-center gap-1.5">
            <input
              type="number"
              value="25"
              class="w-20 px-2 py-1 bg-white border border-indigo-400 ring-2 ring-indigo-100 rounded-lg text-xs font-mono font-bold text-center focus:outline-none text-slate-900"
            />
            <button class="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-xs hover:bg-indigo-700 transition">
              Áp dụng (2)
            </button>
          </div>

          <div class="h-4 w-px bg-slate-300 mx-1 hidden sm:block"></div>

          <!-- Xóa dòng đã chọn -->
          <button class="px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-rose-100 transition">
            🗑️ Xóa (2)
          </button>

          <!-- Xóa tất cả có xác nhận -->
          <div class="flex items-center gap-1 bg-rose-100/80 px-2 py-0.5 rounded-lg border border-rose-300">
            <span class="text-[11px] font-bold text-rose-800">Xóa hết 3 dòng?</span>
            <button class="px-2 py-0.5 bg-rose-600 text-white rounded text-[11px] font-bold">Có</button>
            <button class="px-1.5 py-0.5 bg-white text-slate-700 rounded text-[11px] font-semibold border border-slate-200">Hủy</button>
          </div>
        </div>
      </div>

      <!-- Bảng chi tiết các dòng sách đã chọn -->
      <div class="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <table class="w-full text-xs">
          <thead class="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold">
            <tr>
              <th class="px-3 py-2.5 text-center w-10">
                <input type="checkbox" class="w-4 h-4 rounded text-indigo-600" />
              </th>
              <th class="px-2 py-2.5 text-left w-10">#</th>
              <th class="px-3 py-2.5 text-left">Đầu Sách</th>
              <th class="px-3 py-2.5 text-center w-28">Tồn Nguồn</th>
              <th class="px-3 py-2.5 text-center w-32">Số Lượng Chuyển</th>
              <th class="px-3 py-2.5 text-center w-12">Xóa</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr class="bg-indigo-50/40">
              <td class="px-3 py-2.5 text-center">
                <input type="checkbox" checked class="w-4 h-4 rounded text-indigo-600" />
              </td>
              <td class="px-2 py-2.5 font-mono text-slate-400 text-center">1</td>
              <td class="px-3 py-2.5">
                <span class="font-mono font-bold text-slate-800 mr-1.5">[H01]</span>
                <span class="font-medium text-slate-900">Bệnh Tưởng (Molière)</span>
              </td>
              <td class="px-3 py-2.5 text-center font-mono font-semibold text-slate-600">85</td>
              <td class="px-3 py-2.5 text-center">
                <input type="number" value="25" class="w-20 px-2 py-1 text-center font-mono font-bold border border-slate-300 rounded-lg bg-white" />
              </td>
              <td class="px-3 py-2.5 text-center">
                <button class="p-1 rounded text-slate-400 hover:text-rose-600">🗑️</button>
              </td>
            </tr>

            <tr class="hover:bg-slate-50/60">
              <td class="px-3 py-2.5 text-center">
                <input type="checkbox" class="w-4 h-4 rounded text-indigo-600" />
              </td>
              <td class="px-2 py-2.5 font-mono text-slate-400 text-center">2</td>
              <td class="px-3 py-2.5">
                <span class="font-mono font-bold text-slate-800 mr-1.5">[H02]</span>
                <span class="font-medium text-slate-900">Trưởng Giả Học Làm Sang</span>
              </td>
              <td class="px-3 py-2.5 text-center font-mono font-semibold text-slate-600">42</td>
              <td class="px-3 py-2.5 text-center">
                <input type="number" value="10" class="w-20 px-2 py-1 text-center font-mono font-bold border border-slate-300 rounded-lg bg-white" />
              </td>
              <td class="px-3 py-2.5 text-center">
                <button class="p-1 rounded text-slate-400 hover:text-rose-600">🗑️</button>
              </td>
            </tr>

            <tr class="bg-indigo-50/40">
              <td class="px-3 py-2.5 text-center">
                <input type="checkbox" checked class="w-4 h-4 rounded text-indigo-600" />
              </td>
              <td class="px-2 py-2.5 font-mono text-slate-400 text-center">3</td>
              <td class="px-3 py-2.5">
                <span class="font-mono font-bold text-slate-800 mr-1.5">[H03]</span>
                <span class="font-medium text-slate-900">Người Bệnh Tưởng Tượng</span>
              </td>
              <td class="px-3 py-2.5 text-center font-mono font-semibold text-slate-600">120</td>
              <td class="px-3 py-2.5 text-center">
                <input type="number" value="25" class="w-20 px-2 py-1 text-center font-mono font-bold border border-slate-300 rounded-lg bg-white" />
              </td>
              <td class="px-3 py-2.5 text-center">
                <button class="p-1 rounded text-slate-400 hover:text-rose-600">🗑️</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Thông báo kiểm tra ATP hợp lệ -->
      <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-medium">
        <span class="text-emerald-600 font-bold text-sm">✓</span>
        <span>Toàn bộ 3 đầu sách (60 cuốn) đều có đủ tồn khả dụng (ATP). Bạn có thể ấn "Xác nhận chuyển kho".</span>
      </div>
    </div>

    <!-- Modal Footer -->
    <div class="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/80">
      <button class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">Hủy bỏ</button>
      <div class="flex items-center gap-2">
        <button class="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition">
          Kiểm tra tồn kho
        </button>
        <button class="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition flex items-center gap-1.5">
          <span>⇄</span> Xác nhận chuyển kho
        </button>
      </div>
    </div>
  </div>
</body>
</html>`;

// HTML 2: StockOverviewMatrix with Warehouse Creation Toast & CTA (#10-CTA)
const warehouseCtaHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Warehouse Creation CTA Banner (#10-CTA)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-slate-100 p-8 min-h-screen">
  <div class="max-w-5xl mx-auto space-y-6">
    <!-- Header simulation -->
    <div class="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200">
      <div>
        <h1 class="text-lg font-bold text-slate-900">Quản Lý Tồn Kho Ma Trận 3 Kho</h1>
        <p class="text-xs text-slate-500">book.formaform.vn · Vai trò Quản Lý / Chủ Cửa Hàng</p>
      </div>
      <div class="flex gap-2">
        <button class="px-3 py-2 bg-slate-900 text-amber-400 border border-amber-500/40 rounded-lg text-xs font-bold">
          🏪 Mở Kho
        </button>
        <button class="px-3 py-2 bg-violet-600 text-white rounded-lg text-xs font-semibold">
          ⇄ Chuyển hàng loạt
        </button>
      </div>
    </div>

    <!-- 2.5 BANNER THÔNG BÁO TẠO KHO & CTA ĐIỀU CHUYỂN (#10-CTA) -->
    <div class="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-indigo-500/10 border border-emerald-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm text-lg font-bold">
          🏢
        </div>
        <div>
          <p class="text-sm font-bold text-slate-900">
            Đã mở kho mới thành công: <span class="text-emerald-700 font-extrabold">Gian Hàng Hội Chợ Sách 2026</span>
            <span class="ml-2 font-mono text-xs font-semibold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
              KHO_HOI_CHO_2026
            </span>
          </p>
          <p class="text-xs text-slate-600 mt-0.5">
            Kho đã sẵn sàng hoạt động. Bạn có muốn chuyển hàng loạt sách vào kho này ngay bây giờ?
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1.5 cursor-pointer">
          <span>⇄</span> Chuyển hàng vào kho này
        </button>
        <button class="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition text-xs font-bold">
          ✕
        </button>
      </div>
    </div>

    <!-- Matrix Table placeholder -->
    <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden p-6 space-y-3">
      <div class="flex justify-between items-center text-xs font-bold text-slate-700 border-b pb-3">
        <span>Ma Trận Tồn Kho Các Kho Hiện Tại</span>
        <span class="font-mono text-slate-500">Tổng cộng: 4 kho đang hoạt động</span>
      </div>
      <div class="text-xs text-slate-500 italic">
        (Bảng ma trận tồn kho hiển thị bình thường bên dưới, dữ liệu kho mới đã sẵn sàng trong danh sách)
      </div>
    </div>
  </div>
</body>
</html>`;

const batchHtmlPath = path.join(tempDir, 'batch-transfer-preview.html');
const warehouseCtaHtmlPath = path.join(tempDir, 'warehouse-cta-preview.html');
const tempShot1 = path.join(tempDir, 'shot1.png');
const tempShot2 = path.join(tempDir, 'shot2.png');

fs.writeFileSync(batchHtmlPath, batchTransferHtml, 'utf8');
fs.writeFileSync(warehouseCtaHtmlPath, warehouseCtaHtml, 'utf8');

const repoReportDir = path.join(__dirname, '..', 'reports', 'wave2-batch-transfer');
if (!fs.existsSync(repoReportDir)) {
  fs.mkdirSync(repoReportDir, { recursive: true });
}

console.log('Capturing BatchTransferModal screenshot...');
execSync(`"${chromePath}" --headless=new --no-sandbox --disable-gpu --window-size=1024,800 --screenshot="${tempShot1}" "file:///${batchHtmlPath.replace(/\\\\/g, '/')}"`);
fs.copyFileSync(tempShot1, path.join(artifactDir, 'batch-transfer-bulk-ui.png'));
fs.copyFileSync(tempShot1, path.join(repoReportDir, 'batch-transfer-bulk-ui.png'));
console.log('✓ Saved batch-transfer-bulk-ui.png (artifacts & repo)');

console.log('Capturing Warehouse CTA screenshot...');
execSync(`"${chromePath}" --headless=new --no-sandbox --disable-gpu --window-size=1100,600 --screenshot="${tempShot2}" "file:///${warehouseCtaHtmlPath.replace(/\\\\/g, '/')}"`);
fs.copyFileSync(tempShot2, path.join(artifactDir, 'warehouse-creation-cta-ui.png'));
fs.copyFileSync(tempShot2, path.join(repoReportDir, 'warehouse-creation-cta-ui.png'));
console.log('✓ Saved warehouse-creation-cta-ui.png (artifacts & repo)');
