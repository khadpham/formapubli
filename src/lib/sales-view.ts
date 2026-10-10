/**
 * Helper THUẦN dùng chung cho màn Doanh Số (Sổ Kép + các panel bên dưới).
 *
 * VÌ SAO Tách ra đây:
 *   Trước đây mỗi panel tự viết một map nhãn kênh, tự cắt chuỗi giờ UTC, tự
 *   tính "30 ngày" cho nút Tháng này. Ba file ⇒ ba cách hiện khác nhau trên
 *   cùng một bảng số, và không có chỗ nào để test canh. Đây là MỘT nơi, và là
 *   contract dùng lại cho Task 5/6.
 *
 * Ràng buộc múi giờ: ngày nghiệp vụ là khái niệm kế toán của Việt Nam. Cloudflare
 * Workers chạy UTC còn máy dev là GMT+7, nên CÙNG một đoạn code sẽ trả về ngày
 * khác nhau giữa production và máy dev trong khung 00:00–07:00. Vì vậy mọi ngày
 * ở đây đều đi qua `Intl.DateTimeFormat` với `timeZone: 'Asia/Ho_Chi_Minh'`
 * (giống `businessDateOf` của order.service) - KHÔNG tự cộng tay 7 tiếng, vì
 * cộng tay thì múi giờ máy của người đọc file lại lọt vào kết quả.
 *
 * File này KHÔNG import `@/services/*`: panel là client component, mà
 * `order.service` kéo theo drizzle + DB vào bundle trình duyệt.
 */
import { appendExportWatermark } from './export-hash';

const VN_TZ = 'Asia/Ho_Chi_Minh';

/** Ngày nghiệp vụ VN của một thời điểm, dạng 'YYYY-MM-DD'. */
function vnDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(instant);
}

/**
 * Lùi/trượt một chuỗi ngày 'YYYY-MM-DD' đúng k số ngày LỊCH, không tính giờ.
 * Dùng `Date.UTC` + `toISOString` vì ngày trần không có múi giờ: cộng 24 giờ
 * vào một ngày ở vùng có DST sẽ trượt 23/25 giờ. Việt Nam không DST nên kết quả
 * vẫn khớp `businessDateOf`, nhưng cách này không để ai phải nhớ điều đó.
 */
function shiftDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

export type DateRange = { startDate: string; endDate: string };

/**
 * Preset "Tháng này": THÁNG LỊCH Việt Nam, từ ngày 1 tới HÔM NAY (không tính
 * tới cuối tháng tương lai - hôm nay mới là "tới nay").
 *
 * Preset cũ lùi 30 ngày lịch nên báo cáo lấn sang tháng trước; người dùng
 * đối chiếu với két thì lệch mà không có chỗ nào chỉ ra lệch.
 */
export function monthPreset(now: Date): DateRange {
  const today = vnDay(now);
  return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
}

/**
 * "n ngày qua" = ĐÚNG n ngày lịch, tính cả hôm nay (7 ngày = 7, không 8).
 * Preset cũ dùng `now - 7 * 24h` rồi ghép `endDate = hôm nay` ⇒ 8 ngày.
 */
export function lastNDays(n: number, now: Date): DateRange {
  const days = Math.max(1, Math.floor(n) || 1);
  const today = vnDay(now);
  return { startDate: shiftDay(today, -(days - 1)), endDate: today };
}

/** Hôm nay theo lịch Việt Nam - 'YYYY-MM-DD'. */
export function vnToday(now: Date = new Date()): string {
  return vnDay(now);
}

/**
 * Nhãn tiếng Việt CÓ DẤU cho kênh bán. Một chỗ duy nhất cho cả màn Doanh Số,
 * thay cho map rời rạc mỗi file.
 *
 * Kênh lạ (enum mới do server thêm sau này) trả nhãn tiếng Việt chung chứ
 * KHÔNG trả thẳng chuỗi enum - enum là tên kỹ thuật, hiện ra cho khách hàng
 * đọc sổ thì không ai hiểu.
 */
export function channelLabel(channel: string | null | undefined): string {
  const key = (channel || '').trim();
  if (!key) return '-';
  const KNOWN: Record<string, string> = {
    FAIR_EVENT: 'Tại quầy hội chợ',
    RETAIL_OFFICE: 'Tại quầy',
    RETAIL_ONLINE_SOCIAL: 'Facebook Chat',
    RETAIL_ONLINE_WEB: 'Website',
    WHOLESALE_PARTNER: 'Bán sỉ',
    ONLINE: 'Online',
    SHOPEE: 'Shopee',
    SPONSORSHIP: 'Tặng',
  };
  return KNOWN[key] || 'Kênh khác';
}

/**
 * Giờ Việt Nam dạng 'HH:mm DD/MM' - cột "Thời Gian" của sổ và CSV.
 *
 * Preset cũ cắt thẳng chuỗi ISO (`createdAt.slice(0,16)`) tức giờ UTC: đơn
 * 07:30 VN hiện thành 00:30, và đơn sau 17:00 VN hiện sang hôm kế. Người dùng
 * so với giờ thực tế trên hoá đơn thấy lệch 7 tiếng mà không có chỗ nào giải
 * thích. `'-'` khi thiếu dữ liệu, không trả 'Invalid Date'.
 *
 * `hourCycle: 'h23'` bắt buộc: `hour12: false` ở ICU cho ra '24' cho nửa đêm.
 */
export function vnHour(iso: string | null | undefined): string {
  if (!iso) return '-';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('day')}/${part('month')}`;
}

/** Nhãn sổ của đơn (tiếng Việt, không lộ enum `fiscalScope`). */
export function fiscalScopeLabel(scope: string | null | undefined): string {
  return scope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Sổ Quản trị Nội bộ';
}

/** Nhãn phương thức thanh toán (tiếng Việt, không lộ enum `paymentMethod`). */
export function paymentLabel(method: string | null | undefined): string {
  const KNOWN: Record<string, string> = {
    CASH: 'Tiền mặt',
    BANK_TRANSFER: 'Chuyển khoản',
    QR_CODE: 'QR',
  };
  return KNOWN[(method || '').trim()] || '-';
}

/** Ô CSV: bọc nháy kép mọi field chứa phẩy/nháy kép, và chặn formula injection. */
function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : `${value}`;
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

const SALES_CSV_HEADERS = [
  'Mã đơn',
  'Kho',
  'Kênh',
  'Khách hàng',
  'Thanh toán',
  'Tiền hàng',
  'Chiết khấu (VND)',
  'Thực thu',
  'Sổ',
  'Số HĐ VAT',
  'Giờ VN',
];

/** Dòng dữ liệu cho `buildSalesCsv` - mỗi panel tự map từ nguồn của nó. */
export interface SalesCsvRow {
  orderCode?: string | null;
  warehouseName?: string | null;
  channel?: string | null;
  customerName?: string | null;
  paymentMethod?: string | null;
  subtotal?: number | null;
  finalAmount?: number | null;
  discountAmount?: number | null;
  fiscalScope?: string | null;
  vatInvoiceCode?: string | null;
  createdAt?: string | null;
  [k: string]: unknown;
}

export interface SalesCsvOptions {
  actorRole?: string;
  reportName?: string;
  fiscalScope?: string;
}

/**
 * CSV bán hàng có dấu + watermark kiểm toàn vẹn, dùng chung cho Sổ Kép và các
 * panel Task 5/6.
 *
 * `actorId` PHẢI là mã nhân viên thật (đọc từ `/api/auth/me`). Trước đây Sổ Kép
 * ghi cứng `'cashier-pos'` ⇒ mọi lượt xuất đều ký tên một người không tồn tại,
 * tức vô hiệu hoá toàn bộ giá trị của watermark trong việc truy vết.
 */
export function buildSalesCsv(
  rows: Array<Record<string, unknown>>,
  actorId: string,
  opts: SalesCsvOptions = {}
): string {
  const body = rows.map((r) => {
    const row = r as SalesCsvRow;
    return [
      csvCell(row.orderCode ?? ''),
      csvCell(row.warehouseName || '-'),
      csvCell(channelLabel(row.channel ?? null)),
      csvCell(row.customerName || '-'),
      csvCell(paymentLabel(row.paymentMethod ?? null)),
      Number(row.subtotal ?? 0),
      Number(row.discountAmount ?? 0),
      Number(row.finalAmount ?? 0),
      csvCell(fiscalScopeLabel(row.fiscalScope ?? null)),
      csvCell(row.vatInvoiceCode ?? ''),
      csvCell(vnHour(row.createdAt ?? null)),
    ].join(',');
  });

  const baseCsv = [SALES_CSV_HEADERS.join(','), ...body].join('\r\n');
  return appendExportWatermark(baseCsv, rows, {
    actorId,
    actorRole: opts.actorRole || '-',
    reportName: opts.reportName || 'BÁO CÁO DOANH SỐ BÁN SÁCH (FORMApubli)',
    fiscalScope: opts.fiscalScope,
  });
}

export interface WatermarkedCsvInput {
  filename: string;
  headers: string[];
  /** Dòng đã escape/quoting xong (dùng `exportCsvCell` nếu cần). */
  rows: string[][];
  rawObjects: Array<Record<string, unknown>>;
  meta: { actorId: string; actorRole: string; reportName: string; fiscalScope?: string };
}

/** Ô CSV dùng chung (escape + chặn formula injection), cho bảng mới. */
export function exportCsvCell(value: unknown): string {
  return csvCell(value);
}

/**
 * Dựng file CSV watermark thuần túy (không chạm DOM → test được ở node).
 * BOM + Blob + tải về nằm ở `downloadWatermarkedCsv`.
 */
export function buildWatermarkedCsv(input: WatermarkedCsvInput): { filename: string; content: string } {
  const baseCsv = [input.headers.join(','), ...input.rows.map((r) => r.join(','))].join('\r\n');
  const content = appendExportWatermark(baseCsv, input.rawObjects, {
    actorId: input.meta.actorId,
    actorRole: input.meta.actorRole,
    reportName: input.meta.reportName,
    fiscalScope: input.meta.fiscalScope,
  });
  return { filename: input.filename, content };
}

/**
 * Tải file CSV watermark về máy (chặn khi thiếu dữ liệu/actor - đúng mẫu
 * 3 bảng cũ: ký bằng mã bịa thì tệ hơn không có dấu vết).
 */
export function downloadWatermarkedCsv(input: WatermarkedCsvInput): boolean {
  if (input.rows.length === 0) {
    alert('Không có dữ liệu để xuất CSV.');
    return false;
  }
  if (!input.meta.actorId) {
    alert('Chưa đọc được người đăng nhập nên chưa xuất được. Tải lại trang rồi thử lại.');
    return false;
  }
  const { filename, content } = buildWatermarkedCsv(input);
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}
