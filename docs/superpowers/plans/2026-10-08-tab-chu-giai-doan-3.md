# Tab "Chủ" Giai đoạn 3 — Tổng doanh thu đa kênh + Giá vốn + Phân tích biên lợi nhuận

Ngày: 2026-10-08. Nguồn: bộ câu hỏi "questionair for Owner" (15 câu, đã có trả lời chủ) + yêu cầu bổ sung của chủ ngày 08/10.

## 1. Mục tiêu

Nâng tab "Chủ" từ "doanh thu Shopee + chi phí" (GĐ2 hiện tại) thành **trung tâm tài chính của chủ**:
- Tổng hợp doanh thu **mọi kênh**: đại lý, online, Shopee, bán lẻ (POS) — hiện tại chỉ có Shopee.
- Cột dữ liệu mới **giá vốn hàng bán** — **chỉ chủ được thấy số thật**.
- Chủ xem rõ: **dòng tiền thực** (tiền tươi cầm về), **biên lợi nhuận** theo kênh/theo đầu sách, các chỉ số tài chính chi tiết.

## 2. Phân tích câu trả lời questionnaire

| Câu | Chủ trả lời | Ý nghĩa cho GĐ3 |
|---|---|---|
| Q1 | **Chỉ khóa giá vốn sách.** Quản lý được thấy doanh thu sự kiện mình phụ trách (để chốt ca, đối soát két) **và** báo cáo kỳ — doanh thu toàn công ty, online, đại lý đều **mở** cho quản lý ("khoá... thì cũng không được"). | Ma trận quyền bên dưới — đã sửa ngày 08/10 sau khi chủ đính chính (trước đó hiểu nhầm là khóa hết) |
| Q8 | Tiền VietQR hiện về **tài khoản cá nhân của nhân viên** (không phải công ty) | Dòng tiền phải theo dõi "tiền về TK ai", không mặc định là TK công ty |
| Q12 | Máy quầy mở tab POS cả ngày (không phải dashboard); nhưng dời số nhạy cảm sang tab Chủ "cũng hay" | Làm cả hai: POS không hiện số nhạy cảm + tab Chủ là nơi duy nhất có số tổng |
| Q13 | Không có hiện tượng nhìn lén (tab khác nhau theo role) | Chưa cần PIN mở lại — ghi nhận, làm sau nếu cần |
| Q2–Q7, Q9–Q11, Q14–Q15 | Không trả lời → theo đề xuất mặc định | Hậu kiểm chi phí; 5 nhóm chi phí; 3 nguồn tiền; ảnh hóa đơn tùy chọn; chi phí nội bộ + ô VAT; vòng đời hội chợ tự động; 3 thẻ đầu trang; hiện song song 2 dòng lãi; khóa sổ vĩnh viễn (chỉ chủ mở khóa); nhập bù số tổng |

## 3. Hiện trạng (đối chiếu)

- `OwnerTab.tsx` + `GET /api/owner/finance`: doanh thu **Shopee** (`shopee_order_finance`: orders, escrow, fees, netProfit) + chi phí 7 nhóm + lãi ròng sau chi phí. Cả nav (`roles.ts`: tab `'chu'` chỉ có ở `ROLE_OWNER`) và API (`requireSessionRole(...['ROLE_OWNER'])`) đều đã chặn đúng.
- **Thiếu:** doanh thu đại lý (`delivery_orders`), online, bán lẻ (`orders`/POS); cột giá vốn; dòng tiền; biên lợi nhuận.
- Các tab đang hiện số tiền mà **quản lý và vai trò khác** thấy: `dashboard`, `sales` (SalesLedgerView), `shopee`, `pos`. Đây là các điểm xung đột quyền phải rà soát (mục 4).

## 4. Ma trận quyền (phân tích xung đột)

Nguyên tắc: **quyền xem theo 2 tầng — tầng tab và tầng trường dữ liệu.**

| Dữ liệu | Chủ | Quản lý | Thu ngân | Thủ kho | Kế toán thuế | Shopee Ops |
|---|---|---|---|---|---|---|
| Tab "Chủ" (`chu`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Doanh thu toàn công ty / online / đại lý | ✅ | ✅ (mở — Q1 đính chính 08/10) | ❌ | ❌ | ❌ | ❌ |
| Doanh thu sự kiện mình phụ trách | ✅ | ✅ (Q1) | ❌ | ❌ | ❌ | ❌ |
| **Giá vốn hàng bán (số thật)** | ✅ duy nhất | ❌ khóa | ❌ | ❌ | ❌ | ❌ |
| Số liệu VAT chính thức (`OFFICIAL_TAX`) | ✅ | ❌ | ❌ | ❌ | ✅ (chỉ phần này) | ❌ |
| Nợ vay / vốn huy động | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Điểm xung đột phải xử lý khi thêm cột giá vốn:**
1. **Rò rỉ qua API chung:** các API hiện tại (`/api/sales`, `/api/delivery-orders`, `/api/shopee`, `/api/pos`) trả dữ liệu cho nhiều role. Khi thêm cột giá vốn vào DB, phải đảm bảo các API này **không select/trả về** cột đó, hoặc strip trước khi trả — kiểm tra từng route, không chỉ trông chờ vào ẩn ở UI.
2. **Sổ kép / kế toán thuế (`ROLE_TAX`):** chỉ thấy `OFFICIAL_TAX`. Giá vốn là số nội bộ → không được lọt vào view thuế.
3. **Tab dashboard của quản lý (Q12):** quản lý được xem doanh thu (Q1 đính chính) nên dashboard giữ số doanh thu; thứ phải dời sang tab Chủ là **giá vốn, lãi gộp, biên lợi nhuận** — mọi chỉ số mà từ đó suy ngược ra được giá vốn.
4. **Biên lợi nhuận suy ngược:** mọi chỉ số margin **chỉ render ở tab Chủ** (kể cả khi quản lý xem được doanh thu).
5. **Q14 (khóa sổ):** sau "Đóng & quyết toán", chi phí/doanh thu kỳ đó chỉ xem; chỉ tài khoản chủ được mở khóa.

## 5. Thiết kế dữ liệu

### 5.1 Tổng hợp doanh thu đa kênh (kỳ: tháng, theo `YYYY-MM` giờ VN)

| Kênh | Nguồn | Điều kiện ghi nhận |
|---|---|---|
| Đại lý | `delivery_orders` (DISPATCHED_LOCKED) + `partner_debt` | **Ghi nhận khi đại lý thực trả tiền** (chủ chốt 08/10 — xuất kho hiếm khi thu tiền ngay). Cần theo dõi tiến độ trả: đã trả / còn lại / xác nhận thanh toán đầy đủ (xem 5.1b) |
| Online | `orders` kênh online | Đơn hoàn tất thanh toán |
| Shopee | `shopee_order_finance` (đã có) | Đơn DELIVERED, theo `synced_at` |
| Bán lẻ (POS) | `orders` kênh POS / két ca | Theo ca chốt (`cashbox`) |

Mỗi kênh trả về: `doanhThu` (ghi nhận), `tienThucThu` (tiền đã về tay), `congNoConLai`, `phiKenh` (phí Shopee...).

### 5.1b Theo dõi tiến độ trả tiền đại lý (chủ yêu cầu 08/10)

- Mỗi phiếu xuất đại lý có trạng thái thanh toán: `CHUA_TRA` → `TRA_MOT_PHAN` → `DA_TRA_DU` (nút "Xác nhận đã thanh toán đầy đủ" do chủ/quản lý bấm, ghi log người xác nhận + thời điểm).
- Bảng `partner_debt` hiện có dùng để lưu công nợ; bổ sung lịch sử trả từng đợt (ngày trả, số tiền, hình thức, TK nhận).
- Tab Chủ hiện cảnh báo: đại lý quá hạn / còn nợ lớn.

### 5.2 Cột giá vốn hàng bán — thiết kế theo lô nhập (chủ chốt 08/10: giá vốn đổi theo đợt in)

**Vấn đề:** cùng một đầu sách, mỗi đợt in/tái bản có giá vốn khác nhau. Không thể lưu một con số cố định cho cả đời sản phẩm.

**Phương án đề xuất (FIFO theo lô):**
- Mỗi **phiếu nhập kho** (đợt in về) ghi: số lượng + **đơn giá vốn của đợt đó** → mỗi đợt là một "lô" (`receipt_lot_id`, `unit_cost`).
- Khi xuất bán, hệ thống trừ kho theo **FIFO** (lô về trước xuất trước) và tính giá vốn dòng hàng = Σ (số lượng từ lô × đơn giá vốn lô đó).
- Tái bản giá mới → lô mới, giá mới — tự động đúng, không phải sửa tay giá vốn sản phẩm.
- Migration: thêm `unit_cost` vào chi tiết phiếu nhập + bảng `inventory_lots` (lô, số lượng còn lại). Phiếu xuất ghi `cogs_amount` từng dòng để truy vết.

**Phương án dự phòng (nếu thấy FIFO nặng):** giá vốn bình quân gia quyền theo ấn bản — đơn giản hơn nhưng kém chính xác khi giá in biến động mạnh. Khuyến nghị đi thẳng FIFO vì logic trừ kho đã có sẵn (Q9 đề xuất "tận dụng 100% logic thẻ kho").

**Quy trình nhập giá vốn — hướng kết hợp (chủ chốt 08/10):**
- **Luồng chính — giá vốn đi theo "lệnh in":** khi chủ đặt in (lúc đàm phán giá với nhà in — chính là lúc chủ biết giá vốn), chủ tạo lệnh in trong hệ thống kèm đơn giá vốn đã thỏa thuận. Khi sách về, thủ kho chỉ nhập **số lượng** đối chiếu lệnh in → hệ thống tự gắn giá vốn vào lô. Thủ kho không thấy số, không kẹt chờ.
- **Luồng dự phòng — phiếu "chờ nhập giá vốn":** hàng về chưa có lệnh in/chưa rõ giá → thủ kho nhập số lượng bình thường, phiếu ở trạng thái chờ. Tab Chủ hiện thẻ nhắc "N phiếu chờ nhập giá vốn", chủ điền sau. Báo cáo biên lợi nhuận gặp phiếu chưa có giá vốn thì hiện "chưa có giá vốn", không tính bừa thành 0.
- **Chủ được sửa giá vốn lô bất cứ lúc nào** (khi phát hiện sai), hệ thống ghi audit log: ai sửa, từ bao nhiêu → bao nhiêu, lúc nào.

**Quy tắc vàng:** không một API non-owner nào được select cột giá vốn. Viết helper `stripCogs()` dùng chung + test quét toàn bộ route (giống luật "test không dùng chung hằng với code": test assert response của các API non-owner **không chứa** key giá vốn).
- Giá vốn chỉ dùng để tính: giá vốn hàng bán theo kênh = Σ giá vốn các dòng đã bán → biên lợi nhuận gộp.

### 5.3 Dòng tiền (tiền tươi)

Theo Q5 (3 nguồn) + Q8 (VietQR về TK cá nhân nhân viên — chủ chốt 08/10: **giữ nguyên**, chỉ cần biết tiền nằm ở TK nào):
- Tách dòng tiền theo **nơi đến**: két tiền mặt POS (đối soát két ca), VietQR (bắt buộc ghi **về tài khoản ai** — cột mới `dest_account`: "TK cá nhân NV A", "TK công ty"...), chuyển khoản công ty, nhân viên tạm ứng.
- "Tiền tươi hôm nay" = tiền mặt két + tiền đã về TK (không tính công nợ chưa thu).
- Báo cáo "tiền đang nằm ở đâu": tổng hợp số dư theo từng tài khoản/nơi đến để chủ biết tiền phân tán thế nào.

### 5.4 Nợ vay & vốn huy động (chủ bổ sung 08/10 — "yếu tố thực tế quan trọng")

- Bảng mới `loans`: chủ nợ (ngân hàng / cá nhân / nhà đầu tư), số tiền vay, lãi suất, ngày vay, kỳ hạn, lịch trả (gốc + lãi từng kỳ), trạng thái.
- Ảnh hưởng dòng tiền: tiền vay về = dòng tiền vào; trả gốc + lãi = dòng tiền ra (lãi vay tính vào chi phí tài chính, trừ vào lãi ròng).
- Cảnh báo: khoản sắp đến hạn trả trong 30 ngày; tổng dư nợ hiện tại.
- Quyền: chỉ chủ thấy (thêm vào ma trận mục 4).

## 6. Thiết kế UI tab Chủ GĐ3 (giữ 3 thẻ đầu trang theo Q10)

1. **Thẻ Tiền tươi:** hôm nay cầm về bao nhiêu (tiền mặt két + tiền về TK, tách theo TK).
2. **Thẻ Hiệu quả:** bảng P&L theo kênh — mỗi kênh một dòng: Doanh thu | Giá vốn | Lãi gộp | Biên gộp % | Chi phí phân bổ | Lãi ròng | Biên ròng %. Thêm dòng tổng. (Q11: hiện song song "lãi tiền mặt" và "lãi kinh doanh đầy đủ".)
3. **Thẻ Cảnh báo:** quầy lệch két, đơn chuyển khoản chưa khớp, công nợ đại lý quá hạn.
4. **Phân tích biên lợi nhuận — bảng tương tác kiểu pivot (chủ yêu cầu 08/10: càng chi tiết, càng linh hoạt càng tốt):**
   - Chủ tự chọn: chiều dòng (kênh bán / đầu sách / tháng), chiều cột (doanh thu, giá vốn, lãi gộp, biên gộp %, chi phí phân bổ, lãi ròng, biên ròng %), bộ lọc (khoảng thời gian, kênh, đối tác).
   - Bật/tắt kênh, drill-down từ kênh → đầu sách → đơn hàng. Không làm BI nặng — một pivot gọn, đủ dùng, đúng dữ liệu thật.
5. Chi phí 7 nhóm như GĐ2 (giữ nguyên), thêm ô "Có hóa đơn VAT" (Q7).
6. **Thẻ Nợ & vốn (mới — chủ bổ sung 08/10):** xem 5.4.

## 7. Lộ trình thực hiện

- **P1 — Tổng doanh thu đa kênh:** API `/api/owner/finance` mở rộng thêm đại lý/online/bán lẻ (doanh thu ghi nhận theo tiền thực thu — mục 5.1); UI thêm bảng theo kênh. Chưa cần giá vốn.
- **P2 — Giá vốn theo lô + quyền trường dữ liệu:** migration (`unit_cost` phiếu nhập, `inventory_lots`, `cogs_amount` dòng xuất), FIFO trừ kho, helper `stripCogs`, rà soát toàn bộ API (mục 4.1–4.4), test quét rò rỉ.
- **P3 — Dòng tiền + pivot biên lợi nhuận:** tách tiền theo nơi đến (`dest_account`, Q8), P&L theo kênh, bảng pivot tương tác (mục 6.4), theo dõi tiến độ trả tiền đại lý (mục 5.1b).
- **P4 — Nợ vay + khóa sổ + dọn dashboard:** bảng `loans`, cảnh báo đến hạn; dời giá vốn/margin khỏi dashboard quản lý (Q12); khóa kỳ đã quyết toán (Q14).

## 8. Câu hỏi cần chủ trả lời thêm — ĐÃ TRẢ LỜI ngày 08/10

1. ~~Giá vốn = gì?...~~ → **Chốt:** giá vốn **thay đổi theo đợt in/tái bản** → thiết kế FIFO theo lô (mục 5.2).
2. ~~Doanh thu đại lý ghi nhận khi nào?...~~ → **Chốt:** ghi nhận **khi đại lý thực trả tiền** → theo dõi tiến độ trả + nút xác nhận đã thanh toán đầy đủ (mục 5.1b).
3. ~~VietQR về TK cá nhân...~~ → **Chốt:** giữ nguyên, bổ sung cột "tiền nằm ở tài khoản nào" (mục 5.3).
4. ~~Biên lợi nhuận xem theo chiều nào?...~~ → **Chốt:** càng chi tiết càng tốt → bảng pivot tương tác: tự chọn chiều, chỉ số, bộ lọc kiểu Power BI thu gọn (mục 6.4).
5. ~~Công nợ phải thu?...~~ → **Chốt:** có, ghi vào tab Chủ luôn; **bổ sung thêm mảng Nợ vay/vốn huy động** (mục 5.4).
