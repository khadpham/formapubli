# AGENT A — BIÊN BẢN NGHIỆM THU (25/09/2026)

> Vai trò A theo `2026-09-25-handoff-state.md` §1: **chỉ review, không sửa code sản phẩm**.
> Biên bản này là đầu vào để **B** thực hiện mục 5 (CÒN) #1 và #2. A không merge,
> không commit, không deploy.

Tham chiếu: `docs/superpowers/plans/2026-09-25-handoff-state.md` (mục 5),
`docs/superpowers/plans/2026-09-24-pos-hardening-abc-master-plan.md` (A1-F, A4),
`docs/superpowers/plans/2026-09-25-pos-ui-floating-sheet-qr-freeze.md`.

## 0. Lưu ý ref trước khi đọc diff (dễ gây kết luận sai)

`git rev-parse main` trong cả hai worktree = **`4a50a2b`** (ref `main` local CŨ),
trong khi `origin/main` = **`b9d15f6`** (docs handoff trên `f344aae`).
Vì vậy `git diff main...HEAD` trong `formapubli-b-af` phóng đại phạm vi (hiện cả
file S-01). Phạm vi thật của A1-F là **chỉ commit `2ab88f3`**:

```text
2ab88f3  scripts/test-discount-checkout-atomic.ts            | 317 +++-
         src/app/api/pos/discount-approvals/[id]/route.ts   |  32 +-
         src/app/api/pos/discount-approvals/route.ts        |   7 +-
         src/services/discount-approval.service.ts          |  60 +-
```

## 1. Phạm vi nghiệm thu

| Hạng mục | Branch / SHA | Kết luận A |
|---|---|---|
| A1-F (API CANCEL, scoping, D-matrix) | `agent/b-approval-full` = `2ab88f3` | **ĐẠT** (điều kiện: chạy test trong shell sạch — xem §4) |
| #7 / #8 / freeze UI của C | `agent/c-login-ux` = `aaedbbd` | **CHƯA ĐẠT** — 5 khoảng thiếu so với handoff §5.2 (xem §3) |
| Tích hợp 2 nhánh | merge dry-run | **SẠCH**, giữ đủ 3 đóng góp (xem §5) |

## 2. Bằng chứng đã chạy lại (không tin báo cáo miệng)

| Lệnh | Nơi chạy | Kết quả |
|---|---|---|
| `npx tsc --noEmit` | `formapubli-b-af` (`2ab88f3`) | exit 0 |
| `npx tsx scripts/test-discount-checkout-atomic.ts` | `formapubli-b-af` | exit 0 — `D01–D11 + DP1a + A1.7/CANCEL PASS` |
| `npx tsc --noEmit` | `formapubli` (`aaedbbd`) | exit 0 |
| `npx tsx scripts/run-real-pos-terminal-test.ts` | `formapubli` | exit 0 — **10/10 PASS** + 8 ảnh PNG tái sinh |
| `git merge-tree --write-tree agent/b-approval-full agent/c-login-ux` | `formapubli` | exit 0, không conflict (tree `733779f`) |

A1-F service được đọc trực tiếp: `cancelRequest` dùng **conditional UPDATE
PENDING/APPROVED → SUPERSEDED** + kiểm chủ sở hữu, race cancel-vs-checkout trả
409 — đúng master plan A1-F. `listPending(warehouseId, cashierId)` chặn cashier
thấy yêu cầu của thu ngân khác; `GET/POST [id]` thêm scoping A1.7.

## 3. Khoảng thiếu của C (`aaedbbd`) — hợp đồng handoff §5.2

Handoff yêu cầu: *freeze giỏ khi pending/**approved** + nút "Sửa giỏ và hủy phê
duyệt" **gọi API CANCEL** (POST `/api/pos/discount-approvals/[id]`, body
`{action:'CANCEL'}`), drawer manager hiện `cartSnapshot`*, và quan sát thêm yêu
cầu "Đã nhận tiền = xác nhận tay".

| # | Phát hiện | Bằng chứng | Mức độ |
|---|---|---|---|
| F1 | `handleCancelApproval()` chỉ reset state local, **không gọi API CANCEL** → yêu cầu duyệt còn `PENDING/APPROVED` phía server (bản ghi mồ côi, vẫn chiếm hàng đợi/được xem là hợp lệ) | `PosCheckoutTerminal.tsx:230-239`; không có `fetch` nào tới `discount-approvals/[id]` trong component | **Chặn nghiệm thu** |
| F2 | `handleCancelApproval()` không xoá `approvedDiscountRequestId` → id duyệt cũ rò rỉ sang đơn sau (`discountApprovalId` vẫn được gửi ở lần checkout kế tiếp) | `PosCheckoutTerminal.tsx:224, 230-239, 992`; chỉ được set lại ở `2491` và clear ở `1031` | **Chặn nghiệm thu** |
| F3 | Freeze không giữ **sau khi đã duyệt**: `onApproved` đặt `setIsApprovalPending(false)` → giỏ mở khoá; thu ngân sửa giỏ rồi chốt sẽ bị server **403 cứng** (`assertValidForCheckout` FORBIDDEN) và mất lượt duyệt | `PosCheckoutTerminal.tsx:2488-2490`; route `assertValidForCheckout` → 403 | Cao (UX/state) |
| F4 | Drawer quản lý vẫn dùng danh sách `GET /api/pos/discount-approvals`, **không hiện `cartSnapshot`** (GET `[id]` đã trả đủ như handoff nói) | `ManagerApprovalDrawer.tsx:46,74-79` — không có `cartSnapshot` trong file | Trung bình |
| F5 | Chưa có bước "Đã nhận tiền" (xác nhận tay) cho Chuyển khoản/QR | grep `Đã nhận tiền|markReceived|receivedMoney` trong `src/components/**` = 0 kết quả; `VietQrPay.tsx` không có callback xác nhận | Trung bình |

Điểm **đạt** của C: dropdown gộp đúng 2 lựa chọn (giữ enum `BANK_TRANSFER`,
`QR_CODE` chỉ còn là giá trị map để tương thích/offline), `VietQrPay` hiện cho cả
2 nhánh, nút nổi `#cart-checkout-bar` (line 2530) mở sheet **không tự chốt đơn**,
sheet `#mobile-checkout-sheet` đóng/mở giữ giỏ, không tràn ngang ở 320/375/390px,
banner `#pos-cart-frozen-banner` + disable `+/-/xóa giỏ/chiết khấu` khi pending.

### Ghi chú kỹ thuật để C sửa F1 (không phải chỉ thêm 1 dòng)

Trong pha *pending*, component chưa biết `requestId` (id do
`DiscountApprovalModal` tạo nội bộ, chỉ truyền lên qua `onApproved`). Cần:
1. Modal phát thêm `requestId` ngay khi tạo yêu cầu (hoặc `onCancelRequest`),
2. component gọi `POST /api/pos/discount-approvals/${requestId}` `{action:'CANCEL'}`,
3. chỉ bỏ freeze sau khi API trả OK; lỗi 409 → tải lại trạng thái, không tự mở khoá,
4. và luôn `setApprovedDiscountRequestId(null)` trong nhánh huỷ (F2).

**Điều kiện tiên quyết:** API `CANCEL` chỉ tồn tại sau khi `2ab88f3` vào `main`.
C phải làm trên base **sau** merge (B merge `main` vào `agent/c-login-ux` rồi C sửa),
nếu không sẽ gọi endpoint 404.

## 4. Cảnh báo môi trường: `MANAGER_PIN_HASHES` rác trong shell (đã gây ĐỎ OAN)

Lần chạy đầu, D10 đỏ: `Gift + PIN đúng phải 200, thực tế 403`.
Root cause (đã chứng minh, không đoán): biến môi trường **process-scope** của shell
đang là

```text
MANAGER_PIN_HASHES="mpv2,mpv2"   # giá trị rác; User/Machine scope = rỗng
```

`getWhitelistHashes()` thấy có giá trị nên **không** dùng fallback dev
(`['9999','1234','8888']`), whitelist chỉ còn `mpv2` → `matchesWhitelist()` luôn
false → **mọi** PIN quản lý bị 403 (fail-closed, đúng về bảo mật nhưng che mất
kết quả test).

- Xác minh: `Remove-Item Env:MANAGER_PIN_HASHES` rồi chạy lại → **exit 0, PASS toàn bộ**.
- Hệ quả: mọi lượt chạy acceptance trong shell này là **bằng chứng không hợp lệ**.
- Khuyến nghị (B): trước mỗi lượt test/acceptance, chạy
  `Remove-Item Env:MANAGER_PIN_HASHES -ErrorAction SilentlyContinue` (hoặc export giá
  trị `mpv2$...` thật), và ghi lại giá trị env trong biên bản.
- Đây **không** phải lỗi code A1-F; cũng không ảnh hưởng prod (prod lấy từ wrangler
  secret, `wrangler.toml` không khai báo biến này).

## 5. Tích hợp: an toàn để merge, thứ tự đề xuất

`merge-tree` giữa `2ab88f3` và `aaedbbd` **không conflict**; đã kiểm tra bản merge
(`733779f`) còn nguyên vẹn cả ba tầng:

| Bằng chứng trong bản merge | Nguồn |
|---|---|
| `formapubli.last_lease_ok` (gate S-OFFLINE) | S-01 (`main`) |
| `discountApprovalId: approvedDiscountRequestId \|\| undefined` (P1b/A1-H) | A1-H (`main`) |
| `qrDataUrl ... (paymentMethod === 'BANK_TRANSFER')` (2 chỗ) | #8 của C |
| `#pos-cart-frozen-banner`, `#btn-open-mobile-checkout-sheet`, `#mobile-checkout-sheet` | #7 + freeze của C |

Thứ tự đề xuất cho B:
1. Merge `agent/b-approval-full` (`2ab88f3`) vào `main` — **A đã nghiệm thu ĐẠT**.
2. Merge `main` vào `agent/c-login-ux` (B chạy git) → C sửa F1–F5 trên base mới.
3. C chạy lại `tsc --noEmit` + `run-real-pos-terminal-test.ts` (**thêm test cho F1/F3**:
   bấm "Hủy duyệt để sửa giỏ" phải có 1 request `POST .../{id}` `{action:'CANCEL'}`
   và chỉ mở khoá sau khi API OK) → bàn giao B.
4. B merge C → smoke G1–G10 trên head ghép cuối → deploy.

Lưu ý không tự revert: nhánh C có base `4a50a2b` (trước A1-H/S-01) nhưng merge đã
giữ đúng các đường của `main` — **không** merge theo kiểu "take theirs" cho file
`PosCheckoutTerminal.tsx`.

## 6. Đối chiếu mục 5 (CÒN) của handoff

| # | Hạng mục handoff | Trạng thái theo A |
|---|---|---|
| 1 | B merge `agent/b-approval-full` sau khi A duyệt | **A đã duyệt** → B merge được ngay |
| 2 | C: #7, #8, freeze pending/approved, nút huỷ gọi API CANCEL, drawer `cartSnapshot` | **Một phần**: #7/#8/freeze-pending ĐẠT; F1–F5 còn thiếu → chưa giao cho B |
| 3 | B: S09–S20, smoke G1–G10, deploy bản C | Chưa chạy (không có bằng chứng trong 2 nhánh này) |
| 4 | User chốt `SESSION_LEASE_ENFORCE=true`, PIN 8 staff, xoá token plaintext + rotate, nghiệm thu iPhone | Ngoài phạm vi A; **có 1 cảnh báo bảo mật**: `scripts/deploy-cloudflare.ts` (untracked, cây chính) chứa token — nhắc lại để không commit nhầm |
| 5 | Parked: #2, #4, #6 | Giữ nguyên parked; chưa có evidence mới trong lượt này |

## 7. Việc A đã KHÔNG làm (giữ đúng vai)

Không sửa file sản phẩm, không commit, không merge, không push, không deploy, không
tạo migration. Chỉ đọc source/diff, chạy test, và ghi biên bản này.
`src/db/index.ts` (WIP của session cũ) và `scripts/deploy-cloudflare.ts` vẫn nguyên
trạng — không chạm.