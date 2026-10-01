# Kế hoạch: ô Ghi chú cho bước thanh toán (tiền mặt + chuyển khoản)

Ngày: 2026-10-01 · Yêu cầu: thu ngân · Branch: `fix/scanner-zoom-roi` → merge `main` → deploy

## 1. Vấn đề

State `note` ĐÃ có trong `PosCheckoutTerminal.tsx:309`, ĐÃ gửi lên server trong cả
đơn tiền mặt (`:2050`) lẫn đơn chuyển khoản (`:1944`), nhưng **không có ô nhập nào**
trên UI. Thu ngân không gõ được ghi chú. `note` hiện chỉ có giá trị khi nhập qua
SmartOrderParser/Copilot.

## 2. Phạm vi (đúng 1 việc, không lan)

Thêm ô nhập **"Ghi chú"** ở cả 3 màn hình thanh toán, TẤT CẢ ghi vào cùng một state
`note` đã có — không tạo state mới, không đổi API, không đổi server:

| # | Màn hình | Vị trí đặt ô nhập (chốt 30/09 theo ý thu ngân) |
|---|---|---|
| 1 | Panel thanh toán desktop | Ngay DƯỚI picker "Thanh toán" (`pos-payment-method-select`), `hidden lg:block` theo picker |
| 2 | Sheet "Chi tiết Đơn hàng & Thanh toán" (mobile) | Ngay DƯỚI picker "Hình thức thanh toán", TRƯỚC khối điều kiện hiện QR — nên dù chọn tiền mặt hay chuyển khoản nó vẫn hiện |
| 3 | Modal chuyển khoản (`TransferPaymentModal`) | Trên nút "Xác nhận đã nhận tiền", để ghi được lúc xác nhận |

Mỗi mặt ĐÚNG MỘT ô. Không đặt dưới ô tên khách, không đặt ở footer sheet.

Vì cùng một `note`:
- Đơn tiền mặt gửi `note` như cũ (`:2050`) — nay đã có giá trị thật.
- Đơn chuyển khoản gửi `note` như cũ (`:1944`) — nay đã có giá trị thật.
- Reset sau mỗi đơn đã có (`:514` `setNote('')`) — đơn mới bắt đầu trống. Giữ nguyên.

## 3. Quy ước UI (bắt buộc theo AGENTS.md)

- Nhãn ngắn, tiếng Việt CÓ DẤU: `Ghi chú`.
- Placeholder: `Ghi chú đơn (không bắt buộc)…`.
- Kiểu ô nhập giống hệt ô "Tên khách hàng" bên cạnh (`:3389-3395`) — copy class, không sáng tạo kiểu mới.
- `aria-label="Ghi chú đơn hàng"`.
- KHÔNG bắt buộc nhập. Đơn tặng vẫn dùng `note` làm lý do dự phòng như cũ (`:1689`) — có ô nhập hẳn giúp thu ngân thấy được.

## 4. Ngoài phạm vi (cấm đụng)

- Không đổi API, schema, migration.
- Không đổi logic giá/tồn/quyền.
- Không thêm ô tên khách hàng cho mobile (việc khác).
- Không đụng `shiftNoteInput` (ghi chú bàn giao ca — việc khác).
- In ghi chú lên phiếu nhiệt: KIỂM TRA nếu `thermalReceipt` đã in `note` thì giữ,
  nếu chưa thì KHÔNG thêm trong đợt này (việc riêng, tránh phình diff).

## 5. Kiểm thử (bắt buộc, theo quy trình repo)

- `npx tsc --noEmit` sạch.
- Test mới `scripts/test-payment-note.ts`, chạy qua `run-isolated.ts`:
  1. Cả 3 ô nhập đều bind `value={note}` + `onChange` → `setNote`.
  2. `note` vẫn được gửi trong cả hai body tạo đơn (tiền mặt + chuyển khoản).
  3. `note` vẫn được reset sau mỗi đơn.
  4. Ô nhập KHÔNG bắt buộc (không có `required`, không chặn submit khi trống).
  5. Placeholder + aria-label đúng chữ.
- Mutation bằng exit code: xoá 1 trong 3 ô nhập → đỏ; bỏ `note` khỏi 1 body → đỏ; thêm `required` → đỏ. Khôi phục đúng.
- Full suite `npx tsx scripts/run-isolated.ts` xanh.

## 6. Triển khai

1. Subagent thực hiện theo plan này (không sửa file khác ngoài 3 file UI + 2 file test/runner).
2. Tôi review diff: đúng 3 ô nhập + test, không lấn việc khác.
3. Tsc + test mới + mutation + full suite.
4. Commit → push branch → merge `main` (từ worktree chính) → push → dừng dev → build → deploy → xác minh production 200.
