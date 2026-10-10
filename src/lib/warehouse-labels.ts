/**
 * Nhãn kho dùng chung - MỘT chỗ duy nhất quyết định chữ hiện ra.
 *
 * Quy ước (chủ chốt, trị dứt điểm việc gọi nhầm "kho" cho đại lý ký gửi):
 * địa chỉ ký gửi đối tác (warehouseType CONSIGNMENT) KHÔNG BAO GIỜ là "kho",
 * luôn hiện "Đại lý X" trên mọi màn hình.
 */

/** Nhãn loại kho (tiếng Việt có dấu). Loại lạ → 'Kho'. */
export const WAREHOUSE_TYPE_LABEL: Record<string, string> = {
  PHYSICAL_MAIN: 'Kho',
  FAIR_EVENT: 'Hội chợ',
  CONSIGNMENT: 'Đại lý',
  IN_TRANSIT: 'Đang chuyển',
};

export function warehouseTypeLabel(type: string | null | undefined): string {
  return WAREHOUSE_TYPE_LABEL[`${type || ''}`] ?? 'Kho';
}

export interface NamedWarehouse {
  name: string;
  warehouseType?: string | null;
}

/**
 * Tên hiển thị: kho ký gửi còn sót tên cũ "Kho Ký gửi [-] X" tự thành
 * "Đại lý X"; đã đúng thì giữ nguyên. Kho thật giữ nguyên tên.
 */
export function displayWarehouseName(wh: NamedWarehouse): string {
  const name = `${wh?.name || ''}`;
  if (`${wh?.warehouseType || ''}` !== 'CONSIGNMENT') return name;
  const trimmed = name.trim();
  if (/^đại lý\s+/i.test(trimmed)) return name;
  // Bóc "Kho" rồi bóc "Ký gửi" (+ gạch nối): "Kho Ký gửi - X" → "X".
  const rest = trimmed
    .replace(/^kho\s+/i, '')
    .replace(/^k[ýy]\s*g[ửửi]i?\s*-?\s*/i, '')
    .trim();
  return `Đại lý ${rest || trimmed}`;
}
