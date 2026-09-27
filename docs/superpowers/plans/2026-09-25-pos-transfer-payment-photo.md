# POS Transfer Payment Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổi luồng chuyển khoản/QR thành tạo đơn PENDING trước, hiển thị QR theo đơn thật, bắt buộc chụp ảnh màn hình khách trước khi cashier xác nhận, đồng thời hỗ trợ offline soft-hold và lưu ảnh cục bộ.

**Architecture:** Worker Kilo sửa migration, order state machine và API contract. Worker Cline sửa camera, IndexedDB, QR cache và POS UI. Hai worker làm trên worktree/branch riêng, không sửa chung file; coordinator cherry-pick theo thứ tự server trước client rồi chạy integration gate.

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM/libSQL SQLite, React 18, IndexedDB, `getUserMedia`, `qrcode`, node:test-style assertion scripts chạy qua `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-25-pos-transfer-payment-photo-design.md`

## Global Constraints

- Base commit cho cả hai worktree: `8efa6e2`.
- Không thêm dependency mới.
- Không OCR, không đọc nội dung ảnh, không gọi API ngân hàng.
- Ảnh không upload server và không phải bằng chứng kiểm toán.
- `BANK_TRANSFER`/`QR_CODE` tại quầy tạo `PENDING_CONFIRMATION` với hạn 30 phút.
- PENDING web/social cũ không có `payment_expires_at` tiếp tục dùng TTL 48 giờ.
- Cashier chỉ confirm/cancel PENDING của chính mình; Owner/Manager làm được mọi đơn.
- Confirm chuyển khoản/QR bắt buộc có `paymentProofId` và `paymentProofCapturedAt` ở request, nhưng server không thể xác minh ảnh.
- Offline không được ghi âm tồn; xung đột ATP giữ `NEEDS_RECONCILIATION`.
- Ảnh local: tối đa 100 ảnh thường hoặc 30 ngày; ảnh `NEEDS_RECONCILIATION` được miễn tự prune.
- Mỗi worker được commit trên branch riêng; không push, không merge, không sửa file thuộc worker khác.
- Không sửa `docs/superpowers/plans/2026-09-25-agent-a-review-verdict.md` hoặc `reports/wave3-pos-ui/*`.

## Review Focus

1. Camera bị từ chối hoặc thiếu thiết bị: đơn phải giữ PENDING, tuyệt đối không tự confirm.
2. Ghi ảnh vào IndexedDB thất bại: tuyệt đối không gọi API confirm.
3. Hai cashier cùng kho cùng bán cuốn sách cuối khi offline: đơn sync sau phải vào `NEEDS_RECONCILIATION`, tồn không được âm.
4. Retry confirm sau mất mạng: trả idempotent success nếu đã COMPLETED, không trừ kho lần hai.
5. Cache tài khoản ngân hàng quá 24 giờ: chặn QR offline, không hiển thị tài khoản có thể đã đổi.

## File Ownership

| Worker | Owned files |
|---|---|
| Kilo | `src/db/schema.ts`, `src/db/migrations/0022_pos_payment_expiry.sql`, `src/db/migrations/meta/_journal.json`, `src/services/order.service.ts`, `src/app/api/orders/route.ts`, `scripts/test-transfer-payment-flow.ts`, `scripts/test-online-orders.ts` |
| Cline | `src/lib/bank-account-cache.ts`, `src/lib/offline-db.ts`, `src/components/pos/VietQrPay.tsx`, `src/components/pos/TransferPaymentModal.tsx`, `src/components/pos/PaymentProofCamera.tsx`, `src/components/pos/PaymentPhotoGallery.tsx`, `src/components/pos/PosCheckoutTerminal.tsx`, `scripts/test-payment-photo-contract.ts`, `scripts/test-offline-engine.ts` |
| Coordinator integration | `scripts/run-isolated.ts`, cross-branch fixes after cherry-pick |

---

### Task 1: Kilo — Payment expiry migration and shared expiry rule

**Files:**
- Create: `src/db/migrations/0022_pos_payment_expiry.sql`
- Modify: `src/db/migrations/meta/_journal.json`
- Modify: `src/db/schema.ts:196-234`
- Modify: `src/services/order.service.ts:894-921,1090-1103`
- Create: `scripts/test-transfer-payment-flow.ts`

**Interfaces:**
- Produces: `orders.paymentExpiresAt: string | null` in Drizzle schema.
- Produces: `OrderService.getPendingEffectiveExpiry(order: { createdAt: string | null; paymentExpiresAt?: string | null }): Date | null`.
- Consumes: existing `PENDING_TTL_HOURS = 48`.

- [ ] **Step 1: Create the failing migration/expiry test**

Create `scripts/test-transfer-payment-flow.ts` with an isolated DB file and these first assertions:

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { migrateFresh } from './migrate-fresh';
import { assertIsolatedTestDb } from './test-guard';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_transfer_payment.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + suffix); } catch {}
}

async function run() {
  process.env.DATABASE_URL = `file:${DB_FILE.split(path.sep).join('/')}`;
  assertIsolatedTestDb('test-transfer-payment-flow');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  const raw = createClient({ url: process.env.DATABASE_URL });
  const columns = await raw.execute('PRAGMA table_info(orders)');
  const names = columns.rows.map((row: any) => row.name ?? row[1]);
  assert.ok(names.includes('payment_expires_at'), 'orders phải có payment_expires_at');

  const indexes = await raw.execute("SELECT name FROM sqlite_master WHERE type='index'");
  const indexNames = indexes.rows.map((row: any) => row.name ?? row[0]);
  assert.ok(indexNames.includes('idx_orders_payment_expires_at'));

  const { OrderService } = await import('../src/services/order.service');
  const explicit = new Date('2026-09-25T10:00:00.000Z');
  const legacy = new Date('2026-09-23T10:00:00.000Z');
  assert.equal(
    OrderService.getPendingEffectiveExpiry({ createdAt: explicit.toISOString(), paymentExpiresAt: '2026-09-25T10:30:00.000Z' })?.toISOString(),
    '2026-09-25T10:30:00.000Z'
  );
  assert.equal(
    OrderService.getPendingEffectiveExpiry({ createdAt: legacy.toISOString(), paymentExpiresAt: null })?.toISOString(),
    new Date(legacy.getTime() + 48 * 3600_000).toISOString()
  );

  raw.close();
  console.log('PAYMENT EXPIRY MIGRATION PASS');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx tsx scripts/test-transfer-payment-flow.ts
```

Expected: FAIL because migration `0022` and `getPendingEffectiveExpiry` do not exist.

- [ ] **Step 3: Add schema and migration**

Add to `orders` in `src/db/schema.ts`:

```ts
paymentExpiresAt: text('payment_expires_at'),
```

Create `src/db/migrations/0022_pos_payment_expiry.sql`:

```sql
ALTER TABLE `orders` ADD `payment_expires_at` text;
--> statement-breakpoint
CREATE INDEX `idx_orders_payment_expires_at` ON `orders` (`payment_expires_at`);
```

Append to `_journal.json`:

```json
{
  "idx": 22,
  "version": "6",
  "when": 1790400000000,
  "tag": "0022_pos_payment_expiry",
  "breakpoints": true
}
```

- [ ] **Step 4: Implement one shared expiry rule**

Add to `OrderService`:

```ts
static getPendingEffectiveExpiry(order: { createdAt: string | null; paymentExpiresAt?: string | null }): Date | null {
  if (!order.createdAt) return null;
  if (order.paymentExpiresAt) {
    const explicit = new Date(order.paymentExpiresAt);
    return Number.isNaN(explicit.getTime()) ? null : explicit;
  }
  return new Date(new Date(order.createdAt).getTime() + PENDING_TTL_HOURS * 3600_000);
}
```

Use this helper in `isPendingExpired`, `getATP`, and `cleanupExpiredPending`. The ATP query must count a PENDING row only while its effective expiry is greater than now. For the SQL batch path, select `orders.paymentExpiresAt` with the held quantities and filter in TypeScript using the shared helper.

- [ ] **Step 5: Run migration and expiry tests**

Run:

```powershell
npx tsx scripts/test-transfer-payment-flow.ts
npx tsx scripts/test-cp3-migrations.ts
```

Expected: both PASS; migration journal remains contiguous `0..22`.

- [ ] **Step 6: Commit**

```powershell
git add src/db/schema.ts src/db/migrations/0022_pos_payment_expiry.sql src/db/migrations/meta/_journal.json src/services/order.service.ts scripts/test-transfer-payment-flow.ts
git commit -m "feat(pos): add scoped payment expiry"
```

---

### Task 2: Kilo — Counter-transfer authorization, proof gate, and close-shift guard

**Files:**
- Modify: `src/services/order.service.ts:923-1103,1224-1417`
- Modify: `src/app/api/orders/route.ts:392-405` (remove the duplicate route-level audit for CONFIRM/CANCEL)
- Modify: `scripts/test-transfer-payment-flow.ts`
- Modify: `scripts/test-online-orders.ts:114-136`

**Interfaces:**
- Produces:

```ts
export interface TransferPaymentProof {
  id: string;
  capturedAt: string;
}
```

- Produces extended signatures:

```ts
OrderService.confirmOrder(
  orderId: string,
  actorRole: string,
  actorId?: string,
  actorContext?: ActorContext,
  paymentProof?: TransferPaymentProof
)

OrderService.cancelOrder(
  orderId: string,
  actorRole: string,
  reason?: string,
  actorContext?: ActorContext
)
```

- [ ] **Step 1: Add failing authorization and proof tests**

Extend the isolated test with warehouse, edition, stock and cashbox fixtures, then assert:

```ts
await assert.rejects(
  () => OrderService.confirmOrder(order.id, 'ROLE_CASHIER', 'cashier-a', cashierA),
  (error: any) => error?.code === 'INVALID_INPUT'
);

await assert.rejects(
  () => OrderService.confirmOrder(order.id, 'ROLE_CASHIER', 'cashier-b', cashierB, { id: 'proof-b', capturedAt: new Date().toISOString() }),
  (error: any) => error?.code === 'FORBIDDEN'
);

const confirmed = await OrderService.confirmOrder(
  order.id,
  'ROLE_CASHIER',
  'cashier-a',
  cashierA,
  { id: 'proof-a', capturedAt: new Date().toISOString() }
);
assert.equal(confirmed.status, 'COMPLETED');
assert.equal((await OrderService.confirmOrder(order.id, 'ROLE_CASHIER', 'cashier-a', cashierA, { id: 'proof-a', capturedAt: new Date().toISOString() })).isIdempotent, true);
```

Add separate fixtures proving cashier A cannot cancel cashier B's order, cashier A can cancel their own order, and `closeSession` rejects while a PENDING order exists in that session.

- [ ] **Step 2: Run and verify RED**

```powershell
npx tsx scripts/test-transfer-payment-flow.ts
```

Expected: FAIL because current service allows only Owner/Manager and does not require proof.

- [ ] **Step 3: Move authorization inside the transaction**

Remove the pre-transaction role rejection from `confirmOrder` and `cancelOrder`. After reading the order:

```ts
const isPrivileged = actorRole === 'ROLE_OWNER' || actorRole === 'ROLE_MANAGER';
const isOwnCashierOrder = actorRole === 'ROLE_CASHIER' && ord.cashierId === actorId;
if (!isPrivileged && !isOwnCashierOrder) {
  throw AppError.forbidden('Cashier chỉ được xác nhận hoặc hủy đơn của chính mình.');
}
```

For digital orders requiring proof:

```ts
if ((ord.paymentMethod === 'BANK_TRANSFER' || ord.paymentMethod === 'QR_CODE') && (!paymentProof?.id || !paymentProof?.capturedAt)) {
  throw AppError.invalid('Phải lưu ảnh xác nhận trước khi xác nhận đơn chuyển khoản/QR.');
}
```

Insert deterministic audit rows inside the same transaction:

```ts
await tx.insert(auditLogs).values({
  id: `aud-order-confirm-${orderId}`,
  action: 'ORDER_CONFIRMED',
  actorRole,
  actorId,
  resource: '/api/orders',
  details: `Xác nhận ${ord.orderCode}; proof=${paymentProof?.id || 'N/A'}; capturedAt=${paymentProof?.capturedAt || 'N/A'}`,
}).onConflictDoNothing({ target: auditLogs.id });
```

Use the equivalent `aud-order-cancel-${orderId}` pattern for cancellation.

Because the audit is now atomic inside the service, delete the route-level `recordAuditLog` call for the `CONFIRM` and `CANCEL` branches in `src/app/api/orders/route.ts`. Keep it for `createOrder`.

- [ ] **Step 4: Block closing a cashbox with pending orders**

Before calculating close totals:

```ts
const pending = await tx
  .select({ id: orders.id })
  .from(orders)
  .where(and(eq(orders.cashboxSessionId, sessionId), eq(orders.status, 'PENDING_CONFIRMATION')))
  .limit(1);
if (pending.length > 0) {
  throw AppError.conflict('Còn đơn chuyển khoản/QR đang chờ. Hãy xác nhận hoặc hủy trước khi chốt ca.');
}
```

- [ ] **Step 5: Update the existing cashier authorization test**

`scripts/test-online-orders.ts:114-136` asserts the old `/Manager\/Owner/` message for a cashier acting on a `RETAIL_ONLINE_WEB` order owned by `webhook`. Replace that regex with the new ownership message:

```ts
if (/chính mình/.test(e.message)) roleBlocked++;
```

Add a positive case proving a `RETAIL_POS` PENDING order created by `cashier-1` can be confirmed by the same cashier with a proof payload.

- [ ] **Step 6: Run and verify GREEN**

```powershell
npx tsx scripts/test-transfer-payment-flow.ts
npx tsx scripts/test-online-orders.ts
npx tsx scripts/test-s3-discount-approval.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/services/order.service.ts src/app/api/orders/route.ts scripts/test-transfer-payment-flow.ts scripts/test-online-orders.ts
git commit -m "feat(pos): authorize cashier transfer confirmation"
```

---

### Task 3: Kilo — Pending creation and offline sync API contract

**Files:**
- Modify: `src/app/api/orders/route.ts:103-425`
- Modify: `src/services/order.service.ts:115-691`
- Modify: `scripts/test-transfer-payment-flow.ts`

**Interfaces:**
- Consumes: `TransferPaymentProof` from Task 2.
- Request fields: `confirmImmediately`, `paymentProofId`, `paymentProofCapturedAt`.
- Response: existing order result plus `status: 'PENDING_CONFIRMATION'`.

- [ ] **Step 1: Add failing route tests**

Using `signSession` and the existing route-test pattern, add:

```ts
const pendingRes = await ordersPost(new Request('http://localhost/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieFor(cashierA) },
  body: JSON.stringify(baseBody({
    paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false,
    moneyReceived: false,
  })),
}));
assert.equal(pendingRes.status, 200);
assert.equal((await pendingRes.json()).data.status, 'PENDING_CONFIRMATION');

const noProofRes = await ordersPost(new Request('http://localhost/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieFor(cashierA) },
  body: JSON.stringify(baseBody({ paymentMethod: 'BANK_TRANSFER', moneyReceived: true })),
}));
assert.equal(noProofRes.status, 403);

const cashRes = await ordersPost(new Request('http://localhost/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieFor(cashierA) },
  body: JSON.stringify(baseBody({ paymentMethod: 'CASH' })),
}));
assert.equal(cashRes.status, 200);
```

Also test that a Cashier can call `action: 'CONFIRM'` for their own order but not another cashier's order.

- [ ] **Step 2: Run and verify RED**

```powershell
npx tsx scripts/test-transfer-payment-flow.ts
```

Expected: digital pending returns 403 before the change.

- [ ] **Step 3: Allow only explicit pending digital orders**

Compute:

```ts
const isDigital = paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR_CODE';
const isPendingTransfer = isDigital && confirmImmediately === false && !giftFlag;
const isImmediateDigital = isDigital && confirmImmediately !== false && !giftFlag;
```

Allow `isPendingTransfer` without `moneyReceived`. For `isImmediateDigital`, require `moneyReceived === true`, `paymentProofId`, and `paymentProofCapturedAt`.

- [ ] **Step 4: Pass actor and proof into service calls**

For confirm/cancel actions:

```ts
const result = body.action === 'CONFIRM'
  ? await OrderService.confirmOrder(
      body.orderId,
      userRole,
      actorHeader,
      actorContext,
      body.paymentProofId && body.paymentProofCapturedAt
        ? { id: body.paymentProofId, capturedAt: body.paymentProofCapturedAt }
        : undefined
    )
  : await OrderService.cancelOrder(body.orderId, userRole, body.reason, actorContext);
```

Remove the route-level Manager/Owner-only rejection for these two actions.

- [ ] **Step 5: Set server-derived expiry for counter transfers**

In `createOrder`, before insert:

```ts
const isCounterTransfer = isPending && (paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR_CODE') && Boolean(params.cashboxSessionId);
const paymentExpiresAt = isCounterTransfer
  ? new Date(Date.now() + 30 * 60_000).toISOString()
  : undefined;
```

Insert `paymentExpiresAt` into `orders`. Do not accept this value from the client.

For offline immediate digital sync, extend the existing `requiredAudit` array in `src/app/api/orders/route.ts:342-363`:

```ts
...(isImmediateDigital
  ? [{
      id: 'transfer-payment-confirmation',
      action: 'ORDER_CONFIRMED',
      actorRole: userRole,
      actorId: actorHeader,
      resource: '/api/orders',
      details: (committedOrderCode: string) => `Xác nhận offline ${committedOrderCode}; proof=${body.paymentProofId}; capturedAt=${body.paymentProofCapturedAt}.`,
    }]
  : []),
```

- [ ] **Step 6: Run and verify GREEN**

```powershell
npx tsx scripts/test-transfer-payment-flow.ts
npx tsx scripts/test-discount-guard.ts
npx tsc --noEmit
```

Expected: no TypeScript errors and both suites PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/api/orders/route.ts src/services/order.service.ts scripts/test-transfer-payment-flow.ts
git commit -m "feat(pos): create transfer orders before payment"
```

---

### Task 4: Cline — Bank-account cache and offline QR source

**Files:**
- Create: `src/lib/bank-account-cache.ts`
- Modify: `src/components/pos/VietQrPay.tsx`
- Create: `scripts/test-payment-photo-contract.ts`

**Interfaces:**
- Produces:

```ts
export interface CachedBankAccount {
  id: string;
  label: string;
  bankBin: string;
  accountNo: string;
  accountName?: string | null;
}

export interface CachedBankAccounts {
  warehouseId: string;
  cachedAt: number;
  defaultId: string | null;
  accounts: CachedBankAccount[];
}

export function readBankAccountsCache(warehouseId: string, now?: number): CachedBankAccounts | null;
export function writeBankAccountsCache(value: CachedBankAccounts): void;
export const BANK_ACCOUNT_CACHE_TTL_MS: number;
```

- [ ] **Step 1: Write failing cache tests**

Create `scripts/test-payment-photo-contract.ts`. Install a minimal in-memory `localStorage` stub, then assert:

```ts
const now = Date.now();
writeBankAccountsCache({ warehouseId: 'wh-au-co', cachedAt: now, defaultId: 'ba-1', accounts: [account] });
assert.equal(readBankAccountsCache('wh-au-co', now)?.accounts[0]?.accountNo, '1234567890');
assert.equal(readBankAccountsCache('wh-au-co', now + 24 * 3600_000 + 1), null);
assert.equal(readBankAccountsCache('wh-quynh-mai', now), null);
```

Expected first run: FAIL because module does not exist.

- [ ] **Step 2: Implement the cache**

Use key `formapubli.bankAccounts.${warehouseId}` and:

```ts
export const BANK_ACCOUNT_CACHE_TTL_MS = 24 * 3600_000;
```

`readBankAccountsCache` must reject expired data, malformed JSON, and a different `warehouseId`.

- [ ] **Step 3: Make VietQrPay prefer network, then cache**

Add state:

```ts
const [source, setSource] = useState<'NETWORK' | 'CACHE' | 'NONE'>('NONE');
const [cachedAt, setCachedAt] = useState<number | null>(null);
```

On fetch success, write cache and use `NETWORK`. On fetch failure, read cache and use `CACHE`. If neither exists, render the existing “chưa có tài khoản nhận” state, set `NONE`, and call the existing `onQr(null)` callback so the parent cannot show a stale QR. A successful cache hit must call `onQr(snapshot)` with the same shape the network path already uses.

Render a short label:

```tsx
{source === 'CACHE' && cachedAt ? (
  <p>Dữ liệu cache {new Date(cachedAt).toLocaleString('vi-VN')}</p>
) : null}
```

- [ ] **Step 4: Run and verify GREEN**

```powershell
npx tsx scripts/test-payment-photo-contract.ts
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```powershell
git add src/lib/bank-account-cache.ts src/components/pos/VietQrPay.tsx scripts/test-payment-photo-contract.ts
git commit -m "feat(pos): cache bank accounts for offline QR"
```

---

### Task 5: Cline — Payment photo store and offline payment states

**Files:**
- Modify: `src/lib/offline-db.ts`
- Modify: `scripts/test-offline-engine.ts`
- Modify: `scripts/test-payment-photo-contract.ts`

**Interfaces:**
- Produces:

```ts
export type OfflinePaymentState =
  | 'READY_TO_SYNC'
  | 'AWAITING_PAYMENT'
  | 'PAID_PENDING_SYNC'
  | 'NEEDS_RECONCILIATION'
  | 'CANCELLED_LOCAL';

export type PaymentProofSyncState = 'LOCAL_ONLY' | 'ORDER_SYNCED' | 'NEEDS_RECONCILIATION';

export interface PaymentProofPhoto {
  id: string;
  orderId?: string;
  orderCode: string;
  warehouseId: string;
  cashierId: string;
  amount: number;
  paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
  capturedAt: string;
  blob: Blob;
  syncState: PaymentProofSyncState;
}

export function normalizeOfflinePaymentState(order: OfflineOrder): OfflinePaymentState;
export function applySyncErrorToOfflineOrder(order: OfflineOrder, errorCode: string): OfflinePaymentState;
export function prunePaymentProofPhotos<T extends PaymentProofPhoto>(photos: T[], now?: number): T[];
export function savePaymentProofPhoto(photo: PaymentProofPhoto): Promise<void>;
export function listPaymentProofPhotos(): Promise<PaymentProofPhoto[]>;
export function deletePaymentProofPhoto(id: string): Promise<void>;
export function updateOfflineOrderPaymentState(id: string, state: OfflinePaymentState): Promise<void>;
```

- [ ] **Step 1: Add failing state and retention tests**

In `scripts/test-offline-engine.ts`:

```ts
assert.equal(normalizeOfflinePaymentState({ ...base, paymentMethod: 'CASH' } as OfflineOrder), 'READY_TO_SYNC');
assert.equal(normalizeOfflinePaymentState({ ...base, paymentMethod: 'BANK_TRANSFER', moneyReceived: true } as OfflineOrder), 'PAID_PENDING_SYNC');
assert.equal(normalizeOfflinePaymentState({ ...base, paymentMethod: 'QR_CODE' } as OfflineOrder), 'NEEDS_RECONCILIATION');
assert.equal(
  normalizeOfflinePaymentState({ ...base, paymentMethod: 'BANK_TRANSFER', moneyReceived: false, paymentState: 'AWAITING_PAYMENT' } as OfflineOrder),
  'AWAITING_PAYMENT'
);
assert.equal(applySyncErrorToOfflineOrder({ ...base, paymentMethod: 'QR_CODE', moneyReceived: true } as OfflineOrder, 'INSUFFICIENT_ATP'), 'NEEDS_RECONCILIATION');
assert.equal(applySyncErrorToOfflineOrder({ ...base, paymentMethod: 'BANK_TRANSFER' } as OfflineOrder, 'NETWORK'), 'AWAITING_PAYMENT');
```

In `scripts/test-payment-photo-contract.ts`, build 105 fake photos with distinct `capturedAt`; 100 normal photos plus 5 `NEEDS_RECONCILIATION`. Assert prune returns the 100 newest normal photos and keeps all 5 reconciliation photos.

- [ ] **Step 2: Run and verify RED**

```powershell
npx tsx scripts/test-payment-photo-contract.ts
```

Expected: FAIL because store/types do not exist.

- [ ] **Step 3: Upgrade IndexedDB atomically**

In `offline-db.ts`:

```ts
const DB_VERSION = 2;
const ORDER_STORE = 'offline_orders';
const PHOTO_STORE = 'payment_proof_photos';
```

In `onupgradeneeded`, create `PHOTO_STORE` with `keyPath: 'id'` and index `orderCode`. Do not open this database from another module.

- [ ] **Step 4: Implement photo CRUD and pruning**

Store Blob directly. On save:

```ts
const photos = await listPaymentProofPhotos();
const kept = prunePaymentProofPhotos([...photos.filter((photo) => photo.id !== photoToSave.id), photoToSave]);
for (const stale of photos) {
  if (!kept.some((item) => item.id === stale.id)) await deletePaymentProofPhoto(stale.id);
}
await putPhoto(photoToSave);
```

`normalizeOfflinePaymentState` must return a valid existing `order.paymentState` first, and only derive a state from `moneyReceived` when the field is absent. This keeps an explicit `AWAITING_PAYMENT` from being silently upgraded by a stale `moneyReceived: false` row.

`applySyncErrorToOfflineOrder` returns `NEEDS_RECONCILIATION` for `INSUFFICIENT_ATP`, `IDEMPOTENCY_CONFLICT` and `CASHBOX_SESSION_NOT_FOUND`, and otherwise preserves the current state so a network failure leaves the order retryable.

`prunePaymentProofPhotos` must keep all `NEEDS_RECONCILIATION` photos regardless of age, then remove normal photos older than 30 days, then trim normal photos to the newest 100.

- [ ] **Step 5: Gate auto-sync by payment state**

`getPendingOfflineOrders` auto-sync callers must receive only `READY_TO_SYNC` and `PAID_PENDING_SYNC`. `AWAITING_PAYMENT` and `NEEDS_RECONCILIATION` remain visible only in explicit review queries.

- [ ] **Step 6: Run and verify GREEN**

```powershell
npx tsx scripts/test-payment-photo-contract.ts
npx tsx scripts/test-offline-engine.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```powershell
git add src/lib/offline-db.ts scripts/test-offline-engine.ts scripts/test-payment-photo-contract.ts
git commit -m "feat(pos): store payment proof photos locally"
```

---

### Task 6: Cline — Minimal camera capture component

**Files:**
- Create: `src/components/pos/PaymentProofCamera.tsx`
- Modify: `scripts/test-payment-photo-contract.ts`

**Interfaces:**
- Produces:

```ts
export interface PaymentProofCameraProps {
  isOpen: boolean;
  orderCode: string;
  onClose: () => void;
  onUsePhoto: (photo: PaymentProofPhoto) => Promise<void>;
}
```

- [ ] **Step 1: Add failing source contract assertions**

Assert the component source contains `getUserMedia`, `playsInline`, `canvas.toBlob`, `image/jpeg`, `track.stop()`, `useModalFocusTrap`, `max-w-lg`, and buttons labelled “Chụp lại” and “Dùng ảnh này”. Assert it does not import `createBarcodeDecoder`, OCR, or any bank API.

For Review Focus 1, assert the `NotAllowedError`/`NotFoundError` branch calls `onClose` and contains no `onUsePhoto` call, so a denied or missing camera can never confirm an order.

For Review Focus 2, assert `onUsePhoto` is awaited inside a `try` block whose `catch` keeps the preview mounted and does not call `onClose`.

- [ ] **Step 2: Run and verify RED**

```powershell
npx tsx scripts/test-payment-photo-contract.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement camera lifecycle**

On open, request environment-facing video. On close, stop every track and invalidate late permission requests with a generation ref. Render a portal dialog with a large shutter button and a camera flip button.

Capture into a canvas with longest edge 1280:

```ts
const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
canvas.width = Math.round(video.videoWidth * scale);
canvas.height = Math.round(video.videoHeight * scale);
context.drawImage(video, 0, 0, canvas.width, canvas.height);
const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
```

- [ ] **Step 4: Save only after explicit user action**

“Dùng ảnh này” creates the `PaymentProofPhoto`, awaits `onUsePhoto`, and only then closes. If the save rejects, keep the preview and show the error.

- [ ] **Step 5: Run and verify GREEN**

```powershell
npx tsx scripts/test-payment-photo-contract.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```powershell
git add src/components/pos/PaymentProofCamera.tsx scripts/test-payment-photo-contract.ts
git commit -m "feat(pos): add payment proof camera"
```

---

### Task 7: Cline — Transfer payment modal and photo gallery

**Files:**
- Create: `src/components/pos/TransferPaymentModal.tsx`
- Create: `src/components/pos/PaymentPhotoGallery.tsx`
- Modify: `scripts/test-payment-photo-contract.ts`

**Interfaces:**
- Consumes:

```ts
export interface TransferPaymentSession {
  mode: 'ONLINE' | 'OFFLINE';
  orderId?: string;
  orderCode: string;
  idempotencyKey: string;
  warehouseId: string;
  amount: number;
  paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
  createdAt: string;
  expiresAt?: string;
  qrSnapshot: { dataUrl: string; payload: string; accountNo: string; content: string };
  paymentProof?: PaymentProofPhoto;
}
```

`qrSnapshot` comes from the existing `VietQrPay` `onQr` callback, which already emits `{ dataUrl, payload, accountNo, content } | null`. Do not add a new prop; Task 8 only has to pass the real order code as `initialContent`.

- `TransferPaymentModalProps`:

```ts
{
  isOpen: boolean;
  session: TransferPaymentSession | null;
  busy: boolean;
  onCapture: () => void;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
}
```

- `PaymentPhotoGalleryProps`:

```ts
{
  isOpen: boolean;
  onClose: () => void;
}
```

- [ ] **Step 1: Add failing UI contract assertions**

Assert labels “Tạo đơn & hiện QR”, “Chụp màn hình xác nhận”, “Khách chuyển sau”, countdown display, cache-source label, gallery search by order code, share, download and delete.

- [ ] **Step 2: Implement TransferPaymentModal**

Render order code, amount, QR, countdown and camera button. Countdown is derived, never a server write:

```ts
const [remainingMs, setRemainingMs] = useState(0);
useEffect(() => {
  if (!session?.expiresAt) return;
  const update = () => setRemainingMs(Math.max(0, new Date(session.expiresAt!).getTime() - Date.now()));
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}, [session?.expiresAt]);
const expired = Boolean(session?.expiresAt) && remainingMs === 0;
```

Disable both the capture and confirm buttons when `expired` or `busy` or `!session?.paymentProof`. Closing the modal means “khách chuyển sau” and calls `onClose`; cancelling calls the explicit `onCancel` action.

- [ ] **Step 3: Implement PaymentPhotoGallery**

Load photos on open. Render newest first and filter by `orderCode`:

```ts
const [query, setQuery] = useState('');
const photos = (await listPaymentProofPhotos())
  .filter((photo) => photo.orderCode.toLowerCase().includes(query.trim().toLowerCase()))
  .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
```

Share with fallback to download:

```ts
async function sharePhoto(photo: PaymentProofPhoto) {
  const file = new File([photo.blob], `payment-${photo.orderCode}-${photo.capturedAt}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `Thanh toán ${photo.orderCode}` });
    return;
  }
  const url = URL.createObjectURL(photo.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}
```

Never offer delete for a photo with `syncState === 'NEEDS_RECONCILIATION'`.

- [ ] **Step 4: Run and verify GREEN**

```powershell
npx tsx scripts/test-payment-photo-contract.ts
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```powershell
git add src/components/pos/TransferPaymentModal.tsx src/components/pos/PaymentPhotoGallery.tsx scripts/test-payment-photo-contract.ts
git commit -m "feat(pos): add transfer payment and photo gallery UI"
```

---

### Task 8: Cline — POS orchestration for online and offline transfer flow

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx`
- Modify: `scripts/test-payment-photo-contract.ts`

**Interfaces:**
- Consumes: `TransferPaymentSession`, `PaymentProofCamera`, `TransferPaymentModal`, `PaymentPhotoGallery`, offline photo/state helpers, and the Task 3 API.
- Produces no new public API outside this component.

- [ ] **Step 1: Add failing orchestration contract assertions**

Assert the digital checkout button text is “Tạo đơn & hiện QR”, digital requests send `confirmImmediately: false`, `MoneyReceivedToggle` is not rendered for digital payment, the camera is opened before confirm, and confirm is unreachable until a photo exists.

- [ ] **Step 2: Remove the pre-order money gate**

Delete the `isMoneyReceived` check for digital payment. Keep cash and gift immediate checkout unchanged.

- [ ] **Step 3: Add transfer session state**

```ts
const [transferSession, setTransferSession] = useState<TransferPaymentSession | null>(null);
const [isTransferCameraOpen, setIsTransferCameraOpen] = useState(false);
const [isPhotoGalleryOpen, setIsPhotoGalleryOpen] = useState(false);
const [isTransferSubmitting, setIsTransferSubmitting] = useState(false);
```

Include these overlays in `isPosOverlayOpen` and all existing checkout/scanner locks.

- [ ] **Step 4: Online happy path**

On digital checkout:

1. POST `/api/orders` with `confirmImmediately: false`.
2. Store returned `orderId/orderCode` in `TransferPaymentSession`.
3. Render `VietQrPay` with `initialContent={session.orderCode}` and keep the snapshot in `transferSession.qrSnapshot` through the existing `onQr` callback.
4. On photo save, POST `action: 'CONFIRM'` with proof fields.
5. On success, close transfer UI, call `resetPostCheckoutState`, refresh cashbox and show receipt.

- [ ] **Step 5: Offline soft-hold path**

Take this path when `navigator.onLine === false` **or** the create request throws a `TypeError`/fetch failure. Reuse the existing `fallbackToOffline` error classification instead of duplicating it:

1. Require a valid cached bank account.
2. Create `OfflineOrder` with `paymentState: 'AWAITING_PAYMENT'`.
3. Generate QR locally from the client order code.
4. After photo save, update state to `PAID_PENDING_SYNC`.
5. Do not print a final success receipt; show “đã ghi nhận, chờ đồng bộ”.
6. Existing sync sends `moneyReceived: true` and both proof fields.

- [ ] **Step 6: Reconciliation path**

Map ATP, idempotency, closed-cashbox and unexpected sync errors to `NEEDS_RECONCILIATION`. Keep the photo. Do not remove the offline order. Reuse the existing offline review surface.

- [ ] **Step 7: Run and verify GREEN**

```powershell
npx tsx scripts/test-payment-photo-contract.ts
npx tsx scripts/smoke-mobile-role-navigation.ts
npx tsx scripts/test-modal-dismiss.ts
npx tsc --noEmit
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/components/pos/PosCheckoutTerminal.tsx scripts/test-payment-photo-contract.ts
git commit -m "feat(pos): require photo before transfer confirmation"
```

---

### Task 9: Coordinator integration — Register tests and run acceptance gate

**Files:**
- Modify: `scripts/run-isolated.ts`
- Modify only if a failing gate identifies a defect: the owning worker's file.

**Interfaces:**
- Consumes: Kilo branch and Cline branch.
- Produces: one integrated branch with both new suites registered.

- [ ] **Step 1: Cherry-pick the server branch before the client branch**

Worker branches are `agent/kilo-transfer-payment-server` and `agent/cline-transfer-payment-client`, both based on `8efa6e2`.

```powershell
$kiloShas = git rev-list --reverse 8efa6e2..agent/kilo-transfer-payment-server
git cherry-pick $kiloShas
```

Expected: no conflicts, because the client branch does not touch Kilo-owned files.

- [ ] **Step 2: Cherry-pick the client branch**

```powershell
$clineShas = git rev-list --reverse 8efa6e2..agent/cline-transfer-payment-client
git cherry-pick $clineShas
```

Expected: no conflicts. If a conflict appears in `PosCheckoutTerminal.tsx` or `VietQrPay.tsx`, the client branch is the owner; resolve in favour of the client version and re-run Task 8 gates.

- [ ] **Step 3: Register both new suites**

Add to `ALL_SUITES` in `scripts/run-isolated.ts`:

```ts
'scripts/test-transfer-payment-flow.ts',
'scripts/test-payment-photo-contract.ts',
```

Place `test-transfer-payment-flow` after `test-s3-discount-approval` and `test-payment-photo-contract` after `test-modal-dismiss`.

- [ ] **Step 4: Run focused gates**

```powershell
npx tsc --noEmit
npx tsx scripts/test-transfer-payment-flow.ts
npx tsx scripts/test-payment-photo-contract.ts
npx tsx scripts/test-offline-engine.ts
npx tsx scripts/test-s3-discount-approval.ts
npx tsx scripts/test-discount-guard.ts
npx tsx scripts/smoke-mobile-role-navigation.ts
npx tsx scripts/test-modal-dismiss.ts
```

Expected: all PASS with no TypeScript errors.

- [ ] **Step 5: Run build and full isolated suite**

```powershell
npm run build
npm run test:isolated
```

Expected: build succeeds and every registered suite passes.

- [ ] **Step 6: Review Review Focus manually**

Record evidence for:

- Camera denial leaves PENDING.
- Photo write failure does not confirm.
- Two-cashier offline conflict becomes reconciliation without negative stock.
- Confirm retry is idempotent.
- Bank cache older than 24 hours blocks offline QR.

- [ ] **Step 7: Inspect final diff and commit integration**

```powershell
git status --short
git diff --check
git diff --stat 8efa6e2..HEAD
git add scripts/run-isolated.ts
git commit -m "test(pos): register transfer payment photo suites"
```

Do not stage `docs/superpowers/plans/2026-09-25-agent-a-review-verdict.md` or `reports/wave3-pos-ui/*`.
