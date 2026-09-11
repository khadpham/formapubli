# formapubli — Hệ Điều Hành Quản Trị Xuất Bản & Kho Vận Chuyên Dụng

> **Đơn vị phát triển:** formapubli Core Engineering  
> **Phiên bản kiến trúc:** 3.0 (Master Comprehensive Edition - 2026)  
> **Repository:** [https://github.com/khadpham/formapubli.git](https://github.com/khadpham/formapubli.git)

---

## 1. Giới thiệu Dự án
**formapubli** là giải pháp ERP tinh gọn, chuyên sâu cho ngành xuất bản và phát hành sách tại Việt Nam. Dự án được thiết kế nhằm thay thế hoàn toàn hệ thống 7 Google Spreadsheets (55 sub-sheets) thủ công trước đây bằng một hệ thống đám mây chuẩn mực, bảo mật tuyệt đối, phản hồi dưới 100ms và **hoàn toàn miễn phí 100% chi phí hạ tầng (0 VNĐ vĩnh viễn)**.

---

## 2. Cấu trúc Tài liệu & Kho Tri thức
Toàn bộ tài liệu thiết kế và hồ sơ kiểm toán được tổ chức bài bản tại:
- **FORMAPUBLI_MASTER_BLUEPRINT.md**: Bản kiến trúc tổng thể 19 chương, bao gồm quy chuẩn nghiệp vụ, cơ sở dữ liệu DDL, chính sách kho vận, chiến lược bảo mật Cloudflare và lộ trình 4 Phase.
- **docs/REPORT_55_SHEETS_AUDIT.md**: Biên bản kiểm toán toàn diện 55 sub-sheets lịch sử: phân tích chi tiết dữ liệu, công thức tính và nhận diện các rủi ro vận hành.
- **docs/FORMAPUBLI_KNOWLEDGE_BASE.md**: Kho tri thức toàn thư của dự án phục vụ tra cứu nhanh cho toàn bộ đội ngũ.
- **data_tabs/**: Bản sao lưu 55 file CSV dữ liệu thô kết xuất từ 7 Google Spreadsheets ban đầu.

---

## 3. Các Trụ cột Kiến trúc Đột phá
1. **Kiến trúc Thực thể 2 Tầng:** Tác phẩm (*Work / Master Title*) cho báo cáo tổng thể cấp điều hành và Ấn bản (*Edition / Lot*) cho quản lý mã vạch ISBN, giá vốn, giá bìa tái bản.
2. **Cấu trúc 3 Kho Vật lý:** Kho 1 (Văn phòng / Tây Hồ - Sách rời), Kho 2 (Quỳnh Mai - Kiện lớn / Nhà in), Kho 3 (Dự phòng / Hội chợ / Kiểm định).
3. **Thao tác Bàn phím Siêu tốc (Keyboard-First):** Tra cứu nhanh bằng 4 số cuối ISBN (isbn_last4) hoặc gõ tắt 2-3 ký tự đầu tên sách (short_code), điều hướng bằng phím mũi tên và Enter trong vòng **2-3 giây**. Hỗ trợ cả súng quét mã vạch USB.
4. **Sổ cái Kho Bất biến (Append-Only Inventory Ledger):** Nghiêm cấm sửa (UPDATE) hoặc xóa (DELETE) lịch sử kho. Bảo đảm 6 bất biến hệ thống, triệt tiêu race condition và không bao giờ bán âm kho.
5. **Đám mây Không Chi phí (100% Free-tier Forever):** Chạy trên PostgreSQL Managed Cloud (Supabase/Neon), Vercel Serverless, và mạng lưới bảo vệ Cloudflare SSL/WAF với chi phí vận hành 0 VNĐ.
6. **Báo cáo BI Đa chiều Chuẩn Quốc tế:** Trực quan hóa dữ liệu theo phong cách Tableau/PowerBI, phân tích đa chiều theo Kênh, Chiết khấu, Mùa vụ và Dòng sách.

---

## 4. Bản quyền & Phân phối
Dự án được bảo hộ và phát triển nội bộ cho **formapubli**.
