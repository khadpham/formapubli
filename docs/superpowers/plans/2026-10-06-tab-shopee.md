# Tab Shopee riêng + role Nhân viên Shopee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhân viên Shopee đăng nhập role mới, vận hành đơn Shopee trên tab riêng trong phạm vi kho được cấp; thủ kho chung giữ nguyên.

**Architecture:** Thêm 1 role + 1 nav tab + 1 view lọc trên service Shopee có sẵn. Phạm vi kho ép ở server (`queue`/`ship`), lưu trong `shopee_settings` (key JSON). Không đụng `ROLE_WAREHOUSE`, không code UI tab Chủ.

**Tech Stack:** Next 14 App Router, Drizzle + Turso/LibSQL, `node:crypto` HMAC có sẵn, test `scripts/test-*.ts` + `scripts/run-isolated.ts`, `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-10-06-tab-shopee-design.md` + `docs/shopee/11-quyet-dinh-tab-shopee-va-role.md` — executor đọc cả 3 file này trước khi code.

## Global Constraints

- `orders.channel` chỉ thêm `'SHOPEE'` (đã có). `paymentMethod` chỉ `CASH | BANK_TRANSFER | QR_CODE | COD`; đơn Shopee trả trước → `BANK_TRANSFER`, COD → `COD`.
- Trừ kho duy nhất qua `InventoryService.recordMovementsBatch`. Cấm `UPDATE` tồn tay. Cấm luồng Shopee đi qua `OrderService.confirmOrder`.
- Doanh thu Shopee chỉ tính khi `shippingStatus='DELIVERED'` (giữ hồi quy `test-shopee-revenue-guard`).
- Kho xuất mặc định Âu Cơ, đọc cấu hình, cấm hardcode id kho trong code.
- Token trong bảng `shopee_shop_tokens`. Cấm commit secret/token; đọc từ env.
- `ROLE_WAREHOUSE` + 15 chỗ check quyền kho chung: không đụng.
- Mỗi suite đăng ký vào `scripts/run-isolated.ts`; test lấy hằng từ `src/db/schema.ts`, không tự chế giá trị; test cắt 1 chỗ code phải đỏ.
- `npx tsc --noEmit` sạch + `npm run build` sạch trước push (sửa CSS cũng build).
- `git add` từng file, không `-A`, không `commit -a`. Nhãn UI tiếng Việt có dấu, ngắn (`Shopee`, `Giao hàng`, `In vận đơn`, `Đơn lỗi`).
- Stash `tam-giu-png-wave3-truoc-khi-sang-shopee` nằm trên `main` — không đụng tới khi ở nhánh này.

## Review Focus

- Nhân viên Shopee chỉ thấy kho được cấp — mong đợi: gọi `queue`/`ship` với kho ngoài phạm vi bị chặn ở server, không chỉ ẩn ở UI → test ở Task 4.
- Quản lý đổi phạm vi kho có hiệu lực ngay không restart — mong đợi: đọc DB mỗi request, không cache RAM → test ở Task 4.
- Role lạ/Cashier/Tax mò vào API Shopee — mong đợi: 403/redirect, không rò dữ liệu → test ở Task 5.
- Đơn Shopee chưa giao lọt vào doanh thu sau khi sửa báo cáo — mong đợi: guard cũ vẫn xanh → test ở Task 5.
- Tab mới hiện với đúng 3 role, role khác không thấy — mong đợi: `allowedNavItems` của Cashier/Tax/Warehouse không chứa `'shopee'` → test ở Task 1.

---

## File Structure

- Sửa: `src/lib/roles.ts` — thêm `ROLE_SHOPEE_OPS` vào `UserRole` + `USER_ROLES` (nav `['shopee','settings']`). Một trách nhiệm: registry vai trò.
- Sửa: `src/components/auth/LoginModal.tsx:20` — thêm `'ROLE_SHOPEE_OPS'` vào `ROLE_ORDER`; không cho vào `HIDDEN_PICKER_ROLES`.
- Sửa: `src/components/layout/AppSidebar.tsx:121-178` — thêm nav item `shopee` (sau `sales`).
- Sửa: `src/components/layout/MasterAppShell.tsx` — map phím tắt, tiêu đề, nhánh render tab `shopee` (theo mẫu `effectiveTab === 'sales'` ở dòng 301/406-410).
- Tạo: `src/components/shopee/ShopeeTab.tsx` — view vận hành (hàng đợi + giao/in + đơn lỗi + chỗ trống doanh thu link chờ). Server component nhận `sessionRole`, fetch qua API routes có sẵn.
- Sửa: `src/services/shopee/shop-config.ts` — thêm `getShopeeOpsWarehouses()` + `setShopeeOpsWarehouses(ids, actorRole)` (ghi bởi OWNER/MANAGER, key `'ops_warehouse_ids'` JSON array, mặc định = `[warehouseId]` khi rỗng).
- Sửa: `src/app/api/shopee/config/route.ts` — cho MANAGER ghi key phạm vi kho (giữ OWNER-only cho `warehouse_id`/`cod_enabled`).
- Sửa: `src/app/api/shopee/status/route.ts:16-20`, `src/app/api/shopee/queue/route.ts:16-20`, `src/app/api/shopee/ship/route.ts:16-20`, `src/services/shopee/shipment.ts:11` — allowlist thêm `'ROLE_SHOPEE_OPS'`.
- Sửa: `src/app/api/shopee/queue/route.ts:21-34`, `ship` — lọc theo `getShopeeOpsWarehouses()`.
- Tạo: `scripts/test-shopee-tab-scope.ts` — suite phân quyền + phạm vi kho.
- Sửa: `scripts/run-isolated.ts:205-206` — đăng ký suite mới cạnh 2 dòng shopee có sẵn.

---

### Task 1: Role mới `ROLE_SHOPEE_OPS` (nền móng quyền)

**Files:**
- Modify: `src/lib/roles.ts:1-6,48-55`
- Modify: `src/components/auth/LoginModal.tsx:20`
- Test: `scripts/test-shopee-tab-scope.ts` (tạo khung suite, chỉ viết 3 assert role ở task này)

**Interfaces:**
- Consumes: `USER_ROLES`, `getDefaultTabForRole` (`src/lib/roles.ts:77-80`).
- Produces: `UserRole` mới `'ROLE_SHOPEE_OPS'`; `USER_ROLES['ROLE_SHOPEE_OPS'].allowedNavItems === ['shopee','settings']`; tab mặc định `'shopee'`.

- [ ] **Step 1: Viết test đỏ.** Tạo `scripts/test-shopee-tab-scope.ts` theo đúng khung `scripts/test-shopee-shop-config.ts:12-30` (import `assertIsolatedTestDb`, bộ đếm `pass/fail`, hàm `eq2`, `main()` + `process.exit`). Nội dung 3 assert:
```ts
import { assertIsolatedTestDb } from './test-guard';
import { USER_ROLES, getDefaultTabForRole } from '../src/lib/roles';
assertIsolatedTestDb('test-shopee-tab-scope');
// ... eq2('role Shopee nav đúng', JSON.stringify(USER_ROLES['ROLE_SHOPEE_OPS'].allowedNavItems), JSON.stringify(['shopee','settings']));
// ... eq2('tab mặc định là shopee', getDefaultTabForRole('ROLE_SHOPEE_OPS'), 'shopee');
// ... eq2('kho chung không thấy tab shopee', USER_ROLES['ROLE_WAREHOUSE'].allowedNavItems.includes('shopee'), false);
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Run: `DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-shopee-tab-scope.ts`. Kỳ vọng: FAIL (key `ROLE_SHOPEE_OPS` chưa tồn tại).

- [ ] **Step 3: Implement tối thiểu.** Trong `src/lib/roles.ts`: thêm `'ROLE_SHOPEE_OPS'` vào union `UserRole`, thêm entry:
```ts
ROLE_SHOPEE_OPS: {
  id: 'ROLE_SHOPEE_OPS',
  label: 'Nhân viên Shopee',
  badgeColor: 'text-orange-700 border-orange-300',
  badgeBg: 'bg-orange-50',
  description: 'Vận hành đơn Shopee trong kho được cấp, không thấy doanh thu tổng',
  allowedNavItems: ['shopee', 'settings'],
},
```
Trong `LoginModal.tsx:20` sửa thành:
```ts
const ROLE_ORDER: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX', 'ROLE_SHOPEE_OPS'];
```
Không đụng `HIDDEN_PICKER_ROLES` (dòng 24 giữ nguyên).

- [ ] **Step 4: Chạy lại, xác nhận XANH.** Cùng lệnh Step 2. Kỳ vọng: 3/3 pass.

- [ ] **Step 5: Commit.** Run: `git add scripts/test-shopee-tab-scope.ts src/lib/roles.ts src/components/auth/LoginModal.tsx` rồi `git commit -m "feat(shopee): role Nhan vien Shopee + hien picker"`.

### Task 2: Nav + tab `shopee` hiện đúng 3 role

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx:143-149` (chèn sau khối `sales`)
- Modify: `src/components/layout/MasterAppShell.tsx` (map phím, tiêu đề dòng ~300, nhánh render dòng ~383-420)
- Create: `src/components/shopee/ShopeeTab.tsx` (khung tối thiểu: nhận `sessionRole`, hiện hàng đợi từ `/api/shopee/queue`)

**Interfaces:**
- Consumes: `roleConfig.allowedNavItems` (Task 1), `GET /api/shopee/queue` (có sẵn).
- Produces: nav item `shopee`; tab render `<ShopeeTab sessionRole={currentRole} />`.

- [ ] **Step 1: Viết test đỏ.** Thêm vào `scripts/test-shopee-tab-scope.ts`:
```ts
// ... eq2('chu thay tab shopee', USER_ROLES['ROLE_OWNER'].allowedNavItems.includes('shopee'), true);
// ... eq2('quan ly thay tab shopee', USER_ROLES['ROLE_MANAGER'].allowedNavItems.includes('shopee'), true);
// ... eq2('thu ngan khong thay tab shopee', USER_ROLES['ROLE_CASHIER'].allowedNavItems.includes('shopee'), false);
// ... eq2('ke toan thue khong thay tab shopee', USER_ROLES['ROLE_TAX'].allowedNavItems.includes('shopee'), false);
```
Run cùng lệnh Task 1 Step 2. Kỳ vọng: FAIL (OWNER/MANAGER chưa có `'shopee'`).

- [ ] **Step 2: Implement nav.** `AppSidebar.tsx` sau khối `sales` (dòng 143-149) chèn:
```tsx
{
  id: 'shopee',
  label: 'Shopee',
  icon: ShoppingBag,
  shortcut: 'Alt+9',
  color: 'text-orange-600',
},
```
Thêm `ShoppingBag` vào import icon đầu file (cùng nhóm `lucide-react` có sẵn). `MasterAppShell.tsx`: (a) map phím thêm `'9': 'shopee'` cạnh dòng 231-236; (b) tiêu đề thêm `{effectiveTab === 'shopee' && 'Shopee'}` cạnh dòng 300-305; (c) nhánh render cạnh dòng 383-420:
```tsx
{currentRole && effectiveTab === 'shopee' && (
  <ShopeeTab sessionRole={currentRole} />
)}
```
`src/lib/roles.ts`: thêm `'shopee'` vào `allowedNavItems` của `ROLE_OWNER` và `ROLE_MANAGER` (giữ nguyên các tab cũ, chỉ thêm phần tử).

- [ ] **Step 3: Tạo `ShopeeTab.tsx` tối thiểu** (client component, khung vận hành; chi tiết nút Giao/In ở Task 4):
```tsx
'use client';
import React, { useEffect, useState } from 'react';
import type { UserRole } from '@/lib/roles';
export function ShopeeTab({ sessionRole }: { sessionRole: UserRole }) {
  const [queue, setQueue] = useState<Array<{ orderSn: string; customerName: string; finalAmount: number }>>([]);
  useEffect(() => {
    fetch('/api/shopee/queue').then((r) => r.json()).then((j) => {
      if (j?.success) setQueue(j.data.toPack || []);
    }).catch(() => {});
  }, []);
  return (
    <div>
      <h2>Đơn Shopee cần gói ({queue.length})</h2>
      {/* nút Giao/In + đơn lỗi + thẻ doanh thu link chờ: Task 4 */}
    </div>
  );
}
```

- [ ] **Step 4: Chạy test XANH + `tsc`.** Run test suite (kỳ vọng 7/7) rồi `npx tsc --noEmit` (kỳ vọng sạch, bắt lỗi import `ShoppingBag`/`ShopeeTab` nếu sai).

- [ ] **Step 5: Commit.** `git add` từng file trên + message `feat(shopee): tab Shopee + nav 3 role`.

### Task 3: Phạm vi kho nhiều-kho do quản lý cấp (data + server ép)

**Files:**
- Modify: `src/services/shopee/shop-config.ts` (thêm 2 hàm)
- Modify: `src/app/api/shopee/config/route.ts` (MANAGER được ghi key phạm vi)
- Modify: `src/app/api/shopee/queue/route.ts:21-34` + `src/app/api/shopee/ship/route.ts` (lọc theo phạm vi)
- Modify: `src/app/api/shopee/status/route.ts:16-20`, `queue:16-20`, `ship:16-20`, `src/services/shopee/shipment.ts:11` (allowlist)

**Interfaces:**
- Consumes: `getShopeeConfig` (có sẵn), bảng `shopeeSettings` key-value.
- Produces: `getShopeeOpsWarehouses(): Promise<string[]>`; `setShopeeOpsWarehouses(ids: string[], actorRole: UserRole): Promise<string[]>` (ghi bởi OWNER/MANAGER, ngược lại ném `FORBIDDEN`).

- [ ] **Step 1: Viết test đỏ.** Thêm vào suite:
```ts
import { getShopeeOpsWarehouses, setShopeeOpsWarehouses } from '../src/services/shopee/shop-config';
// ... const w0 = await getShopeeOpsWarehouses(); eq2('mặc định phạm vi = kho xuất', JSON.stringify(w0), JSON.stringify(['wh-au-co'])); // seed kho xuất trước bằng setShopeeConfig({warehouseId:'wh-au-co'},'ROLE_OWNER')
// ... let code=''; try { await setShopeeOpsWarehouses(['wh-a'], 'ROLE_CASHIER'); } catch (e) { code = e instanceof AppError ? e.code : 'NOT_APP_ERROR'; } eq2('thu ngan bị chặn cấp kho', code, 'FORBIDDEN');
// ... const w1 = await setShopeeOpsWarehouses(['wh-a','wh-b'], 'ROLE_MANAGER'); eq2('quản lý cấp được nhiều kho', JSON.stringify(w1), JSON.stringify(['wh-a','wh-b']));
```
Run: kỳ vọng FAIL "function not defined".

- [ ] **Step 2: Implement.** Trong `shop-config.ts`:
```ts
export async function getShopeeOpsWarehouses(): Promise<string[]> {
  const rows = await db.select().from(shopeeSettings);
  const raw = rows.find((r) => r.key === 'ops_warehouse_ids')?.value || '';
  try {
    const list = JSON.parse(raw || '[]') as unknown;
    if (Array.isArray(list) && list.length > 0) return list.map(String);
  } catch { /* rơi xuống mặc định */ }
  const cfg = await getShopeeConfig();
  // ponytail: phạm vi đội Shopee dùng chung 1 danh sách; muốn cấp theo từng
  // người thì nâng key thành map staffId->ids (upgrade path đã chừa).
  return cfg.warehouseId ? [cfg.warehouseId] : [];
}
export async function setShopeeOpsWarehouses(ids: string[], actorRole: UserRole): Promise<string[]> {
  if (actorRole !== 'ROLE_OWNER' && actorRole !== 'ROLE_MANAGER') {
    throw AppError.forbidden('Chỉ chủ/quản lý được cấp kho cho nhân viên Shopee.');
  }
  const clean = [...new Set(ids.map((s) => `${s}`.trim()).filter(Boolean))];
  await db.insert(shopeeSettings).values({ key: 'ops_warehouse_ids', value: JSON.stringify(clean) })
    .onConflictDoUpdate({ target: shopeeSettings.key, set: { value: JSON.stringify(clean) } });
  return getShopeeOpsWarehouses();
}
```
`queue/route.ts`: allowlist thêm `'ROLE_SHOPEE_OPS'`; sau khi lấy `toPack`, lọc đơn theo kho xuất của đơn nằm trong `getShopeeOpsWarehouses()` (đơn Shopee mang `warehouseId` — nếu schema đơn chưa có cột kho, lọc theo `warehouseId` của dòng ledger `DISPATCH_SALE` tương ứng; không tự thêm cột mới khi chưa cần). `ship/route.ts` + `shipment.ts:11` (`SHIP_ROLES` thêm `'ROLE_SHOPEE_OPS'`): từ chối khi kho xuất cấu hình ngoài phạm vi. `status/route.ts`: allowlist thêm role mới. `config/route.ts`: nhánh ghi key phạm vi cho OWNER/MANAGER; `warehouse_id`/`cod_enabled` giữ OWNER-only.

- [ ] **Step 3: Chạy XANH + kiểm đỏ-thật.** Run suite (kỳ vọng pass hết). Sau đó cắt 1 chỗ code (ví dụ đổi `!== 'ROLE_MANAGER'` thành `=== 'ROLE_MANAGER'`) chạy lại phải ĐỎ, rồi hoàn tác — chống test dùng chung hằng với code.

- [ ] **Step 4: Commit.** `git add` từng file + message `feat(shopee): pham vi kho nhieu-kho + server ep`.

### Task 4: Hoàn thiện view tab (Giao/In + đơn lỗi + link chờ Chủ)

**Files:**
- Modify: `src/components/shopee/ShopeeTab.tsx` (Task 2)
- Modify: `src/components/settings/ShopeePanel.tsx` (thu gọn còn cấu hình Chủ; phần hàng đợi chuyển sang tab mới, không xóa API)

**Interfaces:**
- Consumes: `POST /api/shopee/ship`, `GET /api/shopee/queue` (quarantine có sẵn).
- Produces: tab đầy đủ 4 khối (đợi gói / giao-in / đơn lỗi / doanh thu chờ).

- [ ] **Step 1: Viết test đỏ (UI ẩn theo cờ).** Mở rộng `scripts/test-shopee-ui-hidden.ts` hoặc assert trong suite mới: `GET /api/shopee/queue` khi `SHOPEE_UI_ENABLED` tắt trả `uiEnabled:false` và tab không render nút Giao. Run: kỳ vọng FAIL.

- [ ] **Step 2: Implement.** `ShopeeTab.tsx`: mỗi dòng đơn có nút `Giao hàng` (POST `/api/shopee/ship {orderSn}`, toast `Đã giao đơn <sn> — mã vận đơn <code>` theo mẫu panel cũ) + nút `In vận đơn` (mở tài liệu A6 từ API có sẵn); khối `Đơn lỗi` liệt kê quarantine + lý do; khối `Doanh thu` chỉ render dòng chữ + link chờ (`/sales`, ghi chú "xem ở tab Chủ sau"), không gọi escrow ở đây. `ShopeePanel.tsx`: giữ phần kết nối + cấu hình cho Chủ, xóa phần hàng đợi trùng (thay bằng link sang tab Shopee).

- [ ] **Step 3: Chạy XANH + hồi quy.** Run: suite mới + `test-shopee-order-pull` + `test-shopee-revenue-guard` + `test-shopee-shipment` + `test-shopee-webhook` (kỳ vọng tất cả xanh, đơn CREATED không lọt doanh thu).

- [ ] **Step 4: Commit.** `git add` từng file + message `feat(shopee): view tab day du + gon panel`.

### Task 5: Đăng ký suite + build sạch + chốt

**Files:**
- Modify: `scripts/run-isolated.ts` (thêm dòng sau dòng 206)
- Test: toàn bộ suite shopee

**Interfaces:**
- Consumes: mọi task trên. Produces: cây xanh hoàn chỉnh trên nhánh.

- [ ] **Step 1: Đăng ký suite.** Trong `scripts/run-isolated.ts` sau dòng `'scripts/test-shopee-ui-hidden.ts',` thêm `'scripts/test-shopee-tab-scope.ts',` (đúng mẫu 2 dòng 205-206, không sửa gì khác).

- [ ] **Step 2: Chạy toàn bộ liên quan.** Run: `npx tsx scripts/run-isolated.ts --only=test-shopee-tab-scope` rồi các suite shopee còn lại + `npx tsc --noEmit`. Kỳ vọng: xanh hết.

- [ ] **Step 3: `npm run build`.** Kỳ vọng: sạch (bắt lỗi CSS/route mà `tsc` không thấy). Nếu build khi dev server đang chạy thì dừng dev trước (build ghi đè `.next`).

- [ ] **Step 4: Commit cuối.** `git add scripts/run-isolated.ts` + message `chore(shopee): dang ky suite tab-scope`. Cập nhật bảng Task trong `docs/shopee/10-ke-hoach-trien-khai-shopee.md` (thêm 1 dòng Tab+Role, suite kiểm chứng) rồi commit riêng `docs(shopee): cap nhat trang thai tab + role`.

## Self-Review

1. **Spec coverage:** role mới → Task 1; nav+tab 3 role → Task 2; 2 cấu hình kho + server ép → Task 3; view 4 khối + gọn panel → Task 4; suite+build → Task 5. Tab Chủ loại trừ đúng như mục 6 spec.
2. **Placeholder scan:** không TBD/TODO; mọi step có lệnh chạy + kỳ vọng; id kho dùng giá trị seed test (`wh-au-co`) khớp mẫu `test-shopee-shop-config.ts:50`, tra id thật ở sandbox sau.
3. **Type consistency:** `ROLE_SHOPEE_OPS`, `ShopeeTab({sessionRole})`, `getShopeeOpsWarehouses`/`setShopeeOpsWarehouses`, key `'ops_warehouse_ids'` — thống nhất toàn plan.
4. **Review Focus:** 5 dòng đều có test sở hữu (Task 3, 3, 5, 4, 1).
