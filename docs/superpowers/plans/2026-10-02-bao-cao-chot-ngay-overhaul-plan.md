# Overhaul Báo Cáo Chốt Ngày + Trạng Thái Hội Chợ — Kế hoạch triển khai

> ## ⛔ CẢNH BÁO — ĐÃ SỬA 03/10/2026, ĐỌC TRƯỚC KHI LÀM THEO
>
> Bản gốc của plan này viết `QR_TRANSFER` / `COUNTER_TRANSFER` cho `payment_method`.
> **Hai giá trị đó không tồn tại trong hệ thống** — nó là nguyên nhân khiến
> `pendingQr` luôn = 0 mà test vẫn xanh (vì test dùng *cùng* giá trị sai).
> Giá trị thật lấy từ `src/db/schema.ts` `orders.paymentMethod`:
> **`CASH` | `BANK_TRANSFER` | `QR_CODE`** (kèm `TRANSFER` cũ vẫn được chấp nhận).
>
> Đã sửa 3 chỗ trong plan. Code thật ở `src/services/daily-settlement.service.ts:122`
> đã đúng từ trước. **Không sửa ngược lại thành giá trị cũ.**
> Chi tiết bài học: `docs/superpowers/plans/2026-10-02-trang-thai-toan-bo.md` mục 10.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở Báo Cáo Chốt Ngày là thấy ngay tiền thu + két có khớp không; bản in có đủ bảng "sắp hết" và xếp mọi bảng theo tồn bé → lớn; Trạng Thái Hội Chợ chọn được 1 kho / 1 ngày và nhận 2 khối "bán chạy" chuyển sang.

**Architecture:** Một helper thuần `src/lib/stocktake-order.ts` xử lý sắp xếp/lọc tồn (test được không cần DOM). Service `daily-settlement` trả thêm `pendingQrTotal` (lọc đơn chờ, loại quá hạn 48h). UI dùng lại helper cho cả màn hình lẫn bản in ⇒ giấy luôn khớp màn.

**Tech Stack:** Next.js 14 App Router, React 18, Tailwind, Drizzle ORM + libSQL (Turso), TypeScript, script test Node (`node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-10-02-bao-cao-chot-ngay-va-trang-thai-hoi-cho-design.md`

## Global Constraints

- Không đổi công thức `grossSales / netSales / totalDiscount`.
- Không đụng nghiệp vụ hủy đơn chờ, không đụng `PENDING_TTL_HOURS = 48`.
- Ngày nghiệp vụ: giờ Việt Nam (`businessDateOf` trong `order.service.ts`). `daily-settlement` ĐÃ dùng `vnDayEquals` — không đổi logic, chỉ sửa comment sai.
- Dùng chung `STOCK_THRESHOLD_WARNING = 5` từ `src/lib/stock-highlight.ts`, không hardcode.
- Tên hiển thị tiếng Việt CÓ DẤU, ngắn, nút là động từ ngắn.
- Mỗi hành động phải có dấu hiệu bấm rõ: icon + viền + `aria-label` + trạng thái sau khi bấm.
- Deploy chỉ khi cây nguồn sạch: `git status --porcelain` rỗng. Không deploy khi còn việc của agent khác.
- Ngày nghiệp vụ VN là hằng UTC+7, không DST.

## Review Focus

1. **Đơn chờ quá hạn 48h**: dòng PENDING_CONFIRMATION còn nằm trong DB nhưng ATP đã nhả chỗ → phải loại khỏi `pendingQrTotal`, nếu không số tiền chờ bị thổi phồng.
2. **Đơn chờ tiền mặt**: không được tính vào dòng "QR chờ xác nhận".
3. **Đơn chờ qua nửa đêm**: 23:50 hôm qua không được lọt vào báo cáo hôm nay.
4. **Bản in lệch màn hình**: bảng IV và bảng V phải cùng quy tắc xếp tồn bé → lớn, kể cả khi người dùng đang bật/tắt bộ lọc trên màn.
5. **Tổng tiền bị đọc sai**: dòng "đang chờ" phải tách khối, không cộng tay được vào Thực thu.

---

## Task 1: Trường `pendingQrTotal` trong service

**Files:**
- Modify: `src/services/daily-settlement.service.ts` (thêm truy vấn sau khối `dayOrders`, dòng ~86; thêm vào object `return` ở dòng ~552)
- Test: `scripts/test-pending-qr-total.ts` (mới) + đăng ký trong `scripts/run-isolated.ts`

**Interfaces:**
- Consumes: `OrderService.isPendingExpired(order)` (đã export, static), `vnDayEquals(col, day)` (đã có trong file), `STOCK_THRESHOLD_WARNING` không dùng ở task này.
- Produces: `paymentBreakdown.pendingQr: { total: number; ordersCount: number }` trong response của `DailySettlementService.getDailyFairSettlement`.

- [ ] **Step 1: Viết test đỏ**

Tạo `scripts/test-pending-qr-total.ts`, theo khuôn của `scripts/test-s4-settlement.ts`:

```ts
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_pending_qr.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-pending-qr-total');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');
  const { OrderService } = await import('../src/services/order.service');
  const { businessDateOf } = await import('../src/services/order.service');

  const client = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(client, { schema });

  const WH = 'wh-au-co';
  await db.insert(schema.warehouses).values({ id: WH, code: 'KHO_AU_CO', name: 'Kho test', isActive: true });
  await db.insert(schema.works).values({ id: 'w1', code: 'W1', title: 'Sách 1', author: 'A' });
  await db.insert(schema.editions).values({ id: 'e1', code: 'E1', workId: 'w1', isbn: '9786040000001', isbnLast4: '0001', coverPrice: 100000 });

  const vnToday = businessDateOf(new Date());
  const vnYesterday = businessDateOf(new Date(Date.now() - 24 * 3600_000));
  // createdAt ở 23:50 VN hôm qua = 16:50 UTC hôm qua.
  const yesterdayLate = new Date(Date.now() - 7 * 3600_000).toISOString();

  const mk = async (id: string, over: any) => {
    await db.insert(schema.orders).values({
      id, code: id.toUpperCase(), orderCode: id.toUpperCase(), warehouseId: WH,
      status: 'PENDING_CONFIRMATION', paymentMethod: 'BANK_TRANSFER',
      subtotal: 100000, discountAmount: 0, finalAmount: 100000,
      createdAt: new Date().toISOString(), ...over,
    } as any);
    await db.insert(schema.orderItems).values({
      id: `${id}-i`, orderId: id, editionId: 'e1', productId: 'e1', quantity: 1, unitPrice: 100000, totalAmount: 100000,
    } as any);
  };

  await mk('o-live', {});                                                   // chờ, còn hạn → TÍNH
  await mk('o-expired', { paymentExpiresAt: '2000-01-01T00:00:00.000Z' });  // quá hạn → LOẠI
  await mk('o-cash', { paymentMethod: 'CASH' });                            // tiền mặt chờ → LOẠI
  await mk('o-yesterday', { createdAt: yesterdayLate });                    // ngoài ngày → LOẠI
  await mk('o-done', { status: 'COMPLETED', paymentMethod: 'BANK_TRANSFER' }); // đã chốt → LOẠI

  const r: any = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: vnToday });
  assert.equal(r.paymentBreakdown.pendingQr.ordersCount, 1, 'chỉ đúng 1 đơn QR còn hạn trong ngày');
  assert.equal(r.paymentBreakdown.pendingQr.total, 100000, 'tiền chờ = finalAmount của đơn đó');
  assert.equal(r.financials.netSales, 100000, 'đơn đã COMPLETED vẫn vào Thực thu như cũ');
  console.log('✓ test-pending-qr-total PASS');
}
run().catch((e) => { console.error('✗ FAIL', e); process.exit(1); });
```

- [ ] **Step 2: Chạy test, phải đỏ**

Run: `npx tsx scripts/test-pending-qr-total.ts`
Expected: FAIL với `Cannot read properties of undefined (reading 'pendingQr')`.

- [ ] **Step 3: Cài đặt tối thiểu**

Trong `src/services/daily-settlement.service.ts`, ngay sau khối tính `dayOrders` (sau dòng 85), thêm:

```ts
    // 2b. Đơn CHUYỂN KHOẢN đang chờ xác nhận trong ngày (D4).
    // BÁO CÁO KHÔNG ĐƯỢC CỘNG khoản này vào Thực thu — nó chưa ghi nhận.
    // Bắt buộc loại đơn quá hạn: TTL là 48h và đơn hết hạn VẪN CÒN trong DB
    // với status PENDING_CONFIRMATION (chỉ đổi sang CANCELLED khi ai đó bấm
    // xác nhận, order.service.ts:1645), trong khi ATP đã nhả giữ chỗ từ lâu
    // (order.service.ts:1007). Tính bằng SUM thuần sẽ thổi phồng số tiền chờ.
    const pendingRows = await txOrDb
      .select({
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        createdAt: orders.createdAt,
        paymentExpiresAt: orders.paymentExpiresAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.warehouseId, warehouseId),
          eq(orders.status, 'PENDING_CONFIRMATION'),
          vnDayEquals(orders.createdAt, targetDate)
        )
      );

    let pendingQrTotal = 0;
    let pendingQrCount = 0;
    for (const r of pendingRows) {
      const method = (r.paymentMethod || '').toUpperCase();
      if (method !== 'BANK_TRANSFER' && method !== 'QR_CODE' && method !== 'TRANSFER') continue;
      if (OrderService.isPendingExpired(r)) continue;
      pendingQrTotal += r.finalAmount || 0;
      pendingQrCount++;
    }
```

Thêm vào `return`, ngay sau khối `qrTransfer` (dòng ~558):

```ts
        pendingQr: {
          total: pendingQrTotal,
          ordersCount: pendingQrCount,
        },
```

- [ ] **Step 4: Chạy lại, phải xanh**

Run: `npx tsx scripts/test-pending-qr-total.ts`
Expected: PASS.

- [ ] **Step 5: Đăng ký suite + chạy cùng suite cũ để chắc không vỡ**

Thêm `'scripts/test-pending-qr-total.ts',` vào mảng `ALL_SUITES` trong `scripts/run-isolated.ts`.

Run: `npx tsx scripts/run-isolated.ts --only=test-pending-qr-total,test-s4-settlement,test-settlement`
Expected: cả 3 xanh.

- [ ] **Step 6: Commit**

```bash
git add src/services/daily-settlement.service.ts scripts/test-pending-qr-total.ts scripts/run-isolated.ts
git commit -m "feat(settlement): them paymentBreakdown.pendingQr, loai don cho qua han 48h"
```

---

## Task 2: Helper thuần cho sắp xếp/lọc tồn

**Files:**
- Create: `src/lib/stocktake-order.ts`
- Test: `scripts/test-stocktake-order.ts` (mới) + đăng ký trong `scripts/run-isolated.ts`

**Interfaces:**
- Consumes: `STOCK_THRESHOLD_WARNING` từ `src/lib/stock-highlight.ts`.
- Produces:
  - `type StocktakeRow = { editionId?: string; code?: string | null; theoreticalStock?: number | null }`
  - `sortByStock<T extends { theoreticalStock?: number | null }>(rows: T[], dir: 'ASC' | 'DESC'): T[]`
  - `filterLowStock<T extends { theoreticalStock?: number | null }>(rows: T[]): T[]`
  - `sortLabel(dir: 'ASC' | 'DESC'): string` → `'Bé → Lớn'` | `'Lớn → Bé'`

- [ ] **Step 1: Viết test đỏ**

```ts
// scripts/test-stocktake-order.ts
import assert from 'node:assert/strict';
import {
  sortByStock,
  filterLowStock,
  sortLabel,
} from '../src/lib/stocktake-order';
import { STOCK_THRESHOLD_WARNING } from '../src/lib/stock-highlight';

const rows = [
  { code: 'C', theoreticalStock: 12 },
  { code: 'A', theoreticalStock: 0 },
  { code: 'B', theoreticalStock: 3 },
  { code: 'D', theoreticalStock: null },
  { code: 'E', theoreticalStock: 5 },
];

const asc = sortByStock(rows, 'ASC').map((r) => r.code);
assert.deepEqual(asc, ['D', 'A', 'B', 'E', 'C'], 'null coi như tồn 0, xếp bé trước');
assert.deepEqual(sortByStock(rows, 'DESC').map((r) => r.code), ['C', 'E', 'B', 'A', 'D']);
assert.deepEqual(sortByStock(rows, 'ASC').map((r) => r.code), asc, 'không mutate mảng gốc');
assert.equal(rows[0].code, 'C', 'mảng gốc không bị đổi');

assert.deepEqual(filterLowStock(rows).map((r) => r.code), ['D', 'A', 'B', 'E'], `lọc ≤ ${STOCK_THRESHOLD_WARNING}`);
assert.deepEqual(filterLowStock([]), []);

assert.equal(sortLabel('ASC'), 'Bé → Lớn');
assert.equal(sortLabel('DESC'), 'Lớn → Bé');
console.log('✓ test-stocktake-order PASS');
```

- [ ] **Step 2: Chạy, phải đỏ**

Run: `npx tsx scripts/test-stocktake-order.ts`
Expected: FAIL — `Cannot find module '../src/lib/stocktake-order'`.

- [ ] **Step 3: Cài đặt**

```ts
// src/lib/stocktake-order.ts
import { STOCK_THRESHOLD_WARNING } from './stock-highlight';

export type StocktakeRow = {
  code?: string | null;
  theoreticalStock?: number | null;
};

/** Tồn null/undefined = 0: ấn phẩm chưa có dòng tồn phải nằm đầu danh sách đếm. */
const stockOf = (r: { theoreticalStock?: number | null }): number => Number(r.theoreticalStock || 0);

/**
 * Sắp theo tồn lý thuyết. Trùng tồn → xếp theo mã để bản in ổn định giữa
 * hai lần mở (không có tie-break thì thứ tự là thứ tự DB trả về).
 */
export function sortByStock<T extends { theoreticalStock?: number | null }>(rows: T[], dir: 'ASC' | 'DESC'): T[] {
  const sign = dir === 'ASC' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const diff = (stockOf(a) - stockOf(b)) * sign;
    if (diff !== 0) return diff;
    return (a.code || '').localeCompare(b.code || '');
  });
}

export function filterLowStock<T extends { theoreticalStock?: number | null }>(rows: T[]): T[] {
  return rows.filter((r) => stockOf(r) <= STOCK_THRESHOLD_WARNING);
}

export function sortLabel(dir: 'ASC' | 'DESC'): string {
  return dir === 'ASC' ? 'Bé → Lớn' : 'Lớn → Bé';
}
```

- [ ] **Step 4: Chạy, phải xanh**

Run: `npx tsx scripts/test-stocktake-order.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stocktake-order.ts scripts/test-stocktake-order.ts
git commit -m "feat(lib): helper sap xep/loc ton dung chung cho man hinh va ban in"
```

---

## Task 3: Đầu tab "Tiền & Két" — tiền lên trên cùng

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx` (thay khối 728-899, thêm dòng két + dòng đang chờ)
- Test: `scripts/test-settlement-money-header.ts` (mới, kiểm source) + đăng ký

**Interfaces:**
- Consumes: `paymentBreakdown.pendingQr` (Task 1), `cashboxReconciliation.{expectedCashTotal, cashVariance, cashVariancePending}` (đã có sẵn).
- Produces: hàm cục bộ `MoneyHeader({ data })` trong cùng file, dùng ở tab FINANCIALS.

**Vì dùng test kiểm source:** đây là JSX thuần, không có DOM harness trong repo; các test UI sẵn có cũng kiểm source bằng regex (xem `scripts/test-order-code-13.ts`).

- [ ] **Step 1: Viết test đỏ**

```ts
// scripts/test-settlement-money-header.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('src/components/pos/DailyFairSettlementModal.tsx', 'utf8');

const iHeader = src.indexOf('function MoneyHeader');
const iKpi = src.indexOf('KPI Cards');
assert.ok(iHeader > 0, 'phải có hàm MoneyHeader');
assert.ok(iKpi === -1, 'không còn khối "KPI Cards" cũ nằm giữa đơn lớn nhất và phần còn lại');

const moneyBlock = src.slice(iHeader, src.indexOf('{activeTab === \'STOCKTAKE\'', iHeader) || src.length);
assert.ok(moneyBlock.includes('pendingQr'), 'đầu tab phải hiện tiền đang chờ');
assert.ok(moneyBlock.includes('expectedCashTotal'), 'đầu tab phải hiện tiền kỳ vọng trong két');
assert.ok(moneyBlock.includes('Thực thu'), 'số chủ đạo là Thực thu');
assert.ok(
  moneyBlock.indexOf('Thực thu') < moneyBlock.indexOf('Bán chạy nhất'),
  'tiền phải nằm trước dòng bán chạy'
);
console.log('✓ test-settlement-money-header PASS');
```

- [ ] **Step 2: Chạy, phải đỏ**

Run: `npx tsx scripts/test-settlement-money-header.ts`
Expected: FAIL — `phải có hàm MoneyHeader`.

- [ ] **Step 3: Thêm `MoneyHeader` và gắn vào đầu tab**

Trong `DailyFairSettlementModal.tsx`, thêm hàm con ngay trước component chính:

```tsx
  /**
   * Đầu tab Tiền & Két: số chủ đạo + 4 ô phụ + 2 dòng trạng thái.
   * Tách riêng `pendingQr` vì đó là tiền CHƯA ghi nhận — không cộng vào Thực thu.
   */
  function MoneyHeader({ data: any }: { data: any }) {
    const f = data?.financials || {};
    const pb = data?.paymentBreakdown || {};
    const rec = data?.cashboxReconciliation || {};
    const pending = pb.pendingQr || { total: 0, ordersCount: 0 };
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-slate-500">
              Thực thu ngày {data?.reportDate || ''}
            </p>
            <p className="text-3xl font-black font-mono text-emerald-700 leading-tight">
              {(f.netSales || 0).toLocaleString('vi-VN')} đ
            </p>
          </div>
          <span
            className={`px-2 py-1 rounded-lg text-[11px] font-bold ${
              data?.hasOpenSession ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {data?.hasOpenSession ? '⚠ Còn ca chưa chốt' : '✓ Đã chốt ca 100%'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[11px] font-bold text-slate-500">Tiền mặt</p>
            <p className="font-mono font-black text-sm text-emerald-700">{(pb.cash?.sales || 0).toLocaleString('vi-VN')} đ</p>
            <p className="text-[10px] text-slate-400">{pb.cash?.ordersCount || 0} đơn</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[11px] font-bold text-slate-500">Chuyển khoản</p>
            <p className="font-mono font-black text-sm text-indigo-700">{(pb.qrTransfer?.sales || 0).toLocaleString('vi-VN')} đ</p>
            <p className="text-[10px] text-slate-400">{pb.qrTransfer?.ordersCount || 0} đơn</p>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
            <p className="text-[11px] font-bold text-rose-700">Chiết khấu đã cấp</p>
            <p className="font-mono font-black text-sm text-rose-700">−{(f.totalDiscount || 0).toLocaleString('vi-VN')} đ</p>
            <p className="text-[10px] text-rose-600 font-semibold">tương đương {((f.averageDiscountRate || 0) * 100).toFixed(1)}%</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[11px] font-bold text-slate-500">Số đơn</p>
            <p className="font-mono font-black text-sm text-slate-900">{f.totalOrdersCount || 0} đơn</p>
            <p className="text-[10px] text-slate-400">TB {(f.averageOrderValue || 0).toLocaleString('vi-VN')} đ</p>
          </div>
        </div>

        <p className="text-xs font-bold flex items-center gap-1.5">
          <span className={rec.cashVariancePending ? 'text-amber-700' : Number(rec.cashVariance) === 0 ? 'text-emerald-700' : 'text-rose-700'}>
            {rec.cashVariancePending
              ? '⏳ Chưa thể đối soát két (còn ca mở hoặc chưa đếm tiền thực tế)'
              : Number(rec.cashVariance) === 0
                ? '✓ Tiền kỳ vọng trong két khớp thực tế'
                : `⚠ Lệch két ${(rec.cashVariance || 0).toLocaleString('vi-VN')} đ`}
          </span>
          {!rec.cashVariancePending && (
            <span className="font-mono text-slate-600">{(rec.expectedCashTotal || 0).toLocaleString('vi-VN')} đ</span>
          )}
        </p>

        {pending.ordersCount > 0 && (
          <p className="text-xs font-bold text-amber-700">
            ⏳ {pending.ordersCount} đơn chuyển khoản chờ xác nhận — {(pending.total || 0).toLocaleString('vi-VN')} đ (chưa ghi nhận vào Thực thu)
          </p>
        )}
      </div>
    );
  }
```

Rồi trong tab `FINANCIALS`, đặt `<MoneyHeader data={data} />` làm khối ĐẦU TIÊN, xoá khối `Đơn Giá Trị Cao Nhất` (728-774), xoá khối KPI cũ (847-899), xoá `Cơ Cấu Phương Thức Thanh Toán` (911-954), và thay bằng một dòng bán chạy nhất đặt SAU `HourlyOrdersChart`:

```tsx
      {(data?.topSellers || []).length > 0 && (
        <p className="text-xs font-bold text-slate-600">
          Bán chạy nhất hôm nay: [{data.topSellers[0].code}] {data.topSellers[0].title} · {data.topSellers[0].soldCopies} cuốn
        </p>
      )}
```

- [ ] **Step 4: Chạy test, phải xanh**

Run: `npx tsx scripts/test-settlement-money-header.ts`
Expected: PASS.

- [ ] **Step 5: Kiểm kiểu**

Run: `npx tsc --noEmit`
Expected: 0 lỗi. Nếu còn lỗi TS2802 ở file của agent khác thì ghi nhận, không sửa file đó.

- [ ] **Step 6: Commit**

```bash
git add src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-money-header.ts scripts/run-isolated.ts
git commit -m "feat(pos): day tab 'Tien & Ket' - thuc thu len dau, ket + don cho, bo don lon nhat/top10"
```

---

## Task 4: Bỏ nút "Đơn vị CK", bản in có 2 bảng xếp theo tồn

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx`
  - bỏ `discountDisplayMode` (state 171, nút 675-687, dùng ở 859/861/1402/1424)
  - `stocktakeSortMode` (190) khởi tạo `'ASC'`, xoá nhánh `'DEFAULT'`
  - xoá 2 đoạn tự nhảy ASC (1203-1205, và rút gọn handler 1198-1208)
  - dùng `sortedStocktakeList` = `sortByStock(filterLowStock(...))` khi có lọc
  - bản in: `soldOnlyRows` xếp theo tồn (393) + thêm bảng V mới sau bảng IV
- Test: `scripts/test-settlement-print-stocktake.ts` (mới) + đăng ký

**Interfaces:**
- Consumes: `sortByStock`, `filterLowStock`, `sortLabel` (Task 2).
- Produces: bảng in `V. SẮP HẾT (TỒN ≤ 5) — CẦN ĐẾM CUỐI NGÀY`.

- [ ] **Step 1: Viết test đỏ**

```ts
// scripts/test-settlement-print-stocktake.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('src/components/pos/DailyFairSettlementModal.tsx', 'utf8');

assert.ok(!src.includes('discountDisplayMode'), 'đã bỏ hoàn toàn nút đơn vị chiết khấu');
assert.ok(!src.includes("stocktakeSortMode === 'DEFAULT'"), 'không còn chế độ Mặc định');
assert.ok(
  /useState<'ASC' \| 'DESC'>\('ASC'\)/.test(src),
  'sắp xếp kiểm kê mặc định là Bé → Lớn'
);
assert.ok(src.includes('SẮP HẾT'), 'bản in có bảng sắp hết');
assert.ok(src.includes('CẦN ĐẾM CUỐI NGÀY'), 'bảng sắp hết nói rõ dùng để đếm');
assert.ok(src.includes('Số đếm thực tế'), 'bảng sắp hết có cột để nhân viên điền tay');
assert.ok(src.includes('sortByStock'), 'màn hình và bản in dùng chung hàm sắp xếp');
assert.ok(
  src.indexOf('sortByStock(soldOnlyRows') > 0,
  'bảng đã bán cũng xếp theo tồn'
);
console.log('✓ test-settlement-print-stocktake PASS');
```

- [ ] **Step 2: Chạy, phải đỏ**

Run: `npx tsx scripts/test-settlement-print-stocktake.ts`
Expected: FAIL — `đã bỏ hoàn toàn nút đơn vị chiết khấu`.

- [ ] **Step 3: Bỏ nút đơn vị chiết khấu**

- Xoá state `discountDisplayMode` và toàn bộ 4 chỗ dùng nó.
- Ô KPI chiết khấu trong `MoneyHeader` đã hiện cả hai số (Task 3) — không cần chỗ nào khác.
- Bảng tab Chiết Khấu (khoảng 1402/1424): mỗi ô gồm 2 dòng —
  `<strong>{money}</strong>` + `<span className="text-[10px] text-slate-400">{percent}</span>`.

- [ ] **Step 4: Đổi sắp xếp kiểm kê**

```tsx
  const [stocktakeSortMode, setStocktakeSortMode] = useState<'ASC' | 'DESC'>('ASC');
```

Memo `sortedStocktakeList` dùng helper:

```tsx
  const sortedStocktakeList = useMemo(() => {
    const list = Array.isArray(data?.inventoryReconciliation) ? data.inventoryReconciliation : [];
    const base = stocktakeOnlyLow ? filterLowStock(list) : list;
    return sortByStock(base, stocktakeSortMode);
  }, [data?.inventoryReconciliation, stocktakeSortMode, stocktakeOnlyLow]);
```

Nút sắp xếp đổi thành 2 trạng thái:

```tsx
onClick={() => setStocktakeSortMode((prev) => (prev === 'ASC' ? 'DESC' : 'ASC'))}
```

Nhãn dùng `sortLabel(stocktakeSortMode)` (có dấu mũi tên → nhân viên không phải đoán).

Xoá đoạn tự nhảy ASC khi bật lọc (1203-1205) và khi mở tab.

- [ ] **Step 5: Bản in**

Đổi `soldOnlyRows` (393) thành đã xếp:

```tsx
  const soldOnlyRows: any[] = sortByStock(
    (data?.inventoryReconciliation || []).filter((it: any) => Number(it.soldToday || 0) > 0),
    'ASC'
  );
  const lowStockRows: any[] = filterLowStock(data?.inventoryReconciliation || []);
```

Thêm ngay sau bảng IV (sau dòng 1752) bảng mới:

```tsx
              <div className="print-block mb-4 font-sans">
                <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1 mb-2.5 tracking-wide text-[13px]">
                  V. SẮP HẾT (TỒN ≤ {STOCK_THRESHOLD_WARNING}) — CẦN ĐẾM CUỐI NGÀY
                </h3>
                <table className="w-full border-collapse border border-slate-300 text-[11.5px]">
                  <thead>
                    <tr className="bg-slate-100 font-semibold text-slate-800 text-center">
                      <th className="border border-slate-300 py-1 px-2 w-10">#</th>
                      <th className="border border-slate-300 py-1 px-2 w-20">Mã</th>
                      <th className="border border-slate-300 py-1 px-2 text-left">Tên ấn phẩm</th>
                      <th className="border border-slate-300 py-1 px-2 w-24 text-right">Tồn còn</th>
                      <th className="border border-slate-300 py-1 px-2 w-28 text-center">Số đếm thực tế</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="border border-slate-300 py-2 px-2 text-center text-slate-500 italic">
                          Không có ấn phẩm nào tồn ≤ {STOCK_THRESHOLD_WARNING} cuốn.
                        </td>
                      </tr>
                    ) : (
                      lowStockRows.map((it: any, idx: number) => (
                        <tr key={it.editionId}>
                          <td className="border border-slate-300 py-1 px-2 text-center font-mono text-slate-600">{idx + 1}</td>
                          <td className="border border-slate-300 py-1 px-2 text-center font-mono font-bold text-slate-900">{it.code}</td>
                          <td className="border border-slate-300 py-1 px-2 text-slate-900">{it.title}</td>
                          <td className="border border-slate-300 py-1 px-2 text-right font-mono font-bold text-slate-900">
                            {it.theoreticalStock}
                          </td>
                          <td className="border border-slate-300 py-1 px-2" />
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <p className="text-[11.5px] italic mt-1 text-slate-600">
                  Xếp theo tồn bé → lớn. Số đếm thực tế do nhân viên điền tay — hệ thống chưa lưu số đếm.
                </p>
              </div>
```

Thêm import `STOCK_THRESHOLD_WARNING` từ `@/lib/stock-highlight` nếu chưa có.

- [ ] **Step 6: Chạy test + kiểu**

Run: `npx tsx scripts/test-settlement-print-stocktake.ts` → PASS
Run: `npx tsc --noEmit` → 0 lỗi của file này.

- [ ] **Step 7: Commit**

```bash
git add src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-print-stocktake.ts scripts/run-isolated.ts
git commit -m "feat(pos): bo nut don vi chiết khau, mac dinh xep ton be->lon, ban in them bang 'sap het'"
```

---

## Task 5: Thanh tab dính đầu + chân modal có nút In

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx` (thay thanh tab 638-697; thêm footer trước `</div>` ngoài cùng; thêm `sessionStorage` cho `activeTab`)
- Test: gộp vào `scripts/test-settlement-money-header.ts` (thêm assert)

- [ ] **Step 1: Thêm assert vào test đỏ**

```ts
assert.ok(src.includes('sessionStorage'), 'nhớ tab đang xem qua sessionStorage');
assert.ok(src.includes('sticky'), 'thanh tab và chân modal phải dính');
```

- [ ] **Step 2: Chạy, phải đỏ**

Run: `npx tsx scripts/test-settlement-money-header.ts` → FAIL.

- [ ] **Step 3: Sửa state để nhớ tab**

```tsx
  const [activeTab, setActiveTab] = useState<'FINANCIALS' | 'STOCKTAKE' | 'DISCOUNT'>('FINANCIALS');
  // Nhớ tab đang xem: đóng modal mở lại không nên mất chỗ đang đọc.
  useEffect(() => {
    const saved = sessionStorage.getItem('formapubli.settlement.tab');
    if (saved === 'FINANCIALS' || saved === 'STOCKTAKE' || saved === 'DISCOUNT') setActiveTab(saved);
  }, []);
  useEffect(() => {
    sessionStorage.setItem('formapubli.settlement.tab', activeTab);
  }, [activeTab]);
```

- [ ] **Step 4: Thay thanh tab**

```tsx
        <div className="no-print sticky top-0 z-10 px-3 sm:px-6 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 bg-slate-200/60 p-1 rounded-xl" role="tablist">
            {([
              { key: 'FINANCIALS', label: 'Tiền & Két', icon: Banknote },
              { key: 'STOCKTAKE', label: 'Kiểm Kê', icon: Boxes },
              { key: 'DISCOUNT', label: 'Chiết Khấu', icon: ShieldAlert },
            ] as const).map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === t.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                <t.icon className="w-4 h-4" />
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
```

Nút tải lại và nút in cũ chuyển xuống chân modal (bước 5).

- [ ] **Step 5: Thêm chân modal dính**

Ngay trước thẻ đóng ngoài cùng của modal, sau khối in:

```tsx
        <div className="no-print sticky bottom-0 shrink-0 px-3 sm:px-6 py-2 bg-slate-900 text-white flex items-center justify-between gap-2">
          <button
            onClick={fetchSettlement}
            disabled={isLoading}
            aria-label="Tải lại số liệu báo cáo"
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-slate-700 transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={isLoading || !data}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-50 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>In Báo Cáo</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Đóng báo cáo"
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-700 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
```

- [ ] **Step 6: Chạy test + kiểu**

Run: `npx tsx scripts/test-settlement-money-header.ts` → PASS
Run: `npx tsc --noEmit` → 0 lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-money-header.ts
git commit -m "feat(pos): thanh tab segmented dan dau, chan modal co nut In, nho tab da xem"
```

---

## Task 6: Trạng Thái Hội Chợ — chọn kho/ngày + nhận 2 khối chuyển sang

**Files:**
- Modify: `src/components/dashboard/LiveFairMonitorModal.tsx` (thêm state + 2 select; thêm 2 khối Đơn lớn nhất / Top 10)
- Modify: `src/components/dashboard/ExecutiveDashboard.tsx:861` (truyền `warehouseId` hiện chọn)
- Modify: `src/app/api/pos/live-monitor/route.ts:18-20` (sửa comment sai "báo cáo chốt ngày dùng ngày UTC")
- Test: `scripts/test-live-monitor-scope.ts` (mới) + đăng ký

**Interfaces:**
- Consumes: `?warehouseId=` và `?date=` của `live-monitor/route.ts` (đã có sẵn).
- Produces: props `LiveFairMonitorModal({ isOpen, onClose, initialWarehouseId? })`, kho nhớ ở `localStorage` key `formapubli.liveMonitor.warehouseId`.

- [ ] **Step 1: Viết test đỏ**

```ts
// scripts/test-live-monitor-scope.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('src/components/dashboard/LiveFairMonitorModal.tsx', 'utf8');
const route = fs.readFileSync('src/app/api/pos/live-monitor/route.ts', 'utf8');

assert.ok(ui.includes('formapubli.liveMonitor.warehouseId'), 'phải nhớ kho đã chọn');
assert.ok(!ui.includes('formapubli.liveMonitor.date'), 'KHÔNG nhớ ngày — mở nhầm ngày cũ là rủi ro hiểu sai');
assert.ok(ui.includes('date='), 'phải gửi ngày đang xem lên API');
assert.ok(ui.includes('warehouseId='), 'phải gửi kho đang chọn lên API');
assert.ok(ui.includes('Đơn Lớn Nhất') || ui.includes('Đơn Giá Trị Cao Nhất'), 'nhận khối đơn lớn nhất');
assert.ok(ui.includes('Bán Chạy') || ui.includes('bán chạy'), 'nhận khối top bán chạy');
assert.ok(
  !route.includes('ngày UTC'),
  'comment cũ nói báo cáo ngày dùng UTC là SAI — cả hai đã dùng ngày VN'
);
console.log('✓ test-live-monitor-scope PASS');
```

- [ ] **Step 2: Chạy, phải đỏ**

Run: `npx tsx scripts/test-live-monitor-scope.ts`
Expected: FAIL.

- [ ] **Step 3: Thêm chọn kho/ngày vào LiveFairMonitorModal**

```tsx
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; name: string }[]>([]);

  // Chỉ nhớ KHO. Không nhớ ngày: mở nhầm ngày cũ khiến người dùng tưởng hôm
  // nay chưa bán được gì — nguy hiểm hơn nhiều so với phải bấm chọn ngày.
  useEffect(() => {
    const saved = localStorage.getItem('formapubli.liveMonitor.warehouseId');
    if (saved) setWarehouseId(saved);
  }, []);
  useEffect(() => {
    if (warehouseId) localStorage.setItem('formapubli.liveMonitor.warehouseId', warehouseId);
  }, [warehouseId]);
```

URL fetch:

```tsx
const qs = new URLSearchParams();
if (warehouseId) qs.set('warehouseId', warehouseId);
qs.set('date', date);
fetch(`/api/pos/live-monitor?${qs.toString()}`)
```

UI chọn (đặt trên đầu modal, cạnh tiêu đề):

```tsx
<div className="flex flex-wrap items-center gap-2">
  <select
    aria-label="Chọn kho hội chợ"
    value={warehouseId}
    onChange={(e) => setWarehouseId(e.target.value)}
    className="text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-300 bg-white"
  >
    <option value="">Tất cả kho hội chợ</option>
    {warehouseOptions.map((w) => (
      <option key={w.id} value={w.id}>{w.name}</option>
    ))}
  </select>
  <input
    type="date"
    aria-label="Chọn ngày"
    value={date}
    onChange={(e) => setDate(e.target.value)}
    className="text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-300 bg-white"
  />
</div>
```

Tiêu đề phải luôn nói rõ đang xem ngày nào (tránh tưởng là hôm nay):

```tsx
<p className="text-[11px] sm:text-xs text-slate-400">
  {date}{warehouseId ? ' · ' + (warehouseOptions.find((w) => w.id === warehouseId)?.name || warehouseId) : ' · Tất cả kho hội chợ'}
</p>
```

- [ ] **Step 4a: Thêm `largestOrder` vào API live-monitor**

Live-monitor **không** có trường đơn lớn nhất, nên không dùng `recentClosed` (đó là "đơn vừa đóng gần đây", không phải đơn lớn nhất trong ngày). Thêm một khối truy vấn đúng theo khuôn `topRows` sẵn có, rồi đưa vào `return`:

```ts
    // Đơn giá trị cao nhất trong ngày đang xem — chuyển từ Báo Cáo Chốt Ngày
    // sang đây vì nó thuộc loại "đang bán gì", không phải quyết toán tiền.
    const largestRow = await db
      .select({
        orderCode: orders.orderCode,
        finalAmount: orders.finalAmount,
        paymentMethod: orders.paymentMethod,
        itemCount: sql<number>`COUNT(${orderItems.id})`,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(
        and(
          inArray(orders.warehouseId, scopeIds),
          eq(orders.status, 'COMPLETED'),
          vnDayEq(orders.createdAt, date)
        )
      )
      .groupBy(orders.id)
      .orderBy(desc(orders.finalAmount))
      .limit(1);
```

`vnDayEq(col, date)` đã có sẵn trong chính file route (dòng 49) — dùng đúng hàm đó, không viết lại biểu thức `substr(datetime(...,'+7 hours'))`. Import `desc` chỉ khi chưa có trong danh sách import của route.

Trong `return`, thêm cạnh `topSellers`:

```ts
        largestOrder: largestRow.length
          ? {
              orderCode: largestRow[0].orderCode,
              finalAmount: Number(largestRow[0].finalAmount || 0),
              paymentMethod: largestRow[0].paymentMethod,
              itemCount: Number(largestRow[0].itemCount || 0),
              createdAt: largestRow[0].createdAt,
              warehouseName: whName(largestRow[0].warehouseId),
            }
          : null,
```

- [ ] **Step 4b: Dán 2 khối vào LiveFairMonitorModal**

- "Top bán chạy": dùng `data.topSellers` — **tên trường khác** so với bản trong báo cáo ngày: ở đây là `copies`/`revenue` (không phải `soldCopies`/`soldRevenue`). Copy khối UI, đổi tên trường.
- "Đơn lớn nhất": dùng `data.largestOrder`. Bỏ thanh ngang "% chiếm doanh thu thực thu" (không có mẫu số ở đây); thay bằng dòng nhỏ "chiếm X% doanh thu hôm nay" tính từ `data.today.revenue`.
- Cả hai đặt ở CUỐI nội dung monitor, sau danh sách đơn chờ.

- [ ] **Step 5: Sửa comment sai + truyền prop từ dashboard**

- `live-monitor/route.ts` dòng 18-20: đổi đoạn "Ngày nghiệp vụ theo GIỜ VIỆT NAM. Báo cáo chốt ngày dùng ngày UTC — hai nơi có thể lệch nhau trong khung 00:00-07:00" thành: "Ngày nghiệp vụ theo GIỜ VIỆT NAM, giống hệt `businessDateOf` mà báo cáo chốt ngày dùng — hai nơi KHÔNG lệch nhau."
- `ExecutiveDashboard.tsx:861`: `<LiveFairMonitorModal isOpen={isLiveMonitorOpen} onClose={...} />` — thêm `initialWarehouseId={selectedFairWarehouseId}` nếu dashboard đang có biến kho hội chợ đang chọn; không có thì bỏ qua prop này.

- [ ] **Step 6: Chạy test + kiểu**

Run: `npx tsx scripts/test-live-monitor-scope.ts` → PASS
Run: `npx tsc --noEmit` → 0 lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/LiveFairMonitorModal.tsx src/components/dashboard/ExecutiveDashboard.tsx src/app/api/pos/live-monitor/route.ts scripts/test-live-monitor-scope.ts scripts/run-isolated.ts
git commit -m "feat(dashboard): trang thai hoi cho chon kho/ngay, nho kho, nhan khoi ban chay"
```

---

## Task 7: Đồng bộ tài liệu + kiểm chứng tổng thể

**Files:**
- Modify: `docs/superpowers/plans/2026-10-02-trang-thai-toan-bo.md` (mục kết quả mới)

- [ ] **Step 1: Chạy toàn bộ suite liên quan**

Run: `npx tsx scripts/run-isolated.ts --only=test-pending-qr-total,test-settlement,test-s4-settlement,test-stocktake-order`
Expected: tất cả PASS. Không hạ assertion.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: thành công (bỏ qua cảnh báo EPERM symlink standalone — đã biết, không chặn).

- [ ] **Step 3: Nghiệm thu tay trên điện thoại** (dùng `npm run dev:https` nếu cần camera; không cần camera cho các bước này)

1. Mở Báo Cáo Chốt Ngày → phải thấy Thực thu ngay đầu, không phải cuộn.
2. Có dòng két và dòng đơn chờ (nếu có đơn QR chờ).
3. Tab Kiểm Kê mở ra đã xếp tồn bé → lớn ngay, không cần bấm.
4. Bấm `In Báo Cáo` → giấy có mục IV (đã bán) và V (sắp hết), cả hai xếp tồn bé → lớn.
5. Mở Trạng Thái Hội Chợ → chọn 1 kho, chọn ngày; đóng lại mở tiếp thì kho còn đúng chọn, ngày về hôm nay.

- [ ] **Step 4: Cập nhật tài liệu + commit**

```bash
git add docs/superpowers/plans/2026-10-02-trang-thai-toan-bo.md
git commit -m "docs(pos): ghi ket qua overhaul bao cao chot ngay + trang thai hoi cho"
```

- [ ] **Step 5: Báo cáo, KHÔNG tự deploy**

Báo lại version/commit và **chờ chủ duyệt deploy** (deploy chỉ chạy khi `git status --porcelain` rỗng và không còn việc của agent khác trong cây nguồn).