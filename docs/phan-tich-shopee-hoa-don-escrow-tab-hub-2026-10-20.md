# Phân tích: Hóa đơn người mua Shopee, Escrow/Tài chính sâu, và Tái cấu trúc tab Shopee thành Hub đơn online

Ngày: 2026-10-20. Người thực hiện: Muse (nghiên cứu trực tiếp tài liệu chính thức open.shopee.com + điều khoản Shopee + thực hành kế toán kênh VN). Phạm vi quyết định liên quan: quyết định hóa đơn 14/10 (mọi sản phẩm bán ra đều phải có hóa đơn; lấy VAT xuất riêng ngay, không lấy gom tổng hợp cuối ngày), quyết định hub đơn online 09/10 (đơn portal chuyển vào tab Shopee), blueprint ERP.

---

## PHẦN 1. Luồng hóa đơn phía người mua trên Shopee và cách nối vào pipeline của công ty

### 1.1. Cơ chế phía Shopee

- Khi thanh toán, người mua doanh nghiệp (hoặc cá nhân có nhu cầu) khai thông tin xuất hóa đơn ngay trên Shopee: tên đơn vị, mã số thuế, địa chỉ, email nhận hóa đơn. Đơn hàng mang trạng thái liên quan tới hóa đơn (INVOICE_PENDING trong danh sách trạng thái đơn).
- Shopee cung cấp 4 API liên quan hóa đơn người mua (module Order), NHƯNG phạm vi quốc gia khác nhau - điểm vừa xác minh trực tiếp từ tài liệu chính thức và làm thay đổi thiết kế:
  1. `get_buyer_invoice_info` (POST): **Việt Nam dùng được** (chỉ VN/TH/PH). Trả về invoice_type (personal/company/household) và với VN: name, email, tax_id, address; phía công ty: company_name, company_tax_id, company_email, company_address; thêm nhóm household_* và national_id. Lưu ý: thông tin có thể bị che một phần tùy trạng thái đơn.
  2. `get_pending_buyer_invoice_order_list`: **chỉ PH/BR - Việt Nam KHÔNG dùng được**. Không có hàng đợi chờ hóa đơn chính thức qua API cho VN.
  3. `upload_invoice_doc` (file pdf/jpeg/png/xml, tối đa 1MB): **chỉ PH/BR - Việt Nam KHÔNG dùng được**. Không tải được file hóa đơn lên Shopee qua API ở VN.
  4. `download_invoice_doc`: chỉ PH/BR.
- Hệ quả cho VN: Shopee chỉ cho người bán ĐỌC thông tin hóa đơn khách đã khai. Việc phát hành và GỬI hóa đơn cho khách diễn ra ngoài Shopee (email tới company_email khách đã khai, đính kèm link tra cứu MS-Invoice; hoặc gửi qua chat Shopee). Không có SLA/thời hạn phản hồi nào được tài liệu quy định cho VN (quy trình bắt buộc xuất hóa đơn trước khi gửi hàng chỉ áp cho Brazil).

### 1.2. Nối vào pipeline hiện có của công ty - ghép từng bước

Pipeline hóa đơn hiện tại của ERP (đã xong với POS/bán buôn/portal): đơn có thông tin hóa đơn -> fiscal_scope = OFFICIAL_TAX -> chuẩn bị hóa đơn riêng -> đẩy MS-Invoice -> kế toán duyệt/ký trên MS-Invoice -> ERP đồng bộ trạng thái ngược. Với Shopee, ghép như sau:

| Bước | Phía Shopee | Phía ERP/MS-Invoice |
| --- | --- | --- |
| 1. Khách khai thông tin HĐ khi đặt hàng | order mang trạng thái INVOICE_PENDING; đọc bằng get_buyer_invoice_info | Khi đồng bộ đơn về (webhook + poll theo trạng thái INVOICE_PENDING), ghi vào đúng 4 trường invoice_company_name/invoice_tax_code/invoice_address/invoice_email của đơn (ERP đã có sẵn các trường này cho POS - dùng chung) |
| 2. Hàng đợi xử lý | (VN không có API hàng đợi) ERP tự xây từ trạng thái đơn INVOICE_PENDING | Tab Hóa đơn trong hub hiển thị hàng đợi gộp: đơn Shopee chờ HĐ + đơn portal chờ HĐ + POS chờ HĐ, một quy trình duy nhất |
| 3. Phát hành | - | fiscal_scope = OFFICIAL_TAX, prepareFromOrder (đã sửa đúng thuế sách 5%, tách ngược VAT), pushInvoice sang MS-Invoice ký hiệu 1C26TVN |
| 4. Ký | - | Kế toán ký trên MS-Invoice như hiện tại (ERP không đụng ký số - quyết định đã chốt) |
| 5. Trả hóa đơn cho khách | upload_invoice_doc KHÔNG khả dụng ở VN | Sau khi syncStatus = SIGNED, ERP gửi hóa đơn cho khách qua email (company_email khách đã khai trên Shopee) kèm link tra cứu của MS-Invoice; dự phòng qua chat Shopee. Đây là thay đổi so với bản thảo ban đầu (từng nghĩ upload lên Shopee) |
| 6. Đơn không yêu cầu HĐ | - | fiscal_scope = INTERNAL_MANAGEMENT, gom vào hóa đơn tổng hợp cuối ngày cùng mẻ với POS/portal (theo quyết định 14/10) |

### 1.3. Các điểm phải quyết định khi triển khai (không tự suy diễn)

1. **Thời điểm ghi doanh thu/hóa đơn cho đơn Shopee**: đơn online có độ trễ giao hàng và hoàn trả; hóa đơn riêng cho khách yêu cầu VAT nên phát hành khi đơn chắc chắn (sau giao thành công) hay ngay khi đơn xác nhận? Đề xuất: phát hành khi đơn chuyển COMPLETED hoặc khách yêu cầu sớm qua chat thì xử lý tay. Cần chốt với thực tế vận hành và kế toán.
2. **Đơn bị hủy/hoàn sau khi đã xuất hóa đơn**: cần hóa đơn điều chỉnh theo pipeline hoàn trả (đã phân tích ở tài liệu V5 prep). Shopee trả hàng có API riêng nên ERP sẽ biết ngay khi phát sinh.
3. **COD**: đơn Shopee COD tiền do SPX thu hộ; hóa đơn vẫn xuất theo giá trị hàng - không phụ thuộc hình thức thanh toán (pipeline hiện tại đã xử lý qua paymentInstrumentEnumId chung).
4. **Nhất quán MST**: thông tin khách khai trên Shopee là nguồn chính thức; ERP không tự sửa, chỉ cảnh báo nếu MST sai định dạng (10/13 ký tự số).

### 1.4. Giá trị

- Trước đây: khách Shopee xin hóa đơn -> nhân viên vào Seller Centre xem tay, xuất tay, gửi email tay. Nay: tự động vào hàng đợi, một nút phát hành, tự trả file. Đây là mảnh ghép biến quyết định "mọi đơn đều có hóa đơn" thành khả thi ở kênh Shopee - kênh trước đây mù hóa đơn nhất.

---

## PHẦN 2. Escrow là gì và thiết kế tài chính sâu cho kênh Shopee

### 2.1. Escrow là gì - giải thích gốc rễ

Escrow là cơ chế **giữ tiền trung gian có điều kiện**: tiền của người mua không đi thẳng tới người bán, mà Shopee giữ tại "Tài khoản Đảm bảo" (Shopee Guarantee Account) cho tới khi điều kiện giải ngân thỏa mãn. Theo Điều khoản dịch vụ Shopee, tiền được giải ngân cho người bán khi một trong các sự kiện xảy ra:

- (a) Người mua bấm xác nhận đã nhận hàng; hoặc
- (b) Hết Thời gian Đảm bảo (Shopee Guarantee Period) mà không có tranh chấp; hoặc
- (c) Shopee phán quyết tranh chấp/hoàn trả nghiêng về người bán.

Nếu hoàn trả được duyệt, tiền quay về người mua từ chính khoản giữ này - người bán không phải tự hoàn tiền.

Thời gian Đảm bảo = số ngày chuẩn bị hàng (DTS) + thời gian giao dự kiến + thời gian người mua xác nhận (thường 3 ngày với shop thường, 15 ngày với Shopee Mall), người mua có thể gia hạn thêm. Sau giải ngân, tiền vào Số dư người bán, rồi chi trả (payout) về ngân hàng theo chu kỳ tự động hoặc rút thủ công (có phí rút).

Vì sao nó quan trọng với kế toán: **doanh thu ghi nhận (khi bán) khác hoàn toàn với tiền về (sau escrow 1-3 tuần)**, và số tiền về đã bị trừ một chồng phí. Mọi hệ thống tính lãi Shopee đúng đều phải bắt đầu từ escrow.

### 2.2. Giải phẫu một khoản escrow - công thức lãi thật

```
TIỀN THỰC NHẬN (escrow amount sau điều chỉnh)
= Tổng khách trả (hàng + ship khách chịu)
- Giảm giá phía người bán (voucher shop, giảm giá sản phẩm)
- Phí vận chuyển phía người bán chịu (chênh lệch phí ship thực tế)
- Phí cố định/hoa hồng sàn (theo ngành hàng)
- Phí xử lý giao dịch (6% tại VN từ 24/04/2026, tính trên tổng thanh toán, áp cả COD)
- Phí dịch vụ chương trình đã tham gia (Voucher Xtra khoảng 5.5%, Freeship Xtra, Hoàn xu Xtra...)
- Phần đồng tài trợ voucher với sàn (shop chịu tới 40% từ 23/05/2026)
- Phí theo đơn (PiShip khoảng 2.700đ/đơn) nếu bật
- Hoa hồng tiếp thị liên kết (nếu có đơn qua affiliate)
- Thuế khấu trừ tại nguồn (nếu thuộc diện)
+ Bồi thường mất hàng / điều chỉnh khác (nếu có)

LÃI THẬT TỪNG ĐƠN = escrow_amount_after_adjustment - COGS - chi phí marketing phân bổ
```

Minh họa (số tròn, sách giá bìa 200.000đ, bán trên Shopee sau giảm giá shop còn 170.000đ, ship khách trả):
- Khách trả: 170.000đ
- Phí cố định ngành Sách (ước nhóm thấp, khoảng 4%): -6.800đ
- Phí xử lý giao dịch 6%: -10.200đ
- Voucher Xtra 5.5% (nếu tham gia): -9.350đ
- PiShip: -2.700đ
- Thực nhận escrow: khoảng 140.950đ (83% giá bán)
- COGS theo chiết khấu mua đứt 35% trên giá bìa: -130.000đ
- **Lãi gộp trước marketing: khoảng 10.950đ (5,5% giá bìa)** - cực mỏng, và chỉ cần thêm ads là âm.

Bài học quản trị: ở kênh Shopee, **giá bán và chương trình tham gia quyết định sống còn**; không có số escrow theo đầu sách thì mọi quyết định giá đều là mò. Đây chính là lý do phải kéo escrow về ERP chứ không dừng ở doanh thu danh nghĩa như cách làm xlsx hiện tại.

Lưu ý tính thời điểm: mọi tỷ lệ phí ở trên thay đổi liên tục theo chính sách sàn (riêng 2026 đã đổi ít nhất 3 đợt). Hệ thống KHÔNG được hardcode tỷ lệ để tính tiền - chỉ dùng tỷ lệ để dự báo; tiền thật luôn lấy từ escrow API của từng đơn.

### 2.3. Ba tầng dữ liệu tài chính Shopee cung cấp (đã xác minh trong tài liệu)

1. **Theo đơn** - `get_escrow_detail` / `get_escrow_detail_batch`: toàn bộ cấu thành tiền của từng đơn (giá gốc, giảm giá hai phía, từng loại phí tách dòng, thuế, phí ship các phía, số escrow trước/sau điều chỉnh). Đơn vị phân tích nhỏ nhất và chính xác nhất.
2. **Theo kỳ** - `generate_income_statement`, `get_income_statement`, `generate_income_report`, `get_income_report`, `get_income_overview`, `get_income_detail`: báo cáo thu nhập chính thức theo kỳ của sàn - dùng để khớp tổng.
3. **Tiền thật về** - `get_payout_detail`, `get_payout_info`, `get_wallet_transaction_list`, `get_billing_transaction_info`: dòng tiền chi trả thực tế và hóa đơn phí của sàn - dùng để khớp ngân hàng.

Quy tắc đối soát 3 chiều: tổng escrow theo đơn (tầng 1) phải khớp income report kỳ (tầng 2), và tổng payout kỳ (tầng 3) phải khớp sao kê ngân hàng. Lệch ở tầng nào khoanh vùng ở tầng đó.

### 2.4. Thiết kế phân tích nhiều chiều trong ERP

Bảng sự kiện trung tâm: một dòng cho mỗi đơn Shopee hoàn tất, chứa toàn bộ cấu thành escrow + COGS + kênh + kho xuất + chiến dịch (nếu gắn). Các chiều cắt:

- **Theo đầu sách**: doanh thu danh nghĩa, thực nhận, tổng phí và tỷ lệ phí %, COGS, lãi gộp, lãi sau phân bổ ads. Xếp hạng đầu sách lãi/lỗ thật - đầu vào cho quyết định tái bản/đẩy bán.
- **Theo thời gian**: ngày/tuần/tháng; tách rõ 3 mốc: ngày đặt (doanh thu), ngày hoàn tất (ghi nhận), ngày giải ngân/ngày payout (dòng tiền).
- **Theo chương trình**: đơn thường vs đơn Voucher Xtra/Freeship Xtra/flash sale - đo xem chương trình có đáng tham gia không (doanh thu tăng thêm so với phí chương trình).
- **Theo kho xuất**: hội chợ vs kho chính (hàng bán Shopee xuất từ đâu, lãi theo điểm xuất).
- **Theo phương thức thanh toán**: COD vs trả trước (phí xử lý giao dịch áp cả hai, nhưng hành vi hủy/hoàn khác nhau).
- **Theo khu vực giao** (tỉnh/thành từ địa chỉ nhận): phí ship phía bán chịu theo vùng.
- **Theo trạng thái vòng đời**: tỷ lệ hủy, tỷ lệ hoàn trả và tác động tiền của chúng (escrow bị thu hồi, phí ship hai chiều).

Các chỉ số sức khỏe tài chính cần cảnh báo tự động:
- **Phải thu Shopee tồn đọng**: tổng escrow đã hoàn tất nhưng chưa payout, tuổi nợ theo mốc 7/14/21 ngày - tiền của mình đang bị giữ bao nhiêu.
- **Lệch tỷ lệ phí**: tỷ lệ phí thực tế của đơn so với kỳ vọng theo cấu hình chương trình - bắt được thay đổi chính sách của sàn ngay trong tuần đầu thay vì cuối quý.
- **Đơn âm lãi**: escrow sau điều chỉnh nhỏ hơn COGS - cảnh báo theo đầu sách.
- **Lệch đối soát**: tổng 3 tầng không khớp quá ngưỡng (ví dụ 0,5%) thì báo ngay.

### 2.5. Dòng tiền (cashflow) - chiều bị quên nhiều nhất

Vì escrow giữ 1-3 tuần, ERP cần một màn hình riêng: dự báo tiền về theo tuần dựa trên escrow đang chờ giải ngân + lịch payout, đặt cạnh các khoản phải chi (in ấn, bản quyền). Với một công ty dưới 10 người, đây là khác biệt giữa "bán tốt" và "kẹt tiền".

---

## PHẦN 3. Tái cấu trúc tab Shopee thành Hub đơn online (Portal + Shopee)

### 3.1. Hiện trạng và vấn đề

- Tab Shopee hiện tại: nhập đơn bằng xlsx thủ công; nhiều điểm yếu đã ghi nhận (biểu thức lọc SĐT/địa chỉ dễ vỡ, trừ kho lệch, thiếu COD, poll thủ công).
- Quyết định 09/10 đã chốt hướng: toàn bộ đơn online (portal + Shopee) gộp vào một hub đặt tại tab Shopee; bỏ khâu duyệt chờ ở tab Bán hàng; thủ kho xác nhận đã giao là trừ kho.
- Nay có thêm các năng lực mới: API Shopee thật (đơn tự về, gửi hàng SPX, in phiếu, hoàn trả, escrow, hóa đơn người mua), cộng với bài toán chat và sản phẩm đồng bộ.
- Kết luận: KHÔNG nên giữ nguyên cấu trúc tab hiện tại rồi "gắn API vào". Cấu trúc cũ được thiết kế quanh thao tác nhập file; cấu trúc mới phải thiết kế quanh vòng đời đơn và các hàng đợi công việc (work queues). Đây là thay đổi tư duy giao diện, không chỉ thêm nút.

### 3.2. Nguyên tắc thiết kế hub

1. **Một danh sách đơn, hai kênh**: đơn portal và đơn Shopee là hai nguồn của cùng một thực thể đơn online. Lọc theo kênh bằng chip/tab con; cột và trạng thái dùng chung; hành động đặc thù theo kênh hiển thị theo ngữ cảnh (đơn Shopee có in phiếu SPX, đơn portal có VietQR/xác nhận chuyển khoản).
2. **Trạng thái vòng đời hợp nhất**: Mới -> Đã xác nhận (đã trừ giữ kho ATP) -> Đang chuẩn bị -> Đã bàn giao vận chuyển -> Đang giao -> Hoàn thành | Đã hủy | Hoàn trả. Trạng thái gốc của từng kênh được ánh xạ vào khung này (Shopee READY_TO_SHIP/PROCESSED/SHIPPED/COMPLETED/CANCELLED; portal theo vòng đời hiện có) nhưng nhân viên chỉ học MỘT hệ trạng thái.
3. **Thiết kế theo hàng đợi công việc**: mỗi màn hình con trả lời một câu hỏi vận hành: "đơn nào đang chờ tôi xử lý việc X" - chờ xác nhận, chờ đóng gói/in phiếu, chờ hóa đơn, chờ xử lý hoàn trả, chờ đối soát.
4. **Không nhân đôi thực thể**: sản phẩm Shopee và sản phẩm portal đều ánh xạ về sản phẩm ERP (bảng ánh xạ riêng theo kênh); tồn kho một nguồn sự thật là ERP, kênh là nơi hiển thị.
5. **Giữ đúng các quy tắc giao diện đã chốt**: modal desktop 2 cột không cuộn dọc, không confirm/alert trình duyệt, làm mới giữ trạng thái.

### 3.3. Cấu trúc đề xuất cho tab (đổi tên hiển thị: "Đơn online")

Bên trong tab là các mục con dạng tab ngang (giữ nguyên khung điều hướng 12 tab cấp 1):

1. **Tổng quan** (mới): số đơn hôm nay theo kênh, doanh thu danh nghĩa và thực nhận ước tính, số đơn chờ xử lý theo từng hàng đợi, cảnh báo (token sắp hết hạn, đơn sắp quá hạn gửi, escrow tồn đọng, lệch đối soát). Đây là màn hình mở tab là thấy việc.
2. **Đơn hàng**: danh sách hợp nhất như mục 3.2.1; chi tiết đơn dạng modal 2 cột (trái: dòng hàng + vận chuyển + ghi chú; phải: thanh toán + hóa đơn + hành động theo kênh). Hành động hàng loạt: in phiếu vận đơn Shopee theo job, xác nhận đã giao portal.
3. **Vận chuyển**: bảng điều phối SPX (đơn sẵn sàng gửi, chọn dropoff/pickup, lấy mã vận đơn, hàng đợi in phiếu và trạng thái bản in) + phần giao hàng portal (đơn vị vận chuyển ngoài/thu hộ).
4. **Sản phẩm kênh**: bảng ánh xạ sản phẩm ERP <-> Shopee item/portal product; trạng thái đồng bộ giá/tồn; lỗi đồng bộ; thao tác đăng sản phẩm mới lên Shopee từ dữ liệu ERP; hàng đợi duyệt nội dung trước khi đẩy (bài học portal: mô tả AI phải có người duyệt).
5. **Hoàn trả**: hàng đợi hoàn trả gộp 2 kênh; mỗi hoàn trả gắn: lý do, bằng chứng, trạng thái tranh chấp, tác động kho (hàng về nhập lại kho nào) và tác động tiền (escrow bị thu hồi/portal hoàn tiền) - dùng chung chính sách đối trả phương án A đã lên production.
6. **Tài chính**: đối soát 3 tầng của Phần 2 (escrow theo đơn, income theo kỳ, payout), P&L theo đầu sách cho kênh online, dự báo dòng tiền, cảnh báo lệch phí. Đơn portal cũng vào cùng khung này (thực nhận = tiền chuyển khoản đã khớp).
7. **Hóa đơn** (mục con hoặc liên kết sâu sang tab Hóa đơn điện tử): hàng đợi yêu cầu hóa đơn từ Shopee (pending buyer invoice) + portal; một nút phát hành đi qua pipeline MS-Invoice; trạng thái trả file cho khách.

Chat khách Shopee: đặt ở mục con sau cùng hoặc biểu tượng có huy hiệu số tin chưa đọc - phạm vi P2, phụ thuộc scope riêng xin thêm với Shopee.

### 3.4. Lộ trình chuyển đổi (không đập đi xây lại trong một lần)

- **Bước 0 (giữ nguyên)**: tab hiện tại vẫn chạy xlsx cho tới khi API sẵn sàng; thêm trường channel + ánh xạ trạng thái hợp nhất ở tầng dữ liệu trước (việc backend, không đổi giao diện).
- **Bước 1 (P1)**: đồng bộ đơn Shopee bằng API vào cùng danh sách; màn hình Vận chuyển SPX + in phiếu; portal giữ nguyên luồng hiện tại trong cùng danh sách. xlsx chuyển thành đường dự phòng (ẩn sau nút nhập tay).
- **Bước 2 (P1.5)**: hàng đợi hóa đơn người mua Shopee nối pipeline MS-Invoice; mục Tổng quan.
- **Bước 3 (P2)**: sản phẩm/tồn đồng bộ, hoàn trả API, chat.
- **Bước 4 (P3)**: tài chính escrow 3 tầng + phân tích nhiều chiều + dự báo dòng tiền.
- Mỗi bước đi qua quy trình quen thuộc: làm trên dev, kiểm thử trực tiếp trên trình duyệt + đối chiếu DB, tách PR nhỏ, deploy.

### 3.5. Rủi ro và điểm phải nhớ

- Tồn kho hai sự thật: Shopee tự trừ khi có đơn; ERP trừ theo vòng đời của mình. Phải chốt một quy tắc đồng bộ duy nhất (ERP là sự thật vật lý; tồn hiển thị trên Shopee = tồn ERP trừ giữ chỗ online), kèm job đối soát và cảnh báo lệch - đã có bài học lệch kho từ thời xlsx.
- Webhook không đảm bảo thứ tự và có thể lặp: cập nhật trạng thái đơn phải idempotent.
- Token và hàng đợi API là hạ tầng dùng chung cho mọi mục con - xây một lần ở bước 1, không làm riêng lẻ theo tính năng.
- Đổi tên hiển thị tab thành "Đơn online" là thay đổi khách hàng nội bộ nhìn thấy: theo quy tắc, preview trên dev trước khi lên production.

---

### 1.4. Giá trị

- Trước đây: khách Shopee xin hóa đơn -> nhân viên vào Seller Centre xem tay, xuất tay, gửi email tay. Nay: đơn INVOICE_PENDING tự về, thông tin hóa đơn tự điền, một nút phát hành, email gửi tự động kèm link tra cứu. Đây là mảnh ghép biến quyết định "mọi đơn đều có hóa đơn" thành khả thi ở kênh Shopee - kênh trước đây mù hóa đơn nhất.

## PHỤ LỤC A. Danh mục trường escrow detail (get_escrow_detail, xác minh từ tài liệu chính thức)

Truy vấn: GET, tham số bắt buộc order_sn. Khối order_income gồm:
- escrow_amount (sau khi trừ: seller_transaction_fee, service_fee, commission_fee, campaign_fee, order_ams_commission_fee, các phí ship/bảo vệ, thuế các loại, withholding_tax các loại, seller_order_processing_fee, fbs_fee, ads_escrow_top_up_fee, th_import_duty, pay_per_sale, final_shipping_fee, actual_shipping_fee).
- Nhóm giá: order_original_price, original_price, order_discounted_price, order_selling_price.
- Nhóm giảm giá: order_seller_discount, seller_discount, shopee_discount, voucher_from_seller, voucher_from_shopee, coins.
- Nhóm ship: buyer_paid_shipping_fee, estimated/actual/final_shipping_fee, shopee_shipping_rebate, shipping_fee_discount_from_3pl, reverse_shipping_fee, order_chargeable_weight.
- Nhóm phí: commission_fee, service_fee, seller_transaction_fee, buyer_transaction_fee, credit_card_transaction_fee, campaign_fee, ams_commission_fee (+ biến thể net_* riêng cho BR kèm quy tắc chi tiết và seller_product_rebate).
- Nhóm thuế: escrow_tax, final_escrow_product_gst, final_escrow_shipping_gst, sales_tax_on_lvg; riêng Việt Nam có: withholding_vat_tax, withholding_pit_tax, withholding_cit_tax, tax_registration_code, vat_on_imported_goods (8%).
- Nhóm bảo vệ/khiếu nại: seller_lost_compensation, các khoản claim rsf/fsf, shipping_seller_protection_fee_amount, delivery_seller_protection_fee_premium_amount.
- order_adjustment[]: total_adjustment_amount và escrow_amount_after_adjustment - dùng trường sau điều chỉnh này để tính lãi thật (không dùng số danh nghĩa).
- items[]: chi tiết từng dòng hàng (ids, sku, giá, giảm giá, activity_type, số lượng, ams_commission_fee, kit_items, promotion_list) - nền cho phân tích theo đầu sách.
- Trường thanh toán người mua: buyer_payment_info (ảnh chụp lúc thanh toán); tenure_info_list; return_order_sn_list.

Lưu ý thiết kế: nhóm withholding_vat_tax/pit_tax/cit_tax của VN là các khoản khấu trừ tại nguồn - kế toán cần thấy riêng khi đối soát thuế; không gộp vào phí sàn.

## PHỤ LỤC B. BusinessInsights và AccountHealth (xác minh từ tài liệu chính thức)

- **BusinessInsights** (module 141): tại thời điểm 2026-10-20 chỉ có đúng 1 endpoint get_marketing_hot_listing và chỉ áp dụng cho Brazil. Kết luận: với shop Việt Nam, phân tích kinh doanh phải do ERP tự xây từ dữ liệu đơn + escrow (như thiết kế ở Phần 2) - không trông chờ API phân tích của sàn.
- **AccountHealth** (module 103): có đầy đủ bộ theo dõi sức khỏe shop: get_shop_performance (điểm tổng 1-4, danh sách khoảng 40 chỉ số theo 3 nhóm Fulfillment/Listing/Customer-Service kèm mục tiêu), get_metric_source_detail (đào sâu từng chỉ số: đơn nào ảnh hưởng, listing nào có vấn đề), get_penalty_point_history (điểm phạt theo quý), get_punishment_history (lịch sử hình phạt đang diễn ra/đã kết thúc), get_listings_with_issues (danh sách sản phẩm có vấn đề kèm mã lý do). Ứng dụng: cảnh báo vận hành trong tab Đơn online (ví dụ sắp trễ gửi hàng, sản phẩm vi phạm nội dung) trước khi bị phạt - bảo vệ thứ hạng shop.

## Kết luận 3 câu hỏi

1. Luồng hóa đơn người mua Shopee ghép được vào pipeline MS-Invoice ở 5/6 bước; riêng bước trả file cho khách phải chuyển sang email vì API upload không mở cho thị trường Việt Nam. Điểm cần chốt duy nhất là thời điểm phát hành cho đơn online.
2. Escrow là tiền khách bị Shopee giữ có điều kiện và là con số duy nhất đáng tin để tính lãi kênh Shopee; ERP nên kéo đủ 3 tầng (đơn/kỳ/payout) và phân tích theo 7 chiều đã thiết kế, kèm cảnh báo lệch phí và dự báo dòng tiền.
3. Nên tái cấu trúc tab Shopee thành Hub "Đơn online" theo vòng đời đơn và hàng đợi công việc, theo lộ trình 5 bước không gián đoạn vận hành; việc cần làm trước là tầng dữ liệu hợp nhất, giao diện thay dần theo từng giai đoạn P1-P3.
