# Kế hoạch — Sửa máy quét mã: iPhone zoom 2x hỏng + quét nhầm mã ngoài khung (30/09, đêm)

## Triệu chứng người dùng báo
1. iPhone: bật zoom 2x là **quét không được**. 1x thì bình thường.
2. Android: zoom 2x vẫn quét được nhưng **không nhạy bằng 1x**.
3. Khung nhìn bị giới hạn trong ô chữ nhật, nhưng thực tế camera **quét toàn màn** →
   đôi lúc quét nhầm mã vạch khác, mã QR khác.
4. UX không trực quan: không nhìn được toàn cảnh, phải dí sát vào khung.

## Bốn nguyên nhân gốc (đã xác minh trong code, không phải phỏng đoán)

### G1 — iPhone vỡ vì zoom bị áp hai lần
`InAppBarcodeScanner.tsx:389` gọi `applyConstraints({ zoom: 2 })` (zoom **quang**),
rồi `:589` **vẫn** crop 50% trung tâm để phóng to lần nữa cho bộ giải mã.
Trên iOS, `applyConstraints` đổi định dạng capture ⇒ 2x quang **rồi** 2x phần mềm.
Kết quả: mã vạch quá nhỏ/blur ⇒ không giải mã được. Android giữ độ phân giải tốt hơn
nên vẫn quét được nhưng kém nhạy hơn — **khớp đúng mô tả của người dùng**.

### G2 — Thứ người dùng THẤY và thứ máy QUÉT đang khác nhau
Khung nhìn là ô `w-64 h-44` (`:705`), nhưng `:595` vẽ **toàn bộ khung hình** vào
canvas rồi giải mã cả khung. Nên mã nằm ngoài ô vẫn bị bắt ⇒ quét nhầm.

### G3 — Preview bị thu nhỏ không nhất quán
`:695` CSS `transform: scale(2)` **chỉ** chạy khi máy *không* có zoom quang.
Có zoom quang thì không scale. Nên hình thu nhỏ khác nhau giữa các máy, người dùng
không biết mình đang nhìn vùng nào.

### G4 — Quét cả QR_CODE
`barcode-decoder.ts:28` nạp `EAN_13, EAN_8, CODE_128, **QR_CODE**`.
Sách luôn là EAN-13 (dữ liệu mẫu trong test: `5901234123457`), còn hội chợ thì
lúc nào cũng có poster/tấm QR quanh đó. Scanner chỉ dùng ở
`PosCheckoutTerminal` cho sách — không dùng chỗ nào cần QR.

## Phương án sửa

Chỉ **một** nguyên tắc chi phối: **thứ người dùng thấy là đúng vùng máy quét.**

| # | Việc | Sửa gì | Chữa nguyên nhân |
|---|---|---|---|
| A | Bỏ zoom quang | Xoá `applyConstraints({zoom})` và CSS `scale(2)` | G1, G3 |
| B | Thêm vùng quét ROI | Khung nhìn = ROI thật; crop canvas theo ROI rồi **phóng to** để giải mã | G2 |
| C | Zoom đổi nghĩa | 1x = ROI rộng, 2x = ROI hẹp. **Không đụng stream** | G1, độ nhạy 2x |
| D | Bỏ QR | Khỏi `POSSIBLE_FORMATS` | G4 |
| E | Chặt tái phát | Test + mutation | tất cả |

Vì sao C đúng: zoom 2x = vùng quét nhỏ hơn ⇒ mỗi mã chiếm **nhiều pixel hơn** ⇒
giải mã **nhạy hơn**, đúng như người dùng mong. Và không đụng `applyConstraints`
nên iPhone không còn đường để vỡ — mọi máy hành xử giống nhau.

## Ước lượng rủi ro
- Chỉ đụng 2 file: `InAppBarcodeScanner.tsx`, `barcode-decoder.ts`.
- **Không** đụng luồng bán hàng, tiền, tồn, API.
- `CODE_128` giữ lại (một số tem sách dùng Code 128).
- Định dạng còn lại vẫn giải mã được 100% mã sách hiện tại (test dùng EAN-13).
- Nếu sau này cần quét QR (ví dụ đăng nhập nhân viên bằng mã), bật lại được.

## Kiểm chứng (bắt buộc, không bỏ bước nào)
1. `npx tsc --noEmit` sạch.
2. Test mới: ROI đúng tỉ lệ, crop đúng vùng, 2x **nhỏ hơn** 1x, không còn
   `applyConstraints` zoom, không còn `scale(2)`, danh sách định dạng không có QR.
3. **Mutation test bằng EXIT CODE** (không so khớp chuỗi — đã dính mojibake 2 lần):
   phá từng bất biến phải làm suite ĐỎ, bản gốc XANH.
4. Test cũ `test-camera-scanner.ts` (bộ giải mã) không được đỏ.
5. Toàn bộ suite.
6. `npm run build` sạch → deploy → xác minh bằng cách đọc bundle thật.
7. **Người dùng xác nhận trên iPhone thật** — tôi không tự kiểm được camera.

## Phần không tự kiểm được (nói thẳng)
- Camera iPhone thật, độ nhạy thực tế, hành vi focus khi zoom.
- Tôi chỉ chứng minh được: cấu trúc logic, toán học ROI, và không còn đường để
  iPhone vỡ do `applyConstraints`. Không thể ngồi đo trên iPhone của bạn.
