# formapubli — Master Architecture & Operating Blueprint
> **Hệ điều hành Kho vận & Vận hành Xuất bản — Phiên bản 2.0 (Kiến trúc chuẩn hóa)**  
> **Trọng tâm Phase 1:** Lõi Quản lý Kho vận, Vòng đời ISBN & Sổ cái Tồn kho Bất biến (Logistics Core & Append-Only Inventory Ledger)  
> **Tài liệu tham chiếu chung cho toàn bộ đội ngũ Kỹ thuật & Vận hành kinh doanh**

---

## Mục lục tài liệu

1. [Bối cảnh & Tuyên ngôn dự án](#01-bối-cảnh--tuyên-ngôn-dự-án)
2. [Lộ trình Triển khai theo Phase](#02-lộ-trình-triển-khai-theo-phase)
3. [Ranh giới & Trọng tâm của MVP (Phase 1)](#03-ranh-giới--trọng-tâm-của-mvp-phase-1)
4. [Khung Tiếp nhận & Xử lý Dữ liệu Google Sheets](#04-khung-tiếp-nhận--xử-lý-dữ-liệu-google-sheets)
5. [Mô hình Miền Nghiệp vụ Kho vận Ngành sách](#05-mô-hình-miền-nghiệp-vụ-kho-vận-ngành-sách)
6. [Sổ cái Kho Bất biến (Inventory Ledger) & Các Bất biến Hệ thống](#06-sổ-cái-kho-bất-biến-inventory-ledger--các-bất-biến-hệ-thống)
7. [Danh mục Sự kiện Kho vận (Logistics Event Catalog)](#07-danh-mục-sự-kiện-kho-vận-logistics-event-catalog)
8. [Các Luồng Vận hành Kho Chi tiết (Detailed Workflows)](#08-các-luồng-vận-hành-kho-chi-tiết-detailed-workflows)
9. [Mô hình Dữ liệu Cơ sở (Database Schema & Data Dictionary)](#09-mô-hình-dữ-liệu-cơ-sở-database-schema--data-dictionary)
10. [Kiến trúc Kỹ thuật & Xử lý Đồng thời (Concurrency & Architecture)](#10-kiến-trúc-kỹ-thuật--xử-lý-đồng-thời-concurrency--architecture)
11. [Thiết kế Trải nghiệm theo 3 Vai trò Vận hành (Role-Based UX)](#11-thiết-kế-trải-nghiệm-theo-3-vai-trò-vận-hành-role-based-ux)
12. [Chiến lược Kiểm thử & Tiêu chuẩn Nghiệm thu (DoD)](#12-chiến-lược-kiểm-thử--tiêu-chuẩn-nghiệm-thu-dod)
13. [Định hướng Phát triển cho các Phase Tiếp theo](#13-định-hướng-phát-triển-cho-các-phase-tiếp-theo)

---

## 01. Bối cảnh & Tuyên ngôn dự án

### 1.1. Bối cảnh ngành xuất bản & phát hành sách
Kinh doanh xuất bản và chuỗi nhà sách tại Việt Nam có những đặc thù rất riêng so với bán lẻ hàng tiêu dùng thông thường:
- **Đơn vị định danh:** Mỗi ấn bản sách gắn liền với một mã chuẩn quốc tế **ISBN-13**. Một tác phẩm (*Title*) có thể có nhiều ấn bản (*Editions* — bìa mềm, bìa cứng, bản đặc biệt, tái bản có thay đổi).
- **Tính chất luân chuyển phức tạp:** Sách từ nhà in nhập về kho tổng, sau đó luân chuyển đến các kệ sách tại cửa hàng bán lẻ, gửi ký gửi tại chuỗi nhà sách đối tác, hoặc đóng gói giao trực tiếp cho khách mua online.
- **Ký gửi (Consignment) chiếm tỷ trọng lớn:** Sách gửi tại các đối tác phân phối vẫn thuộc **quyền sở hữu của công ty phát hành** cho đến khi đối tác thực tế bán được cho bạn đọc và chốt biên bản đối soát.
- **Tình trạng hàng hóa đa dạng:** Ngoài sách mới 100%, vòng đời sách phát sinh sách trầy xước nhẹ do trưng bày (*Minor Damage*), sách lỗi in ấn hoặc dập gáy do vận chuyển (*Defective*), sách đang chờ kiểm định sau khi thu hồi (*Quarantine*).

### 1.2. Nỗi đau của hiện trạng: Ma trận Google Sheets
Hiện tại, doanh nghiệp đang phải điều hành toàn bộ dòng chảy hàng hóa qua các bảng tính Google Sheets rời rạc:
- **Tồn kho ảo & Bất đồng bộ:** Một đầu sách được ghi chép ở file kho tổng, file cửa hàng, file theo dõi ký gửi đối tác A, file đơn hàng lẻ. Khi có phát sinh, việc cập nhật thủ công dẫn đến lệch số liệu, không ai biết chính xác ngay lúc này công ty còn bao nhiêu cuốn thực sự bán được.
- **Không có truy vết lịch sử (Audit Trail):** Khi số lượng trên Sheets bị sửa hoặc công thức bị nhảy, không thể biết ai đã sửa, sửa lúc nào, dựa trên chứng từ hay quyết định thực tế nào.
- **Rủi ro thất thoát:** Hàng gửi đi ký gửi và hàng luân chuyển trên đường (In-transit) dễ bị thất lạc hoặc quên thu hồi do không có quy trình xác nhận 2 bước độc lập.

### 1.3. Tuyên ngôn cốt lõi
> **"ERP correctness first. AI and automation second."**  
> **"Xây lõi Kho vận tin cậy tuyệt đối trước — Mở rộng thương mại và tích hợp sau."**

formapubli không đặt mục tiêu ôm đồm toàn bộ các chức năng kế toán thuế hay sàn thương mại điện tử ngay từ đầu. Dự án tập trung giải quyết dứt điểm **tính toàn vẹn và chuẩn xác của dòng chảy vật lý của từng cuốn sách**.

---

## 02. Lộ trình Triển khai theo Phase

Thay vì ép buộc một khung thời gian cố định gây cắt xén chất lượng kiểm soát, formapubli chia nhỏ thành các **Phase mục tiêu**. Mỗi phase chỉ được coi là hoàn tất khi đã vượt qua các tiêu chí nghiệm thu khắt khe (*Definition of Done*).

```text
[Phase 0: Khung Dữ liệu & Tiếp nhận Sheets]
                     │
                     ▼
[Phase 1: Lõi Kho vận & Sổ cái Tồn kho (MVP)]
                     │
                     ▼
[Phase 2: Mở rộng Thương mại & Quy trình Nghiệp vụ]
                     │
                     ▼
[Phase 3: Tích hợp Hệ sinh thái & Đa kênh]
```

### Chi tiết các Phase:

| Phase | Trọng tâm | Đầu ra nghiệm thu chính | Điều kiện chuyển Phase |
|---|---|---|---|
| **Phase 0** | **Khung Dữ liệu & Tiếp nhận Sheets** | - Tiếp nhận Google Sheets và bản thuyết minh từ chủ dự án.<br>- Hoàn thiện Data Dictionary & Danh mục ISBN.<br>- Bộ quy tắc làm sạch dữ liệu và cấu trúc vị trí kho. | Toàn bộ danh mục đầu sách, vị trí kho và số dư ban đầu được định hình trên giấy và đối soát logic. |
| **Phase 1 (MVP)** | **Lõi Kho vận & Sổ cái Tồn kho Bất biến** | - Master Data (Đầu sách, ISBN, Vị trí kho/kệ, Đối tác, Pháp nhân).<br>- Sổ cái kho Append-Only Inventory Ledger & Balance Projection.<br>- Luồng Nhập kho, Chuyển kho 2 bước, Xuất ký gửi, Xuất bán cơ bản.<br>- Kiểm kê kho & Điều chỉnh tồn.<br>- Hỗ trợ súng quét mã vạch USB.<br>- Báo cáo tồn vật lý, tồn khả dụng theo thời gian thực. | Hệ thống chạy trơn tru với dữ liệu thực tế tại 1 kho tổng và 1 điểm ký gửi; 0 lỗi âm kho; tổng biến động luôn cân bằng. |
| **Phase 2** | **Vận hành Thương mại & Luồng Mở rộng** | - Quản lý đơn hàng thương mại chi tiết & Bảng giá theo đối tác.<br>- Quy trình đổi trả hàng (RMA) & Khu vực cách ly kiểm định.<br>- Nghiệp vụ Đặt trước (Pre-order) & Quy tắc phân bổ tồn kho.<br>- Quản lý công nợ vận hành với đối tác ký gửi. | Luồng thương mại và đổi trả chạy khép kín; các trạng thái đơn/thanh toán/hàng hóa tách biệt rõ ràng. |
| **Phase 3** | **Tích hợp Hệ sinh thái & Kênh ngoài** | - Cơ chế kết nối hóa đơn điện tử chuyên biệt (MSInvoice).<br>- Tích hợp sàn TMĐT (Shopee Open Platform) dựa trên hạn ngạch tồn.<br>- Đồng bộ tồn 2 chiều với Website phát hành.<br>- Báo cáo tài chính quản trị và tuổi tồn chuyên sâu. | Các hệ thống ngoài kết nối an toàn qua Outbox/Inbox Pattern; không làm gián đoạn hay treo transaction kho nội bộ. |

---

## 03. Ranh giới & Trọng tâm của MVP (Phase 1)

Để đảm bảo thành công và tính ổn định tuyệt đối của hệ thống, Phase 1 đặt ra ranh giới phạm vi (*Scope Boundary*) minh bạch:

### 3.1. Những gì BẮT BUỘC có trong Phase 1 (In-Scope)
1. **Quản lý Danh mục Gốc (Master Data):**
   - Quản lý Tác giả, Nhà xuất bản, Tác phẩm, Ấn bản (ISBN-13).
   - Quản lý Cây vị trí lưu trữ: `Kho vật lý (Warehouse) → Khu vực (Zone) → Kệ (Shelf)`.
   - Quản lý Đối tác (Nhà in, Đại lý ký gửi, Khách sỉ) và Pháp nhân công ty.
2. **Sổ cái Kho Bất biến (Inventory Ledger Core):**
   - Bút toán ghi nhận mọi biến động: Nhập, Xuất, Chuyển, Điều chỉnh.
   - Cơ chế Balance Projection cập nhật tức thời trong cùng transaction database.
   - Nghiêm cấm hoàn toàn hành vi sửa (`UPDATE`) hoặc xóa (`DELETE`) bản ghi lịch sử kho.
3. **Các Luồng Vận hành Kho Cơ bản:**
   - **Nhập hàng (Receive):** Nhập sách từ nhà in/nhà cung cấp theo từng đợt, hỗ trợ ghi nhận Lô nhập (*Receipt Lot*).
   - **Chuyển kho 2 bước (Two-step Transfer):** Kho A xuất $\rightarrow$ Vào trạng thái trung gian `IN_TRANSIT` $\rightarrow$ Kho B xác nhận thực nhận. Tuyệt đối không tự động tăng kho đích khi kho nguồn mới gửi đi.
   - **Ký gửi vật lý (Consignment Dispatch):** Xuất hàng chuyển sang địa điểm của đối tác ký gửi, hệ thống tự động ghi nhận đối tác là nơi lưu giữ (*Custodian*) nhưng quyền sở hữu (*Owner*) vẫn thuộc công ty.
   - **Xuất bán cơ bản (Sale Dispatch):** Trừ trực tiếp tồn vật lý tại địa điểm bán theo phiếu xuất.
   - **Kiểm kê & Điều chỉnh (Stocktaking & Adjustment):** So sánh số đếm thực tế và số sách trên hệ thống; tạo phiếu điều chỉnh có ghi rõ lý do và người phê duyệt.
4. **Hỗ trợ Thao tác Thực địa:**
   - Hỗ trợ máy quét mã vạch Barcode/ISBN chuẩn USB (hoạt động theo cơ chế giả lập bàn phím - Keyboard Wedge) với phím Enter kết thúc.
   - Tra cứu nhanh thông tin tồn kho của từng ISBN tại mọi vị trí chỉ bằng 1 lần quét.
5. **Báo cáo Kho Cốt lõi:**
   - Tồn kho tại thời điểm hiện tại và tại thời điểm bất kỳ trong quá khứ ($t$).
   - Thẻ kho (Lịch sử biến động từng ISBN tại từng kho).

### 3.2. Những gì DỨT KHOÁT ĐỂ LẠI cho Phase sau (Out-of-Scope Phase 1)
- ❌ **Không có hóa đơn điện tử:** Chưa tìm kiếm endpoint hay kết nối hóa đơn trong giai đoạn này; MVP giữ tập trung vào kho vận. Sẽ có giải pháp chuyên biệt riêng ở Phase 3.
- ❌ **Chưa triển khai chính sách đổi trả phức tạp:** Các quy trình phân loại kiểm định sách cũ/hỏng nhiều bước sẽ nằm ở Phase 2. Trong Phase 1, sách hỏng chỉ được ghi giảm qua phiếu kiểm kê điều chỉnh.
- ❌ **Chưa triển khai quy tắc phân bổ Pre-order:** Việc gom tiền cọc, giữ chỗ ưu tiên theo thuật toán FIFO sẽ được đưa vào Phase 2 khi phần thương mại được xây dựng.
- ❌ **Chưa tích hợp sàn Shopee hoặc Website:** Giữ cho dữ liệu nội bộ sạch và vững trước khi mở cổng API ra bên ngoài.
- ❌ **Không phụ thuộc vào AI/LLM:** Lõi kho vận vận hành hoàn toàn bằng logic nghiệp vụ chính xác 100%.

---

## 04. Khung Tiếp nhận & Xử lý Dữ liệu Google Sheets

Chủ dự án sẽ cung cấp các file Google Sheets đang sử dụng trong thực tế kèm theo thuyết minh cụ thể trong tương lai gần. Dưới đây là kiến trúc tiếp nhận (*Intake Architecture*) đã được chuẩn bị sẵn để xử lý ngay khi nhận dữ liệu.

```text
[Google Sheets Thực tế & Thuyết minh từ Doanh nghiệp]
                        │
                        ▼
         [1. Intake & Snapshot Bất biến]
                        │
                        ▼
         [2. Data Profiling & Phát hiện Sai lệch]
                        │
                        ▼
         [3. Staging DB (import_batches & rows)]
                        │
                        ▼
         [4. Làm sạch & Chuẩn hóa (Unicode, ISBN)]
                        │
                        ▼
         [5. Đối soát Số dư Mở đầu (Opening Balance)]
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
 [Ký nhận Biên bản]           [Còn sai sót / Lệch]
        │                               │
        ▼                               ▼
 [6. Ghi bút toán OPENING]     [Rà soát lại Sheets]
```

### Các bước trong quy trình tiếp nhận:
1. **Snapshot Bất biến:** Khi nhận link/file Google Sheets, toàn bộ dữ liệu thô được xuất thành file CSV/JSON và lưu trữ đóng băng (kèm mã băm SHA-256). Tuyệt đối không chỉnh sửa trực tiếp trên file gốc.
2. **Profiling (Khảo sát chất lượng dữ liệu):**
   - Quét tìm các mã ISBN sai định dạng, bị mất số 0 ở đầu (do định dạng số của Sheets).
   - Nhận diện các đầu sách trùng lặp nhưng bị gõ khác tên (ví dụ: có dấu cách thừa, viết hoa thường).
   - Phát hiện các dòng số lượng bị âm, công thức tính bị lỗi `#REF!`, `#VALUE!`.
3. **Staging & Validation:**
   - Dữ liệu được nạp vào các bảng tạm `sheet_import_batches` và `sheet_import_rows`.
   - Mỗi dòng dữ liệu được phân loại: `VALID`, `WARNING`, hoặc `ERROR` với thông báo lỗi chi tiết đến từng ô.
4. **Đối soát & Ký nhận Số dư Mở đầu (Opening Balance Sign-off):**
   - Thay vì cố gắng tái dựng lại 3 năm lịch sử từ những file tính không đủ chứng từ, hệ thống chỉ lấy **Số dư chốt kiểm kê tại ngày chuyển đổi** làm số dư ban đầu (`OPENING_BALANCE`).
   - Biên bản số dư mở đầu phải được Thủ kho và Quản lý đối chiếu, ký xác nhận trước khi nạp chính thức vào Sổ cái kho.

---

## 05. Mô hình Miền Nghiệp vụ Kho vận Ngành sách

### 5.1. Nguyên tắc cốt lõi: Không bao giờ dùng một cột `quantity` duy nhất
Một lỗi sai kinh điển của các phần mềm quản lý kho đơn giản là chỉ dùng một cột `quantity` để biểu diễn số lượng sách. Trong thực tế ngành sách, cùng 1 đầu sách có thể ở nhiều trạng thái hoàn toàn khác nhau.

formapubli quản lý hàng hóa dựa trên **4 chiều độc lập**:

1. **Ấn bản (Edition / ISBN):** Xác định phiên bản in cụ thể của tác phẩm. Mỗi ấn bản có một mã ISBN-13 duy nhất.
2. **Vị trí vật lý (Location):** Nơi cuốn sách đang thực sự nằm:
   - Kho tổng (Khu vực A, Kệ B).
   - Kệ sách tại Cửa hàng bán lẻ.
   - Vị trí trung gian đang vận chuyển (`IN_TRANSIT`).
   - Kho/Kệ tại đối tác nhận ký gửi.
3. **Chủ sở hữu (Owner):** Pháp nhân nắm quyền sở hữu tài sản đối với cuốn sách.
   - Sách tại kho công ty do công ty sở hữu $\rightarrow$ Owner: `Company`.
   - Sách đã gửi sang nhà sách đối tác để ký gửi $\rightarrow$ Location: `Partner_Store`, nhưng Owner: `Company`.
4. **Tình trạng vật lý (Condition):**
   - `NEW`: Sách mới 100%, nguyên màng co hoặc đạt tiêu chuẩn trưng bày bán lẻ.
   - `MINOR_DAMAGE`: Sách xước bìa, cấn nhẹ gáy, chuyển sang bán giảm giá.
   - `DEFECTIVE`: Sách rách trang, in thiếu trang, dán ngược bìa từ nhà in; chờ trả nhà in hoặc thanh lý.
   - `QUARANTINE`: Sách thu hồi từ đối tác hoặc khách hàng; đang nằm khu cách ly để chờ kiểm định.

### 5.2. Phân biệt các khái niệm Tồn kho & Cam kết thương mại

| Khái niệm | Định nghĩa nghiệp vụ | Cách tính |
|---|---|---|
| **Tồn vật lý (Physical Stock)** | Tổng số cuốn sách thực sự đang hiện diện tại một vị trí cụ thể. | Tổng $\Delta$ của các bút toán kho đã ghi nhận tại vị trí đó. |
| **Tồn sở hữu (Owned Stock)** | Tổng số sách thuộc tài sản của công ty trên toàn mạng lưới (kể cả hàng đang gửi ký gửi hoặc đang đi đường). | Tổng tồn vật lý tại mọi địa điểm có `owner_id = Company`. |
| **Tồn bán được (Sellable Stock)** | Số sách vừa nằm ở vị trí bán lẻ/kho xuất, vừa có tình trạng `NEW`. | Tồn vật lý tại kho nội bộ thỏa mãn điều kiện `condition = 'NEW'`. |
| **Tồn khả dụng (Available-to-Promise - ATP)** | Số sách thực tế có thể hứa bán cho đơn hàng mới mà không sợ bị trùng/thiếu hàng. | $\text{ATP} = \text{Sellable} - \text{Active Reservations} - \text{Safety Buffer}$ |

> **Ví dụ thực tiễn:**  
> Doanh nghiệp in 1.000 cuốn sách ISBN `978-604-000-01`:
> - 600 cuốn nằm tại Kho tổng (mới 100%).
> - 300 cuốn gửi ký gửi tại Nhà sách X.
> - 80 cuốn tại Cửa hàng trực thuộc (đang có 10 cuốn khách đặt mua online chưa giao).
> - 20 cuốn bị cấn móp trong quá trình vận chuyển.
> 
> 👉 **Tổng tồn sở hữu của công ty:** $600 + 300 + 80 + 20 = 1.000$ cuốn.  
> 👉 **Tồn vật lý tại Kho tổng:** 600 cuốn.  
> 👉 **Tồn khả dụng (ATP) tại Cửa hàng trực thuộc:** $80 - 10 = 70$ cuốn.  
> 👉 **Tồn khả dụng tại Kho tổng để cấp cho đại lý khác:** 600 cuốn (không được tính 300 cuốn bên Nhà sách X vào để hứa giao cho bên khác).

---

## 06. Sổ cái Kho Bất biến (Inventory Ledger) & Các Bất biến Hệ thống

### 6.1. Triết lý Sổ cái Bất biến (Append-Only Ledger)
Trong formapubli, **không có khái niệm `UPDATE stock SET quantity = 50`**. Mọi con số tồn kho đều là kết quả tổng hợp của một chuỗi các sự kiện kho vận đã diễn ra.
- Mỗi lần sách được nhập, xuất, chuyển vị trí hay điều chỉnh, hệ thống sẽ tạo một dòng mới trong bảng `inventory_ledger`.
- Bút toán ghi nhận gồm số lượng tăng dương ($+X$) hoặc giảm âm ($-X$).
- Khi có sai sót, người dùng không được xóa dòng cũ mà phải tạo một **bút toán đảo (Reversal Entry)** ghi rõ tham chiếu đến bút toán ban đầu và lý do đảo.

### 6.2. Cấu trúc bản ghi Sổ cái Kho (`inventory_ledger`)
Mỗi bản ghi ledger chứa đầy đủ 18 trường thông tin để phục vụ đối soát pháp lý và kỹ thuật:

```text
1.  id                    : UUID (Khóa chính duy nhất)
2.  entity_id             : UUID (Pháp nhân ghi nhận tài sản)
3.  event_type            : Enum (RECEIVE, TRANSFER_OUT, TRANSFER_IN, ...)
4.  edition_id            : UUID (Mã ấn bản / ISBN)
5.  lot_id                : UUID (Lô nhập hàng từ nhà in, nếu có)
6.  location_id           : UUID (Địa điểm vật lý phát sinh biến động)
7.  owner_id              : UUID (Chủ sở hữu hàng hóa)
8.  condition             : Enum (NEW, MINOR_DAMAGE, DEFECTIVE, QUARANTINE)
9.  quantity_delta        : Integer (Số lượng biến động: số âm hoặc số dương, KHÁC 0)
10. unit_cost_snapshot    : Numeric(15, 2) (Giá vốn tại thời điểm nhập/xuất)
11. effective_at          : Timestamp with time zone (Thời điểm phát sinh nghiệp vụ)
12. recorded_at           : Timestamp with time zone (Thời điểm ghi vào CSDL - defaultNow)
13. actor_id              : UUID (Người dùng thực hiện thao tác)
14. document_type         : String (Phiếu nhập, Phiếu xuất kho, Phiếu chuyển, Biên bản kiểm kê)
15. document_id           : UUID (ID chứng từ phát sinh)
16. correlation_id        : UUID (Mã liên kết nhóm các bút toán cùng một giao dịch)
17. reversal_of           : UUID (Khóa ngoại trỏ đến ID bút toán bị đảo, nếu là bút toán sửa sai)
18. idempotency_key       : String (Khóa chống gửi trùng lệnh từ giao diện/thiết bị)
```

### 6.3. Bảng Cân đối Tồn kho (Stock Balance Projection)
Để tối ưu hóa tốc độ truy vấn (không phải tính toán lại hàng triệu dòng ledger mỗi khi tra cứu tồn), hệ thống duy trì bảng **`stock_balances`**:
- Bảng này đóng vai trò là một hình chiếu (*Projection*) tức thời của Ledger.
- Khóa duy nhất (*Composite Unique Key*) của một bucket tồn kho:  
  $$\text{Bucket Key} = (\text{entity\_id}, \text{edition\_id}, \text{location\_id}, \text{owner\_id}, \text{condition}, \text{lot\_id})$$
- **Quy tắc bất di bất dịch:** Việc ghi vào `inventory_ledger` và cập nhật tăng/giảm trên `stock_balances` **bắt buộc phải nằm trong cùng một Database Transaction**. Nếu một trong hai thao tác thất bại, toàn bộ giao dịch phải Rollback.

### 6.4. Các Bất biến Hệ thống Bắt buộc (System Invariants)
Bất kỳ dòng code nào can thiệp vào kho vận cũng phải tuân thủ nghiêm ngặt 6 bất biến sau:
1. **Không âm kho vật lý (No Negative Stock):** Tại bất kỳ thời điểm nào, tổng số lượng trong một bucket tồn kho không bao giờ được nhỏ hơn 0 ($quantity \ge 0$).
2. **Bảo toàn Số lượng khi Chuyển kho (Quantity Conservation):** Khi chuyển hàng từ Kho A sang Kho B, tổng delta giữa 2 kho phải bằng 0:  
   $$\Delta Q_{\text{Kho A}} + \Delta Q_{\text{In-Transit}} = 0 \quad \text{và} \quad \Delta Q_{\text{In-Transit}} + \Delta Q_{\text{Kho B}} = 0$$
3. **Ký gửi không làm mất quyền sở hữu:** Xuất hàng đi ký gửi chỉ thay đổi `location_id`, tuyệt đối không tự động đổi `owner_id` và không tự động ghi nhận doanh thu.
4. **Tính bất biến của Lịch sử (Append-Only):** Tuyệt đối không cho phép lệnh `UPDATE` hoặc `DELETE` trên bảng `inventory_ledger` ở mức Database Role (revoke quyền sửa/xóa đối với application role).
5. **Tính bất biến của Khóa chống lặp (Idempotency):** Cùng một `idempotency_key` gửi lại nhiều lần phải trả về kết quả ban đầu, không được sinh ra hai dòng biến động kho.
6. **Thời gian ghi nhận nhất quán:** `recorded_at` luôn lấy giờ hệ thống máy chủ CSDL theo UTC; `effective_at` phản ánh thời điểm nghiệp vụ thực tế theo múi giờ `Asia/Ho_Chi_Minh`.

---

## 07. Danh mục Sự kiện Kho vận (Logistics Event Catalog)

Mọi thao tác kho vận trong Phase 1 đều được chuẩn hóa thành các mã sự kiện cụ thể:

| Mã Sự kiện (`event_type`) | Ý nghĩa Nghiệp vụ | Tác động Tồn vật lý | Chứng từ Kèm theo |
|---|---|---|---|
| `OPENING_BALANCE` | Khởi tạo số dư ban đầu từ Google Sheets chuyển đổi sang. | $+$ Tồn tại vị trí chỉ định | Biên bản bàn giao số dư mở đầu |
| `RECEIPT_POSTED` | Nhập sách từ nhà in / nhà cung cấp về kho tổng. | $+$ Tồn tại vị trí Nhận kho | Phiếu nhập kho (Goods Receipt Note) |
| `TRANSFER_DISPATCH` | Xuất sách ra khỏi kho nguồn để chuyển đi kho khác. | $-$ Kho nguồn, $+$ Vị trí `IN_TRANSIT` | Lệnh chuyển kho (Transfer Order) |
| `TRANSFER_RECEIVE` | Kho đích xác nhận thực nhận sách từ vị trí đang đi đường. | $-$ Vị trí `IN_TRANSIT`, $+$ Kho đích | Biên bản thực nhận chuyển kho |
| `CONSIGNMENT_SEND` | Xuất sách giao cho đối tác ký gửi (Nhà sách X, Đại lý Y). | $-$ Kho nội bộ, $+$ Vị trí Đối tác | Phiếu xuất ký gửi |
| `CONSIGNMENT_RETURN` | Nhận lại sách ký gửi từ đối tác trả về kho công ty. | $-$ Vị trí Đối tác, $+$ Kho nội bộ | Biên bản trả hàng ký gửi |
| `SALE_FULFILL` | Xuất kho giao sách cho khách mua lẻ hoặc khách sỉ. | $-$ Tồn vật lý tại kho xuất | Hóa đơn bán lẻ / Phiếu xuất bán |
| `STOCKTAKE_ADJUST` | Điều chỉnh tăng/giảm sau khi kiểm kê thực tế tại kệ. | $+$ hoặc $-$ Chênh lệch kiểm kê | Biên bản kiểm kê & Quyết định xử lý |
| `CONDITION_RELOCATE` | Phát hiện sách hỏng/xước, chuyển từ kệ bán sang kệ phế phẩm. | $-$ Bucket `NEW`, $+$ Bucket `DEFECTIVE` | Phiếu phân loại tình trạng sách |

---

## 08. Các Luồng Vận hành Kho Chi tiết (Detailed Workflows)

### 8.1. Luồng Nhập hàng từ Nhà in (Receive Goods)
- **Tạo phiếu dự kiến:** Thủ kho tạo phiếu nhận sách dựa trên lệnh in.
- **Quét mã & Kiểm đếm:** Thủ kho dùng súng quét mã vạch ISBN trên từng kiện hoặc nhập số lượng thực đếm.
- **Nhận từng phần (Partial Receipt):** Nếu nhà in giao đợt 1 là 400 cuốn / 1.000 cuốn, hệ thống ghi nhận đúng 400 cuốn vào kho, phiếu nhận hàng chuyển trạng thái "Đã nhận một phần", 600 cuốn còn lại tiếp tục chờ đợt sau.
- **Duyệt phiếu & Post Ledger:** Khi bấm hoàn thành, hệ thống mở một Transaction PostgreSQL để ghi Ledger và cập nhật Balance tức thời.

### 8.2. Luồng Chuyển kho 2 bước (Two-Step Transfer)
Tuyệt đối không sử dụng luồng chuyển kho "1 bước" (bấm chuyển là kho đích tự tăng), vì trong thời gian xe tải chở sách đi trên đường, nếu xảy ra thất thoát sẽ không thể quy trách nhiệm.
- **Bước 1 (Xuất chuyển - Dispatch):** Thủ kho nguồn chọn sách, quét ISBN, chọn kho đích và bấm xuất.
  - Hệ thống: Trừ tồn kho nguồn, Tăng tồn kho ảo `IN_TRANSIT`.
- **Bước 2 (Tiếp nhận - Receive):** Khi xe chở sách tới kho đích, thủ kho đích mở phiếu chuyển, quét kiểm đếm thực tế.
  - Trường hợp đủ: Trừ `IN_TRANSIT`, Tăng tồn kho đích.
  - Trường hợp thiếu/hỏng: Nhập số thực nhận. Số lượng thiếu được ghi nhận thành biên bản hao hụt để quản lý xử lý, không để treo tồn ảo trong `IN_TRANSIT`.

### 8.3. Luồng Quản lý Hàng Ký gửi (Consignment)
- **Bản chất:** Đối tác ký gửi (các chuỗi nhà sách) chỉ là nơi giữ hàng hộ công ty.
- **Thao tác:** Xuất kho giao sách cho đối tác bằng phiếu `CONSIGNMENT_SEND`.
- **Báo cáo:** Bất kỳ lúc nào, Quản lý cũng có thể tra cứu: *"Hiện tại có bao nhiêu cuốn sách thuộc quyền sở hữu của công ty đang nằm tại Nhà sách X"*.

### 8.4. Luồng Kiểm kê & Cân bằng kho (Stocktaking)
- **Bước 1:** Quản lý tạo đợt kiểm kê theo từng kho hoặc từng kệ cụ thể.
- **Bước 2:** Thủ kho dùng máy quét kiểm tra từng cuốn sách thực tế trên kệ.
- **Bước 3:** Hệ thống tự động đối chiếu: `Chênh lệch = Số thực đếm - Số tồn hệ thống`.
- **Bước 4:** Quản lý duyệt chênh lệch. Hệ thống tự động phát sinh bút toán `STOCKTAKE_ADJUST` đưa số liệu hệ thống khớp 100% với thực tế, lưu vết rõ lý do điều chỉnh.

---

## 09. Mô hình Dữ liệu Cơ sở (Database Schema & Data Dictionary)

Hệ thống được thiết kế chuẩn mực trên **PostgreSQL**, khai báo qua **Drizzle ORM**.

### 9.1. Bảng Danh mục Tổ chức & Vị trí
- `organizations`: Quản lý các pháp nhân nội bộ và đối tác bên ngoài (Nhà in, Đại lý ký gửi, Khách buôn).
- `locations`: Địa điểm kho vật lý (Kho tổng, Cửa hàng trực thuộc, Điểm ký gửi, Vị trí In-transit).
- `shelves`: Vị trí chi tiết đến từng phân khu và kệ sách (`zone_name`, `shelf_code`, `barcode`).

### 9.2. Bảng Danh mục Sách & Ấn bản
- `titles`: Tác phẩm văn học / sách gốc (Tên tác phẩm, tác giả, tên gốc).
- `editions`: Ấn bản cụ thể gắn liền với **ISBN-13** duy nhất (Tên ấn bản, giá bìa, số trang, năm xuất bản).

### 9.3. Bảng Lõi Sổ cái & Cân đối Kho
- `inventory_ledger`: Bảng append-only lưu trữ lịch sử mọi biến động (18 trường dữ liệu đã nêu ở phần 06).
- `stock_balances`: Bảng cân đối tồn kho tức thời, có ràng buộc `CHECK (physical_quantity >= 0)` để chặn đứng lỗi âm kho ngay từ tầng CSDL.
- `stock_documents` & `stock_document_lines`: Quản lý các chứng từ nghiệp vụ gốc (Phiếu nhập, Phiếu chuyển kho, Phiếu xuất ký gửi, Biên bản kiểm kê).

### 9.4. Bảng Tiếp nhận Dữ liệu Google Sheets
- `sheet_import_batches`: Quản lý từng đợt nạp file Google Sheets (Tên file, người tải lên, thời gian, số dòng thành công/thất bại).
- `sheet_import_rows`: Lưu chi tiết từng dòng dữ liệu thô (`raw_data`), dữ liệu sau khi chuẩn hóa (`normalized_data`) và danh sách lỗi phát hiện (`validation_errors`).

---

## 10. Kiến trúc Kỹ thuật & Xử lý Đồng thời (Concurrency & Architecture)

### 10.1. Mô hình Modular Monolith
formapubli lựa chọn mô hình **Modular Monolith** sử dụng **Next.js App Router, TypeScript, PostgreSQL và Drizzle ORM**:
- **Lợi ích cốt lõi:** Một cơ sở dữ liệu duy nhất giúp toàn bộ các thao tác kho vận nằm trọn vẹn trong các Database Transaction chuẩn ACID. Không phát sinh tình trạng phân mảnh dữ liệu hay lỗi bất đồng bộ mạng như mô hình Microservices.
- **Triển khai tinh gọn:** Toàn bộ hệ thống có thể chạy trên một máy chủ cloud tiết kiệm hoặc máy chủ nội bộ mà vẫn đáp ứng thời gian phản hồi cực nhanh (< 200ms cho các thao tác kho).

### 10.2. Chống Race Condition & Overselling (Bán âm kho)
Khi có nhiều thao tác kho diễn ra cùng một thời điểm (ví dụ: hai thủ kho cùng xuất một đầu sách):
1. **Khóa dòng dữ liệu (Row-level Locking):**  
   Mọi giao dịch thay đổi tồn kho đều bắt đầu bằng câu lệnh khóa dòng:  
   `SELECT * FROM stock_balances WHERE id = :bucket_id FOR UPDATE;`
2. **Sắp xếp thứ tự khóa để chống Deadlock:**  
   Nếu một phiếu xuất kho chứa nhiều đầu sách, hệ thống bắt buộc sắp xếp danh sách các ID bucket theo thứ tự tăng dần trước khi gọi `FOR UPDATE`.
3. **Kiểm tra điều kiện khả dụng ngay trong transaction:**  
   Chỉ khi tồn vật lý trừ đi lượng đã giữ chỗ lớn hơn hoặc bằng lượng yêu cầu thì mới tiến hành ghi Ledger và cập nhật Balance.
4. **Idempotency Key:**  
   Mọi request gửi từ trình duyệt lên server đều mang một khóa `idempotency_key`. Nếu mạng chập chờn khiến thủ kho bấm nút hai lần, server sẽ phát hiện và chỉ thực thi đúng một lần duy nhất.

---

## 11. Thiết kế Trải nghiệm theo 3 Vai trò Vận hành (Role-Based UX)

Giao diện formapubli được thiết kế may đo cho đúng 3 vai trò vận hành thực tế:

### 1. Thủ kho (Warehouse Operator)
- **Tối ưu tốc độ:** Thao tác chủ yếu bằng bàn phím và súng quét mã vạch USB. Ô nhập liệu luôn tự động focus để nhận mã vạch ngay lập tức.
- **Phản hồi âm thanh:** Có tiếng "bíp" xác nhận khi quét mã hợp lệ và tiếng cảnh báo khi mã vạch không tồn tại trong hệ thống.
- **Mobile Responsive:** Giao diện tối ưu cho màn hình di động, phím bấm to rõ ràng, thuận tiện cho việc cầm điện thoại kiểm tra sách trên các tầng kệ cao.

### 2. Quản lý Vận hành (Operations Manager)
- **Bảng điều hành thời gian thực (Dashboard):** Xem nhanh tổng số sách sở hữu trên toàn mạng lưới, danh sách các đầu sách sắp hết hàng cần in thêm.
- **Hàng đợi phê duyệt (Approval Queue):** Gom toàn bộ các yêu cầu chuyển kho, phiếu xuất ký gửi và đề xuất điều chỉnh kiểm kê về một nơi duy nhất để duyệt nhanh chóng.

### 3. Kế toán Kho (Stock Accountant)
- **Đối soát & Minh bạch:** Tra cứu lịch sử thẻ kho chi tiết từng ngày, từng giờ.
- **Khóa sổ kỳ kho:** Chức năng khóa kỳ kế toán kho, ngăn chặn mọi hành vi nhập lùi ngày làm sai lệch báo cáo tài chính đã chốt.

---

## 12. Chiến lược Kiểm thử & Tiêu chuẩn Nghiệm thu (DoD)

### 12.1. Ma trận Kiểm thử Bắt buộc
- **Kiểm thử logic (Unit Tests):** Kiểm tra tính hợp lệ của mã ISBN-13 (thuật toán Modulo 10), tính đúng đắn của các phép toán cộng trừ delta tồn kho.
- **Kiểm thử tranh chấp đồng thời (Concurrency Tests):** Chạy thử nghiệm 20 luồng đồng thời cùng xuất 1 cuốn sách duy nhất trên CSDL PostgreSQL thật để chứng minh hệ thống không bao giờ bị âm kho.
- **Kiểm thử luồng khép kín (E2E Tests):** Kiểm tra toàn bộ vòng đời: `Nhập kho → Chuyển kho in-transit → Thực nhận → Xuất ký gửi → Kiểm kê điều chỉnh`.

### 12.2. Tiêu chuẩn Nghiệm thu Phase 1 (Definition of Done)
Một tính năng của Phase 1 chỉ được coi là hoàn thành khi:
1. [x] Lõi kho vận được cô lập hoàn toàn, không phụ thuộc vào bất kỳ hệ thống hóa đơn ngoài nào.
2. [x] Hệ thống vượt qua toàn bộ các kiểm tra Typecheck và Linting không có lỗi.
3. [x] Sổ cái kho Append-only hoạt động chính xác: không cho phép sửa/xóa bút toán cũ.
4. [x] Súng quét mã vạch USB hoạt động trơn tru trên mọi màn hình nhập/xuất kho.
5. [x] Bộ khung Staging sẵn sàng để nạp các file Google Sheets khi chủ dự án cung cấp.
6. [x] Thủ kho và Quản lý thực hiện kiểm thử thực tế đạt 100% kết quả mong đợi.

---

## 13. Định hướng Phát triển cho các Phase Tiếp theo

Khi Lõi Kho vận Phase 1 đã vận hành ổn định và số liệu tồn kho đã hoàn toàn chính xác, doanh nghiệp sẽ triển khai tiếp các phase sau:

### 13.1. Định hướng Phase 2: Mở rộng Thương mại & Quy trình Nghiệp vụ
- **Quản lý Đơn hàng & Bảng giá:** Thiết lập các bảng giá chiết khấu riêng cho từng đối tác ký gửi, đại lý bán sỉ và khách lẻ.
- **Quy trình Đổi trả hàng (RMA):** Thiết lập quy trình đưa sách trả về vào khu cách ly `QUARANTINE` để thủ kho kiểm định mức độ hư hại trước khi quyết định bán giảm giá hay trả về nhà in.
- **Đặt trước (Pre-order):** Quản lý nhu cầu đặt trước khi sách chưa về kho, phân bổ tự động theo nguyên tắc ai đặt cọc trước nhận sách trước (FIFO).

### 13.2. Định hướng Phase 3: Tích hợp Hệ sinh thái & Kênh ngoài
- **Hóa đơn điện tử (MSInvoice):** Tích hợp thông qua Outbox Pattern bất đồng bộ theo hướng tiếp cận riêng đã thống nhất, đảm bảo việc xuất hóa đơn không ảnh hưởng đến tốc độ của kho.
- **Sàn TMĐT (Shopee) & Website:** Tự động đồng bộ số lượng tồn kho khả dụng lên sàn và website theo hạn ngạch an toàn, tự động kéo đơn hàng về để thủ kho đóng gói giao hàng.

---

> **Lời kết:**  
> Dòng chảy vật lý của từng cuốn sách là cốt lõi của toàn bộ hoạt động kinh doanh xuất bản. Bằng việc xây dựng một Lõi Kho vận chuẩn mực và Sổ cái Bất biến trong Phase 1, formapubli sẽ giúp doanh nghiệp hoàn toàn làm chủ hàng hóa, giải phóng đội ngũ khỏi ma trận bảng tính, và sẵn sàng cho những bước mở rộng quy mô lớn hơn trong tương lai.


---

## 14. Tổng hợp Kiến thức Kiểm toán 55 Sheets con (Audited Sheets Synthesis)

Tài liệu kiểm toán chi tiết từng dòng, cột và công thức của 55 sheets con đã được lưu trữ độc lập tại file docs/REPORT_55_SHEETS_AUDIT.md.

### 14.1. Danh mục 81 Đầu sách & Phân tách Hai Kỷ nguyên (Sheet 1)
- H01 đến H45 (Xuất bản Khác - XBK): Sách cổ điển (Moliere, Baudelaire...), đa phần cạn kho hoặc có số tồn âm.
- H46 đến H81 (FORMApubli): Sách thương hiệu chính thức (Bốn tình yêu, Dưỡng đường đồng hồ cát, In illo Tempore...).
- Tab Điều chỉnh xuất VAT-2025: Chia ngược giá trước thuế VAT 5% (Giá bìa / 1.05) phục vụ xuất hóa đơn.

### 14.2. Khủng hoảng Nhập liệu Ma trận Bán lẻ (Sheet 2 - LẺ 2026)
- Ma trận 81 cột ngang, mỗi cuốn là 1 cột, Cột B chứa text địa chỉ chat của khách. Rất dễ gõ nhầm cột.
- formapubli giải quyết bằng Form bán lẻ tinh gọn và tra cứu 4 số cuối ISBN bằng bàn phím.

### 14.3. Bế tắc Đối soát 29 Bảng tính Đại lý Ký gửi (Sheet 3)
- Danh sách 29 link Google Sheets của các đại lý (Đông Tây, Bình Book, Hamvas Bela...).
- formapubli coi mỗi đại lý là một Kho ảo (Virtual Consignment Location), sách vẫn thuộc sở hữu của công ty.

### 14.4. Thực trạng Đếm kho Thùng vs Sách rời (Sheet 4)
- Công thức đếm: SL Thùng x SL/Thùng + Sách rời. Ghi chú cảnh báo sai số do dọn kho lỗi (ước lượng lệch 10%).
- Quản lý riêng dòng Artbook Đoàn Cầm Hạc (ĐCH) tiền triệu (bản đặc biệt, bản thường).

### 14.5. Tiến độ Nhà in Giao lắt nhắt từng đợt (Sheet 5 - Nhập Tổng)
- Hợp đồng in 1,000 cuốn nhưng nhà in giao từng đợt (132q, 900q...). Không ghi nhận tồn theo hợp đồng in.

### 14.6. Ngoại giao Sách Biếu / Tặng Đồ sộ (Sheet 6)
- 505 dòng tặng sách, 141 reviewer bookstagram, danh mục Thu Phục tặng học giả/dịch giả, và sổ rút sách nội bộ.

### 14.7. Dòng tiền Kép & Bù trừ Chi phí Cá nhân (Sheet 7)
- TK cá nhân Lan Anh (LA) song song TK Công ty (vitanova). Lan Anh ứng tiền túi rồi cấn trừ cuối tháng.

---

## 15. Kiến trúc Kỹ thuật Đám mây, Bảo mật SSL & Tối ưu Hiệu năng

### 15.1. 100% Đám mây Serverless
- CSDL SQL: PostgreSQL Cloud (Supabase / Neon) chuẩn ACID, tự động sao lưu hàng ngày.
- Ứng dụng Web: Next.js 14+ triển khai Serverless Edge (Vercel / Cloudflare Pages).

### 15.2. Lá chắn Bảo mật Cloudflare & SSL Chuẩn A+
- Đặt sau Cloudflare WAF, chống DDoS tự động, kích hoạt Strict SSL (TLS 1.3) và HTTP/3 (QUIC).
- Phân quyền RBAC chặt chẽ (Thủ kho, Quản lý, Giám đốc).

### 15.3. Tối ưu Tốc độ Tải trang (PageSpeed 95+)
- Giao diện Minimalist Tailwind CSS, Server-side rendering, ảo hóa danh sách lớn.
- Thao tác phím và quét mã phản hồi dưới 100ms.

### 15.4. Cơ chế Xuất / Tải Dữ liệu Cục bộ Ngoại tuyến theo Yêu cầu
- Xuất báo cáo Excel/CSV Nhập - Xuất - Tồn, Thẻ kho, Đối soát ký gửi tức thời.
- One-click Full Database Dump về máy tính cá nhân để lưu trữ ngoại tuyến an toàn.


---

## 16. Cấu trúc Thực thể & Chi tiết Vận hành Độc quyền formapubli

### 16.1. Kiến trúc Thực thể 2 Tầng: Tác phẩm (Work) vs Ấn bản / Lô in (Edition/Lot)
Khi sách tái bản đổi giá bìa (ví dụ từ 120k lên 140k), formapubli đăng ký mã ISBN mới:
- **Tầng 1 - Tác phẩm / Đầu sách (Work / Master Title):** Đại diện nội dung (ví dụ: FORMA-046: Bốn tình yêu). Dashboard cấp cao dùng thực thể này để xem tổng in lũy kế, tổng bán và tổng tồn toàn mạng lưới mà không phân mảnh.
- **Tầng 2 - Ấn bản / Lô in (Edition / Lot):** Gắn liền với ISBN-13 duy nhất, giá bìa cụ thể, năm xuất bản và đợt in. Thủ kho xuất/nhập ghi nhận chính xác đến từng Ấn bản để áp đúng giá vốn và giá bìa.

### 16.2. Cấu trúc 3 Kho Vật lý & Quản lý Không gian Kệ sách
1. **Kho 1 - Văn phòng kiêm Kho Soạn hàng (Tây Hồ / Main Office):** Lưu sách rời, đóng gói đơn lẻ, đơn tặng và chuyển phát nhanh.
2. **Kho 2 - Kho Lưu trữ Kiện lớn (Quỳnh Mai / Bulk Storage):** Nhận xe tải từ nhà in; lưu sách nguyên thùng/kiện; xuất buôn lô lớn và chuyển tiếp ứng Kho 1.
3. **Kho 3 - Kho Dự phòng / Trung chuyển (Warehouse 3 / Reserve):** Lưu trữ dự phòng, cách ly kiểm đếm hoặc phân loại sách cũ/hội chợ.

*Cơ chế Kệ sách mềm (Soft Shelf Hints):* Do cấu trúc tủ kệ ở 3 kho không đồng nhất và việc tìm sách đang dựa trên trí nhớ thủ kho Lan Anh, hệ thống không bắt buộc nhập tọa độ cứng mà cung cấp trường suggested_location (ví dụ: Kệ sắt tầng 2 góc trái) in trên phiếu soạn hàng.

### 16.3. Quy trình Keyboard-First Siêu tốc (4 Số cuối ISBN & Phím mũi tên)
Thực tế thủ kho Lan Anh đang xử lý đơn hàng ngày mà chưa có súng quét mã vạch chuyên dụng, phải gõ tay vào ma trận 81 cột. formapubli tối ưu bằng cơ chế Keyboard-First:
- **Tra cứu 4 số cuối ISBN:** Lan Anh chỉ cần liếc 4 số cuối trên mã vạch sau bìa sách và gõ vào ô tìm kiếm (ví dụ: gõ 7507 hoặc tên tắt).
- **Điều hướng phím mũi tên & Enter:** Bấm phím mũi tên lên/xuống để chọn đúng phiên bản trong dropdown -> Bấm **Enter lần 1** để thêm sách vào đơn (số lượng = 1) -> Bấm **Enter lần 2** (hoặc Ctrl + Enter) để hoàn tất phiếu xuất.
- **Hỗ trợ Súng quét USB:** Khi cắm súng quét trong tương lai, máy tự bắn 13 số ISBN + Enter, hệ thống tự động tăng số lượng và bíp xác nhận dưới 100ms.

### 16.4. Các Chính sách Nghiệp vụ Độc quyền
1. **Chính sách Sách hỏng / Hao hụt ký gửi:** Định mức hao hụt tự nhiên cho phép là 1.5% - 2.0% trên tổng doanh số bán kỳ đối soát. Vượt định mức đại lý bồi hoàn 50% giá bìa. Nhận về phân loại: Lành -> Bán lại; Xước nhẹ -> Kho Thanh lý hội chợ; Nát -> Lập biên bản Xuất hủy hao hụt (Write-off).
2. **Chính sách Cước vận chuyển:** Giao đi đại lý: formapubli chịu nếu đạt giá trị tối thiểu (>= 5 triệu đồng giá bìa). Trả về kho: Đại lý chịu 100% cước.
3. **Chính sách Cấn trừ Sách cũ - mới (Credit Memo):** Thu hồi sách cũ ghi nhận vào Credit Balance để cấn trừ trực tiếp vào đơn hàng mới.
4. **Chiến lược Chốt Kiểm kê Mở đầu:** Không truy vết sai lệch 10% trong quá khứ. Tổ chức Đợt đếm tay 100% tại 3 kho để chốt biên bản Số dư Mở đầu (Clean Slate).

### 16.5. Đặc tả Cơ sở Dữ liệu Lõi Phase 1 (PostgreSQL Schema DDL)
`sql
-- 1. Bảng Tác phẩm / Đầu sách chung (Work / Master Title)
CREATE TABLE works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL, -- Vi du: FORMA-046, XBK-001
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    author VARCHAR(255) NOT NULL,
    translator VARCHAR(255),
    category VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng Ấn bản / Lô in theo ISBN (Editions)
CREATE TABLE editions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
    isbn VARCHAR(13) UNIQUE NOT NULL, -- 13 so chuan quoc te
    isbn_last4 VARCHAR(4) NOT NULL,    -- 4 so cuoi tra cuu nhanh
    edition_number INT DEFAULT 1,      -- Lan in thu 1, 2, 3...
    cover_price NUMERIC(12, 2) NOT NULL,
    vat_rate NUMERIC(4, 2) DEFAULT 0.05, -- Thue suat VAT 5%
    format_size VARCHAR(50),           -- Vi du: 13 x 20.5 cm
    pages INT,
    publication_year INT,
    suggested_location TEXT,           -- Ghi chu vi tri ke sach ho tro thu kho
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_editions_isbn_last4 ON editions(isbn_last4);

-- 3. Bảng Kho vật lý (Warehouses)
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL, -- KHO_TAY_HO, KHO_QUYNH_MAI, KHO_DU_PHONG
    name VARCHAR(255) NOT NULL,
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bảng Đối tác & Pháp nhân (Partners)
CREATE TABLE partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- CONSIGNMENT, WHOLESALE, PRINTER, INTERNAL
    contact_info TEXT,
    discount_rate NUMERIC(5, 2) DEFAULT 0.00, -- Chiet khau mac dinh
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Bảng Sổ cái Kho Bất biến (Append-Only Inventory Ledger)
CREATE TABLE inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    event_type VARCHAR(50) NOT NULL, -- RECEIPT, DISPATCH_SALE, DISPATCH_GIFT, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT
    quantity_delta INT NOT NULL,     -- So duong (+) hoac so am (-), KHAC 0
    condition VARCHAR(30) DEFAULT 'NEW', -- NEW, MINOR_DAMAGE, DEFECTIVE
    document_ref VARCHAR(100) NOT NULL,  -- Ma phieu xuat/nhap/chuyen kho
    note TEXT,
    actor_id VARCHAR(100) NOT NULL,      -- Nguoi thao tac (Lan Anh, Admin...)
    idempotency_key VARCHAR(100) UNIQUE NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Bảng Tồn kho Thời gian thực (Stock Balances Projection)
CREATE TABLE stock_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edition_id UUID NOT NULL REFERENCES editions(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    condition VARCHAR(30) DEFAULT 'NEW',
    physical_quantity INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_positive_stock CHECK (physical_quantity >= 0),
    CONSTRAINT uq_stock_bucket UNIQUE (edition_id, warehouse_id, condition)
);
`


---

## 17. Tối ưu Chi phí Tuyệt đối (100% Free Forever Tier) & Động cơ CSDL Không Chi phí

### 17.1. Tuyên ngôn Chi phí: 0 VNĐ Vĩnh viễn (Zero Infrastructure Cost)
Doanh nghiệp đang vận hành trên Google Sheets với chi phí hạ tầng **0 VNĐ**. Mọi kiến trúc công nghệ được lựa chọn cho formapubli bắt buộc phải tuân thủ nghiêm ngặt nguyên tắc: **Hoạt động hoàn toàn miễn phí 100% trong hạn ngạch vĩnh viễn (Free-tier forever)**, không phát sinh bất kỳ hóa đơn hàng tháng nào:

| Thành phần | Công nghệ Đề xuất | Gói Miễn phí (Free Tier) | Khả năng Đáp ứng Thực tế của formapubli | Chi phí Hàng tháng |
| :--- | :--- | :--- | :--- | :---: |
| **Cơ sở dữ liệu SQL** | **Supabase Postgres** hoặc **Neon Postgres** | 500 MB dung lượng lưu trữ, 2 tỷ phép tính compute/tháng, tự động backup. | Toàn bộ 81 đầu sách + 10 năm giao dịch sổ cái kho (~50.000 dòng ledger) chỉ tốn khoảng **15 - 20 MB** dung lượng. Hạn mức 500 MB đủ dùng trong **hơn 20 năm**. | **0 VNĐ** |
| **Hạ tầng Web & API** | **Vercel** hoặc **Cloudflare Pages** | Băng thông 100 GB/tháng, không giới hạn số lượng request Serverless. | formapubli có 3-5 nhân sự nội bộ thao tác hàng ngày, chỉ tiêu tốn chưa đến **1 GB/tháng** (chưa tới 1% hạn ngạch cho phép). | **0 VNĐ** |
| **Lá chắn Bảo mật & SSL** | **Cloudflare Free Plan** | Không giới hạn băng thông, chống DDoS không giới hạn, chứng chỉ SSL/TLS 1.3 tự động cấp phát, HTTP/3, CDN toàn cầu. | Bảo vệ toàn diện tên miền của formapubli, chống phá hoại, tăng tốc độ tải trang về dưới 0.5s. | **0 VNĐ** |
| **Lưu trữ Báo cáo & File** | **Google Drive API (Service Account)** | 15 GB miễn phí sẵn có của tài khoản Google. | Dùng làm nơi lưu trữ các bản xuất sao lưu CSDL tự động hàng tuần. | **0 VNĐ** |

### 17.2. Phương án Thay thế SQL Engine Cục bộ Siêu Tối ưu: SQLite / LibSQL (Turso)
Nếu công ty thậm chí không muốn phụ thuộc vào bất kỳ dịch vụ đám mây bên thứ ba nào hoặc muốn chạy hoàn toàn khép kín:
- **Turso (LibSQL - SQLite for Cloud):** Cung cấp gói Free vĩnh viễn với 9 GB dung lượng (gấp 18 lần nhu cầu của formapubli), tốc độ truy vấn phản hồi < 10ms.
- **SQLite Single-file Embedded:** Toàn bộ cơ sở dữ liệu được gói gọn trong 1 file duy nhất ormapubli.db. Hàng ngày chỉ cần copy 1 file này lưu vào USB hoặc Google Drive là toàn bộ hệ thống được sao lưu an toàn 100%, không tốn một đồng chi phí vận hành nào.


---

## 18. Cơ chế Nhập liệu Bàn phím Siêu tốc: Gõ tắt 2-3 Ký tự Đầu Tên Sách (Fuzzy Acronym Matcher)

### 18.1. Động lực Thực tế
Nhân viên như Lan Anh khi làm việc lâu năm thường nhớ tên sách theo thói quen gõ tắt trong văn hóa chat:
- Gõ ty -> Ra ngay *Bệnh tưởng* hoặc *Bốn tình yêu*.
- Gõ 
bl -> Ra ngay *Người biển lận*.
- Gõ dddhc hoặc dd -> Ra ngay *Dưỡng đường đồng hồ cát*.
- Gõ sp -> Ra ngay *Le Spleen de Paris*.
- Gõ middle -> Ra ngay *Middlemarch*.

### 18.2. Thuật toán Tìm kiếm Đa phương thức (Hybrid Multi-search)
Ô tìm kiếm tại màn hình Nhập/Xuất kho hỗ trợ 3 chế độ song song tự động nhận diện:
1. **Nếu là chuỗi 4 chữ số (ví dụ: 7507):** Hệ thống lập tức quét theo 4 số cuối của ISBN (isbn_last4).
2. **Nếu là chuỗi 2-4 ký tự viết tắt không dấu (ví dụ: ty):** Hệ thống đối soát với trường short_code (mã viết tắt các chữ cái đầu) được sinh tự động khi nạp sách.
3. **Nếu là chuỗi từ khóa thông thường (ví dụ: 
gười biển):** Hệ thống tìm kiếm theo Full-text Search không dấu tiếng Việt.
4. **Điều hướng bàn phím thuần túy:** Phím mũi tên lên/xuống di chuyển danh sách -> Enter để chọn -> Ctrl + Enter xuất kho. Tốc độ thao tác đạt kỷ lục **2-3 giây cho mỗi đơn hàng**!

---

## 19. Hệ thống Báo cáo Quản trị Trực quan Đẳng cấp Quốc tế (Interactive Analytics BI Dashboard)

Hệ thống cung cấp một phân hệ Báo cáo Trực quan tương tác cao theo phong cách **Tableau / PowerBI**, tích hợp trực tiếp trên nền tảng Web:

### 19.1. Các Chiều Phân tích Đa chiều (Multi-Dimensional Slicers)
- **Theo Kênh & Tên miền (Domain / Channel):** Bán lẻ Online, Hội chợ, Đại lý Ký gửi (Fahasa, Đông Tây, Bình Book...), Mua đứt, Bán buôn xuất Mỹ, Thư viện.
- **Theo Giá tiền & Tỷ lệ Chiết khấu:** Thống kê doanh số theo các nấc chiết khấu: 0% (Bán lẻ), 30%, 35%, 37%, 40%, 50% (Đầu nậu).
- **Theo Thời gian & Mùa vụ:** Biểu đồ xu hướng doanh số theo tuần, tháng, quý, năm, so sánh tỷ trọng giữa các năm 2024 - 2025 - 2026.
- **Theo Nhóm Sách:** So sánh doanh số và vòng quay tồn kho giữa dòng kinh điển XBK vs dòng chủ lực FORMA vs dòng Artbook độc bản ĐCH.

### 19.2. Thư viện Trực quan hóa & Đồ họa Tương tác
- **Biểu đồ Cột Chồng (Stacked Bar Chart):** Cơ cấu doanh số từng tháng phân tách rõ Doanh thu Bán lẻ vs Ký gửi vs Mua đứt.
- **Biểu đồ Vùng (Area Chart):** Tốc độ giải phóng tồn kho của từng đợt in sách.
- **Biểu đồ Donut & Treemap:** Tỷ trọng kênh phân phối và tỷ trọng ngân sách sách biếu tặng/ngoại giao.
- **Bộ lọc Tương tác 1-Click (Cross-filtering):** Click vào một Đại lý trên biểu đồ tròn -> Toàn bộ bảng số liệu phía dưới tự động lọc danh sách các cuốn sách đại lý đó đang giữ và số tiền công nợ tương ứng.
- **Xuất Báo cáo Tiêu chuẩn Quốc tế:** Cho phép xuất hình ảnh biểu đồ độ phân giải cao (PNG/SVG) hoặc xuất toàn bộ bảng số liệu sang file Excel/PDF đã được định dạng kẻ bảng đẹp mắt chỉ với 1 click.

---
