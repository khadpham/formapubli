# BIEN BAN KIEM TOAN VA PHAN TICH TOAN DIEN 55 SHEETS CON CUA FORMAPUBLI

> Tai lieu kiem toan he thong du lieu van hanh lich su phuc vu chuyen doi so sang ERP formapubli.
> Thoi diem lap: Thang 9/2026.

---

## I. BANG TONG HOP 7 GOOGLE SPREADSHEETS (55 TABS CON)

| STT | Ma Sheet | Nhom chuc nang | So Tab con | GID dau tien | Tom tat muc tieu quan tri |
| :---: | :--- | :--- | :---: | :---: | :--- |
| 1 | sheet1_danhmuc | SHEET 1: DANH MUC SACH VA BAO GIA | **2** | 0 | Quan ly 81 dau sach (H01-H45: XBK, H46-H81: FORMA), kho sach, so trang, gia bia va cong thuc tach VAT 5%. |
| 2 | sheet2_ban_thang | SHEET 2: DU LIEU BAN THEO THANG VA DOI TAC PHAN PHOI | **11** | 1807916279 | Theo doi kenh ban le (kem dia chi text), ky gui dai ly, ban dut, hoi cho, xuat My va thu vien/dau nau. |
| 3 | sheet3_ban_nam | SHEET 3: DU LIEU BAN NAM VA TONG HOP TIEU THU | **12** | 1148267273 | Can doi da nam (2024-2026), ty trong trung gian vs truc tiep, chi tiet tung thang va danh ba 29 sheets dai ly. |
| 4 | sheet4_kho_kiemkho | SHEET 4: DU LIEU KHO, KIEM KHO VA VAT | **6** | 445705476 | So lieu dem thuc te theo Thung vs Sach roi (12/2025, 2026), artbook DCH doc ban va so ton VAT MISA/ke toan. |
| 5 | sheet5_xuat_nhap | SHEET 5: DU LIEU XUAT NHAP VA KHO TONG | **7** | 997296637 | Kho tong Quynh Mai theo kien, tien do nha in giao tung dot, du bao vong quay ban het va thanh ly sach cu. |
| 6 | sheet6_tang | SHEET 6: DU LIEU SACH BIEU, TANG, REVIEW VA NGOAI GIAO | **9** | 699654199 | He sinh thai ngoai giao tri thuc: Tang hoc gia Thu Phuc, KOL reviewer, thu vien cong dong, bu thu va rut noi bo. |
| 7 | sheet7_money_flow | SHEET 7: DONG TIEN (MONEY FLOW) VA DOI SOAT THU CHI | **8** | 1038774476 | Dong tien song song TK Lan Anh (LA) vs TK Cong ty (vitanova), doi soat cuoc buu cuc COD va phi van hanh. |

---

## II. CHI TIET NGHIEP VU VA RUI RO TUNG SUB-SHEET TRONG 55 TABS

### SHEET 1: DANH MUC SACH VA BAO GIA
- **Muc tieu:** Quan ly 81 dau sach (H01-H45: XBK, H46-H81: FORMA), kho sach, so trang, gia bia va cong thuc tach VAT 5%.
- **So luong sub-sheets:** 2 tabs

| STT | Ten Tab | GID | So dong | Headers tieu bieu | Thuyet minh van hanh & Danh gia rui ro |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | **Báo giá** | 0 | N/A | _Khong co header_ | Danh muc 81 dau sach chuan (H01-H45 la XBK; H46-H81 la FORMA). Day du ISBN, kho, so trang, gia bia, dich gia.<br>**Rui ro**: Dung ma H01, H46 kieu text, chua co Barcode chuan cho tung lo in tai ban. |
| 2 | **Điều chỉnh xuất VAT-2025** | 1764843757 | 81 | TT<br>TÊN SÁCH<br>Giá Bìa<br>VAT | Bang quy doi gia truoc thue VAT 5% (Gia bia / 1.05) phuc vu xuat hoa don.<br>**Rui ro**: Tinh toan cong thuc thu cong, lam tron de gay lech hoa don tong. |

---

### SHEET 2: DU LIEU BAN THEO THANG VA DOI TAC PHAN PHOI
- **Muc tieu:** Theo doi kenh ban le (kem dia chi text), ky gui dai ly, ban dut, hoi cho, xuat My va thu vien/dau nau.
- **So luong sub-sheets:** 11 tabs

| STT | Ten Tab | GID | So dong | Headers tieu bieu | Thuyet minh van hanh & Danh gia rui ro |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | **tổng kết** | 1807916279 | 27 | nộp<br>tồn<br>loại<br>kênh | Tong ket doanh thu va no kenh ban T6-T12/2024 (Shopee, Facebook).<br>**Rui ro**: So lieu chot tinh, khong dong bo voi so kho. |
| 2 | **Hằng tháng** | 0 | 36 | Mỗi kỳ<br>Trực tiếp (theo kỳ)<br>Trực tiếp (lẻ)<br>Ký gửi | Theo doi kenh phan phoi rieng biet.<br>**Rui ro**: Du lieu phan manh. |
| 3 | **projection** | 1325784184 | 0 | _Khong co header_ | Theo doi kenh phan phoi rieng biet.<br>**Rui ro**: Du lieu phan manh. |
| 4 | **LẺ 2026** | 2136291213 | 83 | ngày<br>Địa chỉ<br>Tổng<br>Bệnh tưởng | So ban le 2026: Cot B chua nguyen doan chat/dia chi khach, cac cot sau la 81 tua sach ghi so luong.<br>**Rui ro**: CUC KY NGUY HIEM. 81 cot ngang rat de go lech cot; dia chi phi cau truc khong the tich hop ship. |
| 5 | **Ký gửi** | 2023951129 | 51 | Thời điểm 
bắt đầu<br>Type<br>Đại Lý<br>VAT? | Dai ly ky gui (Dong Tay, Binh Book, Cricket, Hamvas Bela...); chiet khau 30-40%; tien ve TK LA hay Cong ty.<br>**Rui ro**: Khong theo doi duoc ton thuc te tai dai ly, phu thuoc doi tac bao cao, cong no mo am. |
| 6 | **Mua đứt** | 724757544 | 74 | Thời gian<br>Type<br>VAT?<br>% ck | Ban buon mua dut (Wild Cat, Trang Cuoi, Demedi...); CK 35-40%.<br>**Rui ro**: Chiet khau thoa thuan tung don, khong co bang gia si (tier) chuan hoa. |
| 7 | **Thư viện** | 1197457300 | 10 | Thời gian<br>Type<br>VAT?<br>% ck | Theo doi kenh phan phoi rieng biet.<br>**Rui ro**: Du lieu phan manh. |
| 8 | **Đầu nậu** | 721922952 | 11 | Type<br>VAT?<br>% ck<br>Tiền về TK nào? | Theo doi kenh phan phoi rieng biet.<br>**Rui ro**: Du lieu phan manh. |
| 9 | **HỘI CHỢ 2026** | 1674212107 | 82 | TÊN SÁCH<br>Giá Bìa<br>TỔNG<br>HỘI SÁCH MÙA XUÂN | Ban tai Hoi sach Mua Xuan, Hoi sach Mua Thu, HAS, DSQ Ba Lan.<br>**Rui ro**: Xuat mang di hoi cho khong co kho tam (In-transit), de that thoat. |
| 10 | **Mua nhiều** | 210608179 | 78 | Chị Quỳnh Anh
mua sang Mỹ<br>chị QA<br>chị QA/1/2025 | Don hang lon xuat sang My (chi Quynh Anh), ke chi tiet tung tua.<br>**Rui ro**: Xuat khau si can co phieu dong thung (Packing List) chuan. |
| 11 | **Rao thuê** | 1214382207 | 2 | Le Condé

(LCT)<br>Nhưng anh đề nghị thế này: không phải em mua mà ký gửi để bán thử, tất nhiên anh biết với một người đọc sách thật như em thì phải có đọc rồi mới hào hứng giới thiệu sách cho độc giả của mình được, thế nên anh sẽ tặng em mấy cuốn tuỳ em chọn để em đọc, trong cùng đợt nhập của em, em thấy thế nào?

Nhưng mà nếu anh muốn em bán giúp thì cũng ok, em có thể đi hỏi khách hàng của em để xem họ muốn mua cuốn nào rồi sẽ lấy về. Em thấy như vậy khá ok, không bị tồn hàng mà cũng an toàn cho cả anh và em nữa.<br>Này, em có muốn bán giúp anh, kiểu hỏi khách hàng của em rồi lấy về không? Anh có thể gửi cho em một bộ, rồi em chụp ảnh đăng. Được đơn nào thì anh gửi. 

Hoặc anh đưa luôn ảnh & giới thiệu cho em thì em đỡ phải chụp lại. | Luu mau tin nhan chao hang, nho KOLs/tiem sach ban giup hoac ky gui thu.<br>**Rui ro**: Du lieu phi cau truc nam lan trong bang tinh so lieu. |

---

### SHEET 3: DU LIEU BAN NAM VA TONG HOP TIEU THU
- **Muc tieu:** Can doi da nam (2024-2026), ty trong trung gian vs truc tiep, chi tiet tung thang va danh ba 29 sheets dai ly.
- **So luong sub-sheets:** 12 tabs

| STT | Ten Tab | GID | So dong | Headers tieu bieu | Thuyet minh van hanh & Danh gia rui ro |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | **TỔNG BÁN** | 1148267273 | 85 | XBK + FORMA<br>Hộp chốt<br>Tổng bán FORMA<br>2024 | Bang can doi ban da nam (2024, 2025, 2026), tinh ty le % Ban/In va % Ton.<br>**Rui ro**: Cong don tu cac thang nhap tay; sai 1 thang lech ca nam. |
| 2 | **TẶNG** | 2039062334 | 80 | REVEW<br>thiện nguyện/cv<br>REVEW<br>thiện nguyện/cv | Bang nhap tong hop va du bao.<br>**Rui ro**: Thieu quy trinh khoa so ky. |
| 3 | **4/2026** | 1807108762 | 81 | STT<br>TÊN SÁCH<br>Logistics<br>TẶNG | Chi tiet tieu thu thang: Tach Ban le, Hoi cho, Dai ly, Tang, Luu chieu, Loi.<br>**Rui ro**: Thu kho phai tong hop thu cong tu nhieu nguon. |
| 4 | **5/2026** | 1290093002 | 83 | STT<br>TÊN SÁCH<br>Logistics<br>TẶNG | Chi tiet tieu thu thang: Tach Ban le, Hoi cho, Dai ly, Tang, Luu chieu, Loi.<br>**Rui ro**: Thu kho phai tong hop thu cong tu nhieu nguon. |
| 5 | **6/2026** | 956647775 | 83 | STT<br>TÊN SÁCH<br>Logistics<br>TẶNG | Chi tiet tieu thu thang: Tach Ban le, Hoi cho, Dai ly, Tang, Luu chieu, Loi.<br>**Rui ro**: Thu kho phai tong hop thu cong tu nhieu nguon. |
| 6 | **7/2026** | 980100867 | 85 | STT<br>TÊN SÁCH<br>Logistics<br>TẶNG | Chi tiet tieu thu thang: Tach Ban le, Hoi cho, Dai ly, Tang, Luu chieu, Loi.<br>**Rui ro**: Thu kho phai tong hop thu cong tu nhieu nguon. |
| 7 | **8/2026** | 2073254470 | 85 | STT<br>TÊN SÁCH<br>Logistics<br>TẶNG | Chi tiet tieu thu thang: Tach Ban le, Hoi cho, Dai ly, Tang, Luu chieu, Loi.<br>**Rui ro**: Thu kho phai tong hop thu cong tu nhieu nguon. |
| 8 | **cao thấp 2025-2026** | 1812872700 | 80 | TỔNG<br>2024<br>tháng 1/2025<br>tháng 2/2025 | Bang nhap tong hop va du bao.<br>**Rui ro**: Thieu quy trinh khoa so ky. |
| 9 | **trung gian** | 1666211934 | 72 | Trung gian<br>Trực tiếp<br>Tổng<br>% trung gian | Phan tich ty trong kenh Trung gian (Dai ly, Ky gui) vs Truc tiep (Ban le).<br>**Rui ro**: Do tre so lieu lon do doi tac cham bao cao. |
| 10 | **nháp tổng** | 367799034 | 47 | 466<br>Bốn tình yêu<br>203<br>Các khía cạnh của tiểu thuyết | Bang nhap tong hop va du bao.<br>**Rui ro**: Thieu quy trinh khoa so ky. |
| 11 | **nháp** | 1170968993 | 79 | _Khong co header_ | Bang nhap tong hop va du bao.<br>**Rui ro**: Thieu quy trinh khoa so ky. |
| 12 | **DANH SÁCH ĐẠI LÝ (TX)** | 1663976436 | 29 | _Khong co header_ | Danh muc 29 link Google Sheets rieng re cua cac dai ly doi tac de di nhat so lieu thu cong.<br>**Rui ro**: NGHEN CO CHAI. Mat hang gio moi tuan de truy cap 29 sheets ben ngoai doi soat! |

---

### SHEET 4: DU LIEU KHO, KIEM KHO VA VAT
- **Muc tieu:** So lieu dem thuc te theo Thung vs Sach roi (12/2025, 2026), artbook DCH doc ban va so ton VAT MISA/ke toan.
- **So luong sub-sheets:** 6 tabs

| STT | Ten Tab | GID | So dong | Headers tieu bieu | Thuyet minh van hanh & Danh gia rui ro |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | **ĐCH artbook** | 445705476 | 23 | Ngày<br>Tồng Kho<br>Tổn<br>Thời gian | Theo doi chuyen biet Artbook Doan Cam Hac (DCH): Ban dac biet, ban thuong, thu tien.<br>**Rui ro**: An pham bac trieu nhung quan ly lan lon giua ban va kho. |
| 2 | **VAT 4/9 - thanh gửi** | 59915095 | 73 | Mã hàng<br>Tên hàng<br>ĐVT<br>Cuối kì | Kiem ke kho van.<br>**Rui ro**: Thieu bien ban dieu chinh thua thieu. |
| 3 | **KIỂM 12/2025** | 1382296458 | 77 | - Số liệu chưa phải là chính xác tuyệt đối, có sai số tuỳ lượng đầu vào và dọn kho lỗi<br>27/12/2025<br>27/12/2025<br>27/12/2025 | Kiem kho thuc te 12/2025 va 2026: Dem Thung x SL/Thung + Sach roi. Ghi chu: So lieu chua chinh xac tuyet doi do don kho loi.<br>**Rui ro**: RUI RO CAO. Ton chi mang tinh uoc tinh; do lech thuc te khoang 10%. |
| 4 | **kho 2025** | 1731554300 | 77 | - Số liệu chưa phải là chính xác tuyệt đối, có sai số tuỳ lượng đầu vào và dọn kho lỗi<br>27/12/2025<br>27/12/2025<br>27/12/2025 | Kiem kho thuc te 12/2025 va 2026: Dem Thung x SL/Thung + Sach roi. Ghi chu: So lieu chua chinh xac tuyet doi do don kho loi.<br>**Rui ro**: RUI RO CAO. Ton chi mang tinh uoc tinh; do lech thuc te khoang 10%. |
| 5 | **vat 29/5/2026** | 1384201733 | 141 | Tên kho<br>Mã hàng<br>Tên hàng<br>ĐVT | Tong hop nhap xuat ton kho thanh pham theo mau thue VAT tu 01/01/2026 den 27/05/2026.<br>**Rui ro**: So lieu ke toan lech voi so dem thuc te tai kho. |
| 6 | **Copy of vat 29/5/2026** | 862711181 | 48 | Tên kho<br>Mã hàng<br>Tên hàng<br>ĐVT | Tong hop nhap xuat ton kho thanh pham theo mau thue VAT tu 01/01/2026 den 27/05/2026.<br>**Rui ro**: So lieu ke toan lech voi so dem thuc te tai kho. |

---

### SHEET 5: DU LIEU XUAT NHAP VA KHO TONG
- **Muc tieu:** Kho tong Quynh Mai theo kien, tien do nha in giao tung dot, du bao vong quay ban het va thanh ly sach cu.
- **So luong sub-sheets:** 7 tabs

| STT | Ten Tab | GID | So dong | Headers tieu bieu | Thuyet minh van hanh & Danh gia rui ro |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | **QUỲNH MAI** | 997296637 | 15 | Quỳnh Mai<br>Tên sách<br>Còn<br>Nhập | Kho tong Quynh Mai: Quan ly nhap/xuat theo kien lon (Hotel Savoy, Ngan, Giua dat va nuoc...).<br>**Rui ro**: Kho ve tinh doc lap; chuyen ve Tay Ho thieu phieu In-transit theo doi. |
| 2 | **Nhập - Tổng** | 764374735 | 81 | TÊN SÁCH<br>Sl in<br>SL nhà in gửi<br>Sl còn lại 
chưa giao | Tien do giao hang tu Nha in: SL in hop dong vs Nha in giao tung dot vs Con lai chua giao.<br>**Rui ro**: Neu ghi nhap theo hop dong in thi ton so sach bi thoi phong hang nghin cuon. |
| 3 | ** xuất 2024** | 184713934 | 67 | STT<br>TÊN SÁCH<br>TỔNG<br>TẶNG | Nhat ky xuat nhap theo nam.<br>**Rui ro**: Luu tru phan manh theo tung nam. |
| 4 | **xuất 2025.1** | 1550587457 | 78 | STT<br>TÊN SÁCH<br>TỔNG<br>TẶNG | Nhat ky xuat nhap theo nam.<br>**Rui ro**: Luu tru phan manh theo tung nam. |
| 5 | **Kho 2026.2.24** | 1210396760 | 77 | TÊN SÁCH<br>SL IN<br>SL ĐÃ GIAO<br>XUẤT | Nhat ky xuat nhap theo nam.<br>**Rui ro**: Luu tru phan manh theo tung nam. |
| 6 | **Trang tính33** | 356971508 | 75 | TÊN SÁCH<br>BÁN<br>TỒN THỰC TẾ<br>THỜI GIAN 
BÁN HẾT
(tháng) | Du bao vong quay ban het ton kho thuc te (tinh theo thang/nam).<br>**Rui ro**: Cong thuc tinh khong phan anh tinh mua vu. |
| 7 | **Sách cũ** | 550962552 | 46 | TÊN SÁCH<br>TỒN THỰC TẾ<br>GIÁ BÁN | Ton kho va thanh ly sach cu (XBK).<br>**Rui ro**: Nhieu tua ton am hoac hu hao mat gia tri. |

---

### SHEET 6: DU LIEU SACH BIEU, TANG, REVIEW VA NGOAI GIAO
- **Muc tieu:** He sinh thai ngoai giao tri thuc: Tang hoc gia Thu Phuc, KOL reviewer, thu vien cong dong, bu thu va rut noi bo.
- **So luong sub-sheets:** 9 tabs

| STT | Ten Tab | GID | So dong | Headers tieu bieu | Thuyet minh van hanh & Danh gia rui ro |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | **XUẤT** | 699654199 | 67 | TÊN SÁCH<br>THÁNG 4<br>THÁNG 5<br>THÁNG 6 | Ho so ngoai giao, truyen thong va nghiem thu.<br>**Rui ro**: Du lieu phan manh. |
| 2 | **Theo dõi** | 525095784 | 505 | ––<br>Type<br>Lý do<br>Sách | So cai 505 dong tang sach: Quan he, Cong viec/CTV, Bu thu, FORMAria, kem tien ship.<br>**Rui ro**: Luong sach tang rat lon nhung khong co han muc (budget) duyet truoc. |
| 3 | **reviewer** | 0 | 141 | Confirm<br>Nguồn<br>Link<br>content nổi bật | Theo doi 141 tai khoan KOL/Reviewer: Tinh trang gui sach, link review, bai tra no.<br>**Rui ro**: Chua danh gia duoc ty le hoan von (ROI) tren chi phi tang sach va ship. |
| 4 | **THU PHỤC** | 1200099539 | 24 | BÁO<br>THẦY<br>DỊCH<br>TIỆM | Ho so Thu Phuc: Tang sach cho hoc gia, vien si, nha bao, dich gia uy tin.<br>**Rui ro**: Nghiep vu van hoa cot loi nhung can dong bo vao tep doi tac. |
| 5 | **địa điểm** | 1015741023 | 28 | Time<br>Loại<br>Action<br>Tên/ link/ contact | Ho so ngoai giao, truyen thong va nghiem thu.<br>**Rui ro**: Du lieu phan manh. |
| 6 | **nghiệm thu** | 1787844922 | 71 | STT<br>SL bán
2024+2025<br>SL tặng<br>báo | Ho so ngoai giao, truyen thong va nghiem thu.<br>**Rui ro**: Du lieu phan manh. |
| 7 | **content** | 1529763787 | 64 | STT<br>SL bán<br>tóm tắt<br>quote | Ho so ngoai giao, truyen thong va nghiem thu.<br>**Rui ro**: Du lieu phan manh. |
| 8 | **NỘI BỘ** | 453005445 | 13 | THÁNG 12<br>NL<br>Bộ thu x 3 | So noi bo: Sach thanh vien sang lap rut dung rieng (NL, PDC, Lan Anh, Tran). Ghi chu: Khong tinh vao thong ke.<br>**Rui ro**: NGUYEN NHAN LECH KHO. Xuat kho khong phieu lam ton thuc te thap hon so sach. |
| 9 | **Contact list** | 141938761 | 5 | Email<br>Trạm đọc<br>https://www.facebook.com/tramdoc.vn | Ho so ngoai giao, truyen thong va nghiem thu.<br>**Rui ro**: Du lieu phan manh. |

---

### SHEET 7: DONG TIEN (MONEY FLOW) VA DOI SOAT THU CHI
- **Muc tieu:** Dong tien song song TK Lan Anh (LA) vs TK Cong ty (vitanova), doi soat cuoc buu cuc COD va phi van hanh.
- **So luong sub-sheets:** 8 tabs

| STT | Ten Tab | GID | So dong | Headers tieu bieu | Thuyet minh van hanh & Danh gia rui ro |
| :---: | :--- | :---: | :---: | :--- | :--- |
| 1 | **Lương La** | 1038774476 | 20 | 29/4/24<br>Chị Quỳnh Anh<br>6,000,000đ | Du lieu tai chinh va dieu phoi.<br>**Rui ro**: Chua dong bo voi he thong ke toan. |
| 2 | **Sách ĐCH** | 53432971 | 14 | Ngày<br>Tên người nhận<br>SL<br>Thu | Du lieu tai chinh va dieu phoi.<br>**Rui ro**: Chua dong bo voi he thong ke toan. |
| 3 | **TÔNG KẾT THÁNG/2026 (LA)** | 2097116433 | 169 | LA+CT<br>Khoản<br>Thu<br>Chi | Tong ket dong tien thang Lan Anh: Thu dai ly + ban le tru toan bo phi van hanh.<br>**Rui ro**: Nhap nhang tien ca nhan va tien cong ty; Lan Anh phai ung tien tui roi quyet toan. |
| 4 | **THU 2026** | 1728579464 | 77 | TK LA<br>TK vitanova<br>NOTE | Phan chia dong tien ve giua TK Lan Anh (LA) va TK Cong ty (vitanova).<br>**Rui ro**: Thieu doi soat tu dong giua hoa don va bien dong so du ngan hang. |
| 5 | **CHI 2026** | 1488380340 | 333 | Ngày<br>Tổng<br>Regular<br>Exceptional | Nhat ky chi phi 333 dong: Ship, hop carton, helper don kho, tiep khach, du an.<br>**Rui ro**: Nhieu khoan tien mat nho le thieu hoa don chung tu hop le. |
| 6 | **SHIP** | 360864498 | 33 | TỔNG<br>by season<br>Ship kỳ<br>Ship mua | Du lieu tai chinh va dieu phoi.<br>**Rui ro**: Chua dong bo voi he thong ke toan. |
| 7 | **THUẾ ETAX** | 933796055 | 26 | THÁNG<br>PHẢI NỘP<br>NGÀY NHẬN<br>GHN | Doi soat tien cuoc va tien thu ho COD hang tuan voi GHN, GHTK, SPX.<br>**Rui ro**: Doi soat thu cong tung ma de bi sot tien COD doi tac cham thanh toan. |
| 8 | **MƯỢN THƯ VIỆN** | 221473870 | 3 | stt<br>Tên<br>Sách<br>Thời gian
Mượn - trả | Chuong trinh muon sach thu vien: Thu coc, tru phi thue, hoan coc cho ban doc.<br>**Rui ro**: Phat sinh theo doi cong no tien coc hoan tra. |

---

