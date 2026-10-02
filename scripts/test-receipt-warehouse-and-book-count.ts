/**
 * BIÊN LAI: tên kho xuất + tổng số sách — hai lỗi đã đo trên production.
 *
 * Bối cảnh (đơn hội chợ 02/10/2026, đọc trực tiếp production):
 *   - Kho thật là `wh-kho-hoi-cho-ho-guom` / `wh-kho-dh-ha-noi-thang-10-2026`,
 *     không nằm trong bảng tra cứng cứng ở màn biên lai ⇒ mọi đơn hội chợ in tên
 *     kho của kho KHÁC ("Kho Quỳnh Mai").
 *   - ORD261002000V: 1 cuốn sách (135.000đ) + 1 quà hàng hóa là bookmark
 *     (`order_items.edition_id = NULL`) ⇒ `totalQuantity = 2`, phiếu ghi "2 cuốn".
 *
 * Test này khoá lại CẢ HAI quy tắc, và khoá luôn nguyên tắc quan trọng hơn: không
 * bao giờ bịa tên kho. Sai tên kho trên phiếu là sai chỗ giao hàng.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveReceiptSummary } from '../src/lib/receipt-summary';

const ROOT = process.cwd();
let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};

const WAREHOUSES = [
  { id: 'wh-au-co', name: 'Kho 1 - Âu Cơ (Văn phòng chính & Xuất lẻ)' },
  { id: 'wh-quynh-mai', name: 'Kho 2 - Quỳnh Mai (Kho Tổng & Lưu kho sỉ)' },
  { id: 'wh-du-phong', name: 'Kho 3 - Dự phòng (Hội chợ & Lưu động)' },
  { id: 'wh-kho-hoi-cho-ho-guom', name: 'Hội chợ Hồ gươm' },
  { id: 'wh-kho-dh-ha-noi-thang-10-2026', name: 'ĐH Hà Nôi thang 10/2026' },
];

async function main() {
  // ---------- 1. TÊN KHO ----------
  ok(
    resolveReceiptSummary({ warehouseId: 'wh-kho-hoi-cho-ho-guom' }, WAREHOUSES).warehouseName ===
      'Hội chợ Hồ gươm',
    'kho hội chợ phải hiện tên thật, không phải tên kho văn phòng'
  );
  ok(
    resolveReceiptSummary({ warehouseId: 'wh-kho-dh-ha-noi-thang-10-2026' }, WAREHOUSES)
      .warehouseName === 'ĐH Hà Nôi thang 10/2026',
    'kho ĐH Hà Nội tháng 10/2026 phải hiện tên thật'
  );
  // Không kho nào được hiện nhầm tên của kho khác — đây là lỗi gốc đã sảy ra.
  for (const wh of WAREHOUSES) {
    const shown = resolveReceiptSummary({ warehouseId: wh.id }, WAREHOUSES).warehouseName;
    ok(shown === wh.name, `kho ${wh.id} không được hiện nhầm tên kho khác (đang hiện "${shown}")`);
  }

  // Không tra được tên thì hiện MÃ kho — không được bịa, không được rơi về một
  // tên kho bất kỳ.
  ok(
    resolveReceiptSummary({ warehouseId: 'wh-kho-moi-2027' }, WAREHOUSES).warehouseName ===
      'wh-kho-moi-2027',
    'kho lạ (chưa có trong danh sách) phải hiện MÃ kho để người đọc tra được'
  );
  ok(
    resolveReceiptSummary({ warehouseId: undefined }, WAREHOUSES).warehouseName === 'Kho không rõ',
    'không có kho thì nói rõ là không rõ, không đoán bừa'
  );
  ok(
    resolveReceiptSummary(
      { warehouseId: 'wh-au-co', warehouseName: 'Hội chợ Hồ gươm' },
      WAREHOUSES
    ).warehouseName === 'Hội chợ Hồ gươm',
    'tên kho do server gửi kèm được ưu tiên hơn tra cứu cục bộ'
  );

  // ---------- 2. TỔNG SỐ SÁCH ----------
  // Đơn thật ORD261002000V: 1 sách + 1 quà bookmark.
  ok(
    resolveReceiptSummary(
      { warehouseId: 'wh-kho-hoi-cho-ho-guom', totalQuantity: 2, bookQuantity: 1 },
      WAREHOUSES
    ).bookQuantity === 1,
    'đơn 1 cuốn + 1 quà hàng hóa phải hiện "1 cuốn", không phải "2 cuốn"'
  );
  ok(
    resolveReceiptSummary({ totalQuantity: 3 }, WAREHOUSES).bookQuantity === 3,
    'đơn không có bookQuantity (offline/phiên cũ) thì lùi về totalQuantity, không in rỗng'
  );
  ok(
    resolveReceiptSummary({ totalQuantity: 2, bookQuantity: 0 }, WAREHOUSES).bookQuantity === 0,
    'bookQuantity = 0 là số thật (đơn chỉ có hàng hóa) — không được thay bằng totalQuantity'
  );
  ok(
    resolveReceiptSummary(null, WAREHOUSES).bookQuantity === 0,
    'không có đơn thì số sách = 0, không phải NaN'
  );

  // ---------- 3. HAI BÊN DÙNG CHUNG MỘT QUY TẮC ----------
  const terminal = fs.readFileSync(
    path.resolve(ROOT, 'src/components/pos/PosCheckoutTerminal.tsx'),
    'utf8'
  );
  ok(
    /resolveReceiptSummary\(completedOrder, sellableWarehouses\)/.test(terminal),
    'màn biên lai phải lấy tên kho + số sách qua resolveReceiptSummary (một nguồn sự thật)'
  );
  ok(
    !/'Kho Quỳnh Mai'/.test(terminal) && !/'Kho Âu Cơ'\s*:/.test(terminal),
    'không được còn bảng tra tên kho viết tay trong màn biên lai'
  );
  ok(
    /receiptOrder\?\.warehouseName/.test(terminal) &&
      /receiptOrder\?\.bookQuantity/.test(terminal),
    'màn biên lai phải hiện tên kho và số sách đã qua resolveReceiptSummary'
  );

  const thermal = fs.readFileSync(path.resolve(ROOT, 'src/lib/thermalReceipt.ts'), 'utf8');
  ok(
    /warehouseName\?:\s*string/.test(thermal),
    'phiếu in phải nhận warehouseName từ POS thay vì tự tra bảng cứng'
  );
  ok(
    !/KNOWN_WAREHOUSE_NAMES/.test(thermal),
    'phiếu in không được còn bảng tra tên kho cứng (sai với kho hội chợ)'
  );
  ok(
    /order\.bookQuantity \?\? order\.totalQuantity/.test(thermal),
    '"Tổng số lượng sách" trên phiếu in phải ưu tiên bookQuantity'
  );

  console.log(`\n=== BIÊN LAI: TÊN KHO + TỔNG SỐ SÁCH: ${checks} assertions PASS ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});