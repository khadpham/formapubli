export interface TransferContentInput {
  /** Mẫu tuỳ biến theo kho (warehouses.qr_transfer_template). Rỗng = chưa cấu hình. */
  template: string | null;
  /** Mã đơn làm biến {MA} và là nội dung dự phòng khi chưa có mẫu. */
  orderCode: string;
  itemCount: number;
  warehouseName: string;
  warehouseCode: string;
  /** Người dùng đã gõ tay trong ô nội dung → giữ nguyên, không áp mẫu. */
  manualContent: string | null;
}

export function resolveTransferContent(input: TransferContentInput): string {
  const { template, orderCode, itemCount, warehouseName, warehouseCode, manualContent } = input;
  if (manualContent !== null) return manualContent;
  if (!template) return orderCode;
  return template
    .replace(/\{SL\}/g, String(itemCount || 0))
    .replace(/\{MA\}/g, orderCode || '')
    .replace(/\{KHO\}/g, warehouseName || '')
    .replace(/\{KH\}/g, warehouseCode || '');
}
