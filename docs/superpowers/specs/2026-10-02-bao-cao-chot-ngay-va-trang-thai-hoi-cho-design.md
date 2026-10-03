# Thiết kế lại Báo cáo Chốt Ngày + Trạng Thái Hội Chợ

Ngày: 2026-10-02 · Trạng thái: chờ chủ nghiệm thử · Phạm vi: UI hai màn hình + 2 trường dữ liệu

---

## 1. Bối cảnh (đã kiểm trong code, không phải phỏng đoán)

### 1.1 Hai màn hình chồng nhau ở phần tiền

| | Trạng thái Hội Chợ (`LiveFairMonitorModal.tsx`, 619 dòng) | Báo cáo Chốt Ngày (`DailyFairSettlementModal.tsx`, 1955 dòng) |
|---|---|---|
| Trả lời | "Bây giờ đang bán gì, còn bao nhiêu?" | "Hôm nay thu được bao nhiêu, két có khớp?" |
| Phạm vi | MẶC ĐỊNH tất cả kho hội chợ, KHÔNG chọn được 1 kho, KHÔNG chọn được ngày | 1 kho + 1 ngày (có ô chọn) |
| Tự làm mới | Có | Bấm tay |
| Đơn chưa đóng (`PENDING_CONFIRMATION`) | Có, kèm giữ chỗ ATP | Không — chỉ tính `COMPLETED` (daily-settlement.service.ts:74) |
| Tiền két / kiểm kê / in | Không | Có |

Backend của màn Trạng thái Hội Chợ **đã hỗ trợ sẵn** `?warehouseId=` và `?date=` (`live-monitor/route.ts:66-67`), component đã có prop `warehouseId` (dòng 85) — nhưng `ExecutiveDashboard.tsx:861` không truyền prop, và không có ô chọn ngày.

### 1.2 Trong Báo cáo Chốt Ngày, tiền bị chôn

Thứ tự hiện tại của tab `FINANCIALS`:

| # | Khối | Dòng |
|---|---|---|
| 1 | Đơn Giá Trị Cao Nhất | 728 |
| 2 | Top 10 Ấn Phẩm Bán Chạy (10 dòng) | 779 |
| 3 | **Doanh thu gộp / Chiết khấu / Thực thu / Phiên ca** | 848 |
| 4 | Biểu đồ số đơn theo giờ | 904 |
| 5 | Cơ cấu tiền mặt / chuyển khoản | 911 |
| 6 | **Đối soát két (kỳ vọng / lệch)** | 957 |

Người mở báo cáo lúc 22h phải cuộn qua 10 sản phẩm bán chạy mới thấy "Thực thu".

### 1.3 Ba vấn đề UI cụ thể

1. **Nút "Đơn vị CK"** (dòng 675-687): chỉ cho xem MỘT trong hai số. Đọc "%" tưởng đó là tổng chiết khấu là hiểu sai. Chiết khấu nằm ở cả bảng (dòng 1402) và cả KPI (859).
2. **Thanh chuyển tab** (639-672): 3 tab chữ dài + nút "Đơn vị CK" + nút tải lại chen cùng một hàng; trên điện thoại là thanh cuộn ngang không có dấu hiệu còn tab.
3. **Nút "In Báo Cáo"** nằm trên cùng (dòng 598) — khi đang ở giữa trang dài thì phải cuộn lên.

### 1.4 Bản in thiếu luôn nhóm cần đếm

- Màn hình tab Kiểm Kê: bảng ĐẦY ĐỦ 88 ấn phẩm, có sắp xếp + lọc (memo `sortedStocktakeList` 196-218, render 1298).
- Bản in: **không có bảng này**. Chỉ in `IV. TỒN SÁCH CUỐI NGÀY (ẤN PHẨM ĐÃ BÁN)` từ `soldOnlyRows` (dòng 393) — lọc `soldToday > 0`, thứ tự thô.
- Bảng in đó **đã có cột "Tồn còn"** (dòng 1709) nên xếp lại theo cột này được, không phải đổi cấu trúc bảng.

---

## 2. Mục tiêu / Không mục tiêu

**Mục tiêu**
1. Mở Báo cáo Chốt Ngày là thấy ngay tiền thu, két có khớp không, còn đơn nào đang chờ.
2. Hai màn hình không còn cùng trả lời một câu hỏi.
3. Bản in có đủ hai bảng (sắp hết + đã bán), cùng xếp theo tồn bé → lớn.
4. Bỏ hẳn nút "Đơn vị CK", thay bằng hiển thị đồng thời tiền và phần trăm.
5. Bổ sung chọn 1 kho / 1 ngày cho Trạng Thái Hội Chợ, nhớ kho đã chọn.

**Không mục tiêu (lần này không làm)**
- Không đổi công thức tính `grossSales / netSales / totalDiscount`.
- Không thay đổi nghiệp vụ hủy đơn chờ, không đụng TTL.
- Không viết lại `daily-settlement.service.ts` từ đầu.
- Không sửa bố cục bản in giấy ngoài phần kiểm kê.

---

## 3. Quyết định đã chốt

| # | Quyết định | Chủ duyệt |
|---|---|---|
| D1 | Bỏ nút "Đơn vị CK", hiện luôn cả tiền và % | ✅ |
| D2 | Chuyển "Đơn lớn nhất" + "Top 10 bán chạy" sang Trạng Thái Hội Chợ | ✅ |
| D3 | Chuẩn hoá ngày nghiệp vụ của cả 2 màn về giờ Việt Nam | ✅ |
| D4 | Thêm dòng "đơn QR đang chờ xác nhận" vào Báo cáo Chốt Ngày (phương án A) | ✅ |
| D5 | Bản in: thêm bảng "Sắp hết (cần đếm)" + xếp BẢNG ĐÃ BÁN theo cột tồn (phương án C) | ✅ |
| D6 | Trạng Thái Hội Chợ: nhớ kho đã chọn, KHÔNG nhớ ngày | ✅ |
| D7 | Kiểm kê mặc định xếp **tồn bé → lớn**; bỏ chế độ "Mặc định" (thô) | ✅ |

---

## 4. Thiết kế

### 4.1 Báo Cáo Chốt Ngày — thanh chuyển tab

```
┌──────────────────────────────────────────────────────────────┐
│ Báo Cáo Chốt Ngày        [02/10/2026 ▾] [Kho: Hội chợ ▾]   │  ← giữ nguyên
├──────────────────────────────────────────────────────────────┤
│  💰 Tiền & Két   │   📦 Kiểm Kê   │   🏷 Chiết Khấu          │  ← sticky, 3 mục
├──────────────────────────────────────────────────────────────┤
│  [nội dung tab]                                             │
├──────────────────────────────────────────────────────────────┤
│                            [🔄]        [🖨 In Báo Cáo] [Đóng] │  ← sticky footer
└──────────────────────────────────────────────────────────────┘
```

- Segmented pill, nhãn NGẮN có dấu ("Tiền & Két", "Kiểm Kê", "Chiết Khấu"), luôn hiện cả 3 mục trên điện thoại (không cuộn ngang).
- Nút tải lại thu gọn thành icon ở footer.
- `activeTab` nhớ trong `sessionStorage` để đóng/mở lại không mất chỗ đang xem (cùng kiểu với `localStorage` đã dùng ở 5 component).

### 4.2 Báo Cáo Chốt Ngày — tab "Tiền & Két"

```
┌──────────────────────────────────────────────────────────────┐
│ THỰC THU NGÀY 02/10            ● Đã chốt ca 100%             │
│ 12.480.000 đ                                                │
│ ┌───────────┬───────────┬─────────────┬──────────┐           │
│ │ Tiền mặt │ Chuyển khoản│ Chiết khấu  │ Số đơn  │           │
│ │ 8.200.000 │ 4.280.000  │ −620.000đ   │  37 đơn  │           │
│ │           │            │ tương đương │          │           │
│ │           │            │ 5,2%        │          │           │
│ └───────────┴───────────┴─────────────┴──────────┘           │
│ ✓ Tiền kỳ vọng trong két 8.640.000đ — khớp                  │
│ ⚠ 2 đơn QR chờ xác nhận — 1.150.000đ  [Xem ở Trạng Thái Hội Chợ] │
├──────────────────────────────────────────────────────────────┤
│ Biểu đồ số đơn theo giờ                                     │
├──────────────────────────────────────────────────────────────┤
│ Bán chạy nhất hôm nay: [HH034] Cháu trai Wittgenstein · 12 cuốn│
└──────────────────────────────────────────────────────────────┘
```

- "Đơn Giá Trị Cao Nhất" và "Top 10" **rời khỏi** tab này (D2) → chuyển sang Trạng Thái Hội Chợ.
- Chỉ giữ lại **1 dòng** bán chạy nhất (để người in báo cáo vẫn biết món chủ lực).
- Ô "Chiết khấu" hiện **cả hai** số: tiền (chữ to, đỏ) + `tương đương 5,2%` (chữ nhỏ, xám). Không có nút bấm nào.
- Dòng két: xanh khi `cashVariance === 0`, đỏ + số tiền lệch khi khác. Nguồn: `cashboxReconciliation` đã có sẵn.
- Dòng đang chờ (D4): tính ở server, xem mục 5.1.

### 4.3 Báo Cáo Chốt Ngày — tab "Chiết Khấu"

- Bỏ dùng `discountDisplayMode` trong bảng: **mỗi ô gồm 2 dòng** — `−620.000đ` (đậm) và `5,2%` (nhỏ, xám).
- Giữ nguyên phần cảnh báo đơn vượt trần và tỷ lệ duyệt.
- Xoá state `discountDisplayMode` khỏi component.

### 4.4 Báo Cáo Chốt Ngày — tab "Kiểm Kê"

- **Mặc định xếp tồn bé → lớn (D7).** `stocktakeSortMode` khởi tạo `'ASC'` thay vì `'DEFAULT'`. Lý do: đang phải bấm nút thì mọi người sẽ bấm nút — thà mặc định luôn, và bản in mặc định khớp luôn.
- **Bỏ chế độ "Mặc định" (thô)**: nút sắp xếp chỉ còn 2 trạng thái `Bé → Lớn` ⇄ `Lớn → Bé`. Không có đường về thứ tự thô vì thứ tự thô không mang ý nghĩa gì cho người đối chiếu, và bản in giờ phải khớp màn hình.
- Xoá 2 đoạn tự chuyển sang ASC không còn tác dụng: khi mở tab Kiểm Kê (dòng 1203-1205) và khi bật lọc sắp hết (dòng 1198-1208 rút gọn còn phần bật/tắt).
- Giữ nguyên bảng và nút "Sắp hết (≤ 5)", nhưng **phải hiện cảnh báo trên màn hình**: "Đang lọc: chỉ tồn ≤ 5 — bản in cũng chỉ có các dòng này."

### 4.5 Bản in (D5) — phát hiện khi đọc code: bản in THIẾU bảng kiểm kê

Thực tế hiện tại (đã kiểm dòng 1466-1955): bản in **không có bảng kiểm kê tồn đầy đủ**. Nó chỉ in bảng `IV. TỒN SÁCH CUỐI NGÀY (ẤN PHẨM ĐÃ BÁN)` lấy `soldOnlyRows` — chỉ những ấn phẩm **đã bán trong ngày** (`soldToday > 0`), và **thứ tự thô** (dòng 393).

Hậu quả thực tế: cuốn sắp hết mà hôm nay không bán được cuốn nào thì **không có mặt trên giấy**, dù đó đúng là nhóm phải đếm lúc đóng thùng.

**Sửa (phương án C):**

1. Bảng `IV. TỒN SÁCH CUỐI NGÀY (ẤN PHẨM ĐÃ BÁN)` — **xếp theo cột "Tồn còn" bé → lớn**. Bảng này đã có cột `Tồn còn` (dòng 1709/1727) nên chỉ sắp lại mảng, không đổi cấu trúc bảng.
2. Thêm bảng mới `V. SẮP HẾT (TỒN ≤ 5) — CẦN ĐẾM CUỐI NGÀY`: lấy `inventoryReconciliation` lọc `theoreticalStock <= STOCK_THRESHOLD_WARNING`, **xếp tồn bé → lớn**. Cột: `#`, `Mã`, `Tên ấn phẩm`, `Tồn còn`, `Số đếm thực tế` (ô trống để nhân viên điền tay khi kiểm kê — hệ thống hiện **không** lưu số đếm, xem chú thích state ở trên).
3. Cả hai bảng dùng **cùng một quy tắc**: xếp theo tồn bé → lớn. Trùng lặp giữa hai bảng là CÓ CHỦ Ý — một cuốn tồn 3 vừa đã bán vừa sắp hết xuất hiện ở cả hai chỗ vì nó thuộc cả hai việc: cần đếm và đã bán.
4. Nút "Chỉ hiện tồn ≤ 5" trên màn hình **không** chi phối bản in — bản in luôn in cả hai bảng cố định ở trên. Nhờ vậy giấy in luôn giống nhau bất kể người dùng đang bật/tắt bộ lọc trên màn hình.

### 4.6 Trạng Thái Hội Chợ

- Thêm 2 bộ chọn trên đầu modal: **Kho** (mặc định "Tất cả kho hội chợ") và **Ngày** (mặc định hôm nay giờ VN).
- Nhớ **kho** trong `localStorage` (`formapubli.liveMonitor.warehouseId`), **không nhớ ngày** (D6).
- Chuyển vào đây 2 khối lấy từ Báo Cáo Chốt Ngày (D2):
  - "Đơn Giá Trị Cao Nhất" (thuộc loại "đang bán gì").
  - "Top 10 Ấn Phẩm Bán Chạy" + tổng quà tặng.
- API **không cần sửa** — `live-monitor/route.ts` đã nhận `warehouseId` và `date`.
- Tiêu đề hiện ngày đang xem để không nhầm với hôm nay: `Trạng Thái Hội Chợ — 02/10/2026 · Kho Hội chợ Hồ Gươm`.

---

## 5. Thay đổi dữ liệu

### 5.1 Trường mới `pendingQrTotal` (D4)

Tính trong `daily-settlement.service.ts`:

```
pendingQrTotal = SUM(finalAmount) của đơn thỏa ĐỒNG THỜI:
  1. warehouseId = kho đang xem
  2. status = 'PENDING_CONFIRMATION'
  3. paymentMethod là chuyển khoản (qrTransfer / counterTransfer)
  4. createdAt thuộc ngày nghiệp vụ VN
  5. KHÔNG quá hạn — dùng lại OrderService.isPendingExpired()
```

**Vì sao điều 5 là bắt buộc:** TTL là 48 giờ (`order.service.ts:47`) và đơn quá hạn **vẫn nằm trong DB với status PENDING_CONFIRMATION** cho tới khi ai đó thao tác xác nhận (lúc đó mới đổi `CANCELLED`, dòng 1645). ATP đã nhả giữ chỗ từ lâu (dòng 1007 bỏ qua đơn hết hạn). Tính bằng `SUM` thuần sẽ tính cả tiền đã chết.

**Quy tắc hiển thị:** dòng này là **ảnh chụp lúc mở báo cáo**, tách khối riêng, KHÔNG cộng vào Thực thu. Đơn chờ sau này thành `COMPLETED` sẽ nằm trong Thực thu của lần mở sau — đó là đúng, nên phải ghi rõ thời điểm.

### 5.2 Chuẩn hoá ngày nghiệp vụ VN (D3)

- ~~`daily-settlement.service.ts` hiện lấy ngày UTC~~ — **ĐÃ KIỂM 02/10: `daily-settlement` ĐÃ dùng `vnDayEquals` (ngày VN) từ trước.** Chỉ có **comment** trong `live-monitor/route.ts` nói ngược lại là sai. Không có lỗi logic ngày ở đây.
- Sửa: mốc ngày nghiệp vụ của `daily-settlement` về giờ VN, dùng cùng cách tính `businessDateOf`/`vnToday` đang có sẵn ở `order.service.ts`.
- Ngày báo cáo được chọn (mặc định hôm nay) giữ nguyên cơ chế hiện có.

---

## 6. Rủi ro và cách chặn

| Rủi ro | Dấu hiệu sớm | Cách chặn |
|---|---|---|
| Đơn hết hạn 48h làm sai số tiền chờ | Số chờ > số tiền thật đang giữ ATP | Bắt buộc `isPendingExpired()`; thêm 1 assertion test |
| Người dùng cộng tay "Thực thu + đang chờ" | Báo cáo in ra vượt tổng thu | Tách khối, nhãn "chưa ghi nhận", không cùng hàng |
| Bản in khác màn hình | Nhân viên đối chiếu lệch dòng | Bản in dùng cùng `sortedStocktakeList` + ghi rõ thứ tự/lọc |
| Mở nhầm ngày ở Trạng Thái Hội Chợ | Số liệu = 0 khi đang bán | Không nhớ ngày; tiêu đề luôn hiện ngày đang xem |
| Bỏ nút "Đơn vị CK" làm vỡ chỗ khác | `discountDisplayMode` còn dùng ở dòng 859/861/1402/1424 | Xoá hẳn state, thay bằng 2 con số ở mọi chỗ |
| Đổi mốc ngày làm lệch báo cáo cũ | Báo cáo ngày hôm qua dịch số | Chỉ đổi mốc TÍNH, không sửa dữ liệu cũ; test với đơn quanh nửa đêm |
| Mặc định xếp mới làm người dùng "không tìm ra" | Nhân viên tưởng bảng lỗi | Nhãn thứ tự luôn hiện trên màn hình và trên giấy in, không chỉ bằng màu/icon |
| Bỏ chế độ "Mặc định" thì không quay lại được thứ tự cũ | — | Chấp nhận: thứ tự thô không có ý nghĩa đối chiếu |

---

## 7. Kiểm thử

1. `scripts/test-settlement-money-header.ts` (mới) — khối tiền đầu tab: đúng số từ payload, không mất ô nào khi đổi chiết khấu %/đ. **Tên file đúng là `test-settlement-money-header.ts`** — `test-settlement-report-header.ts` không tồn tại.
2. `scripts/test-pending-qr-total.ts` (mới) — 4 ca: đơn chờ hạn (loại), đơn chờ còn hạn (tính), đơn tiền mặt chờ (loại), đơn ngoài ngày (loại).
3. Cập nhật `scripts/test-s3-discount-approval.ts` — thêm khẳng định bản in kiểm kê theo thứ tự đang lọc.
4. Kiểm thử tay trên điện thoại: mở report ở 2 kho khác nhau, mở Trạng Thái Hội Chợ ở 2 kho, bấm In, đối chiếu thứ tự dòng.

---

## 8. Ngoài phạm vi (ghi để sau)

- Sửa mã vạch `ed-h66`, `ed-h85` (chủ sẽ tự cập nhật sau).
- Validate checksum ISBN-13 khi nhập.
- Bổ sung cột "so với hôm qua" ▲▼ trên khối tiền (cần truy vấn ngày hôm trước — làm ở đợt sau, không gộp vào lần này để giữ diff nhỏ).