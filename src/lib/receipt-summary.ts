/**
 * Số liệu hiển thị trên màn "Bán Hàng Thành Công" và trên phiếu in - gom vào
 * MỘT chỗ để hai bên không thể hiển thị khác nhau.
 *
 * HAI LỖI ĐÃ ĐO TRÊN PRODUCTION (đơn hội chợ 02/10/2026), cùng một nguyên nhân:
 * màn hình tự tính lại thứ mà server đã biết, bằng bảng tra cứu cứng có từ lâu
 * và đã lỗi thời.
 *
 * 1. TÊN KHO SAI. Bản cứ trong `PosCheckoutTerminal` map 2 mã kho văn phòng rồi
 *    `else 'Kho Quỳnh Mai'`. Nhưng kho hội chợ dùng mã riêng - production có
 *    `wh-kho-hoi-cho-ho-guom` và `wh-kho-dh-ha-noi-thang-10-2026` - nên MỌI đơn
 *    hội chợ in ra tên kho của kho khác. Sai tên kho trên phiếu là sai chỗ giao
 *    hàng. Nay tra tên trong danh sách kho POS đã tải; không tra được thì hiện
 *    MÃ kho, tuyệt đối không bịa tên.
 *
 * 2. TỔNG SỐ SÁCH SAI. `totalQuantity` cộng MỌI dòng hàng, kể cả dòng quà HÀNG
 *    HÓA (bookmark, móc khoá - dòng `edition_id = NULL`). Đo thật: ORD261002000V
 *    bán 1 cuốn + tặng 1 bookmark mà phiếu ghi "2 cuốn" - thu ngân tưởng hệ
 *    thống tự thêm sách vào đơn. `bookQuantity` do server tính (dòng có
 *    `edition_id`) là con số đúng; thiếu thì lùi về `totalQuantity` cho đơn
 *    offline/phiên cũ.
 */

export interface ReceiptWarehouseLike {
  id: string;
  name?: string | null;
}

export interface ReceiptOrderLike {
  warehouseId?: string | null;
  warehouseName?: string | null;
  totalQuantity?: number | null;
  /** Số CUỐN SÁCH (dòng có `edition_id`). Server tính, xem `bookQuantityOf`. */
  bookQuantity?: number | null;
}

export function resolveReceiptSummary(
  order: ReceiptOrderLike | null | undefined,
  warehouses: readonly ReceiptWarehouseLike[] = []
): { warehouseName: string; bookQuantity: number } {
  const whId = String(order?.warehouseId || '').trim();
  const found = warehouses.find((w) => w.id === whId)?.name?.trim();
  return {
    warehouseName: String(order?.warehouseName || '').trim() || found || whId || 'Kho không rõ',
    bookQuantity: Number(order?.bookQuantity ?? order?.totalQuantity) || 0,
  };
}