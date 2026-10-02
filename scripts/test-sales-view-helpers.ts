/**
 * KHÓA HÀNH VI helper dùng chung cho màn Doanh Số (Task 4).
 *
 * CHẠY: npx tsx scripts/test-sales-view-helpers.ts   (thuần, KHÔNG cần DB)
 *
 * VÌ SAO CÓ FILE NÀY:
 *   1. `monthPreset` trước đây là 30 ngày trượt ⇒ nút "Tháng này" báo cáo cả
 *      tháng trước. Người dùng đối chiếu với két thì lệch mà không có chỗ nào
 *      chỉ ra lệch.
 *   2. `lastNDays(7)` trước đây là hôm nay trừ 7 ⇒ 8 ngày. Cùng lý do.
 *   3. Giờ hiển thị cắt chuỗi UTC ⇒ đơn 07:30 VN hiện thành 00:30.
 *   4. Nhãn kênh map rời rạc mỗi file, và map kho fallback bịa tên ⇒ đọc sổ ra
 *      tên kho không tồn tại.
 *
 * Đây là CONTRACT cho Task 5/6 dùng lại — đổi chữ ký/tên ở đây là phá 2 task sau.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  monthPreset,
  lastNDays,
  channelLabel,
  buildSalesCsv,
  vnHour,
  paymentLabel,
  fiscalScopeLabel,
} from '../src/lib/sales-view';

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else {
    failures++;
    console.error(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  }
}

/** Số ngày lịch tính cả hai đầu (2026-09-26 → 2026-10-02 = 7 ngày). */
function inclusiveDays(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return ms / 86400000 + 1;
}

console.log('\n=== DOANH SỐ: HELPER DÙNG CHUNG (ngày VN / nhãn kênh / CSV) ===');

// ---------------------------------------------------------------------------
// 1. monthPreset = THÁNG LỊCH Việt Nam, không phải 30 ngày trượt.
// ---------------------------------------------------------------------------
assert.deepEqual(monthPreset(new Date('2026-10-02T10:00:00+07:00')), {
  startDate: '2026-10-01',
  endDate: '2026-10-02',
});
ok(true, '1. monthPreset(02/10) = 01/10 → 02/10 (tháng lịch, không trượt 30 ngày)');

assert.deepEqual(monthPreset(new Date('2026-10-01T00:30:00+07:00')), {
  startDate: '2026-10-01',
  endDate: '2026-10-01',
});
ok(true, '2. monthPreset ngày 1 = 01/10 → 01/10 (không lùi sang tháng trước)');

// Mốc biên: 20:00 UTC 30/09 = 03:00 VN 01/10. Tính theo UTC sẽ ra tháng 9.
assert.deepEqual(monthPreset(new Date('2026-09-30T20:00:00Z')), {
  startDate: '2026-10-01',
  endDate: '2026-10-01',
});
ok(true, '3. monthPreset tính theo GIỜ VN (20:00Z 30/09 = 03:00 VN 01/10 → tháng 10)');

// ---------------------------------------------------------------------------
// 2. lastNDays = đúng n ngày lịch, tính cả hôm nay.
// ---------------------------------------------------------------------------
const week = lastNDays(7, new Date('2026-10-02T10:00:00+07:00'));
assert.deepEqual(week, { startDate: '2026-09-26', endDate: '2026-10-02' });
assert.equal(inclusiveDays(week.startDate, week.endDate), 7);
ok(true, '4. lastNDays(7) = 26/09 → 02/10, đúng 7 ngày (không phải 8)', `span = ${inclusiveDays(week.startDate, week.endDate)} ngày`);

const today = lastNDays(1, new Date('2026-10-02T10:00:00+07:00'));
assert.deepEqual(today, { startDate: '2026-10-02', endDate: '2026-10-02' });
ok(true, '5. lastNDays(1) = hôm nay');

const month = lastNDays(30, new Date('2026-10-02T10:00:00+07:00'));
assert.equal(inclusiveDays(month.startDate, month.endDate), 30);
ok(true, '6. lastNDays(30) đúng 30 ngày lịch', `${month.startDate} → ${month.endDate}`);

// Qua tháng/năm không được trượt: 03/01 trừ 2 ngày = 01/01 cùng năm.
const crossMonth = lastNDays(3, new Date('2026-01-03T09:00:00+07:00'));
assert.deepEqual(crossMonth, { startDate: '2026-01-01', endDate: '2026-01-03' });
ok(true, '7. lastNDays lùi qua ranh giới tháng đúng (03/01 → 01/01)');

// ---------------------------------------------------------------------------
// 3. channelLabel: tiếng Việt có dấu, KHÔNG lộ enum.
// ---------------------------------------------------------------------------
assert.equal(channelLabel('FAIR_EVENT'), 'Tại quầy hội chợ');
assert.equal(channelLabel('RETAIL_OFFICE'), 'Tại quầy');
assert.equal(channelLabel('RETAIL_ONLINE_SOCIAL'), 'Facebook Chat');
assert.equal(channelLabel('RETAIL_ONLINE_WEB'), 'Website');
assert.equal(channelLabel('WHOLESALE_PARTNER'), 'Bán sỉ');
assert.equal(channelLabel('ONLINE'), 'Online');
ok(true, '8. channelLabel dịch đủ 6 kênh chính sang tiếng Việt có dấu');

assert.equal(channelLabel(null), '—');
assert.equal(channelLabel(''), '—');
ok(true, '9. channelLabel(null/rỗng) = "—"');

const unknown = channelLabel('PARTNER_V2_X');
ok(
  unknown !== 'PARTNER_V2_X' && !/[A-Z_]{4,}/.test(unknown),
  '10. channelLabel kênh lạ KHÔNG lộ enum (fallback tiếng Việt)',
  `→ "${unknown}"`
);

assert.equal(paymentLabel('CASH'), 'Tiền mặt');
assert.equal(paymentLabel('BANK_TRANSFER'), 'Chuyển khoản');
assert.equal(paymentLabel('QR_CODE'), 'QR');
assert.equal(paymentLabel(null), '—');
assert.equal(paymentLabel('MOBA_COD_V2'), '—');
ok(true, '10b. paymentLabel dịch tiếng Việt, không lộ enum');

assert.equal(fiscalScopeLabel('OFFICIAL_TAX'), 'Hóa đơn VAT');
assert.equal(fiscalScopeLabel('INTERNAL_MANAGEMENT'), 'Sổ Quản trị Nội bộ');
assert.equal(fiscalScopeLabel(null), 'Sổ Quản trị Nội bộ');
ok(true, '10c. fiscalScopeLabel dịch tiếng Việt, không lộ enum');

// ---------------------------------------------------------------------------
// 4. vnHour: HH:mm DD/MM theo GIỜ VIỆT NAM.
// ---------------------------------------------------------------------------
assert.equal(vnHour('2026-10-01T18:30:00.000Z'), '01:30 02/10');
ok(true, '11. vnHour(18:30Z) = 01:30 02/10 giờ VN (+7, qua nửa đêm)');

assert.equal(vnHour('2026-10-01T09:05:00.000Z'), '16:05 01/10');
ok(true, '12. vnHour(09:05Z) = 16:05 01/10 giờ VN');

assert.equal(vnHour(null), '—');
ok(true, '13. vnHour(null) = "—"');

assert.equal(vnHour('2026-10-01T17:00:00.000Z'), '00:00 02/10');
ok(true, '14. vnHour nửa đêm VN = "00:00" (không nhảy sang "24:00")');

// ---------------------------------------------------------------------------
// 5. buildSalesCsv: header có dấu, kênh tiếng Việt, watermark đúng người xuất.
// ---------------------------------------------------------------------------
const csv = buildSalesCsv(
  [
    {
      orderCode: 'DH2601001',
      warehouseName: 'Kho 3 - Hội Chợ (Sự kiện)',
      channel: 'FAIR_EVENT',
      customerName: 'Nguyễn Thị Lan, đại diện',
      paymentMethod: 'CASH',
      subtotal: 120000,
      discountAmount: 12000,
      finalAmount: 108000,
      fiscalScope: 'OFFICIAL_TAX',
      vatInvoiceCode: '',
      createdAt: '2026-10-01T18:30:00.000Z',
    },
  ],
  'nv-bich'
);

const headerLine = csv.split('\r\n')[0];
for (const h of ['Mã đơn', 'Kho', 'Kênh', 'Thanh toán', 'Tiền hàng', 'Chiết khấu (VND)', 'Thực thu', 'Sổ', 'Giờ VN']) {
  ok(headerLine.includes(h), `15. Header CSV có cột "${h}"`, headerLine);
}

const headerOrder = ['Mã đơn', 'Kho', 'Kênh', 'Thanh toán', 'Tiền hàng', 'Chiết khấu (VND)', 'Thực thu', 'Sổ', 'Giờ VN'].map((h) =>
  headerLine.indexOf(h)
);
ok(
  headerOrder.every((i, idx) => i >= 0 && (idx === 0 || i > headerOrder[idx - 1])),
  '16. Các cột bắt buộc đúng THỨ TỰ trong header',
  headerLine
);

ok(csv.includes('"Nguyễn Thị Lan, đại diện"'), '17. Ô chứa DẤU PHẨY được bọc nháy kép');
ok(csv.includes('Tại quầy hội chợ'), '18. Cột Kênh hiện tiếng Việt, không lộ enum FAIR_EVENT');
ok(!csv.includes('FAIR_EVENT'), '19. CSV không chứa enum kênh thô');
ok(csv.includes('01:30 02/10'), '20. Cột "Giờ VN" dùng giờ Việt Nam');
ok(csv.includes('Exported By: [nv-bich]'), '21. Watermark ghi ĐÚNG người xuất (actorId thật)');
ok(!csv.includes('cashier-pos'), '22. Không còn actorId giả "cashier-pos"');
ok(csv.includes('Sổ Kế Toán Thuế') || csv.includes('Hóa đơn VAT'), '23. Cột Sổ hiện tiếng Việt');

// Field chứa XUỐNG DÒNG phải được bọc nháy kép, nếu không Excel sẽ vỡ bảng.
const csvMultiLine = buildSalesCsv(
  [
    {
      orderCode: 'DH2601002',
      warehouseName: 'Kho 1 - Âu Cơ (VP chính)',
      channel: 'RETAIL_OFFICE',
      customerName: 'Trần\nThị Hai',
      paymentMethod: 'BANK_TRANSFER',
      subtotal: 50000,
      finalAmount: 50000,
      fiscalScope: 'INTERNAL_MANAGEMENT',
      vatInvoiceCode: '00012345',
      createdAt: '2026-10-02T02:00:00.000Z',
    },
  ],
  'nv-bich'
);
ok(csvMultiLine.includes('"Trần\nThị Hai"'), '24. Ô chứa XUỐNG DÒNG được bọc nháy kép');

// Cột chiết khấu: kế toán đối chiếu sổ cần SỐ TIỀN giảm, không chỉ tỷ lệ.
const csvFirstDataLine = csv.split('\r\n')[1];
assert.ok(csvFirstDataLine.includes(',12000,'), 'CSV phải có ô chiết khấu bằng SỐ TIỀN');
ok(true, '24b. Cột "Chiết khấu (VND)" chứa số tiền giảm (12000)', csvFirstDataLine);
// Không có cột CK trong input ⇒ ra 0, không `NaN`/`undefined`.
const csvNoDiscount = buildSalesCsv(
  [{ orderCode: 'DH-0', warehouseName: 'K', channel: 'ONLINE', subtotal: 1000, finalAmount: 1000 }],
  'nv-bich'
);
ok(!/NaN|undefined/.test(csvNoDiscount), '24c. Thiếu `discountAmount` ⇒ ra 0, không NaN/undefined');

// Chống Excel formula injection: text bắt đầu = + - @ phải có dấu nháy bảo vệ.
const csvFormula = buildSalesCsv(
  [
    {
      orderCode: '=CMD()',
      warehouseName: '@handle',
      channel: 'ONLINE',
      customerName: null,
      paymentMethod: 'CASH',
      subtotal: 0,
      finalAmount: 0,
      fiscalScope: 'INTERNAL_MANAGEMENT',
      vatInvoiceCode: '',
      createdAt: null,
    },
  ],
  'nv-bich'
);
ok(csvFormula.includes(`"'=CMD()"`) && csvFormula.includes(`"'@handle"`), '25. Chặn formula injection (=, +, -, @)');

// Danh sách rỗng vẫn phải ra header + watermark, KHÔNG ném lỗi.
const csvEmpty = buildSalesCsv([], 'nv-bich');
ok(
  csvEmpty.split('\r\n')[0].includes('Mã đơn') && csvEmpty.includes('Total Records: [0]'),
  '26. buildSalesCsv([]) vẫn có header + watermark, không lỗi'
);

// ---------------------------------------------------------------------------
// 6. KHÓA: thẻ tổng không được nháy "0 đơn" trong lúc đang tải, và nhãn
//    "thẻ tổng theo kho/ngày/sổ" phải LUÔN hiện (không chỉ khi có slicer).
//    Đây là lỗi reviewer nhặt ở vòng review 1 — canh ở source vì trạng thái
//    loading chỉ tồn tại vài chục ms nên test trình duyệt bắt không ổn định.
// ---------------------------------------------------------------------------
// Đọc theo convention repo (`path.resolve(process.cwd(), …)` như
// test-sales-ledger-vn-day.ts) chứ KHÔNG dùng `import.meta.url`: repo không
// khai báo `"type"` trong package.json nên đây là CJS, và `import.meta.url`
// bị tsc từ chối khi biên dịch `--module commonjs` (TS1343) — mọi assert đọc
// source phía sau sẽ chết theo.
const LEDGER_SRC = readFileSync(
  path.resolve(process.cwd(), 'src/components/sales/SalesLedgerView.tsx'),
  'utf8'
);
ok(
  /loading\s*&&\s*!summary/.test(LEDGER_SRC) && /Đang tải…/.test(LEDGER_SRC),
  '27. Lúc skeleton bật (loading && !summary) phải hiện "Đang tải…", KHÔNG hiện "0 đơn hoàn tất"'
);
ok(
  /Thẻ tổng theo kho\/ngày\/sổ/.test(LEDGER_SRC) &&
    !/channelSlicer !== 'ALL' \|\| searchQuery/.test(LEDGER_SRC),
  '28. Nhãn "thẻ tổng theo kho/ngày/sổ" hiện LUÔN, không điều kiện theo slicer'
);
// Bỏ comment trước khi quét: chính comment giải thích "vì sao gỡ" lại chứa
// chữ `window.print()` và "In Phiếu" ⇒ quét thẳng sẽ báo đỏ giả.
const LEDGER_CODE = LEDGER_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');
ok(
  !/window\.print\(/.test(LEDGER_CODE) && !/In Phiếu/.test(LEDGER_CODE),
  '29. Nút "In Phiếu" (window.print — in trang trắng) đã gỡ khỏi component'
);
ok(
  /discountAmount: Number\(ord\.discountAmount \|\| 0\)/.test(LEDGER_SRC),
  '30. Component truyền `discountAmount` vào buildSalesCsv (cột Chiết khấu)'
);
ok(
  /Chưa tải được danh mục kho — tải lại trang/.test(LEDGER_SRC) &&
    !/Chưa tải được danh mục kho — bấm "Làm mới"/.test(LEDGER_SRC),
  '31. Hint kho rỗng nói "tải lại trang" (nút Làm mới không nạp lại /api/warehouses)'
);

// ---------------------------------------------------------------------------
// 7. Task 5 — CSV giữ DÒNG SPONSORSHIP RIÊNG, không gộp vào doanh thu bán.
//    Lỗi gốc: ai cũng lọc `channel !== 'SPONSORSHIP'` rồi tổng ⇒ quà tài trợ
//    biến mất khỏi file, kế toán đối chiếu CSV với sổ thấy lệch mà không biết
//    lệch ở đâu. Dòng tài trợ phải CÒN trong file, 0đ, nhãn tiếng Việt.
// ---------------------------------------------------------------------------
const csvSponsored = buildSalesCsv(
  [
    {
      orderCode: 'DH-SPONSOR-1',
      warehouseName: 'Kho 3 - Hội Chợ (Sự kiện)',
      channel: 'SPONSORSHIP',
      customerName: 'Hội Chợ Xuân Hà Nội',
      paymentMethod: 'CASH',
      subtotal: 0,
      discountAmount: 0,
      finalAmount: 0,
      fiscalScope: 'INTERNAL_MANAGEMENT',
      vatInvoiceCode: '',
      createdAt: '2026-10-01T09:05:00.000Z',
    },
    {
      orderCode: 'DH-BAN-1',
      warehouseName: 'Kho 3 - Hội Chợ (Sự kiện)',
      channel: 'FAIR_EVENT',
      customerName: 'Nguyễn Văn A',
      paymentMethod: 'CASH',
      subtotal: 200000,
      discountAmount: 0,
      finalAmount: 200000,
      fiscalScope: 'INTERNAL_MANAGEMENT',
      vatInvoiceCode: '',
      createdAt: '2026-10-01T09:10:00.000Z',
    },
  ],
  'nv-bich'
);
const sponsoredLines = csvSponsored.split('\r\n');
const sponsorLine = sponsoredLines.find((l) => l.includes('DH-SPONSOR-1')) || '';
const sellLine = sponsoredLines.find((l) => l.includes('DH-BAN-1')) || '';
ok(sponsoredLines.length >= 3, '32. CSV giữ CẢ dòng SPONSORSHIP lẫn dòng bán (không lọc mất)', `số dòng = ${sponsoredLines.length - 1}`);
ok(sponsorLine.includes('"Tặng"'), '33. Dòng tài trợ hiện nhãn tiếng Việt "Tặng"', sponsorLine);
ok(
  sponsorLine.includes(',0,0,0,') && !sponsorLine.includes('200000'),
  '34. Dòng tài trợ giữ 0đ và KHÔNG bị gộp tiền của dòng bán',
  sponsorLine
);
ok(sellLine.includes(',200000,0,200000,'), '35. Dòng bán giữ nguyên tiền hàng/thực thu', sellLine);
ok(
  !/SPONSORSHIP/.test(csvSponsored),
  '36. File CSV không lộ enum SPONSORSHIP thô (tiếng Việt thay thế)'
);

// ---------------------------------------------------------------------------
// 8. Task 5 — RevenueAnalyticsPanel đi theo filter của tab, không tự đặt
//    filter riêng. Lỗi gốc: panel fetch `view=channels` TRẦN ⇒ số toàn lịch
//    sử đặt cạnh bảng đang lọc "7 ngày", người dùng đối chiếu thấy lệch.
//    Quét SOURCE (bỏ comment) vì trạng thái chỉ tồn tại vài chục ms —
//    test trình duyệt bắt không ổn định.
// ---------------------------------------------------------------------------
const PANEL_SRC = readFileSync(
  path.resolve(process.cwd(), 'src/components/sales/RevenueAnalyticsPanel.tsx'),
  'utf8'
);
/** Bỏ comment để quét không báo đỏ giả (chính comment giải thích lại chứa từ khoá). */
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
const PANEL_CODE = stripComments(PANEL_SRC);
const LEDGER_PANEL_CALL = LEDGER_CODE.match(/<RevenueAnalyticsPanel[\s\S]*?\/>/)?.[0] || '';

ok(
  /startDate:\s*string/.test(PANEL_CODE) && /endDate:\s*string/.test(PANEL_CODE) &&
    /warehouseId:\s*string/.test(PANEL_CODE) && /fiscalScope\?/.test(PANEL_CODE),
  '37. Panel NHẬN filter từ tab qua props (startDate/endDate/warehouseId/fiscalScope), không tự đặt'
);
ok(
  /set\('startDate'/.test(PANEL_CODE) && /set\('endDate'/.test(PANEL_CODE) &&
    /set\('warehouseId'/.test(PANEL_CODE) && /set\('fiscalScope'/.test(PANEL_CODE) &&
    // Query phải được GHÉP VÀO URL thật, không phải dựng rồi bỏ.
    /view=\$\{view\}/.test(PANEL_CODE) && /q\.toString\(\)/.test(PANEL_CODE),
  '38. Panel gửi kèm filter khi gọi /api/analytics (không fetch trần toàn lịch sử)'
);
ok(
  !/view=channels/.test(PANEL_CODE),
  '39. Không còn fetch view=channels trần (số toàn lịch sử đặt cạnh bảng lọc)'
);
ok(
  /startDate=\{startDate\}/.test(LEDGER_PANEL_CALL) &&
    /endDate=\{endDate\}/.test(LEDGER_PANEL_CALL) &&
    /warehouseId=\{selectedWarehouse\}/.test(LEDGER_PANEL_CALL),
  '40. Sổ Kép truyền filter ĐANG DÙNG xuống panel (dùng chung 1 state, không tạo state thứ hai)',
  LEDGER_PANEL_CALL.replace(/\s+/g, ' ')
);
ok(
  /channelLabel\(/.test(PANEL_CODE) && !/CHANNEL_LABELS/.test(PANEL_CODE),
  '41. Panel dùng `channelLabel` dùng chung, không còn map nhãn kênh cứng trong file'
);
ok(
  !/revenue-analytics/.test(PANEL_SRC),
  '42. Không còn actorId hằng số "revenue-analytics" trong watermark CSV'
);
ok(
  /actorId=\{actorId\}/.test(LEDGER_PANEL_CALL) && /actorId:\s*string/.test(PANEL_CODE),
  '43. Watermark CSV ký NGƯỜI THẬT (actorId từ Sổ Kép, đọc /api/auth/me)'
);
ok(
  /TỔNG/.test(PANEL_CODE),
  '44. Bảng có dòng TỔNG ở cuối (mọi con số trên màn hình cộng tay lại được)'
);
ok(
  /Tặng \/ Tài trợ/.test(PANEL_CODE) && /SPONSORSHIP/.test(PANEL_CODE),
  '45. Dòng tài trợ hiển thị RIÊNG, không gộp vào doanh thu bán'
);
ok(
  /salesRevenue/.test(PANEL_CODE),
  '46. Tổng doanh thu lấy từ cashflow.salesRevenue (server loại SPONSORSHIP), không tự cộng byChannel'
);
ok(
  /Đang tải/.test(PANEL_CODE) && /Chưa có đơn/.test(PANEL_CODE),
  '47. Panel có trạng thái loading và empty RIÊNG (không hiện số 0 giả)'
);
ok(
  /new AbortController\(\)/.test(PANEL_CODE),
  '48. Fetch của panel có AbortController (bấm liên tiếp nhiều preset không bị response cũ ghi đè)'
);

// ---------------------------------------------------------------------------
// 9. Task 6 — TopEditionsPanel + GiftReportPanel.
//    Cả hai là panel CLIENT nên trạng thái chỉ tồn tại vài chục ms: quét SOURCE
//    (bỏ comment) như mục 7/8, không dựng trình duyệt cho từng assertion.
//    Đây là contract đã khóa ở server (Task 2/3): client chỉ được ĐỌC đúng
//    shape đó, không tự tính lại (cộng tay) và không giấu quà vào bảng top.
// ---------------------------------------------------------------------------
const TOP_SRC = readFileSync(
  path.resolve(process.cwd(), 'src/components/sales/TopEditionsPanel.tsx'),
  'utf8'
);
const GIFT_SRC = readFileSync(
  path.resolve(process.cwd(), 'src/components/sales/GiftReportPanel.tsx'),
  'utf8'
);
const TOP_CODE = stripComments(TOP_SRC);
const GIFT_CODE = stripComments(GIFT_SRC);
const LEDGER_TOP_CALL = LEDGER_CODE.match(/<TopEditionsPanel[\s\S]*?\/>/)?.[0] || '';
const LEDGER_GIFT_CALL = LEDGER_CODE.match(/<GiftReportPanel[\s\S]*?\/>/)?.[0] || '';

// --- Top bán chạy ----------------------------------------------------------
ok(
  /warehouseId:\s*string/.test(TOP_CODE) && /actorId:\s*string/.test(TOP_CODE),
  '49. Top nhận kho + actorId THẬT từ tab (không tự đặt filter, không ký giả)'
);
ok(
  !/setHours\(/.test(TOP_CODE) && !/toISOString\(/.test(TOP_CODE) &&
    /startDate:\s*string/.test(TOP_CODE) && /endDate:\s*string/.test(TOP_CODE),
  '50. Top nhận ngày từ tab (startDate/endDate) và KHÔNG tự cắt ngày giờ máy (setHours/toISOString)'
);
ok(
  /set\('startDate'/.test(TOP_CODE) && /set\('endDate'/.test(TOP_CODE) &&
    /set\('warehouseId'/.test(TOP_CODE) && /'top-editions'/.test(TOP_CODE) &&
    /api\/analytics/.test(TOP_CODE),
  '51. Top gửi kho + khoảng ngày xuống /api/analytics (số khớp bảng đang lọc)'
);
ok(
  /totalGiftQty/.test(TOP_CODE) && /đã tặng/i.test(TOP_CODE),
  '52. Top hiện "đã tặng N cuốn" riêng (quà 0đ không lẫn vào bảng nhưng không bị giấu)'
);
// Nút refresh phải có CHỮ trong chính thẻ `<button>` (icon trần là "mảng chữ",
// người dùng không dám bấm). Quét từng thẻ button thay vì regex dotAll (cấu
// hình ts của repo chưa bật target es2018 ⇒ cờ `s` bị tsc chặi TS1501).
const TOP_BUTTONS = TOP_CODE.match(/<button[\s\S]*?<\/button>/g) || [];
ok(
  /<label[^>]*htmlFor="top-editions-n"/.test(TOP_CODE) &&
    TOP_BUTTONS.some((b) => /<RefreshCw[\s\S]*?\/>/.test(b) && /Tải lại/.test(b)),
  '53. Nút refresh CÓ NHÃN nhìn thấy (icon + "Tải lại") + select TopN có label htmlFor'
);
ok(
  !/type Preset/.test(TOP_CODE) && !/presetRange/.test(TOP_CODE) &&
    !/setPreset\(/.test(TOP_CODE) && !/lastNDays\(/.test(TOP_CODE) &&
    !/Hôm nay[\s\S]*?7 ngày qua[\s\S]*?30 ngày qua/.test(TOP_CODE),
  '53b. Top KHÔNG còn preset ngày riêng (hai bộ nút ngày trên một màn ⇒ số lệch nhau)'
);
ok(
  /Tiêu đề/.test(TOP_CODE) && /Kỳ lọc/.test(TOP_CODE) &&
    !/'Hang'/.test(TOP_CODE) && !/'Tieu de'/.test(TOP_CODE),
  '54. CSV Top có dấu + cột "Kỳ lọc" (không còn header không dấu Hang/Tieu de)'
);
ok(
  /actorId:\s*'top-editions'/.test(TOP_CODE) === false && /actorId=\{actorId\}/.test(LEDGER_TOP_CALL),
  '55. Watermark CSV Top ký NGƯỜI THẬT (actorId từ Sổ Kép, đã gỡ hằng số "top-editions")'
);
ok(
  /new AbortController\(\)/.test(TOP_CODE),
  '56. Fetch của Top có AbortController (bấm preset liên tiếp không hiện dữ liệu kỳ cũ)'
);

// --- Báo cáo quà -----------------------------------------------------------
ok(
  /from:\s*string/.test(GIFT_CODE) && /to:\s*string/.test(GIFT_CODE) &&
    /currentRole:\s*UserRole/.test(GIFT_CODE),
  '57. Panel Quà nhận from/to/currentRole từ tab (không tự đặt kỳ riêng)'
);
ok(
  /ROLE_OWNER/.test(GIFT_CODE) && /ROLE_MANAGER/.test(GIFT_CODE) &&
    /return null/.test(GIFT_CODE),
  '58. Panel Quà ẨN HẲN với vai khác (return null — không hộp đỏ 403 cho thu ngân/kế toán thuế)'
);
ok(
  /reports\/gifts/.test(GIFT_CODE) && /set\('from'/.test(GIFT_CODE) && /set\('to'/.test(GIFT_CODE),
  '59. Panel Quà gửi from/to (server lọc ngày VN + chỉ đơn COMPLETED)'
);
ok(
  /Thử lại/.test(GIFT_CODE) && /lineCount/.test(GIFT_CODE),
  '60. Panel Quà có nút "Thử lại" khi lỗi + hiện lineCount (số dòng quà thật)'
);
ok(
  /productName \|\||productName\s*\?\?/.test(GIFT_CODE),
  '61. Tên quà null hiện "—" thay vì trống/khoảng trắng'
);
ok(
  /totalDelivered/.test(GIFT_CODE) && /totalShortfall/.test(GIFT_CODE),
  '62. Tiêu đề lấy "đã phát" (totalDelivered), quà hết tồn hiện DÒNG RIÊNG (totalShortfall)'
);
ok(
  /new AbortController\(\)/.test(GIFT_CODE) && /abortRef\.current\?\.abort\(\)/.test(GIFT_CODE) &&
    /controller\.signal\.aborted/.test(GIFT_CODE),
  '62b. Fetch của panel Quà có AbortController + check aborted (đổi ngày tab liên tục không bị số kỳ cũ ghi đè)'
);
ok(
  /setTotalDelivered\(0\)/.test(GIFT_CODE) && /setTotalShortfall\(0\)/.test(GIFT_CODE) &&
    /setError\(/.test(GIFT_CODE),
  '62c. Nhánh LỖI của panel Quà XOÁ số đã tải (không để số kỳ cũ đứng cạnh nhãn kỳ mới)'
);
ok(
  /from=\{startDate\}/.test(LEDGER_GIFT_CALL) && /to=\{endDate\}/.test(LEDGER_GIFT_CALL) &&
    /currentRole=\{currentRole\}/.test(LEDGER_GIFT_CALL) &&
    /startDate=\{startDate\}/.test(LEDGER_TOP_CALL) && /endDate=\{endDate\}/.test(LEDGER_TOP_CALL) &&
    /warehouseId=\{selectedWarehouse\}/.test(LEDGER_TOP_CALL) &&
    /fiscalScope=\{/.test(LEDGER_TOP_CALL) &&
    /actorId=\{actorId\}/.test(LEDGER_TOP_CALL),
  '63. Sổ Kép truyền filter ĐANG DÙNG (kho + ngày + sổ) xuống cả 2 panel (một state, không state thứ hai)',
  `Gift: ${LEDGER_GIFT_CALL.replace(/\s+/g, ' ')} | Top: ${LEDGER_TOP_CALL.replace(/\s+/g, ' ')}`
);
ok(
  /params\.set\('fiscalScope', fiscalScope\)/.test(TOP_CODE),
  '63b. Top gửi fiscalScope xuống /api/analytics (Sổ Thuế chỉ thấy sách của đơn VAT)'
);

// --- Script vá DB dev: phải vá luôn cột 0032, không lúc nào lại 500 -------
const FIX_DEV_SRC = readFileSync(
  path.resolve(process.cwd(), 'scripts/fix-dev-db-schema.ts'),
  'utf8'
);
ok(
  /is_gift_shortfall/.test(FIX_DEV_SRC),
  '64. fix-dev-db-schema vá cột order_items.is_gift_shortfall (0032) — thiếu nó panel Quà lỗi SQL'
);

// ---------------------------------------------------------------------------
// 10. Task 7 — ExecutiveDashboard dùng chung đường ống (tháng VN + nhãn kỳ).
//    Lỗi gốc: fetch `/api/orders?fiscalScope=ALL` KHÔNG khoảng ngày ⇒ nạp toàn
//    bộ lịch sử vào RAM, số dashboard lệch tab Doanh Số đúng bằng số đơn tài trợ.
// ---------------------------------------------------------------------------
const DASH_SRC = readFileSync(
  path.resolve(process.cwd(), 'src/components/dashboard/ExecutiveDashboard.tsx'),
  'utf8'
);
const DASH_CODE = stripComments(DASH_SRC);
ok(
  /monthPreset/.test(DASH_CODE) && /sales-view/.test(DASH_SRC),
  '65. Dashboard lấy khoảng ngày từ helper tháng lịch dùng chung (không tự cắt ngày)'
);
ok(
  /startDate/.test(DASH_CODE) && /api\/orders\?/.test(DASH_SRC),
  '66. Fetch /api/orders của dashboard kèm startDate/endDate (không nạp toàn lịch sử)'
);
ok(
  /Kỳ /.test(DASH_SRC),
  '67. Dashboard hiện nhãn kỳ đang xem cạnh số tổng (không để số treo không kỳ)'
);

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Helper Doanh Số: ngày VN đúng tháng lịch, nhãn kênh tiếng Việt, CSV có dấu.');
