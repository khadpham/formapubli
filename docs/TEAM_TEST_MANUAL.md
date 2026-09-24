# formapubli OS — Sổ Tay Test Bản Mẫu (Team Test Manual v3)

> **Phạm vi:** bản mẫu giao team test vòng 3 — core quầy + kho + Copilot AI (hỏi đáp, lên đơn nháp) + báo cáo nguồn doanh thu.
> **Phiên bản:** Manual v3 — nhánh `dev`, sau review OCR vòng 3
> (không ghi hash vì hash thay đổi mỗi lần sửa manual; xem `git log` để biết tip hiện tại).
> **Ngày phát hành:** 22/09/2026.
> **Nguyên tắc:** Email báo cáo tháng (5.5) vẫn TẮT — không test mail ở vòng này.
> **Máy test LAN (HTTPS để dùng micro + camera):** `https://<IP-may-tinh>:3000`.
> IP hiện tại (18/09): `https://192.168.1.4:3000` — IP do DHCP cấp, **đổi mạng là đổi IP**:
> kiểm tra lại bằng `ipconfig` (dòng `IPv4 Address`) rồi thay vào link.
> Lần đầu mở trên điện thoại sẽ báo chứng chỉ không tin cậy (cert tự ký):
> Android Chrome bấm *Nâng cao → Tiếp tục truy cập*; cho phép Micro/Camera khi được hỏi.
> Không dùng `http://` nữa vì trình duyệt chặn micro/camera trên http LAN.

---

## 1. Chạy app (mỗi máy test)

```bash
npm install
npm run dev
```

Mở `http://localhost:3000`. Lần đầu mở sẽ hiện **màn hình Đăng Nhập Ca Làm Việc**.

> ⚠️ Dữ liệu trên máy bạn là DB local `formapubli.db`. Tuyệt đối không copy DB của máy khác đè lên khi đang test dở ca.

---

## 2. Đăng nhập kiểu mới: chạm-chọn + PIN (không gõ tay)

1. **Chạm vào tile tên bạn** (đã nhóm sẵn theo vai trò: Chủ / Quản lý / Thu ngân / Thủ kho / Kế toán).
2. **Nhập PIN** → bấm **Mở Ca & Đăng Nhập**.
3. Không thấy tên mình → bấm dòng *"Không thấy tên? Nhập tay mã NV"*.
4. Nhập sai 5 lần → khóa 15 phút (chống đoán mò, đúng thiết kế).

### 2.1. Tài khoản test (TEST ONLY — sẽ đổi hết khi lên thật)

| Mã NV | Tên hiện | Vai trò | PIN test | Được làm gì |
|---|---|---|---|---|
| ADMIN-01 | Chủ Quản Lý | Owner | `9999` | Toàn quyền + quản trị tài khoản |
| QL-01 | Quản Lý Vận Hành | Manager | `8888` | Bán, duyệt CK, quản lý Thu ngân/Thủ kho/Thuế |
| NV-01 / NV-02 | Thu Ngân 01/02 | Cashier | `1234` | Bán quầy, chỉ chạm két của chính mình |
| KHO-01 | Thủ Kho 01 | Warehouse | `5678` | Nhập/xuất/chuyển kho, không thấy doanh thu |
| THUE-01 | Kế Toán Thuế | Tax | `7890` | Chỉ xem số liệu VAT (`OFFICIAL_TAX`) |

> Mọi role đều PIN từ 4 ký tự (kể cả Owner/Manager — ưu tiên tốc độ quầy).
> PIN lưu dạng băm PBKDF2, tự nâng cấp mềm sau lần đăng nhập đúng đầu tiên.

### 2.2. Owner/Manager quản trị tài khoản

Vào **Cài đặt (Alt+8) → 1. Tài Khoản Nhân Sự** (chỉ Owner/Manager thấy tab này):
- **Thêm:** nhập Mã NV (VD `NV3`) + Tên + Vai trò + PIN → Thêm.
- **Reset PIN:** bấm 🔑 ở dòng nhân viên → nhập PIN mới → Lưu.
- **Khóa/Mở:** bấm 🔒/🔓 (khóa = không đăng nhập được, nhưng két ca & lịch sử cũ giữ nguyên — không xóa cứng).
- Giới hạn an toàn: Manager chỉ quản lý Thu ngân/Thủ kho/Thuế; không ai tự khóa hay tự hạ vai trò chính mình.

> Chế độ **mô phỏng vai trò đã XÓA** (go-live): vai trò = phiên đăng nhập thật, không còn dropdown/cards đổi vai trò ở sidebar hay Cài đặt. Mọi role đều thấy nút **Cài Đặt**; tab Nhân sự chỉ Owner/Manager.

---

## 3. Tính năng SẴN SÀNG test (core)

### 3.1. Quầy POS bán sách (vai trò Thu ngân/Quản lý/Owner)
- Tìm sách bằng tên không dấu / 4 số cuối ISBN / quét camera 📷 (`Alt+Shift+C`) / micro 🎙️ (`Alt+V`).
- Chọn kho xuất (Âu Cơ / Hội Chợ / Quỳnh Mai), chiết khấu, cờ VAT/Nội bộ.
- Chiết khấu theo **nút mốc 0–40% (cách 5%)** + nút **🎁 100%** (tặng sự kiện, gọn trong lưới nút).
- Thu ngân giảm tối đa **20%** — vượt mức cần **PIN quản lý** mở khóa cho đơn đó.
- Chốt đơn `Ctrl+Enter` → trừ kho tức thì → in phiếu.
- **Két ca:** mở két đầu ca, chốt ca đối soát thừa/thiếu tiền mặt.

### 3.1.1. Quét camera trên iPhone và Android

**Bản sửa scanner 22/09:** có bộ giải mã dự phòng chạy trong ứng dụng. Không yêu cầu bật `Shape Detection API`, đổi trình duyệt hay cài ứng dụng khác. Kiểm tra trên cả Safari/Chrome iPhone và Chrome Android qua địa chỉ HTTPS LAN ở đầu tài liệu.

1. Tải lại trang để nhận bản sửa, mở POS → camera (`Alt+Shift+C` trên bàn phím). Trạng thái chuẩn bị nằm ở phần tiêu đề; khi camera hoạt động, không có hộp “Sẵn sàng quét” che hình ảnh.
2. Dùng mã EAN-13/ISBN in thật trên bìa sách có trong danh mục. Đưa toàn bộ mã, gồm khoảng trắng hai đầu, vào khung; giữ đủ xa để các vạch sắc nét. Thử cả đặt sách ngang và xoay 90°.
3. Đạt khi scanner hiện **Đã nhận diện!** với đúng ISBN, giỏ thêm đúng sách hoặc hiện lựa chọn nếu trùng ISBN. Giữ nguyên mã không được tự tăng liên tục. Đưa mã ra ngoài khung rồi quét lại sau ít nhất 2 giây: được thêm lần nữa.
4. Để camera nhìn vùng không có mã vài giây rồi đưa sách vào: vẫn đọc được. Trên Android, native đang hoạt động vẫn được ưu tiên sau khi chờ.
5. Thử bật/tắt flash nếu có, đổi ống kính, đóng/mở scanner bằng nút X hoặc chạm nền tối bên ngoài khung. Đóng ngay khi đang xin quyền/đang chuẩn bị/đang quét: camera phải tắt, không được phát sinh lần thêm giỏ đến muộn.
6. Nếu thấy thông báo không tải/không đọc được mã vạch: kiểm tra kết nối, đóng/mở lại scanner hoặc tải lại trang. Khi xác minh lỗi, ghi lại nguyên văn thông báo và có xuất hiện **Đã nhận diện!** hay chưa.

**Không dùng các nút “Mã Vạch Test Nhanh” để nghiệm thu camera:** chúng gọi thẳng xử lý ISBN, bỏ qua giải mã ảnh. Kiểm thử tự động đọc ảnh mã thật và mô phỏng vòng quét, nhưng không thay thế kiểm tra lấy nét/tốc độ trên thiết bị. Trạng thái nghiệm thu iPhone thật: **chờ kiểm tra thiết bị**.

### Thoát nhanh hộp thoại trên điện thoại

Chạm vùng nền bên ngoài khung để đóng scanner, phiếu nhập/xuất/chuyển kho, pick list, RMA, đổi/trả, biên lai, chọn ISBN trùng, dán chat, mở/chốt két và duyệt PIN. Chạm nút, nhập liệu hay cuộn **bên trong** không đóng hộp thoại. Sidebar và Copilot cũng đóng bằng nền ngoài; Copilot chừa một mép nền ở bên trái trên điện thoại.

Chạm ngoài tương đương nút X/Hủy, không phải lưu hay xác nhận. Khi đang gửi giao dịch kho/RMA/đổi trả/mở-chốt két, chạm nền tạm thời không đóng để giữ kết quả xử lý trên màn hình. Đăng nhập chỉ đóng được khi chức năng đó đã cho phép Hủy; màn hình yêu cầu đăng nhập bắt buộc không thể bỏ qua. Kiểm thử tự động: `npx tsx scripts/test-modal-dismiss.ts`.

### 3.2. Bán rớt mạng Offline-First
1. Tắt wifi/4G → bán 1–2 đơn (app báo 🟡 Mất mạng, đơn lưu mã `OFF-...`).
2. Bật mạng lại → bấm **🔄 Đồng bộ ngay**.
3. Đạt khi: không trùng đơn, không trừ kho 2 lần, đơn gắn cờ warning nếu bán vượt tồn.

### 3.3. Kho 3 kho + luân chuyển 2 bước (vai trò Thủ kho/Quản lý/Owner)
- Nhập / Xuất / Chuyển kho, xem **Ma trận 3 kho** + Thẻ kho.
- Chuyển kho đi theo 2 bước: **Điều phối (dispatch)** → xe hàng vào kho ảo trung chuyển → **Nhận hàng (receive)** với biên bản Lành/Hỏng/Mất (R+D+L = số gửi). Hủy phiếu khi còn đi đường để thu hồi.
- Cảnh báo xe kẹt > 12h. Phiếu soạn hàng theo kệ (Pick List).
- Sách lỗi: tạo **phiếu RMA** → hàng vào khu cách ly, không lẫn hàng bán.

### 3.4. Ký gửi + thu tiền công nợ (Quản lý/Owner; Thu ngân được thu tiền mặt hội chợ)
- Gửi hàng → đại lý xác nhận nhận → báo bán lẻ tẻ → lập kỳ đối soát `DRAFT → CONFIRMED` → thu tiền nhiều lần bằng phiếu `PT-...` (chặn thu vượt nợ, hủy phiếu bằng `VOID` có lý do).

### 3.5. Combo/hộp, bản quyền, dự báo (xem + kiểm số)
- Bán 1 combo → trừ đồng thời sách lẻ + vỏ hộp; báo hết combo theo linh kiện cạn nhất.
- Hợp đồng bản quyền: cảnh báo chạm trần lượt in, tính nhuận bút tự động.
- Studio (`Alt+7`): bảng DoI/EOQ, cảnh báo tái bản RED/YELLOW.

### 3.6. Giọng nói + Copilot (thu thập dữ liệu, không thay người kiểm)
- Micro trong ô tìm kiếm/POS/kho: **nói đến đâu chữ hiện đến đấy** (Web Speech, Chrome/Edge/Cốc Cốc). Trình duyệt khác tự rơi về ghi âm Whisper.
- Copilot (`Alt+C`, Owner/Manager): bong bóng góc phải → cửa sổ chat mini (phóng to full khi cần). `Esc` đóng.
- Copilot trả lời **tiếng Việt tự nhiên** (không còn JSON thô): tồn kho, doanh số 2 sổ, cạn kho 105 ngày, đối soát két, **danh mục** (sách của tác giả X, tựa chữ cái Y, tác giả bán chạy), cả ngày/giờ.
- Mic Copilot: bấm nói nhiều lần thì **nối câu** (không mất câu cũ); `Alt+V` khi Copilot mở thì ưu tiên mic Copilot.
- **Lên đơn bằng lời nói:** nói *"lấy 2 cuốn H01 cho chị Lan"* → bấm **Áp vào POS** → qua quầy kiểm giỏ → tự bấm Thanh toán (`Ctrl+Enter`). Copilot **không bao giờ** tự tạo đơn/trừ kho.
- Lệnh sửa/xóa/hủy ("hủy đơn...") luôn bị từ chối — đúng thiết kế read-only + đơn nháp.

### 3.7. Sổ doanh số + phân tích nguồn thu (Owner/Manager)
- Bảng đơn giới hạn chiều cao, cuộn trong bảng; chọn 20/50/100/**Xem toàn bộ**; slicer kênh Bán lẻ/Đại lý/Online/Tặng; thẻ tổng tiền **theo đúng bộ lọc đang xem**.
- Panel **Sách Bán Chạy Nhất**: Hôm nay / 7 ngày qua / 30 ngày qua, Top 10/20/50, xuất CSV.
- Panel **Nguồn Doanh Thu & Dòng Tiền**: nhóm Bán lẻ/Đại lý/Online/Tặng kèm tỷ trọng %, COD chờ về/đã về, sách tặng-tài trợ, ký gửi đại lý, xuất CSV kèm hash.
- Tải lỗi mạng → panel báo đỏ + nút Thử lại (không hiện số 0 giả).

---

## 4. Tính năng CHƯA sẵn sàng / ngoài phạm vi vòng 1

| Hạng mục | Trạng thái | Ghi chú cho team |
|---|---|---|
| Email báo cáo tháng (5.5) | ⛔ TẮT | Không test, không bật `RESEND_API_KEY` |
| Đo WER giọng nói | ⏳ Chờ file thật | Team giúp thu âm (mục 6) |
| Shopee/TikTok, hóa đơn VAT (Phase 6) | ⛔ Chưa có | Tầm nhìn dài hạn |
| Đổi PIN tự phục vụ | ⛔ Chưa có | Nhờ Owner/Manager reset (mục 2.2) |

---

## 5. Kịch bản test hiệu quả nhất (ưu tiên theo thứ tự)

1. **Mở ca thu ngân (NV-01) → bán 3 đơn lẻ → chốt két khớp tiền.** (lõi POS + két)
2. **Bán 1 đơn vượt 20% → bị chặn → Quản lý nhập PIN → qua.** (trần CK)
3. **Tắt mạng bán 2 đơn → mở mạng đồng bộ → kiểm tồn không lệch.** (offline)
4. **Thủ kho chuyển 20 cuốn Âu Cơ → Hội Chợ → nhận thiếu 2 cuốn (1 hỏng 1 mất) → kiểm phương trình R+D+L.** (in-transit)
5. **Tạo NV3 trong Cài đặt → 1. Tài Khoản Nhân Sự → đăng nhập NV3 bán 1 đơn → khóa NV3 → NV3 không vào được.** (quản trị tài khoản mới)
6. **Kế toán thuế đăng nhập → chỉ thấy số VAT, không thấy đơn nội bộ.** (sổ kép)
7. **Nói 5 đơn bằng micro ở quầy ồn → sửa tay → lưu audio+text.** (thu WER)
8. **Copilot: hỏi "kho Âu Cơ còn bao nhiêu cuốn Bệnh tưởng" → đúng số; hỏi "hủy đơn" → bị từ chối; nói "lấy 2 cuốn H01" → Áp vào POS → thanh toán.** (copilot)
9. **Sổ doanh số: slicer Online → thẻ tổng đổi theo; panel Sách bán chạy Hôm nay ra đúng sách vừa bán.** (báo cáo)

---

## 6. Thu file ghi âm cho đo WER (quan trọng, làm song song)

Mỗi mẫu gồm 2 file cùng tên: `*.webm` (ghi âm quầy thật, ồn thật) + `*.txt` (nội dung đúng mong đợi, VD *"bán 2 cuốn dưỡng đường đồng hồ cát giảm 10 phần trăm"*).
Đặt vào thư mục team thống nhất, báo cho chủ dự án để đo v3-vs-turbo và chốt model.

---

## 7. Mẫu báo bug (copy-paste khi báo)

```text
[MÁY/ROLE] NV-01 trên Chrome Android
[LÀM GÌ] Chốt đơn 3 cuốn H46 giảm 20% (có PIN QL-01)
[MONG ĐỢI] Đơn qua, trừ kho 3 cuốn
[THỰC TẾ] Báo lỗi ... (kèm ảnh màn hình)
[MÃ ĐƠN/PHIẾU] (nếu có)
```

Quy tắc: bug chặn bán/chặn két/chặn đồng bộ = P0 báo ngay; bug chính tả/căn lề gom cuối ngày.

---

## 8. Gate kỹ thuật đã qua trước khi giao (để team yên tâm)

- 43+ suites cách ly xanh (gồm suite login-chạm-chọn 19/19, actor-binding 8/8, drill go-live 5/5).
- `tsc` 0 lỗi, `npm run build` 0 lỗi.
- DB production chỉ thay đổi khi có người test tay (audit log); test suite chạy cách ly hoàn toàn.

## 9. Vá bảo mật vòng 2 (có gì mới so với vòng 1)

1. **Chạm-chọn login:** lướt list → chạm tên → gõ PIN (mọi role PIN 4+ ký tự).
2. **Két ca khóa theo người:** thu ngân chỉ mở/xem/chốt két của chính mình; Owner/Manager chốt hộ được.
3. **Chống mạo danh:** mọi bút toán/audit ghi đúng người đăng nhập (không còn actor client gửi).
4. **PIN băm PBKDF2** + tự nâng cấp mềm, không ai phải đổi PIN.
5. **Khóa brute-force bền vững** (sống qua restart) + chặn production thiếu `TRUST_PROXY`.
6. **PIN quản lý:** client không hardcode nữa, server là bên duyệt duy nhất (PIN sai → 403 khi chốt đơn).

### Kịch bản bổ sung vòng 2 (sau 7 kịch bản cũ)

8. **NV-01 mở két → NV-02 không xem/chốt được két NV-01** (403), Quản lý chốt hộ được.
9. **Nhập sai PIN 5 lần → khóa 15 phút**, đúng PIN trong lúc khóa vẫn 403.
10. **Nhập PIN quản lý sai ở modal duyệt CK → đơn chốt bị 403**, PIN đúng thì qua.

## 10. Bản 25/09 — Một phiên cashier (S-01) + POS hardened (đã chạy prod)

> Áp dụng ROLE_CASHIER trên prod `https://book.formaform.vn`.
> Quy tắc: **máy đang bán KHÔNG BỊ VĂNG**; máy khác đăng nhập trùng tài khoản
> sẽ bị chặn với thông báo "Tài khoản đang mở ca trên thiết bị khác".

1. **Một phiên mỗi thu ngân:** NV-01 đang bán trên máy A → máy B đăng nhập
   NV-01 → B nhận 403, A tiếp tục bán bình thường (không mất giỏ, không văng).
2. **Đổi máy đúng cách:** trên máy A bấm **Đăng xuất** → máy khác đăng nhập
   được ngay. Kill app đột ngột thì chờ tối đa **10 phút** lease tự hết.
3. **Quét phiên từ xa (máy kẹt/mất):** Quản lý vào **Quản lý nhân viên →
   Giải phóng phiên** (chỉ Manager/Owner) — máy cũ hết quyền ngay, máy mới
   vào được. Không ảnh hưởng két/ca, giỏ nháp vẫn giữ nguyên trên máy cũ.
4. **Offline:** mất mạng vẫn xem/sửa giỏ NHƯNG **không chốt được đơn offline
   mới** khi phiên chưa được xác nhận gần đây (anti bán ảo); queue cũ không bị xóa.
5. **Đổi PIN = hết phiên cũ** ở mọi máy (tự đăng xuất, đăng nhập lại).
6. **Phê duyệt chiết khấu — giỏ bị khóa:** khi chờ duyệt hoặc ĐÃ ĐƯỢC DUYỆT,
   giỏ khóa hoàn toàn (không thêm/sửa/xóa/scan). Muốn sửa giỏ: bấm
   **"Sửa giỏ và hủy phê duyệt"** — hệ thống hủy phê duyệt TRÊN SERVER rồi
   mới mở khóa (mất mạng khi hủy → giỏ vẫn khóa, không giả định hủy xong).
   Quản lý duyệt: bấm **"Xem giỏ đã khóa"** để đối chiếu đúng giỏ lúc xin duyệt.
7. **Chuyển khoản / QR (đã gộp 1 lựa chọn):** chọn "Chuyển khoản / QR" → hiện
   thông tin TK + QR. Trước khi chốt đơn PHẢI bấm **"Xác nhận đã nhận tiền"**
   (xác nhận tay của thu ngân — đã soi tài khoản/người chuyển). Đơn cũ định
   dạng QR_CODE/BANK_TRANSFER đọc/báo cáo như trước.
8. **Mobile:** nút **Thanh toán nổi** mở sheet thanh toán (không tự chốt đơn);
   danh mục lưới 2 cột; đóng/mở sheet không mất giỏ.
