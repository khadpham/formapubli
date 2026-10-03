# POS Warehouse Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng tự bật/tắt kho lên POS và tick nhiều kho cho mỗi tài khoản thu ngân.

**Architecture:** Task 1 độc lập (toggle UI dùng PATCH đã có). Task 2-5 nối tiếp: migration `0037` thêm `staff.allowed_warehouse_ids` (JSON TEXT), API staff/auth/cashbox hiểu trường mới, StaffManager multi-check, POS lọc theo allowed. Không đổi `assignedWarehouseId`.

**Tech Stack:** Next.js API routes, Drizzle sqlite, `npx tsc --noEmit`, `npx tsx scripts/run-isolated.ts --only=...`, `npm run build` khi sửa CSS.

**Spec:** `docs/superpowers/specs/2026-10-03-pos-warehouse-scope-design.md`

## Global Constraints

- `main` là nguồn sự thật, làm một mình thì commit thẳng `main`.
- Sửa file `.css` thì phải chạy `npm run build` (`tsc` không validate CSS).
- Giá trị hằng tra nguồn thật (`src/db/schema.ts`, migration `src/db/migrations/*.sql`); TEST KHÔNG DÙNG CHUNG HẰNG VỚI CODE.
- DDL copy nguyên văn style migration cũ (PRAGMA + statement-breakpoint); không tự bịa tên cột.
- Nhãn UI tiếng Việt CÓ DẤU, ngắn; nút là động từ ngắn; toggle có text trạng thái, không chỉ màu.
- Không log PIN/passcode; `allowedWarehouseIds` validate phía server.
- `git add` ghi rõ từng file, không `-A`/`commit -a`; deploy chỉ khi cây sạch + tsc + build + test xanh.
- Không hạ assertion để xanh; không commit secret/token.

## Review Focus

- Thu ngân allowed=[A,B] mở két kho C → 403 + tin nhắn tiếng Việt rõ ràng.
- Kho trong allowed nhưng đã ngưng/không sellable → POS hiện cảnh báo 1 dòng, không im lặng mất.
- allowed trống + assigned có → khóa cứng 1 kho y như cũ (không regression).
- PATCH allowed chứa id lạ → 400, không lưu gì.
- Tắt "Bán POS" → kho biến khỏi POS nhưng tồn/sổ/lịch sử giữ nguyên.

---

### Task 1: Công tắc "Bán POS" trong Quản Lý Kho

**Files:**
- Modify: `src/components/inventory/WarehouseManagerPanel.tsx:172-190` (thêm `setSellable` cạnh `setActive`)
- Modify: `src/components/inventory/WarehouseManagerPanel.tsx:310-320` (thêm badge trạng thái)
- Modify: `src/components/inventory/WarehouseManagerPanel.tsx:390-399` (thêm nút cạnh Ngưng hoạt động)

**Interfaces:**
- Consumes: PATCH `/api/warehouses/[id]` đã hỗ trợ `{ isSellableOnPos }` (`src/app/api/warehouses/[id]/route.ts:49`).
- Produces: không có (độc lập, ship được một mình).

- [ ] **Step 1: Thêm hàm `setSellable` sau `setActive`**

```tsx
const setSellable = async (w: Warehouse, isSellableOnPos: boolean) => {
  setBusyId(w.id);
  setError(null);
  setDeleteBlock(null);
  try {
    const res = await fetch(`/api/warehouses/${encodeURIComponent(w.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isSellableOnPos }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) throw new Error(j?.error || 'Cập nhật kho thất bại.');
    await afterChange(j.message || `Đã cập nhật kho [${w.code}].`);
  } catch (e: any) {
    setError(e?.message || 'Cập nhật kho thất bại.');
  } finally {
    setBusyId(null);
  }
};
```

- [ ] **Step 2: Thêm badge trạng thái sau badge Đang mở/Đã khoá (`:310-316`)**

```tsx
<span
  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
    w.isSellableOnPos ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-600'
  }`}
>
  {w.isSellableOnPos ? 'Đang bán' : 'Đã ẩn'}
</span>
```

- [ ] **Step 3: Thêm nút toggle cạnh nút Ngưng hoạt động (`:390-398`)**

```tsx
<button
  type="button"
  onClick={() => setSellable(w, !w.isSellableOnPos)}
  disabled={busy}
  title={w.isSellableOnPos ? 'Ẩn kho khỏi POS' : 'Cho kho bán trên POS'}
  className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
>
  <Store className="w-3.5 h-3.5 text-indigo-600" /> {w.isSellableOnPos ? 'Ẩn khỏi POS' : 'Bán POS'}
</button>
```

`Store` đã import? Kiểm đầu file: nếu chưa có, thêm `Store` vào dòng import lucide-react hiện có (không tạo dòng import mới).

- [ ] **Step 4: tsc sạch**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Verify trên dev thật (test tầng 3 cho UI)**

Run: `npm run dev:lan`, mở panel Quản Lý Kho, tắt "Bán POS" của 1 kho phụ → gọi `GET /api/warehouses` (không `?all`) → kho đó vắng mặt; bật lại → hiện lại. POS dropdown đổi theo.
Expected: list đổi theo toggle, không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/components/inventory/WarehouseManagerPanel.tsx
git commit -m "feat(kho): nut Ban POS tat/mo kho tren POS"
```

### Task 2: Migration 0037 + schema `allowed_warehouse_ids`

**Files:**
- Create: `src/db/migrations/0037_staff_allowed_warehouses.sql`
- Modify: `src/db/schema.ts:666-667` (thêm cột cạnh `assignedWarehouseId`)

**Interfaces:**
- Consumes: không có.
- Produces: cột `allowed_warehouse_ids` (TEXT JSON, default `'[]'`) mà Task 3 đọc.

- [ ] **Step 1: Viết migration theo đúng style 0036**

```sql
-- 0037: danh sách kho POS được phép theo tài khoản (JSON array id, trống = mọi kho)
PRAGMA foreign_keys = off;
--> statement-breakpoint
ALTER TABLE `staff_accounts` ADD COLUMN `allowed_warehouse_ids` text DEFAULT '[]';
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
```

- [ ] **Step 2: Thêm cột vào schema cạnh `assignedWarehouseId`**

```ts
// Kho được phân công phụ trách (đặc biệt thu ngân hội chợ). Quản lý gán được.
assignedWarehouseId: text('assigned_warehouse_id').references(() => warehouses.id),
// Danh sách kho POS được phép (JSON array id). Trống = mọi kho sellable (hành vi cũ).
allowedWarehouseIds: text('allowed_warehouse_ids').default('[]').notNull(),
```

- [ ] **Step 3: Viết test cưỡng bức (RED trước): dev DB phải có cột sau migrate**

```ts
// scripts/test-staff-allowed-warehouses.ts
import { createClient } from '@libsql/client';
const db = createClient({ url: 'file:formapubli.db' });
const cols: any = await db.execute(`PRAGMA table_info(staff_accounts)`);
const names = (cols.rows as any[]).map((r) => r.name);
if (!names.includes('allowed_warehouse_ids')) {
  console.error('FAIL thieu cot allowed_warehouse_ids');
  process.exit(1);
}
const staff: any = await db.execute(`SELECT staff_id, allowed_warehouse_ids FROM staff_accounts`);
for (const r of staff.rows as any[]) {
  const v = JSON.parse((r.allowed_warehouse_ids ?? '[]') as string);
  if (!Array.isArray(v)) { console.error(`FAIL ${r.staff_id} khong phai mang`); process.exit(1); }
}
console.log(`PASS cot ton tai, ${staff.rows.length} tai khoan parse duoc`);
```
Top-level await theo style các script `scripts/*.ts` hiện có (nếu runner báo CJS thì bọc `async function main() { ... } main();`).

- [ ] **Step 4: Chạy test → FAIL (chưa migrate dev DB)**

Run: `npx tsx scripts/test-staff-allowed-warehouses.ts`
Expected: FAIL thiếu cột.

- [ ] **Step 5: Migrate dev DB (sao lưu trước) rồi chạy lại → PASS**

Run: `npx tsx scripts/fix-dev-db-schema.ts` (tự sao lưu `.bak`), rồi `npx tsx scripts/test-staff-allowed-warehouses.ts`
Expected: PASS.

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

```bash
git add src/db/migrations/0037_staff_allowed_warehouses.sql src/db/schema.ts scripts/test-staff-allowed-warehouses.ts
git commit -m "feat(staff): migration allowed_warehouse_ids"
```

### Task 3: API staff PATCH + session + cashbox chặn

**Files:**
- Modify: `src/app/api/staff/[staffId]/route.ts:100-113` (thêm nhánh `allowedWarehouseIds` cạnh `assignedWarehouseId`)
- Modify: `src/lib/auth-session.ts:19` (thêm `allowedWarehouseIds?: string[] | null`)
- Modify: `src/app/api/auth/login/route.ts:371,393` (trả thêm trường, parse JSON)
- Modify: `src/app/api/auth/me/route.ts:37` (trả thêm trường)
- Modify: `src/app/api/cashbox/route.ts:110` (chặn kho ngoài list khi OPEN)

**Interfaces:**
- Consumes: cột Task 2 (parse JSON, lỗi parse → `[]`).
- Produces: `session.allowedWarehouseIds: string[]` mà Task 5 đọc từ `/api/auth/me`.

- [ ] **Step 1: Viết test API RED (chạy trên DB cách ly qua run-isolated)**

Test mới `scripts/test-staff-allowed-scope.ts` (chạy qua `npx tsx scripts/run-isolated.ts --only=test-staff-allowed-scope`):
- Tạo 2 kho sellable A, B (id lấy từ `warehouses` thật trong DB test — KHÔNG hardcode chuỗi id, đọc từ DB).
- PATCH staff với `allowedWarehouseIds: [A]` → 200.
- PATCH với `['kho-khong-ton-tai']` → 400 và DB không đổi.
- OPEN cashbox kho B khi allowed=[A] → 403, tin nhắn chứa "không được phép".
- OPEN cashbox kho A → 200 (hoặc lỗi nghiệp vụ khác, nhưng KHÔNG 403 sai kho).

Run: `npx tsx scripts/run-isolated.ts --only=test-staff-allowed-scope`
Expected: FAIL (route chưa biết trường mới).

- [ ] **Step 2: Thêm nhánh PATCH cạnh `assignedWarehouseId`**

```ts
if (body.allowedWarehouseIds !== undefined) {
  const raw = body.allowedWarehouseIds;
  if (raw !== null && !Array.isArray(raw)) throw AppError.invalid('Danh sách kho không hợp lệ.');
  const ids = [...new Set((raw ?? []).map((x: any) => `${x || ''}`.trim()).filter(Boolean))];
  if (ids.length > 0) {
    const rows = await db.select({ id: warehouses.id, isActive: warehouses.isActive }).from(warehouses);
    const ok = new Set(rows.filter((r) => r.isActive === true).map((r) => r.id));
    const bad = ids.filter((id) => !ok.has(id));
    if (bad.length > 0) throw AppError.invalid(`Kho không tồn tại hoặc đã ngưng: ${bad.join(', ')}.`);
  }
  patch.allowedWarehouseIds = JSON.stringify(ids);
  notes.push(ids.length > 0 ? `cho phép ${ids.length} kho` : 'bỏ giới hạn kho');
}
```

Kiểu `patch` phải chứa `allowedWarehouseIds` — nếu object patch có type hẹp, mở rộng type tại chỗ.

- [ ] **Step 3: Session + login + me**

`auth-session.ts`: thêm `allowedWarehouseIds?: string[] | null;` cạnh dòng 19.
Helper parse đặt cạnh type (không đoán vị trí khác):

```ts
export function parseAllowedWarehouseIds(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? [...new Set(v.map((x) => `${x || ''}`.trim()).filter(Boolean))] : [];
  } catch {
    return [];
  }
}
```

`login/route.ts:371,393` và `me/route.ts:37`: thêm `allowedWarehouseIds: parseAllowedWarehouseIds((staffRow as any)?.allowedWarehouseIds ?? session.allowedWarehouseIds ?? [])` theo đúng shape mỗi chỗ đang dùng (đọc 3 chỗ trước khi sửa, giữ nguyên mọi field khác).

- [ ] **Step 4: Cashbox OPEN chặn (cạnh dòng 110)**

```ts
const allowed = parseAllowedWarehouseIds((session as any).allowedWarehouseIds);
if (allowed.length > 0 && !allowed.includes(`${warehouseId}`)) {
  throw AppError.forbidden('Kho này không nằm trong danh sách được phép của tài khoản.');
}
```

Đọc `route.ts:100-120` trước: dùng đúng class lỗi file đó đang dùng cho nhánh assigned (`AppError.forbidden` hay tương đương — giữ nhất quán, không bịa helper mới). KHÔNG thêm kiểm sellable ở đây: kho ngưng sau khi gán do POS cảnh báo + listSellable loại (Task 5); chặn OPEN theo trạng thái là thay đổi hành vi cũ, ngoài phạm vi.

- [ ] **Step 5: Chạy test → PASS + tsc**

Run: `npx tsx scripts/run-isolated.ts --only=test-staff-allowed-scope`
Expected: PASS toàn bộ.

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/staff/[staffId]/route.ts src/lib/auth-session.ts src/app/api/auth/login/route.ts src/app/api/auth/me/route.ts src/app/api/cashbox/route.ts scripts/test-staff-allowed-scope.ts
git commit -m "feat(api): allowed_warehouse_ids + cashbox chan kho ngoai list"
```

### Task 4: StaffManager tick nhiều kho

**Files:**
- Modify: `src/components/settings/StaffManager.tsx:270-292` (dropdown đơn → multi-check)

**Interfaces:**
- Consumes: PATCH `allowedWarehouseIds` Task 3; `warehouses` list component đã có.
- Produces: không có (UI cuối).

- [ ] **Step 1: Đổi ô gán kho thành multi-check**

Giữ nguyên `<td className="px-3 py-2">`, thay `<select>` bằng danh sách checkbox (đọc shape `r` và `warehouses` tại chỗ, giữ `mutate(staffId, patch, confirmMsg)` y nguyên):

```tsx
<div className="max-w-[190px] space-y-1">
  {warehouses.filter((w) => w.isActive).map((w) => {
    const cur: string[] = Array.isArray((r as any).allowedWarehouseIds)
      ? (r as any).allowedWarehouseIds
      : [];
    const checked = cur.includes(w.id);
    return (
      <label key={w.id} className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            const next = e.target.checked ? [...cur, w.id] : cur.filter((x) => x !== w.id);
            mutate(
              r.staffId,
              { allowedWarehouseIds: next },
              next.length > 0
                ? `Cho ${r.staffId} bán ở ${next.length} kho?`
                : `Bỏ giới hạn kho cho ${r.staffId} (bán mọi kho)?`
            );
          }}
          className="w-4 h-4 accent-indigo-600"
        />
        <span className="truncate">{w.name}</span>
      </label>
    );
  })}
  <p className="text-[10px] text-slate-400">Trống = bán mọi kho.</p>
</div>
```

`r` phải có `allowedWarehouseIds`: mở rộng type dòng 12 + chỗ nạp list staff trong file (đọc trước, thêm `allowedWarehouseIds?: string[] | null`, parse JSON lúc nạp).

- [ ] **Step 2: tsc + verify dev**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

Mở Cài đặt → Nhân sự trên dev, tick/bỏ tick 1 kho → confirm hiện → reload giữ nguyên.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/StaffManager.tsx
git commit -m "feat(staff): tick nhieu kho POS cho moi tai khoan"
```

### Task 5: POS lọc theo allowed + cảnh báo + mặc định

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx:207-231` (đọc allowed từ `/api/auth/me`)
- Modify: `src/components/pos/PosCheckoutTerminal.tsx:1024-1040` (lọc sellable theo allowed + mặc định kho đầu)

**Interfaces:**
- Consumes: `allowedWarehouseIds` từ `/api/auth/me` (Task 3).

- [ ] **Step 1: Đọc allowed khi nạp session (cạnh dòng 216-219)**

```tsx
const allowed: string[] = Array.isArray((j?.data as any)?.allowedWarehouseIds)
  ? (j.data as any).allowedWarehouseIds.filter((x: any) => `${x || ''}`.trim())
  : [];
if (allowed.length > 0) setAllowedWarehouseIds(allowed);
```

Thêm state `const [allowedWarehouseIds, setAllowedWarehouseIds] = useState<string[]>([]);` cạnh `lockedWarehouseId` (dòng 200). Giữ nguyên nhánh `assignedWarehouseId` khóa cứng.

- [ ] **Step 2: Lọc list + mặc định + cảnh báo (trong effect dòng 1024-1040)**

```tsx
const res = await fetch('/api/warehouses');
const json = await res.json();
if (json.success && Array.isArray(json.data) && json.data.length > 0) {
  const allowedNow = allowedWarehouseIdsRef.current; // ref mirror như selectedWarehouseIdRef:692-696
  const visible = allowedNow.length > 0
    ? json.data.filter((w: any) => allowedNow.includes(w.id))
    : json.data;
  setSellableWarehouses(visible);
  setSelectedWarehouseId((prev) =>
    visible.some((w: any) => w.id === prev) ? prev : (visible[0]?.id ?? prev)
  );
  const missing = allowedNow.filter((id) => !json.data.some((w: any) => w.id === id));
  setAllowedMissing(missing);
}
```

Thêm `allowedWarehouseIdsRef` mirror theo đúng mẫu dòng 692-696, state `allowedMissing: string[]`, và 1 dòng cảnh báo dưới selector: kho allowed nhưng vắng mặt → "Kho được gán đã ngưng/bị ẩn — liên hệ quản lý." Hiển thị id (không đoán tên).

- [ ] **Step 3: tsc + verify dev**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

Trên dev: tài khoản tick 2 kho → POS chỉ hiện 2; bỏ tick hết → hiện tất cả; gán kho ngưng → thấy cảnh báo.

- [ ] **Step 4: Commit**

```bash
git add src/components/pos/PosCheckoutTerminal.tsx
git commit -m "feat(pos): loc kho theo tai khoan + canh bao kho mat"
```

### Task 6: Verify tầng 1-3

- [ ] **Step 1: tsc + suites liên quan**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

Run: `npx tsx scripts/run-isolated.ts --only=test-staff-allowed-scope,test-staff-allowed-warehouses`
Expected: PASS. (Tên suite thứ hai theo file Task 2 tạo — đọc tên `--only` runner hỗ trợ trước khi chạy.)

- [ ] **Step 2: build (bắt buộc nếu Task 1/4/5 đụng CSS — nếu không đụng CSS thì bỏ qua có ghi ledger)**

Run: `npm run build`
Expected: xong không lỗi. CHỈ chạy khi không có `next dev` đang chạy (kiểm `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`); có dev chạy → dừng dev trước theo luật repo.

- [ ] **Step 3: verify POS live + kiểm tay Núi Trúc**

Run: `npx tsx scripts/verify-pos-live.ts` (hoặc `POS_BASE_URL=https://localhost:3000` nếu dev đang https).
Expected: PASS.

Tay: bật "Bán POS" Núi Trúc trong Quản Lý Kho → POS hiện Núi Trúc; tắt → mất; tồn kho Núi Trúc không đổi (đối chiếu ma trận tồn trước/sau).
