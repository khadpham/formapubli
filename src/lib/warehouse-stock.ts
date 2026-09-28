/**
 * Một nguồn sự thật cho tồn theo kho. TUYỆT ĐỐI không fallback `totalStock`:
 * đó là tổng mọi kho, dùng làm tồn của một kho sẽ ra số sai ở mọi kho hội chợ.
 */
export function stockOfWarehouse(
  book:
    | {
        stockByWarehouse?: Record<string, number>;
        stockAuCo?: number;
        stockQuynhMai?: number;
        stockDuPhong?: number;
      }
    | null
    | undefined,
  warehouseId: string
): number {
  if (!book || !warehouseId) return 0;
  const raw =
    book.stockByWarehouse?.[warehouseId] ??
    (warehouseId === 'wh-au-co'
      ? book.stockAuCo
      : warehouseId === 'wh-quynh-mai'
      ? book.stockQuynhMai
      : warehouseId === 'wh-du-phong'
      ? book.stockDuPhong
      : undefined);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}
