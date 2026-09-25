# Checklist nghiệm thu tay: chuyển khoản/QR có ảnh xác nhận

Các test tự động không cấp được camera/IndexedDB trong Node, nên 5 mục dưới đây **chỉ verify được trên máy thật**. Chạy trên 1 tablet/máy POS thật, mỗi mục ghi kết quả thật.

Chuẩn bị: mở POS ở kho có hàng, mở ca (két) bằng tài khoản thu ngân, chuẩn bị 1 đơn số (chuyển khoản hoặc QR) và 1 đơn tiền mặt để so sánh.

## 1. Camera bị từ chối → đơn phải giữ PENDING
1. Tắt quyền camera cho trình duyệt (Settings → Permissions → Camera → Block).
2. Chọn thanh toán chuyển khoản → bấm **Tạo đơn & hiện QR**.
3. Bấm **Chụp màn hình xác nhận**.
- [ ] Hiện thông báo lỗi quyền camera, modal đóng lại.
- [ ] **Không** có bước xác nhận nào chạy được.
- [ ] Bấm lại **Tạo đơn & hiện QR** thấy đơn cũ vẫn ở trạng thái chờ (hỏi Manager/Owner), **không** bị trừ kho.
- [ ] Không có bill in ra.

## 2. Lỗi lưu ảnh → tuyệt đối không xác nhận
Cách ép lỗi gần nhất trên máy thật: chặn storage của trình duyệt cho site, hoặc dùng DevTools → Application → Storage → Block.
1. Tạo đơn chuyển khoản như mục 1 (camera đã bật lại).
2. Chụp ảnh → bấm **Dùng ảnh này** khi storage đang bị chặn.
- [ ] Báo lỗi lưu ảnh, **preview vẫn còn** (không bị xoá).
- [ ] Nút xác nhận vẫn khoá.
- [ ] Không có request `action: CONFIRM` nào được gửi (kiểm tra Network tab).

## 3. Retry xác nhận sau mất mạng → idempotent, không trừ kho 2 lần
1. Tạo đơn chuyển khoản, chụp ảnh.
2. Tắt mạng (hoặc DevTools → Offline) **rồi** bấm xác nhận.
- [ ] Báo lỗi mất kết nối, đơn **vẫn còn** trên màn hình để thử lại.
3. Bật mạng, bấm xác nhận lại.
- [ ] Thành công, in bill đúng 1 lần.
- [ ] Tồn kho trừ **đúng 1 lần** (kiểm tra số tồn trước/sau, và dòng ledger `DISPATCH_SALE` chỉ có 1 dòng).
- [ ] Bấm xác nhận lần nữa (nếu còn nút) không sinh thêm giao dịch.

## 4. Hai thu ngân cùng bán lúc số lượng tối thiểu
1. Tạo 1 cuốn sách tồn = 1 tại kho.
2. Từ 2 thiết bị thu ngân (cùng kho, 2 ca khác nhau), cùng bán cuốn đó, **tắt mạng cả 2**.
- [ ] Cả 2 đều tạo được đơn offline và hiện QR.
3. Bật mạng cho thiết bị 1 trước, đồng bộ thành công. Sau đó bậng mạng thiết bị 2.
- [ ] Đơn của thiết bị 2 vào trạng thái **cần đối soát**, không bị xoá, **ảnh vẫn còn**.
- [ ] Tồn kho **không bao giờ âm**.
- [ ] Không có bill in ra cho đơn bị đối soát.

## 5. Cache tài khoản ngân hàng quá 24 giờ → chặn QR offline
1. Khi có mạng, mở luồng chuyển khoản 1 lần để tạo cache tài khoản.
2. Tắt mạng. Sửa DevTools → Application → Local Storage → sửa `cachedAt` của `formapubli.bankAccounts.<kho>` thành giá trị cũ hơn 24 giờ.
3. Tạo đơn chuyển khoản khi đang offline.
- [ ] Báo rõ không tạo được QR vì cache quá hạn, hướng dẫn thu tiền mặt.
- [ ] **Không** hiện QR với tài khoản có thể đã đổi.

## 6. Phạm vi xem ảnh giữa các kho/thu ngân (kiểm tra rò rỉ)
1. Thu ngân kho A tạo 1 đơn chuyển khoản + chụp ảnh.
2. Đổi sang kho B (hoặc đổi user sang thu ngân khác) rồi mở **Ảnh thanh toán**.
- [ ] **Không** thấy ảnh của kho A.
3. Manager mở **Ảnh thanh toán**.
- [ ] Thấy ảnh của mọi thu ngân **trong kho đang chọn**, không thấy ảnh kho khác.
4. (Android/Chrome) Dùng app khác mở link trang rồi quay lại, mở gallery.
- [ ] Ảnh cũ đã bị dọn, không còn ảnh của phạm vi trước.

## 7. Không phá luồng tiền mặt và quà tặng
1. Bán 1 đơn tiền mặt: vẫn 1 bước chốt, trừ kho ngay, in bill.
2. Bán 1 đơn quà tặng: vẫn hỏi lý do, vẫn cần duyệt nếu vượt trần, trừ kho ngay.
- [ ] Không hiện nút chụp ảnh, không hỏi "đã nhận tiền".
- [ ] Tồn kho và két tiền khớp số liệu.

## 8. Hạn 30 phút
1. Tạo đơn chuyển khoản, nhìn đồng hồ đếm ngược trên modal.
2. Để yên cho tới khi hết hạn (hoặc chỉnh đồng hồ máy).
- [ ] Modal hiện đồng hồ đếm ngược còn giảm.
- [ ] Hết hạn thì nút chụp/xác nhận khoá lại, báo đơn hết hạn.
- [ ] Manager xác nhận đơn đó sau khi hết hạn thì báo tự động hủy, **không** trừ kho.

## Ghi lại kết quả
Sau khi chạy xong, ghi vào file này: mục nào PASS/FAIL, mô hình thiết bị + phiên bản trình duyệt, và ảnh chụp màn hình lỗi nếu có. Báo lại để quyết định có ship hay chưa.
