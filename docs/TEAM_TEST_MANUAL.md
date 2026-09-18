# formapubli OS — Sổ Tay Test Bản Mẫu (Team Test Manual v1)

> **Phạm vi:** bản mẫu giao team test vòng 1 — chỉ tính năng then chốt quầy + kho.
> **Commit:** `9f644fc` (gồm merge `feat/login-account-picker` + manual này) trên nhánh `main`.
> **Ngày phát hành:** 18/09/2026.
> **Nguyên tắc:** Email báo cáo tháng (5.5) đã TẮT theo yêu cầu — không test mail ở vòng này.

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
| ADMIN-01 | Chủ Quản Lý | Owner | `owner9999` | Toàn quyền + quản trị tài khoản |
| QL-01 | Quản Lý Vận Hành | Manager | `manager8888` | Bán, duyệt CK, quản lý Thu ngân/Thủ kho/Thuế |
| NV-01 / NV-02 | Thu Ngân 01/02 | Cashier | `1234` | Bán quầy, không thấy doanh thu tổng |
| KHO-01 | Thủ Kho 01 | Warehouse | `5678` | Nhập/xuất/chuyển kho, không thấy doanh thu |
| THUE-01 | Kế Toán Thuế | Tax | `7890` | Chỉ xem số liệu VAT (`OFFICIAL_TAX`) |

### 2.2. Owner/Manager quản trị tài khoản (mới)

Vào **Cài đặt (tab đáy sidebar) → 1. Phân Quyền 5 Roles**, kéo xuống khối **Quản Trị Tài Khoản Ca Làm Việc**:
- **Thêm:** nhập Mã NV (VD `NV3`) + Tên + Vai trò + PIN → Thêm.
- **Reset PIN:** bấm 🔑 ở dòng nhân viên → nhập PIN mới → Lưu.
- **Khóa/Mở:** bấm 🔒/🔓 (khóa = không đăng nhập được, nhưng két ca & lịch sử cũ giữ nguyên — không xóa cứng).
- Giới hạn an toàn: Manager chỉ quản lý Thu ngân/Thủ kho/Thuế; không ai tự khóa hay tự hạ vai trò chính mình.

---

## 3. Tính năng SẴN SÀNG test (core)

### 3.1. Quầy POS bán sách (vai trò Thu ngân/Quản lý/Owner)
- Tìm sách bằng tên không dấu / 4 số cuối ISBN / quét camera 📷 (`Alt+Shift+C`) / micro 🎙️.
- Chọn kho xuất (Âu Cơ / Hội Chợ / Quỳnh Mai), chiết khấu, cờ VAT/Nội bộ.
- Thu ngân giảm tối đa **15%** — vượt mức cần **PIN quản lý** mở khóa cho đơn đó.
- Chốt đơn `Ctrl+Enter` → trừ kho tức thì → in phiếu.
- **Két ca:** mở két đầu ca, chốt ca đối soát thừa/thiếu tiền mặt.

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
- Micro trong ô tìm kiếm đơn: **nói → transcript đổ vào ô chat → luôn kiểm tay trước khi chốt**.
- Copilot (`Alt+C`, Owner/Manager): chỉ hỏi-đáp read-only, có 4 gợi ý sẵn.

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
2. **Bán 1 đơn vượt 15% → bị chặn → Quản lý nhập PIN → qua.** (trần CK)
3. **Tắt mạng bán 2 đơn → mở mạng đồng bộ → kiểm tồn không lệch.** (offline)
4. **Thủ kho chuyển 20 cuốn Âu Cơ → Hội Chợ → nhận thiếu 2 cuốn (1 hỏng 1 mất) → kiểm phương trình R+D+L.** (in-transit)
5. **Tạo NV3 trong Settings → đăng nhập NV3 bán 1 đơn → khóa NV3 → NV3 không vào được.** (quản trị tài khoản mới)
6. **Kế toán thuế đăng nhập → chỉ thấy số VAT, không thấy đơn nội bộ.** (sổ kép)
7. **Nói 5 đơn bằng micro ở quầy ồn → sửa tay → lưu audio+text.** (thu WER)

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

- 42 suites cách ly xanh 100% (gồm suite login-chạm-chọn 13/13 + drill go-live 5/5).
- `tsc` 0 lỗi, `npm run build` 0 lỗi.
- `formapubli.db` production nguyên vẹn (không suite nào được chạm DB thật).
