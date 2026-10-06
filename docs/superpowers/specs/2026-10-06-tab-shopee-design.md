# SPEC: Tab Shopee riêng + role Nhân viên Shopee

- Ngày: 06/10/2026. Nhánh: `feat/shopee-skeleton`.
- Nền: Task 1–9 tích hợp Shopee đã code xong + test mock xanh (chưa merge main,
  chưa deploy, chờ sandbox). Quyết định chi tiết: `docs/shopee/11-quyet-dinh-tab-shopee-va-role.md`.
- Mục tiêu: nhân viên Shopee vận hành độc lập trên tab riêng; Chủ chỉ thấy
  doanh thu ở tab Chủ (làm sau, không code trong đợt này).

## 1. Role mới `ROLE_SHOPEE_OPS`

- Label "Nhân viên Shopee", PIN riêng, nav `['shopee','settings']`.
- Hiện trong picker nhanh (`LoginModal`, không cho vào `HIDDEN_PICKER_ROLES`).
- `ROLE_WAREHOUSE` giữ nguyên toàn bộ (15 chỗ check kho chung không đụng).
- Tab Shopee hiện với: `ROLE_OWNER`, `ROLE_MANAGER`, `ROLE_SHOPEE_OPS`.
  `ROLE_CASHIER`, `ROLE_TAX`, `ROLE_WAREHOUSE`: không thấy tab.

## 2. Tab `shopee` (view lọc, cấm nhân đôi logic)

- Khối hàng đợi cần gói: đơn `channel='SHOPEE'`, lọc theo kho được cấp.
- Nút Gói/Giao/In A6 tái dùng `shipment.ts` + API `/api/shopee/ship`.
- Khối đơn lỗi quarantine: SKU lạ + lý do, tái dùng `order-sync.quarantineUnmatchedSku`.
- Khối cấu hình (chỉ Chủ): kết nối shop, kho xuất, cờ COD — dời từ `ShopeePanel`.
- Chỗ trống thẻ doanh thu escrow: link chờ sang tab Chủ, không code UI Chủ.

## 3. Hai cấu hình kho tách bạch

- (a) `warehouse_id`: kho xuất đơn Shopee duy nhất, mặc định Âu Cơ. Chỉ Chủ đổi.
- (b) Danh sách kho nhân viên được thấy: nhiều kho, `ROLE_MANAGER` trở lên cấp
  qua multi-select, lưu JSON array trong `shopee_settings`, hiệu lực ngay không
  deploy. Mặc định (b) = [(a)].
- Phạm vi (b) ép ở **server** trong `/api/shopee/queue` và `/api/shopee/ship`,
  không chỉ lọc ở UI. Role lạ không trong registry vẫn thấy tab trắng
  (theo `getDefaultTabForRole` trả `''`).

## 4. API thay đổi

- `/api/shopee/status|queue|ship`: allowlist thêm `ROLE_SHOPEE_OPS`.
- `/api/shopee/config`: giữ chỉ `ROLE_OWNER`; thêm đọc/ghi key danh sách kho
  cho nhân viên (ghi bởi `OWNER`/`MANAGER`, đọc bởi 3 role tab Shopee).
- Không trả secret/token về client (giữ như `status` hiện tại).

## 5. Test + nghiệm thu

- Suite mới `scripts/test-shopee-tab-scope.ts` (đăng ký `run-isolated.ts`):
  role mới thấy đúng kho được cấp; kho ngoài phạm vi bị chặn ở server;
  role lạ/Cashier/Tax không vào được API.
- Mock: `scripts/shopee-fake-api.ts` + seed kho Âu Cơ + 1 đơn SKU lạ.
- Nghiệm thu: Gói→Giao→In hết luồng; quản lý đổi phạm vi có hiệu lực ngay;
  đơn chưa `DELIVERED` không lọt doanh thu (hồi quy `test-shopee-revenue-guard`);
  `tsc` sạch + `npm run build` sạch (sửa CSS cũng build).

## 6. Ngoài phạm vi (không làm đợt này)

- UI tab Chủ, thẻ doanh thu/lãi ròng (data `escrow-sync` đã có, UI sau).
- `add_item` đăng sản phẩm (đăng tay xong rồi).
- Sandbox thật (chờ `partner_id/key` + `item_id` 55 listing).
