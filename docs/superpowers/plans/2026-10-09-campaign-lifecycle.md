# Campaign Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vòng đời kho chiến dịch ngắn hạn: tạo campaign → Bắt đầu (sinh kho FAIR_EVENT) → Kết thúc (duyệt tồn thừa → chuyển về → ngưng kho → lưu trữ).

**Architecture:** Bảng `campaigns` + `CampaignService` mới; tái dùng `WarehouseService.createWarehouse/updateWarehouse/detachStaffReferences`, `InventoryService.transferBatch`, `BatchTransferModal`, báo cáo kỳ có sẵn. Không scheduler, không engine chuyển kho mới.

**Tech Stack:** Next.js App Router API routes, Drizzle ORM + libsql, tsx suites qua `run-isolated.ts`.

**Spec:** `docs/superpowers/specs/2026-10-09-campaign-lifecycle-design.md`

## Global Constraints

- `main` là nguồn sự thật, commit thẳng `main`, `git add` từng file (không `-A`).
- Test chạy DB cách ly: `npx tsx scripts/run-isolated.ts --only=<suite>`; suite PHẢI từ chối khi thiếu `DATABASE_URL` test (pattern `test-staff-allowed-warehouses.ts:3-9`).
- Không hạ assertion để xanh; hằng kiểm thử lấy từ nguồn thật (schema/migration), không dùng chung hằng với code.
- Secret/token không bao giờ vào git; không log giá trị secret.
- Mọi ghi production phải qua `scripts/prod-write-guard.ts` (không áp dụng lúc implement — chỉ test DB).
- `npx tsc --noEmit` sạch trước mỗi commit; CSS đổi thì `npm run build`.
- Tên UI tiếng Việt có dấu, nút là động từ ngắn.

## Review Focus

- Bấm Bắt đầu 2 lần liên tiếp (double-click): lần 2 phải 409, không sinh 2 kho.
- Kết thúc khi tồn thừa = 0: vẫn ENDED + ngưng kho, không lỗi chia 0.
- Kho chiến dịch bị ngưng tay giữa kỳ rồi mới bấm Kết thúc: báo rõ, không crash.
- `transferBatch` ném TOCTOU stale giữa chừng: campaign giữ ACTIVE, không mất dấu.
- Hai quản lý bấm Kết thúc đồng thời: 1 thắng, 1 nhận 409 (máy trạng thái server).

---

### Task 1: Migration 0054 + journal + schema

**Files:**
- Create: `src/db/migrations/0054_campaigns.sql`
- Modify: `src/db/migrations/meta/_journal.json` (thêm entry 0053 rồi 0054)
- Modify: `src/db/schema.ts` (thêm `campaigns`, cạnh `portalSettings` dòng ~947)
- Test: `scripts/test-campaign-lifecycle.ts` (tạo ở Task 5, nhưng migration là tiền đề)

**Interfaces:**
- Consumes: quy ước journal (`idx`, `version: 7`, `when` tăng dần, `tag`, `breakpoints: true`).
- Produces: bảng `campaigns`; export `campaigns` từ `@/db` (kiểm tra `src/db/index.ts` re-export schema — nếu không, thêm).

- [ ] **Step 1: Viết file migration SQL**

```sql
-- 0054: campaigns — chiến dịch bán ngắn hạn gắn kho FAIR_EVENT
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  warehouse_id TEXT REFERENCES warehouses(id),
  source_warehouse_id TEXT REFERENCES warehouses(id),
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
```

- [ ] **Step 2: Đăng ký journal (vá luôn lỗ 0053)**

`_journal.json` hiện kết ở idx 52 (`0052_contract_projects`) trong khi file
`0053_portal_settings.sql` đã tồn tại nhưng chưa đăng ký → DB test thiếu bảng
`portal_settings`. Thêm 2 entries cuối mảng `entries` (giữ nguyên các entry cũ,
`when` tăng dần, cách nhau 1000):
- idx 53, tag `0053_portal_settings`
- idx 54, tag `0054_campaigns`

- [ ] **Step 3: Thêm định nghĩa Drizzle vào `schema.ts`**

```ts
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  status: text('status').notNull().default('DRAFT'),
  warehouseId: text('warehouse_id').references(() => warehouses.id),
  sourceWarehouseId: text('source_warehouse_id').references(() => warehouses.id),
  createdBy: text('created_by'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  endedAt: text('ended_at'),
});
```

Đặt ngay sau `portalSettings`. Xác nhận `src/db/index.ts` re-export `* from './schema'` (nếu liệt kê tay thì thêm `campaigns`).

- [ ] **Step 4: Verify journal hợp lệ**

Run: `node -e "const j=require('./src/db/migrations/meta/_journal.json');console.log(j.entries.length, j.entries.slice(-2).map(e=>e.tag))"`
Expected: số entries tăng 2, 2 tag cuối là `0053_portal_settings`, `0054_campaigns`.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0054_campaigns.sql src/db/migrations/meta/_journal.json src/db/schema.ts src/db/index.ts
git commit -m "feat(campaign): migration 0054 campaigns + dang ky journal (va 0053 con thieu)"
```

### Task 2: `CampaignService` (create / start / leftover / end)

**Files:**
- Create: `src/services/campaign.service.ts`
- Test: `scripts/test-campaign-lifecycle.ts` (viết ở Task 5, chạy ở Task 5)

**Interfaces:**
- Consumes: `WarehouseService.createWarehouse({name, warehouseType:'FAIR_EVENT'})` → `{id}`; `WarehouseService.updateWarehouse(id, {isActive:false})` (tự gọi `detachStaffReferences`); `InventoryService.transferBatch({fromWarehouseId, toWarehouseId, items: {editionId, quantity}[], note, actorContext: {staffId, role, fullName, sessionId}, idempotencyKey})`; `db, campaigns, warehouses, stockBalances, products` từ `@/db`; `eq, and, gt, sql` từ `drizzle-orm`; `AppError` từ `./app-error`.
- Produces: `CampaignService.create({name, startDate, endDate, sourceWarehouseId, actorId})`, `.start({campaignId, actor: ActorContext})`, `.getLeftover({campaignId})`, `.end({campaignId, items: {editionId, quantity}[], actor: ActorContext})`.

- [ ] **Step 1: Viết service (khung + create + start)**

```ts
import { db, campaigns, warehouses, stockBalances, products } from '../db';
import { eq, and, gt, sql } from 'drizzle-orm';
import { AppError } from './app-error';
import { WarehouseService } from './warehouse.service';
import { InventoryService } from './inventory.service';
import type { ActorContext } from './inventory.service'; // nếu export thiếu, grep `ActorContext` trong inventory.service.ts và sửa import cho khớp — không tự định nghĩa type mới

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'ENDED';

function slug(s: string): string {
  return s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'CD';
}

export class CampaignService {
  static async create(params: { name: string; startDate: string; endDate: string; sourceWarehouseId: string; actorId: string }) {
    const name = params.name.trim();
    if (!name) throw AppError.invalid('Tên chiến dịch không được để trống.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(params.endDate))
      throw AppError.invalid('Ngày phải dạng YYYY-MM-DD.');
    if (params.endDate < params.startDate) throw AppError.invalid('Ngày kết thúc phải sau ngày bắt đầu.');
    const src = await WarehouseService.getWarehouse(params.sourceWarehouseId);
    if (!src || src.isActive !== true) throw AppError.invalid('Kho nguồn không tồn tại hoặc đã ngưng.');
    const id = `cd-${Date.now().toString(36)}`;
    await db.insert(campaigns).values({
      id, name, startDate: params.startDate, endDate: params.endDate,
      status: 'DRAFT', sourceWarehouseId: params.sourceWarehouseId, createdBy: params.actorId,
    });
    return { id };
  }

  static async start(params: { campaignId: string; actor: ActorContext }) {
    const c = await this.require(params.campaignId);
    if (c.status !== 'DRAFT') throw AppError.conflict('Chiến dịch đã bắt đầu hoặc đã kết thúc.');
    const wh = await WarehouseService.createWarehouse({
      code: `KHO_CD_${slug(c.name)}_${c.startDate.replaceAll('-', '')}`,
      name: `Chiến dịch ${c.name}`,
      warehouseType: 'FAIR_EVENT',
    });
    await db.update(campaigns)
      .set({ status: 'ACTIVE', warehouseId: wh.id })
      .where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'DRAFT')));
    return { campaignId: c.id, warehouseId: wh.id };
  }
  // require(): đọc 1 dòng, không có → AppError.invalid('Chiến dịch không tồn tại.')
}
```

Lưu ý: `UPDATE ... WHERE status='DRAFT'` là chốt chống double-click (2 request đồng
thời chỉ 1 đổi được trạng thái — kiểm tra số dòng ảnh hưởng, nếu 0 thì ném conflict).
Drizzle `db.update().where()` không trả số dòng trên libsql mặc định → đọc lại
status sau update, nếu vẫn DRAFT (thua race) thì ném conflict + xóa kho vừa tạo
(nếu kho đó do chính call này tạo và chưa phát sinh gì — dùng `deleteWarehouse`,
nó từ chối khi đã có nghiệp vụ).

- [ ] **Step 2: Thêm `getLeftover` + `end`**

```ts
static async getLeftover(params: { campaignId: string }) {
  const c = await this.require(params.campaignId);
  if (c.status !== 'ACTIVE' || !c.warehouseId) throw AppError.invalid('Chiến dịch chưa bắt đầu.');
  const rows = await db
    .select({ productId: stockBalances.productId, qty: sql<number>`SUM(${stockBalances.physicalQuantity})`, name: products.name })
    .from(stockBalances)
    .leftJoin(products, eq(products.id, stockBalances.productId))
    .where(and(eq(stockBalances.warehouseId, c.warehouseId), gt(stockBalances.physicalQuantity, 0)))
    .groupBy(stockBalances.productId);
  return rows.map((r) => ({ editionId: r.productId, name: r.name ?? r.productId, quantity: Number(r.qty) }));
}

static async end(params: { campaignId: string; items: { editionId: string; quantity: number }[]; actor: ActorContext }) {
  const c = await this.require(params.campaignId);
  if (c.status !== 'ACTIVE' || !c.warehouseId || !c.sourceWarehouseId)
    throw AppError.invalid('Chiến dịch chưa bắt đầu.');
  const clean = (params.items ?? []).filter((it) => it && Number(it.quantity) > 0);
  if (clean.length > 0) {
    await InventoryService.transferBatch({
      fromWarehouseId: c.warehouseId,
      toWarehouseId: c.sourceWarehouseId,
      items: clean.map((it) => ({ editionId: `${it.editionId}`, quantity: Math.floor(Number(it.quantity)) })),
      note: `Kết thúc chiến dịch ${c.name}`,
      actorContext: params.actor,
      idempotencyKey: `campaign-end-${c.id}`,
    });
  }
  // Chốt race 2 quản lý bấm Kết thúc đồng thời: đọc lại trước khi đổi trạng thái,
  // ai đến sau thấy không còn ACTIVE thì dừng (transfer đã có idempotencyKey nên không chuyển trùng).
  const fresh = await this.require(params.campaignId);
  if (fresh.status !== 'ACTIVE') throw AppError.conflict('Chiến dịch vừa được kết thúc bởi người khác.');
  await WarehouseService.updateWarehouse(c.warehouseId, { isActive: false }); // tự detach staff
  await db.update(campaigns)
    .set({ status: 'ENDED', endedAt: new Date().toISOString() })
    .where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'ACTIVE')));
  return { campaignId: c.id };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/campaign.service.ts
git commit -m "feat(campaign): CampaignService create/start/leftover/end (tai dung transferBatch + detach)"
```

### Task 3: API routes `/api/campaigns`

**Files:**
- Create: `src/app/api/campaigns/route.ts` (GET list + POST create)
- Create: `src/app/api/campaigns/[id]/start/route.ts` (POST)
- Create: `src/app/api/campaigns/[id]/leftover/route.ts` (GET preview)
- Create: `src/app/api/campaigns/[id]/end/route.ts` (POST `{items}`)

**Interfaces:**
- Consumes: `CampaignService.*`; `requireSessionRole(req, ['ROLE_OWNER','ROLE_MANAGER'])`; `recordAuditLog`; `handleApiError`.
- Produces: JSON `{success, data}`; lỗi qua `handleApiError` (không tự chế format).

Mẫu route (copy từ `transfer-batch/route.ts:13-57`, đổi service + audit action
`CAMPAIGN_CREATED/STARTED/ENDED`, resource `/api/campaigns`). `actorContext` dựng
từ session y hệt transfer-batch route (staffId/role/fullName/sessionId).

- [ ] **Step 1: Viết 4 route theo mẫu, mỗi route validate body tối thiểu**
- [ ] **Step 2: `npx tsc --noEmit`** — sạch mới sang bước 3
- [ ] **Step 3: Commit**

```bash
git add src/app/api/campaigns
git commit -m "feat(campaign): API CRUD + start/leftover/end (Owner/Manager)"
```

### Task 4: UI `CampaignPanel` trong tab Kho

**Files:**
- Create: `src/components/inventory/CampaignPanel.tsx`
- Modify: `src/components/layout/MasterAppShell.tsx` (mount trong khối inventory, trên `StockOverviewMatrix`, chỉ `ROLE_OWNER`/`ROLE_MANAGER`)

**Interfaces:**
- Consumes: 4 API Task 3; `BatchTransferModal` có sẵn — nút "Chuyển hàng vào kho" mở modal với prop `initialToWarehouseId` = id kho chiến dịch (prop đã tồn tại, đã xác minh).
- Produces: tạo campaign (tên + từ ngày + đến ngày + kho nguồn) → Bắt đầu → Kết thúc (bảng xem trước cho sửa số → Duyệt).

- [ ] **Step 1: Viết panel (tiếng Việt có dấu, nút động từ ngắn: "Tạo", "Bắt đầu", "Kết thúc", "Duyệt")**
- [ ] **Step 2: Mount + `npx tsc --noEmit` sạch**
- [ ] **Step 3: Commit**

```bash
git add src/components/inventory/CampaignPanel.tsx src/components/layout/MasterAppShell.tsx
git commit -m "feat(campaign): CampaignPanel trong tab Kho (Owner/Manager)"
```

### Task 5: Suite kiểm thử + xanh toàn bộ

**Files:**
- Create: `scripts/test-campaign-lifecycle.ts`
- Modify: `scripts/run-isolated.ts` (thêm vào `ALL_SUITES`, cuối danh sách DB để không nhiễu suite khác — đọc comment thứ tự ở đầu file trước khi chèn)

**Interfaces:**
- Consumes: `CampaignService` trực tiếp (gọi service thật trên DB cách ly, như các suite service khác); guard `DATABASE_URL` chứa `formapubli_test` (copy `test-staff-allowed-warehouses.ts:3-9`); id prefix riêng `CD-TEST-` + `Date.now()` để không lẫn suite khác (DB dùng chung).

- [ ] **Step 1: Viết suite (assert hành vi, không echo hằng)**

```ts
// Bao phủ: create→DRAFT; start→ACTIVE + kho FAIR_EVENT linked; start lần 2→conflict;
// transferBatch 10 cuốn vào kho CD; end(items đã duyệt)→ENDED + kho ngưng +
// staff gỡ gán; end khi tồn 0 vẫn ENDED; getLeftover sau end→lỗi (không ACTIVE);
// kho bị ngưng tay giữa kỳ rồi end→lỗi rõ (không crash); end 2 lần→lần 2 conflict.
// Mỗi assert đọc lại từ DB (không tin return value): SELECT status, SELECT warehouses.is_active,
// SELECT stock_balances.
```

- [ ] **Step 2: Chạy suite mới**

Run: `npx tsx scripts/run-isolated.ts --only=test-campaign-lifecycle`
Expected: PASS.

- [ ] **Step 3: Chạy suite liên quan chống vỡ**

Run: `npx tsx scripts/run-isolated.ts --only=test-staff-allowed-warehouses,test-staff-allowed-scope,test-cp3-migrations`
Expected: PASS (journal thêm 2 entries không làm vỡ đếm độ dài — suite đó assert thích ứng).

- [ ] **Step 4: `npx tsc --noEmit` sạch + commit**

```bash
git add scripts/test-campaign-lifecycle.ts scripts/run-isolated.ts
git commit -m "test(campaign): suite vong doi DRAFT-ACTIVE-ENDED + detach staff"
```

### Task 6: Triển khai + migration production

- [ ] **Step 1: Deploy code** (`git pull` sạch → `tsc` sạch → `npm run deploy`), ghi Version ID.
- [ ] **Step 2: Áp migration 0054 lên production** bằng script mới
  `scripts/apply-migration-0054.ts` (copy `apply-migration-0053.ts`, đổi SQL +
  verify `sqlite_master` có `campaigns`), chạy với `ALLOW_PROD_WRITE=true` +
  `ALLOW_REMOTE_TARGET` đúng host, rồi commit script.
- [ ] **Step 3: Báo user test tay**: tạo chiến dịch thử → Bắt đầu → Kết thúc.
