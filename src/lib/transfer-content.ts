export interface TransferContentInput {
  /** Mẫu tuỳ biến theo kho (warehouses.qr_transfer_template). Rỗng = chưa cấu hình. */
  template: string | null;
  /** Mã đơn đầy đủ. Vào {MA} khi kho có mẫu; vào mẫu mặc định thì đi qua compactOrderCode. */
  orderCode: string;
  itemCount: number;
  warehouseName: string;
  warehouseCode: string;
  /** Người dùng đã gõ tay trong ô nội dung → giữ nguyên, không áp mẫu. */
  manualContent: string | null;
}

/**
 * Kho có cấu hình mẫu nội dung chuyển khoản chưa.
 *
 * Tách ra để POS và màn Quản Lý Kho cùng hỏi một chỗ — trước đây UI tự đoán
 * bằng `template ? ... : ...` ở hai file, dễ lệch nhau.
 */
export function hasTransferTemplate(template: string | null | undefined): boolean {
  return typeof template === 'string' && template.trim().length > 0;
}

/** VietQR chỉ mang tối đa 23 ký tự trong `add_info` (xem normalizeVietqrContent). */
export const VIETQR_CONTENT_MAX = 23;

/**
 * Mẫu nội dung DỰ PHÒNG khi kho chưa cấu hình mẫu riêng.
 *
 * VÌ SAO MẮC ĐỊNH NÀY TỒN TẠI: nội dung chuyển khoản là thứ người ta đối chiếu
 * với sao kê. Trước đây kho trắng mẫu ⇒ nội dung = mã đơn trần 29 ký tự, bị
 * `normalizeVietqrContent` cắt còn 23 ⇒ mất 3 ký tự cuối, và thu ngân không
 * thấy số lượng. Nay nhường chỗ cho số lượng bằng CÁCH RÚT GỌN mã đơn trong QR
 * (mã đơn đầy đủ vẫn nằm nguyên trong DB và mọi nơi khác — nó là khoá đối soát).
 *
 * VÌ SAO NGẮN THẾ: chuỗi này phải ổn định (mỗi đơn một nội dung, không đổi theo
 * thời gian) và ngắn, để sau `normalizeVietqrContent` (bỏ dấu, bỏ ký tự lạ, cắt
 * còn 23) phần định danh mã đơn KHÔNG bị cắt. Không dùng chữ có dấu/ký tự lạ vì
 * chúng bị bỏ mà vẫn ăn chỗ.
 *
 * Mẫu đã cấu hình cho kho LUÔN thắng mẫu này — đây chỉ là dự phòng.
 */
export const DEFAULT_TRANSFER_TEMPLATE = '{SL}cuon {MA}';

/** FNV-1a 32bit → 8 hex. Chỉ dùng khi mã đơn không đúng shape, để vẫn ra tham chiếu ổn định. */
function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * RÚT GỌN mã đơn để nhét vừa ô `add_info` 23 ký tự của VietQR.
 *
 * VÌ SAO KHÁC MÃ ĐƠN TRONG DB: VietQR cắt `add_info` còn 23 ký tự, mà mã đơn thật
 * (`ORD-20260928-<16 hex>`) dài 29 ⇒ phần cuối bị mất và số lượng không còn chỗ.
 * Nên bản ĐI VÀO QR dùng tham chiếu ngắn. MÃ ĐƠN ĐẦY ĐỦ TRONG DB KHÔNG ĐỔI — nó
 * mới là khoá đối soát sao kê.
 *
 * Thuần, không I/O, không `Math.random`: cùng mã đơn ⇒ luôn ra cùng tham chiếu,
 * vì sao kê về sau vài ngày mới tới.
 *
 * Shape chuẩn `ORD-YYYYMMDD-<hex>`: lấy 8 hex cuối (phần ngẫu nhiên nhất, ~4.3 tỷ
 * giá trị). Shape lạ ⇒ hash toàn bộ chuỗi, vẫn 8 hex, KHÔNG ném lỗi.
 */
export function compactOrderCode(orderCode: string): string {
  const raw = String(orderCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tail = /^ORD[0-9A-Z]{8,}$/.test(raw) ? raw.slice(-8) : fnv1aHex(raw);
  return `ORD${tail}`;
}

export function resolveTransferContent(input: TransferContentInput): string {
  const { template, orderCode, itemCount, warehouseName, warehouseCode, manualContent } = input;
  if (manualContent !== null) return manualContent;
  const configured = hasTransferTemplate(template);
  // Mẫu mặc định dùng mã đơn RÚT GỌN để số lượng còn chỗ; mẫu của kho giữ mã
  // đơn đầy đủ như cũ (quản lý tự chọn, preview báo sẽ bị cắt chỗ nào).
  const tpl = configured ? (template as string) : DEFAULT_TRANSFER_TEMPLATE;
  const ma = configured ? orderCode || '' : compactOrderCode(orderCode);
  return tpl
    .replace(/\{SL\}/g, String(itemCount || 0))
    .replace(/\{MA\}/g, ma)
    .replace(/\{KHO\}/g, warehouseName || '')
    .replace(/\{KH\}/g, warehouseCode || '');
}
