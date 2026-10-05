# Tab Doanh Số: sắp xếp + mở rộng + xuất CSV mọi bảng

Ngày: 2026-10-05. Nguồn: yêu cầu chủ doanh nghiệp (tab Doanh Số đông số liệu,
khung cố định, thiếu sắp xếp, thiếu xuất file ở bảng quà).

## 1. Hiện trạng (đã đọc code)

| Bảng | Xuất CSV | Sắp xếp | Khung | Xem nhiều |
|---|---|---|---|---|
| Sổ đơn (SalesLedgerView) | có | không | max-h-480 cố định | 20/50/100/toàn bộ |
| Sách bán chạy (TopEditionsPanel) | có | không | max-h-420 cố định | Top 10/20/50 |
| Nguồn doanh thu (RevenueAnalyticsPanel) | có | cố định theo tiền | tự nhiên | toàn bộ |
| Quà tặng (GiftReportPanel) | KHÔNG | không | tự nhiên | toàn bộ |

3 bản xuất CSV viết riêng (đã lệch nhau). Không lib bảng nào trong repo.

## 2. Quyết định đã chốt với chủ

- Xuất: CSV + BOM + watermark (đã có mẫu, không thêm dep .xlsx).
- Mở rộng: nút "Mở rộng" → fullscreen overlay, Esc/bấm rìa để thu (không tự cao dần).
- Sắp xếp: client-side (dữ liệu đã tải hết ở client, server sort là thừa).

## 3. Thiết kế

### 3.1. Hạ tầng dùng chung mới (2 file)

- `src/lib/table-ux.tsx`: `useSortable<T>(rows, def)` (key, dir, toggle, sorted
  ổn định) + `<SortableTh>` (nút ▲▼, `aria-sort`, title rõ).
  Comparators: số, tiền, ngày ISO, chữ tiếng Việt (`localeCompare('vi')`).
  Lần bấm đầu theo mặc định từng cột (tiền/thời gian: cao→thấp; chữ: A→Z).
- `src/components/sales/TableExpandOverlay.tsx`: bọc vùng cuộn bảng; nút
  "Mở rộng" (icon Maximize2) → portal ra body `fixed inset-0 z-[70]`, nền bấm
  ra thu lại, Esc thu lại, khóa cuộn nền. Tái dùng mẫu PortalToBody +
  useModalFocusTrap đã có. Một DOM duy nhất (portal di chuyển nút, không
  render 2 bản).

### 3.2. Từng bảng

1. **Sổ đơn**: sort Thời gian / Thực thu / Chiết khấu (theo `discountAmount`
   thô, độc lập chế độ hiển thị %/VNĐ). Mặc định thời gian mới→cũ (giữ hành vi
   API hiện tại). + overlay. Xuất giữ nguyên.
2. **Sách bán chạy**: thêm option Top 100 (= trần API, ghi rõ "tối đa 100";
   toàn bộ thật sự cần đổi API — ngoài phạm vi). Sort SL bán / Số đơn /
   Doanh thu trên dòng đã tải (ghi chú "xếp trong N dòng đã tải"). + overlay.
3. **Nguồn doanh thu**: + overlay. Không thêm sort (thứ tự nhóm Bán lẻ/Đại lý/
   Online/Tặng là ngữ nghĩa cố định). Xuất giữ nguyên.
4. **Quà tặng**: + xuất CSV (headers: Sản phẩm, Dòng quà, Tổng cuốn; watermark
   như 3 bảng kia) + sort Tổng cuốn + overlay.
5. CSV helper dùng chung cho bảng quà: `downloadWatermarkedCsv()` trong
   `src/lib/sales-view.ts` (kế `buildSalesCsv`). 3 bảng cũ KHÔNG refactor —
   đang chạy đúng, đụng vào là rủi ro không công.

### 3.3. Ngoài phạm vi (cố ý không làm)

- Phân trang/sort phía server, .xlsx thật, in ấn, đổi trần top=100 của API.
- Sửa logic số liệu (quà trong số cuốn — đã báo riêng, chờ chốt).

## 4. Kiểm thử

- Suite mới `test-sales-table-ux.ts` (regex nguồn, theo lệ repo): SortableTh +
  aria-sort ở 3 bảng, nút Mở rộng ở 4 bảng, xuất CSV ở bảng quà, option Top 100.
- Chạy lại: tsc + suite sales hiện có (doanhso, top-editions qua analytics).
- Tay: desktop + mobile (overlay toàn màn, bảng cuộn ngang trong overlay).

## 5. Rủi ro

- Overlay + dropdown/sticky thead: thead sticky trong overlay cần `top-0` theo
  khung overlay (portal giữ nguyên class, đã tính).
- Bảng đơn dài (hàng nghìn dòng) sort client: `Array.sort` ~ms, không vấn đề;
  render toàn bộ mới nặng — giữ pageSize như cũ, sort trên `filteredOrders`.
