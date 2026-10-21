# Gộp tab Dự án xuất bản + Hợp đồng (2026-10-21)

## Thiết kế đã chọn

**Một tab duy nhất "Dự án & Hợp đồng"** (id `duan-hopdong`), đặt thấp trong menu
(sau Nhân sự, trước Báo cáo). Bên trong có 2 chế độ xem chuyển bằng nút:

1. **Dự án xuất bản** (mặc định): giữ nguyên `PublishingProjectsView` - danh sách
   dự án + timeline 5 giai đoạn. ĐIỂM MỚI: mỗi giai đoạn có hàng liên kết hợp đồng:
   - Đã gắn HĐ: hiện số HĐ + nút "Xem HĐ" (nhảy sang tab Hợp đồng, tự lọc đúng
     số HĐ đó) + nút "Gỡ" (chỉ Owner/Manager).
   - Chưa gắn: nút "+ Gắn hợp đồng" mở modal chọn từ danh sách HĐ có sẵn trong
     hệ thống (có ô tìm kiếm). Gắn qua `PATCH /api/publishing-projects/[id]/stages/[stage]`
     với `contractId` - API này đã có sẵn từ trước, trước đây chưa có UI nào gọi.
2. **Hợp đồng**: giữ nguyên `ContractsTab` đầy đủ (danh sách, soạn, mẫu, AI,
   thông tin công ty, cả nút chuyển "Dự Án" nội bộ cho ContractProjects).

## Vì sao thiết kế này

- Dự án là khung chứa tự nhiên: mỗi đầu sách là 1 dự án, mỗi giai đoạn sản xuất
  sinh đúng 1 hợp đồng - đúng quy định "mỗi giai đoạn 1 HĐ + 1 biên bản nghiệm thu".
- Không mất chức năng nào: mọi nút của 2 tab cũ còn nguyên, chỉ đổi vị trí.
- Trường `contractId` đã có sẵn trong bảng `publishing_stages` từ trước nhưng
  chưa UI nào dùng - nay được khai thác thay vì thêm cột/bảng mới.
- Tab id cũ (`projects`, `contracts`) không còn trong `allowedNavItems` nên
  `effectiveTab` tự rơi về tab đầu tiên - không vỡ, không crash. Không có URL
  route riêng cho tab (SPA chuyển tab bằng state) nên không có bookmark nào vỡ.

## File thay đổi (commit db96064, nhánh dev)

- Mới: `src/components/duan-hopdong/DuAnHopDongTab.tsx`
- Sửa: `PublishingProjectsView.tsx` (thêm contractId, modal gắn HĐ),
  `ContractsTab.tsx` (thêm prop `presetSearch`),
  `AppSidebar.tsx` (1 mục nav, vị trí thấp),
  `MasterAppShell.tsx` (nhãn + nhánh render),
  `src/lib/roles.ts` (OWNER/MANAGER dùng id mới)
- Xóa: `src/components/projects/ProjectsView.tsx` (wrapper chết)

## Kiểm chứng trên dev

- Build sạch (tsc trong build đạt), pm2 dev online, bundle có `duan-hopdong`.
- API: gắn HĐ vào giai đoạn BIEN_DICH thành công, đọc lại thấy contractId,
  gỡ thành công (về null). Dữ liệu test đã dọn sạch.
- Các endpoint chính (invoices, orders, warehouses, shopee/status,
  contracts/documents, publishing-projects) đều 200.
- Smoke-check qua đường public bị 429 do rate-limit từ các lần đăng nhập test
  liên tiếp của chính đợt kiểm thử (không phải regression); kiểm qua localhost
  đều đạt.
- Chưa kiểm bằng mắt trên trình duyệt thật (không có live browser ở tầng này).
