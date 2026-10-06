'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Receipt,
  Banknote,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Printer,
  Calendar,
  Building2,
  Package,
  Boxes,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  X,
  Lock,
  Layers,
  Coins,
  ArrowUp,
  ArrowDown,
  Flame,
  TrendingUp,
} from 'lucide-react';
import { parseDbTimestamp } from '@/lib/db-timestamp';
import type { UserRole } from '@/lib/roles';
import { HourlyOrdersChart } from './HourlyOrdersChart';
import { ProductFlowDrawer } from '@/components/sales/ProductFlowDrawer';
import { CashboxAuditCountModal } from './CashboxAuditCountModal';
import {
  getStockAlertBadge,
  getStockRowHighlightClass,
  STOCK_THRESHOLD_WARNING,
} from '@/lib/stock-highlight';
import { sortByStock, filterLowStock, sortLabel } from '@/lib/stocktake-order';

interface DailyFairSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouseId: string;
  warehouseName?: string;
  currentRole?: string;
}

// Mọi cột thời gian trong DB là UTC; giờ người đọc là giờ Việt Nam (UTC+7, không
// DST). `parseDbTimestamp` đọc được CẢ HAI họ timestamp đang cùng tồn tại (ISO
// 'T' do app ghi và ' ' do SQLite CURRENT_TIMESTAMP ghi) — `new Date('… 09:00:00')`
// không có múi giờ nên đọc thẳng là sẽ lệch 7 tiếng.
const vnHmFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function vnHm(value: string | Date | null | undefined): string {
  if (value == null) return '';
  const d = parseDbTimestamp(value);
  return d && !Number.isNaN(d.getTime()) ? vnHmFmt.format(d) : '';
}

/** Mốc thời gian đã chuẩn hoá về Date (hỗ trợ cả số epoch). */
function asDate(value: string | Date | number | null | undefined): Date | null {
  const d = typeof value === 'number' ? new Date(value) : parseDbTimestamp(value);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Giờ Việt Nam (0–23) của một mốc thời gian trong DB. */
function vnHourOf(value: string | Date | number | null | undefined): number | null {
  const d = asDate(value);
  return d ? new Date(d.getTime() + 7 * 3600 * 1000).getUTCHours() : null;
}

/** Ngày nghiệp vụ Việt Nam 'YYYY-MM-DD' của một mốc thời gian. */
function vnDayOf(value: string | Date | number | null | undefined): string | null {
  const d = asDate(value);
  return d ? new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10) : null;
}

/** Giờ mở ca mặc định khi ngày đó không có dữ liệu hoạt động nào. */
const HOUR_DEFAULT_START = 8;
/** Giờ chốt ca quy ước khi in ngày đã qua — không cắt trước giờ này. */
const HOUR_PAST_END = 21;

/**
 * KHUNG GIỜ ĐỘNG của dải giờ: `[start, end]` là khoảng giờ có việc thật, tính từ
 * ca mở/đóng và giờ có đơn. In cứng 24 cột thì một quầy mở 9h đóng 18h ra 15 cột
 * rỗng — cột rỗng mà lại không vẽ được (xem chú thích dải giờ SVG trong bản in).
 *
 * Mọi mốc thời gian đi qua `parseDbTimestamp` + 7h, KHÔNG cắt chuỗi và KHÔNG dùng
 * giờ máy: DB có HAI họ timestamp cùng tồn tại, cắt chuỗi là ra giờ UTC ⇒ lệch 7
 * tiếng ⇒ dải in lệch hẳn khung giờ làm việc.
 *
 * - Hôm nay: kết thúc ở max(giờ hiện tại, giờ có việc cuối) — giờ hiện tại là mốc
 *   dưới, nên dải không bao giờ cắt mất giờ đang bán.
 * - Ngày đã qua: kéo tới 21h, giờ đóng ca không phải mốc chặn (quầy đóng ca sớm
 *   vẫn phải in tới giờ chốt quy ước).
 * - `end > start` luôn: khung rỗng thì dải in không có cột nào để đọc.
 */
export function hourWindow(input: {
  sessions?: ({ openedAt?: string | Date | null; closedAt?: string | Date | null } | null)[] | null;
  hourly?: ({ hour: number; orders?: number | null } | null)[] | null;
  reportDate?: string | null;
  now?: string | Date | number | null;
} = {}): { start: number; end: number } {
  const rows = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const nowValue = input.now ?? new Date();
  const hours = (v: (number | null)[]) => v.filter((h): h is number => h != null && Number.isFinite(h));

  const busy = rows<{ hour: number; orders?: number | null }>(input.hourly)
    .filter((h) => Number(h?.orders || 0) > 0)
    .map((h) => Number(h?.hour))
    .filter((h) => Number.isFinite(h));
  const opened = hours(rows<{ openedAt?: string | Date | null }>(input.sessions).map((s) => vnHourOf(s?.openedAt)));
  const closed = hours(rows<{ closedAt?: string | Date | null }>(input.sessions).map((s) => vnHourOf(s?.closedAt)));

  const firstActivity = [...opened, ...busy].length ? Math.min(...opened, ...busy) : null;
  const lastActivity = [...closed, ...busy].length ? Math.max(...closed, ...busy) : null;
  // Không có hoạt động nào thì lùi về 8h — nhưng KHÔNG cắt mất hoạt động sớm hơn 8h.
  const start = firstActivity ?? HOUR_DEFAULT_START;

  const nowHour = vnHourOf(nowValue) ?? HOUR_DEFAULT_START;
  const reportDay = input.reportDate || vnDayOf(nowValue);
  const isToday = reportDay != null && vnDayOf(nowValue) === reportDay;
  let end: number;
  if (isToday) end = lastActivity == null ? nowHour : Math.max(nowHour, lastActivity);
  else end = lastActivity == null ? HOUR_PAST_END : Math.max(HOUR_PAST_END, lastActivity);
  if (end <= start) end = Math.min(24, start + 1);
  return { start, end };
}

// Hình học dải giờ trên bản in: viewBox 720×46 — 720 là bề rộng vùng in A4 sau
// lề (190mm @ 96dpi ≈ 718px), nên khi `w-full` co giãn tỉ lệ gần 1:1 và CHỮ
// giữ đúng kích thước thật. Trước đây viewBox chỉ 240×46 bị giãn 3 lần: cột
// thấp vẹo, nhãn giờ nằm cách xa nhau, dải giờ chiếm 137px chiều cao.
// Nét VÀ CHỮ đều là nội dung SVG nên in mặc định (khác màu nền CSS).
const BAND_W = 720;
const BAND_H = 68;
const BAND_BASE_Y = 48;
const BAND_PLOT_H = 30;

/**
 * Dải cột theo NGÀY cho bản in kỳ (SVG thuần rect/text — in không mất hình).
 * Tái dùng hình học BAND của dải giờ; trục X là ngày DD/MM, đông ngày thì
 * thưa nhãn và chỉ ghi số ở cột đỉnh.
 */
function DayBand({
  days,
  value,
  color,
  peakColor,
  caption,
  ariaLabel,
  formatVal,
}: {
  days: Array<{ date: string; orders: number; sales: number }>;
  value: 'orders' | 'sales';
  color: string;
  peakColor: string;
  caption: string;
  ariaLabel: string;
  formatVal: (n: number) => string;
}) {
  const n = Math.max(1, days.length);
  const slot = BAND_W / n;
  const max = Math.max(1, ...days.map((d) => Number(d[value] || 0)));
  const barH = (v: number) => (v > 0 ? Math.max(6, Math.round((v / max) * BAND_PLOT_H)) : 2);
  const peakIdx = days.reduce((best, d, i) => (Number(d[value] || 0) > Number(days[best]?.[value] || 0) ? i : best), 0);
  const labelStep = Math.max(1, Math.ceil(n / 12));
  const showValues = n <= 31;
  const labelOf = (iso: string) => {
    const s = String(iso || '');
    return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s;
  };
  return (
    <div className="mt-2.5">
      <p className="font-bold uppercase text-slate-800 text-[12px] mb-1">{caption}</p>
      <svg viewBox={`0 0 ${BAND_W} ${BAND_H}`} className="w-full h-auto mt-1" fontFamily="monospace" role="img" aria-label={ariaLabel}>
        <line x1="0" y1={BAND_BASE_Y} x2={BAND_W} y2={BAND_BASE_Y} stroke="#cbd5e1" strokeWidth="1" />
        {days.map((d, i) => {
          const v = Number(d[value] || 0);
          const bh = barH(v);
          const x = (i * slot + 4).toFixed(2);
          const wRect = Math.max(4, slot - 8).toFixed(2);
          return (
            <rect
              key={d.date}
              x={x}
              y={BAND_BASE_Y - bh}
              width={wRect}
              height={bh}
              rx={v > 0 ? 3 : 1}
              fill={v > 0 ? color : '#cbd5e1'}
            />
          );
        })}
        {days.map((d, i) => {
          const v = Number(d[value] || 0);
          if (v <= 0) return null;
          if (!showValues && i !== peakIdx) return null;
          const bh = barH(v);
          const isPeak = i === peakIdx;
          return (
            <text
              key={`val-${d.date}`}
              x={(i * slot + slot / 2).toFixed(2)}
              y={BAND_BASE_Y - bh - 4}
              textAnchor="middle"
              fontSize={isPeak ? '10.5' : '9.5'}
              fontWeight={isPeak ? '900' : 'bold'}
              fill={isPeak ? peakColor : '#334155'}
            >
              {formatVal(v)}
            </text>
          );
        })}
        {days.map((d, i) => {
          const isEnd = i === days.length - 1;
          if (i % labelStep !== 0 && i !== 0 && !isEnd) return null;
          return (
            <text
              key={`ngay-${d.date}`}
              x={(i * slot + slot / 2).toFixed(2)}
              y={BAND_BASE_Y + 14}
              textAnchor="middle"
              fontSize="10"
              fontWeight="500"
              fill="#475569"
            >
              {labelOf(d.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** Nhãn tiếng Việt của hình thức thanh toán — cùng cách chia 3 nhóm với service. */
function paymentMethodLabel(method: string | null | undefined): string {
  const key = (method || 'CASH').toUpperCase();
  if (key === 'CASH') return 'Tiền mặt';
  if (key === 'BANK_TRANSFER' || key === 'QR_CODE' || key === 'TRANSFER') return 'Chuyển khoản';
  return 'Thẻ';
}

/**
 * ĐẦU TAB "TIỀN & KÉT" — số chủ đạo + 4 ô phụ + 2 dòng trạng thái.
 *
 * VÌ SAO ĐỨNG ĐẦU: câu hỏi đầu tiên của người mở báo cáo lúc cuối ngày là
 * "hôm nay thu được bao nhiêu, két có khớp không". Trước đây con số này nằm
 * sau thẻ "đơn lớn nhất" và bảng top 10 bán chạy, phải cuộn mới thấy.
 *
 * `pendingQr` TÁCH RIÊNG và ghi rõ "chưa ghi nhận": đó là tiền chuyển khoản
 * còn chờ xác nhận, KHÔNG phải doanh thu. Ai cộng tay vào Thực thu sẽ báo
 * cáo sai. Số này là ảnh chụp lúc mở báo cáo; lát nữa đơn thành COMPLETED
 * sẽ nằm trong Thực thu của lần mở sau — đó là chuyện đúng.
 */
function MoneyHeader({ data, periodLabel }: { data: any; periodLabel?: string }) {
  const f = data?.financials || {};
  const pb = data?.paymentBreakdown || {};
  const rec = data?.cashboxReconciliation || {};
  const pending = pb.pendingQr || { total: 0, ordersCount: 0 };
  const variance = Number(rec.cashVariance || 0);

  const cashState = rec.cashVariancePending
    ? { text: '⏳ Chưa thể đối soát két (còn ca mở hoặc chưa đếm tiền thực tế)', cls: 'text-amber-700' }
    : variance === 0
      ? { text: '✓ Tiền kỳ vọng trong két khớp thực tế', cls: 'text-emerald-700' }
      : { text: `⚠ Lệch két ${variance.toLocaleString('vi-VN')} đ`, cls: 'text-rose-700' };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      {/* `flex-wrap` + `min-w-0`: số tiền `text-3xl` có độ rộng tối thiểu lớn.
          Trước đây hàng này không xuống dòng và div trái không co được, nên chip
          "Đã chốt ca 100%" bị đẩy lệm ra ngoài thẻ, thừa khoảng trống bên phải.
          Nay màn hẹp thì chip xuống hàng dưới thay vì tràn ra ngoài. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-500">Thực thu {periodLabel || `ngày ${data?.reportDate || ''}`}</p>
          <p className="text-2xl sm:text-3xl font-black font-mono text-emerald-700 leading-tight break-words">
            {(f.netSales || 0).toLocaleString('vi-VN')} đ
          </p>
          <p className="text-[11px] text-slate-400">Tiền đã ghi nhận thanh toán</p>
        </div>
        <span
          className={`shrink-0 whitespace-nowrap max-w-full px-2 py-1 rounded-lg text-[11px] font-bold ${
            data?.hasOpenSession ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
          }`}
        >
          {data?.hasOpenSession ? '⚠ Còn ca chưa chốt' : '✓ Đã chốt ca 100%'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <p className="text-[11px] font-bold text-slate-500">Tiền mặt</p>
          <p className="font-mono font-black text-sm text-emerald-700">
            {(pb.cash?.sales || 0).toLocaleString('vi-VN')} đ
          </p>
          <p className="text-[10px] text-slate-400">{pb.cash?.ordersCount || 0} đơn</p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <p className="text-[11px] font-bold text-slate-500">Chuyển khoản</p>
          <p className="font-mono font-black text-sm text-indigo-700">
            {(pb.qrTransfer?.sales || 0).toLocaleString('vi-VN')} đ
          </p>
          <p className="text-[10px] text-slate-400">{pb.qrTransfer?.ordersCount || 0} đơn</p>
        </div>
        {/* Cả hai đơn vị cùng lúc: xem tiền thật và xem tỉ lệ. Trước đây phải
            bấm nút đổi đơn vị, dễ đọc nhầm "5%" thành tổng chiết khấu.
            Ngày không có chiết khấu thì in "0 đ" chứ không phải "−0 đ". */}
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
          <p className="text-[11px] font-bold text-rose-700">Chiết khấu đã cấp</p>
          <p className="font-mono font-black text-sm text-rose-700">
            {Number(f.totalDiscount || 0) > 0 ? '−' : ''}
            {(f.totalDiscount || 0).toLocaleString('vi-VN')} đ
          </p>
          <p className="text-[10px] text-rose-600 font-semibold">
            tương đương {((f.averageDiscountRate || 0) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
          <p className="text-[11px] font-bold text-slate-500">Số đơn</p>
          <p className="font-mono font-black text-sm text-slate-900">{f.totalOrdersCount || 0} đơn</p>
          <p className="text-[10px] text-slate-400">
            TB {(f.averageOrderValue || 0).toLocaleString('vi-VN')} đ
          </p>
        </div>
      </div>

      <p className={`text-xs font-bold ${cashState.cls}`}>
        {cashState.text}
        {!rec.cashVariancePending && (
          <span className="font-mono text-slate-600">
            {' '}
            — {(rec.expectedCashTotal || 0).toLocaleString('vi-VN')} đ
          </span>
        )}
      </p>

      {pending.ordersCount > 0 && (
        <p className="text-xs font-bold text-amber-700">
          ⏳ {pending.ordersCount} đơn chuyển khoản chờ xác nhận —{' '}
          {(pending.total || 0).toLocaleString('vi-VN')} đ (chưa ghi nhận vào Thực thu)
        </p>
      )}
    </div>
  );
}

export function DailyFairSettlementModal({
  isOpen,
  onClose,
  warehouseId,
  warehouseName,
  currentRole = 'ROLE_CASHIER',
}: DailyFairSettlementModalProps) {
  const [data, setData] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Số thứ tự request. Mỗi lần tải tăng 1; response về muộn (số nhỏ hơn số
  // hiện tại) bị bỏ. Trước đây không có: đổi ngày 29 → 28, nếu response 29 về
  // sau nó setData ghi đè ⇒ biên bản mang số liệu ngày 29 nhưng đóng dấu ngày 28.
  const requestSeqRef = useRef(0);
  /** Khóa lần fetch cuối (chế độ+kho+ngày/kỳ): effect bỏ qua khi khóa trùng —
      chống fetch trùng sau "Cả chiến dịch" đã nạp sẵn (thay cờ boolean dễ kẹt). */
  const lastFetchKeyRef = useRef('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentWarehouseId, setCurrentWarehouseId] = useState(warehouseId);
  const [warehouseList, setWarehouseList] = useState<any[]>([]);
  // Ngày mặc định phải là NGÀY NGHIỆP VỤ VIỆT NAM. Trước đây dùng
  // `toISOString().slice(0,10)` là ngày UTC ⇒ từ 00:00 đến 07:00 giờ VN, modal mở
  // báo cáo của HÔM QUA, lệch hẳn với cron chốt ngày theo giờ VN.
  // Tính tại chỗ (không import từ order.service) vì đó là module server nặng —
  // import vào client component sẽ kéo cả tầng db vào bundle. Cùng cách với
  // `vnToday()` ở GET /api/pos/live-monitor.
  const [selectedDate, setSelectedDate] = useState(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  );
  // Chế độ kỳ: 'day' = báo cáo 1 ngày (cũ), 'range' = gom kỳ (mới). Kỳ có thể
  // nhập tay hoặc bấm preset; "Cả chiến dịch" suy từ đơn đầu→cuối của kho.
  // PHÂN QUYỀN (mở 06/10 theo yêu cầu chủ): Kỳ cho Chủ + Quản lý.
  // Thu ngân/Kho/Thuế giữ sự kiện đang diễn ra — nút Kỳ ẩn hẳn như không tồn tại.
  const canViewRange = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const [rangeMode, setRangeMode] = useState<'day' | 'range'>('day');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [activeTab, setActiveTab] = useState<'FINANCIALS' | 'STOCKTAKE' | 'DISCOUNT'>('FINANCIALS');
  // Nhớ tab đang xem: đóng modal rồi mở lại không nên mất chỗ đang đọc.
  // `sessionStorage` (không phải `localStorage`) vì đây là trạng thái của phiên
  // làm việc, không phải tuỳ chọn người dùng muốn giữ lâu dài.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('formapubli.settlement.tab');
      if (saved === 'FINANCIALS' || saved === 'STOCKTAKE' || saved === 'DISCOUNT') setActiveTab(saved);
    } catch { /* trình duyệt chặn storage: bỏ qua, dùng mặc định */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem('formapubli.settlement.tab', activeTab); } catch { /* như trên */ }
  }, [activeTab]);

  // Số đếm thực tế KHÔNG được lưu ở đâu: chỉ nằm trong useState này, không có
  // lệnh nào gửi đi. Chủ sở hữu đã quyết định (2026-09-29): cuối ngày không đếm
  // sách thật, tồn tính bằng "tồn trong kho − số bán" — đúng bằng cột
  // theoreticalStock mà API đã trả sẵn. Nên bỏ ô nhập, chỉ hiện tồn lý thuyết và
  // nói rõ chưa kiểm kê, để không ai tưởng đã đếm.
  const [stocktakeNote, setStocktakeNote] = useState('');
  // Sắp xếp bảng kiểm kê theo tồn lý thuyết. MẶC ĐỊNH 'ASC' (Bé → Lớn):
  // người dùng luôn bấm nút này để xem sách sắp hết trước, nên thà mặc định
  // luôn — bản in cũng xếp theo đúng thứ tự này. Chỉ còn 2 trạng thái vì
  // thứ tự thô không mang ý nghĩa gì khi đối chiếu.
  const [stocktakeSortMode, setStocktakeSortMode] = useState<'ASC' | 'DESC'>('ASC');
  // Cột sắp xếp kiểm kê: 'stock' (tồn lý thuyết) hoặc 'sold' (đã bán). Cuối kỳ
  // người ta cần xem đã bán được gì hơn là sắp hết — vào chế độ Kỳ tự chuyển
  // sang xếp theo đã bán (người dùng vẫn bấm lại được).
  const [stocktakeSortKey, setStocktakeSortKey] = useState<'stock' | 'sold'>('stock');
  const [stocktakeSoldDir, setStocktakeSoldDir] = useState<'DESC' | 'ASC'>('DESC');
  // Lọc chỉ hiển thị các đầu sách sắp hết (tồn lý thuyết <= 5 cuốn)
  const [stocktakeOnlyLow, setStocktakeOnlyLow] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  // Danh sách kiểm kê có sắp xếp và lọc theo nhu cầu đối soát cuối ngày.
  // Dùng CHUNG helper với bản in (`stocktake-order.ts`) để giấy in luôn khớp
  // đúng cái người dùng đang đọc trên màn.
  const sortedStocktakeList = useMemo(() => {
    const list = Array.isArray(data?.inventoryReconciliation) ? data.inventoryReconciliation : [];
    const base = stocktakeOnlyLow ? filterLowStock(list) : list;
    if (stocktakeSortKey === 'sold') {
      const sign = stocktakeSoldDir === 'DESC' ? -1 : 1;
      return [...base].sort((a: any, b: any) => (Number(a.soldToday || 0) - Number(b.soldToday || 0)) * sign);
    }
    return sortByStock(base, stocktakeSortMode);
  }, [data?.inventoryReconciliation, stocktakeSortMode, stocktakeOnlyLow, stocktakeSortKey, stocktakeSoldDir]);

  // Số lượng đầu sách có tồn lý thuyết <= 5 cuốn
  const stocktakeLowCount = useMemo(() => {
    const list = Array.isArray(data?.inventoryReconciliation) ? data.inventoryReconciliation : [];
    return list.filter((it: any) => Number(it.theoreticalStock || 0) <= STOCK_THRESHOLD_WARNING).length;
  }, [data?.inventoryReconciliation]);

  // Lý do chặn in, hiện ra màn hình. Trước đây handlePrint gọi window.print()
  // vô điều kiện nên bấm lúc chưa tải xong (hoặc tải lỗi) ra đúng MỘT TRANG
  // TRẮNG — người dùng tưởng máy in hỏng. Giữ thông báo ở state để nói rõ
  // vì sao không in, thay vì im lặng cho ra trang trắng.
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditModalSessionId, setAuditModalSessionId] = useState<string | null>(null);
  // Trạng thái Xuất CSV. ĐẶT TRƯỚC mọi early-return (Rules of Hooks): đặt sau
  // `if (!isOpen) return null` sẽ đổi số hook giữa 2 lần render → React #310 crash.
  const [csvNotice, setCsvNotice] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  // Nhịp Bán 1 món trong kỳ đang xem (day mode = kỳ 1 ngày). Biến đặt tên
  // riêng (không dùng selectedDate trực tiếp ở JSX cuối) để khối biên bản in
  // phía trên không dính chữ selectedDate — test ngày-khớp-số-liệu quét text.
  const flowStart = rangeMode === 'range' && rangeStart ? rangeStart : selectedDate;
  const flowEnd = rangeMode === 'range' && rangeEnd ? rangeEnd : selectedDate;
  const [flowOpen, setFlowOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Đóng modal khi bấm phím Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    setCurrentWarehouseId(warehouseId);
  }, [warehouseId]);

  useEffect(() => {
    async function loadWarehouses() {
      try {
        const res = await fetch('/api/warehouses?all=true');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setWarehouseList(json.data);
        }
      } catch {}
    }
    if (isOpen) {
      loadWarehouses();
    }
  }, [isOpen]);

  const fetchSettlement = async () => {
    const seq = ++requestSeqRef.current;
    setIsLoading(true);
    setLoadError(null);
    // Chế độ Kỳ mà chưa đủ ngày thì KHÔNG được rơi về báo cáo ngày âm thầm
    // (người dùng tưởng đang xem kỳ mà số là của 1 ngày — dễ in nhầm).
    if (rangeMode === 'range' && (!rangeStart || !rangeEnd)) {
      setData(null);
      setLoadError('Chọn đủ từ ngày đến ngày (hoặc bấm preset) để xem báo cáo kỳ.');
      setIsLoading(false);
      return;
    }
    try {
      const base = `/api/pos/daily-settlement?warehouseId=${encodeURIComponent(currentWarehouseId)}`;
      // Không đủ quyền Kỳ thì luôn xem ngày (dù state có lệch) — server cũng chặn Kỳ.
      const useRange = rangeMode === 'range' && canViewRange;
      const url =
        useRange && rangeStart && rangeEnd
          ? `${base}&start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}`
          : `${base}&date=${encodeURIComponent(selectedDate)}`;
      const res = await fetch(
        url,
        { headers: { 'x-formapubli-role': currentRole } }
      );
      const json = await res.json().catch(() => null);
      if (seq !== requestSeqRef.current) return; // response cũ → bỏ, không ghi đè
      // Phải kiểm cả res.ok lẫn json.success. Trước đây chỉ có
      // `if (json.success)` không có else: lỗi 403/500 rơi vào nhánh `!data` và
      // hiện thành "Không có dữ liệu" — thông báo sai, và `data` cũ của ngày
      // trước vẫn còn trong state nên màn hình hiện số ngày khác dưới nhãn
      // ngày mới. Xoá `data` khi lỗi để không bao giờ in nhầm.
      if (!res.ok || !json?.success) {
        setData(null);
        setLoadError(json?.error || `Báo cáo không tải được (mã lỗi ${res.status}).`);
        return;
      }
      setData(json.data);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setData(null);
      setLoadError('Mất kết nối khi tải báo cáo chốt ngày.');
      console.error('Lỗi tải báo cáo chốt ngày hội chợ:', err);
    } finally {
      if (seq === requestSeqRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !currentWarehouseId) return;
    // Khóa trùng: "Cả chiến dịch" đã nạp sẵn + set state khớp thì effect bỏ qua,
    // không fetch lại. Không dùng cờ boolean (kẹt khi state không đổi).
    const key =
      rangeMode === 'range'
        ? `r|${currentWarehouseId}|${rangeStart}|${rangeEnd}`
        : `d|${currentWarehouseId}|${selectedDate}`;
    if (key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;
    fetchSettlement();
  }, [isOpen, currentWarehouseId, selectedDate, rangeMode, rangeStart, rangeEnd]);

  /** Preset kỳ tính từ hôm nay (ngày VN). */
  const applyPreset = (days: number) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    const t = Date.parse(`${today}T00:00:00Z`);
    const start = new Date(t - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    setRangeMode('range');
    setRangeStart(start);
    setRangeEnd(today);
  };

  /** Bấm sang Kỳ mà chưa có ngày thì tự lấy 1 tuần gần nhất — không để khung
      trống hiện số ngày cũ gây hiểu nhầm. */
  const switchMode = (m: 'day' | 'range') => {
    setRangeMode(m);
    if (m === 'range') {
      // Cuối kỳ xem đã bán trước, tồn sau.
      setStocktakeSortKey('sold');
      setStocktakeSoldDir('DESC');
      if (!rangeStart || !rangeEnd) {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
        const t = Date.parse(`${today}T00:00:00Z`);
        setRangeStart(new Date(t - 6 * 86_400_000).toISOString().slice(0, 10));
        setRangeEnd(today);
      }
    }
  };

  /** Cả chiến dịch: server suy kỳ từ đơn đầu→cuối của kho đang chọn. */
  const applyCampaign = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/pos/daily-settlement?warehouseId=${encodeURIComponent(currentWarehouseId)}&campaign=1`,
        { headers: { 'x-formapubli-role': currentRole } }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setData(null);
        setLoadError(json?.error || 'Không suy được kỳ chiến dịch của kho này.');
        return;
      }
      if (json.empty) {
        setData(null);
        setLoadError('Kho này chưa có đơn nào để lập báo cáo chiến dịch.');
        return;
      }
      // Chiến dịch dài hơn trần kỳ: mời xem 90 ngày gần nhất thay vì lỗi cụt.
      if (json.tooLong) {
        const endT = Date.parse(`${json.endDate}T00:00:00Z`);
        const start90 = new Date(endT - 89 * 86_400_000).toISOString().slice(0, 10);
        setRangeMode('range');
        setRangeStart(start90);
        setRangeEnd(json.endDate);
        setData(null);
        // Effect tự fetch theo kỳ mới và xoá lỗi này khi tải xong.
        setLoadError(
          `Chiến dịch dài ${json.spanDays} ngày (tối đa 92 ngày/kỳ). Đang tải 90 ngày gần nhất — muốn xem đoạn khác thì thu hẹp kỳ.`
        );
        return;
      }
      // Dữ liệu đã có sẵn — đồng bộ khóa fetch để effect không tải lại trùng lặp.
      lastFetchKeyRef.current = `r|${currentWarehouseId}|${json.data.reportStartDate}|${json.data.reportEndDate}`;
      setRangeMode('range');
      setRangeStart(json.data.reportStartDate);
      setRangeEnd(json.data.reportEndDate);
      setData(json.data);
    } catch {
      setData(null);
      setLoadError('Mất kết nối khi tải báo cáo chiến dịch.');
    } finally {
      setIsLoading(false);
    }
  };

  // Đã có số liệu rồi thì lý do chặn in ở lần trước không còn đúng nữa → xoá.
  useEffect(() => {
    if (data) setPrintNotice(null);
  }, [data]);

  if (!isOpen) return null;

  const handlePrint = () => {
    if (isLoading) {
      setPrintNotice('Báo cáo đang được tải, chờ tải xong rồi hãy in.');
      return;
    }
    if (loadError) {
      setPrintNotice(`Chưa in được: ${loadError} Bấm nút tải lại rồi in lại.`);
      return;
    }
    if (!data) {
      setPrintNotice('Chưa có số liệu để in. Bấm nút tải lại rồi thử lại.');
      return;
    }
    setPrintNotice(null);
    window.print();
  };

  // Tính tổng số lượng sách lý thuyết vs thực tế
  const activeWarehouseName =
    warehouseList.find((w) => w.id === currentWarehouseId)?.name || warehouseName || data?.warehouse?.name || currentWarehouseId;

  if (!isOpen || !mounted) return null;

  const totalTheoreticalBooks = (data?.inventoryReconciliation || []).reduce(
    (sum: number, it: any) => sum + (it.theoreticalStock || 0),
    0
  );
  // Ngày in ra LUÔN là ngày của số liệu (`data.reportDate` do API trả), không
  // phải ngày đang chọn trên ô date. Ô date là ý định của người dùng; `reportDate`
  // mới là ngày mà số tiền/số sách thuộc về. Lệch hai thứ này chính là lúc biên bản
  // bàn giao cho kế toán mang số tiện của ngày này dưới dấu ngày khác.
  const shownReportDate = data?.reportDate || selectedDate;
  // Chế độ kỳ: tiêu đề/biên bản ghi rõ kỳ, không ghi ngày đơn.
  const isRangeData = (data as any)?.mode === 'range';
  const printStart = (data as any)?.reportStartDate || '';
  const printEnd = (data as any)?.reportEndDate || '';
  // Nút Xuất CSV cả kỳ (yêu cầu chủ 06/10): chỉ Chủ + Quản lý, chỉ ở chế độ Kỳ.
  const canExportCsv = canViewRange;

  /** Xuất 3 file CSV đúng phạm vi Kỳ đang xem (kho + từ→đến / Cả chiến dịch). */
  const handleExportCsv = async () => {
    if (isLoading || isExportingCsv) return;
    if (!canExportCsv) {
      setCsvNotice('Bạn không có quyền xuất CSV báo cáo kỳ.');
      return;
    }
    if (!isRangeData || !printStart || !printEnd) {
      setCsvNotice('Chuyển sang chế độ Kỳ và chọn đủ từ ngày đến ngày rồi hãy xuất CSV.');
      return;
    }
    setIsExportingCsv(true);
    setCsvNotice(null);
    try {
      const { toCsv, downloadCsv } = await import('@/lib/csv-export');
      // Lấy kho/từ-kỳ từ CHÍNH payload `data` đang hiển thị (không dùng state
      // currentWarehouseId có thể vừa đổi khi người dùng chọn kho khác).
      const whId = (data as any)?.warehouse?.id || currentWarehouseId;
      const base = `/api/reports/ho-guom-summary?warehouseId=${encodeURIComponent(whId)}&start=${encodeURIComponent(printStart)}&end=${encodeURIComponent(printEnd)}`;
      const res = await fetch(base, { headers: { 'x-formapubli-role': currentRole } });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !json?.data) {
        setCsvNotice(json?.error || `Không xuất được CSV (${res.status}). Bấm tải lại rồi thử lại.`);
        return;
      }
      const s = json.data;
      const whName = s.warehouse?.name || activeWarehouseName;
      const vnNow = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
      const head = (title: string) => [
        ['FORMApubli', title],
        [`Kho: ${whName}`, `Kỳ: ${s.range.start} → ${s.range.end}`, `Xuất lúc: ${vnNow} (giờ VN)`],
        [`Tồn: ${s.stockNote || 'Tồn hiện tại lúc mở báo cáo'}`],
        [],
      ];
      const fname = `ho-guom-${whId}-${s.range.start}_${s.range.end}`;
      const lines: any[] = s.lines || [];
      const pause = () => new Promise((r) => setTimeout(r, 300)); // tránh trình duyệt bỏ file 2/3 khi tải liên tục
      downloadCsv(`${fname}-dau-sach.csv`, toCsv([
        ...head('TỔNG HỢP ĐẦU SÁCH'),
        ['STT', 'Mã', 'Tên sách', 'Giá bìa', 'SL bán (có thu tiền)', 'Doanh thu', 'SL tặng (kèm)', 'Tổng xuất (bán+tặng)', 'Tồn hiện tại', 'Hạng theo SL', 'Hạng theo doanh thu', 'Nhóm'],
        ...lines.map((l: any, i: number) => [i + 1, l.code, l.title, l.coverPrice, l.soldQty, l.soldRevenue, l.giftQty, l.totalOut, l.stockNow, l.rankQty, l.rankRevenue, l.group]),
      ]));
      await pause();
      const days: any[] = s.days || [];
      const t = s.totals || {};
      downloadCsv(`${fname}-ngay.csv`, toCsv([
        ...head('DOANH THU THEO NGÀY'),
        ['Ngày', 'Số đơn', 'Doanh thu (thuần)'],
        ...days.map((d: any) => [d.date, d.orders, d.sales]),
        ['TỔNG', t.orders, t.net],
      ]));
      await pause();
      const gifts: any[] = s.giftsInScope?.items || [];
      downloadCsv(`${fname}-qua.csv`, toCsv([
        ...head('QUÀ TẶNG TRONG KỲ (theo kho)'),
        ['Mã quà', 'Tên quà', 'Số lượng đã phát'],
        ...gifts.map((g: any) => [g.code, g.title, g.copies]),
        ['TỔNG', '', s.giftsInScope?.total || 0],
      ]));
      setCsvNotice(`Đã xuất 3 file CSV (${lines.length} đầu sách, kỳ ${s.range.start}→${s.range.end}).`);
    } catch {
      setCsvNotice('Mất kết nối khi xuất CSV. Thử lại.');
    } finally {
      setIsExportingCsv(false);
    }
  };

  /** Nhãn ngày gọn cho dải kỳ trên bản in (YYYY-MM-DD → DD/MM). */
  const ddmm = (iso: string) => {
    const s = String(iso || '');
    return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s;
  };
  // Không có số đếm thực tế nữa (xem chú thích state ở trên) ⇒ không còn "chênh
  // lệch" để hiển thị. Giữ `totalTheoreticalBooks` vì bản in bàn giao vẫn cần tổng
  // tồn lý thuyết. Cố ý KHÔNG in 0 cho phần kiểm kê: số 0 là hẹn số bịa.
  void 0;

  // Dải 24 mốc giờ VN cho biểu đồ cột cao điểm trên bản in. `Math.max(1, ...)` để
  // ngày không bán được gì vẫn ra cột xám thay vì chia 0 = NaN.
  const hourly: any[] = data?.ordersByHour || [];

  // KHUNG GIỜ ĐỘNG — dải giờ chỉ in khoảng có việc thật. `slice(start, end + 1)`
  // vì `end` là giờ CUỐI CÙNG có việc (hoặc giờ hiện tại của hôm nay) nên nó phải
  // nằm trong dải. Cùng hàm này dùng cho cả màn hình lẫn bản in.
  const hourWin = hourWindow({
    sessions: data?.cashboxReconciliation?.sessions,
    hourly,
    reportDate: shownReportDate,
  });
  const hourlyInWindow = hourly.slice(hourWin.start, hourWin.end + 1);
  // `end` có thể ra 24 khi khung chỉ gồm giờ 23 (đảm bảo `end > start`). 24 KHÔNG
  // phải mốc giờ có thật — nhãn cuối của dải SVG vẫn là "23h" — nên hiển thị 23h
  // cho khớp, tránh in ra mốc giờ không tồn tại.
  const hourEndShown = Math.min(23, hourWin.end);
  const maxHourOrders = Math.max(1, ...hourlyInWindow.map((h: any) => Number(h.orders || 0)));
  const peakIndex = hourlyInWindow.reduce(
    (best: number, h: any, i: number) => (Number(h.orders || 0) > Number(hourlyInWindow[best]?.orders || 0) ? i : best),
    0
  );
  const bandSlot = BAND_W / Math.max(1, hourlyInWindow.length);
  /** Cao cột theo số đơn; giờ 0 đơn vẫn chừa 2 đơn vị để thấy mốc giờ trống. */
  const bandBarH = (n: number) => (n > 0 ? Math.max(6, Math.round((n / maxHourOrders) * BAND_PLOT_H)) : 2);
  /** Thang riêng cho dải doanh thu (đơn vị đồng, khác thang đếm đơn ở trên). */
  const maxHourSales = Math.max(1, ...hourlyInWindow.map((h: any) => Number(h.sales || 0)));
  const peakSalesIndex = hourlyInWindow.reduce(
    (best: number, h: any, i: number) => (Number(h.sales || 0) > Number(hourlyInWindow[best]?.sales || 0) ? i : best),
    0
  );
  const bandBarHMoney = (n: number) => (n > 0 ? Math.max(6, Math.round((n / maxHourSales) * BAND_PLOT_H)) : 2);
  /** Nhãn tiền gọn trên cột in (Tr/nghìn) — in đầy đủ tràn cột. */
  const bandMoneyShort = (n: number) =>
    n >= 1000000
      ? `${(Math.round((n / 1000000) * 10) / 10).toLocaleString('vi-VN')}Tr`
      : n >= 1000
        ? `${Math.round(n / 1000)}N`
        : `${n}`;

  // Bảng tồn gọn trên bản in: chỉ ấn phẩm ĐÃ BÁN trong ngày, không cap dòng.
  // Ngày: xếp theo "Tồn còn" bé → lớn. Kỳ (cuối chiến dịch): xếp theo "Đã bán"
  // lớn → bé — cuối kỳ người ta cần xem bán được gì hơn là sắp hết. Dùng CHUNG
  // hàm với màn hình kiểm kê để giấy khớp đúng thứ tự đang đọc.
  const soldOnlyRows: any[] = isRangeData
    ? [...(data?.inventoryReconciliation || []).filter((it: any) => Number(it.soldToday || 0) > 0)].sort(
        (a: any, b: any) => Number(b.soldToday || 0) - Number(a.soldToday || 0)
      )
    : sortByStock(
        (data?.inventoryReconciliation || []).filter((it: any) => Number(it.soldToday || 0) > 0),
        'ASC'
      );
  // Bảng những cuốn CẦN ĐẾM lúc đóng thùng: tồn ≤ ngưỡng, xếp tồn bé → lớn.
  // Cố ý KHÔNG phụ thuộc bộ lọc trên màn hình: giấy in phải luôn giống nhau bất
  // kể người dùng đang bật/tắt gì, nếu không bản in và màn hẻ lệch nhau.
  const lowStockRows: any[] = sortByStock(
    filterLowStock(data?.inventoryReconciliation || []),
    'ASC'
  );
  const soldTodayTotal =
    data?.financials?.totalItemsSold ??
    soldOnlyRows.reduce((sum: number, it: any) => sum + Number(it.soldToday || 0), 0);

  const totalOrdersCount = Number(data?.financials?.totalOrdersCount || 0);
  const netSalesAmount = Number(data?.financials?.netSales || 0);
  const averageOrderValue =
    data?.financials?.averageOrderValue ??
    (totalOrdersCount > 0 ? Math.round(netSalesAmount / totalOrdersCount) : 0);
  const averageItemsPerOrder =
    data?.financials?.averageItemsPerOrder ??
    (totalOrdersCount > 0 ? (soldTodayTotal / totalOrdersCount).toFixed(1) : '0');

  const cashOrdersCount = Number(data?.paymentBreakdown?.cash?.ordersCount || 0);
  const qrTransferOrdersCount = Number(data?.paymentBreakdown?.qrTransfer?.ordersCount || 0);
  const cardOrdersCount = Number(data?.paymentBreakdown?.card?.ordersCount || 0);
  const cashOrdersShare = totalOrdersCount > 0 ? Math.round((cashOrdersCount / totalOrdersCount) * 100) : 0;
  const qrOrdersShare = totalOrdersCount > 0 ? Math.round((qrTransferOrdersCount / totalOrdersCount) * 100) : 0;

  const peakHourNumber = hourlyInWindow[peakIndex]?.hour ?? null;
  const peakHourOrders = Number(hourlyInWindow[peakIndex]?.orders || 0);
  const peakHourSales = Number(hourlyInWindow[peakIndex]?.sales || 0);

  // Bảng đơn vượt trần chiết khấu trên bản in: cap 10 dòng, phần dư đếm gọn.
  const overCapOrders: any[] = data?.discountSupervision?.orders || [];
  const overCapCount = overCapOrders.length;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* CSS ẩn mọi thứ khác khi in khổ A4 (Print Stylesheet) */}
      <style jsx global>{`
        @media print {
          /* GỠ KHỎI LUỒNG mọi nhánh không chứa biên bản, chứ không chỉ ẩn nó.
             Nếu chỉ dùng "visibility: hidden" thì nội dung ẩn VẪN CHIẾM CHỖ ⇒
             trình duyệt in ra hàng chục trang TRẮNG nối sau biên bản.
             :has() loại đúng nhánh chứa biên bản (portal của nó nằm thẳng con
             của body). :not(#id) phía sau là bắt buộc: riêng :has() không đủ —
             độ đặc hiệu (1,0,1) của nó thắng rule #id { display:block !important }
             (1,0,0), cả hai đều !important nên biên bản vẫn bị ẩn ⇒ in trắng. */
          body > *:not(:has(#printable-settlement-report)):not(#printable-settlement-report) {
            display: none !important;
          }
          #printable-settlement-report,
          #printable-settlement-report * {
            visibility: visible !important;
          }
          #printable-settlement-report {
            /* Lớp "hidden" (display:none) của Tailwind đè lên "print:block" tuỳ
               thứ tự CSS. Tự ép hiện để không bao giờ phụ thuộc thứ tự đó. */
            display: block !important;
            /* KHÔNG position:absolute. Owner in thật và thấy TRANG 2 dính sát mép
               trái còn trang 1 thì có lề: Chrome ngắt trang khối absolute kiểu khác
               hẳn khối in-flow. Khối in vốn đã là portal thẳng xuống document.body
               (anh em của backdrop, ngoài khung modal cắt tràn) nên không cần
               absolute để ra khỏi khung cắt. */
            width: 100%;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
            color: #0f172a !important;
          }
          #printable-settlement-report .font-mono {
            font-family: Consolas, "SFMono-Regular", Menlo, Monaco, monospace !important;
          }
          .no-print {
            display: none !important;
          }
          #printable-settlement-report table,
          #printable-settlement-report svg {
            max-width: 100%;
          }
          #printable-settlement-report table {
            break-inside: auto;
            page-break-inside: auto;
          }
          #printable-settlement-report thead {
            display: table-header-group;
          }
          #printable-settlement-report tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          #printable-settlement-report td,
          #printable-settlement-report th,
          #printable-settlement-report p,
          #printable-settlement-report div,
          #printable-settlement-report span,
          #printable-settlement-report strong {
            overflow-wrap: anywhere;
          }
          /* Các khối nhỏ gọn nằm trọn trong 1 trang */
          #printable-settlement-report .print-block {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          /* Khối bảng lớn nhiều dòng (Mục IV tồn sách) cho phép ngắt trang tự nhiên */
          #printable-settlement-report .print-table-block {
            break-inside: auto;
            page-break-inside: auto;
          }
          html:has(#printable-settlement-report),
          body:has(#printable-settlement-report) {
            width: auto !important;
            max-width: 210mm !important;
          }
          /* NGUỒN DUY NHẤT của lề A4 là globals.css. Khối 80mm ở đó khai
             @page với margin 0mm có !important; nếu khối A4 ở đây thiếu
             !important thì lề bị mất sạch (đã đo thật: 0.00mm). Giữ hai
             chỗ cùng giá trị là vô hại; sửa lề thì sửa ở globals.css. */
          @page {
            size: A4 portrait !important;
            margin: 12mm 10mm !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-3xl max-w-6xl w-full shadow-2xl overflow-hidden border border-slate-200 my-auto flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        {/* Header Modal — xuống dòng trên mobile để tiêu đề không bị ép từng chữ */}
        <div className="no-print bg-slate-900 text-white px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm sm:text-base flex items-center gap-2 whitespace-nowrap">
                Báo Cáo Chốt Ngày
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Kho: <strong className="text-white">{activeWarehouseName}</strong>
                <span className="hidden sm:inline"> | </span>
                <span className="ml-1 sm:ml-0">{isRangeData && rangeStart && rangeEnd ? <>Kỳ: <span className="font-mono text-amber-300">{rangeStart} → {rangeEnd}</span></> : <>Ngày: <span className="font-mono text-amber-300">{shownReportDate}</span></>}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {warehouseList.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-700 flex-1 sm:flex-none min-w-0">
                <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <select
                  value={currentWarehouseId}
                  onChange={(e) => setCurrentWarehouseId(e.target.value)}
                  className="bg-transparent text-amber-300 text-xs font-bold outline-none cursor-pointer w-full min-w-0 truncate"
                  title="Chọn kho cần kết toán"
                >
                  {warehouseList.map((w) => (
                    <option key={w.id} value={w.id} className="bg-slate-900 text-white">
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {/* Chế độ Ngày/Kỳ: kỳ gom ở server, 1 request (không fetch N ngày).
                Chủ + Quản lý thấy (vai trò khác chỉ xem ngày của sự kiện đang diễn ra). */}
            {canViewRange && (
            <div className="flex items-center gap-1 bg-slate-800 px-1 py-1 rounded-xl border border-slate-700 shrink-0" role="group" aria-label="Chế độ báo cáo">
              {(['day', 'range'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  aria-pressed={rangeMode === m}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                    rangeMode === m ? 'bg-amber-500 text-slate-900' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {m === 'day' ? 'Ngày' : 'Kỳ'}
                </button>
              ))}
            </div>
            )}
            {rangeMode === 'day' || !canViewRange ? (
              <input
                type="date"
                aria-label="Chọn ngày cần kết toán"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-800 text-white text-xs px-2.5 py-1.5 rounded-xl border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  type="date"
                  aria-label="Kỳ từ ngày"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="bg-slate-800 text-white text-xs px-2 py-1.5 rounded-xl border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
                <span className="text-slate-400 text-xs">→</span>
                <input
                  type="date"
                  aria-label="Kỳ đến ngày"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="bg-slate-800 text-white text-xs px-2 py-1.5 rounded-xl border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
                {([
                  [7, '1 tuần'],
                  [30, '1 tháng'],
                ] as Array<[number, string]>).map(([n, label]) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => applyPreset(n)}
                    className="px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-800 text-amber-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                  >
                    {label}
                  </button>
                ))}
                {/* Cả chiến dịch chỉ kho hội chợ (FAIR_EVENT) mới có: kho vật lý
                    dùng preset/ngày tay. Ẩn hẳn thay vì báo lỗi sau khi bấm. */}
                {(warehouseList.find((w: any) => w.id === currentWarehouseId)?.warehouseType ?? 'FAIR_EVENT') === 'FAIR_EVENT' && (
                <button
                  type="button"
                  onClick={applyCampaign}
                  title="Suy kỳ từ đơn đầu đến đơn cuối của kho đang chọn"
                  className="px-2 py-1 rounded-lg text-[11px] font-bold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
                >
                  Cả chiến dịch
                </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Báo lý do chặn in. `no-print` để không lọt vào chính bản in. */}
        {printNotice && (
          <div
            role="alert"
            className="no-print shrink-0 flex items-start gap-2 px-3 sm:px-6 py-2 bg-amber-50 border-b border-amber-300"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <p className="text-xs font-bold text-amber-900 flex-1">{printNotice}</p>
            <button
              type="button"
              onClick={() => setPrintNotice(null)}
              title="Tắt thông báo"
              aria-label="Tắt thông báo chặn in"
              className="shrink-0 px-2 py-0.5 rounded-lg border border-amber-400 bg-white text-amber-800 text-[11px] font-bold hover:bg-amber-100 cursor-pointer"
            >
              Tắt
            </button>
          </div>
        )}

        {/* Báo kết quả xuất CSV (dấu hiệu bấm rõ: đã xuất gì, kỳ nào). */}
        {csvNotice && (
          <div
            role="status"
            className="no-print shrink-0 flex items-start gap-2 px-3 sm:px-6 py-2 bg-sky-50 border-b border-sky-300"
          >
            <ArrowDown className="w-4 h-4 shrink-0 mt-0.5 text-sky-600" />
            <p className="text-xs font-bold text-sky-900 flex-1">{csvNotice}</p>
            <button
              type="button"
              onClick={() => setCsvNotice(null)}
              title="Tắt thông báo"
              aria-label="Tắt thông báo xuất CSV"
              className="shrink-0 px-2 py-0.5 rounded-lg border border-sky-400 bg-white text-sky-800 text-[11px] font-bold hover:bg-sky-100 cursor-pointer"
            >
              Tắt
            </button>
          </div>
        )}

        {/* Tab Navigation (ẩn khi in).
            Dán đầu (sticky) + 3 ô luôn hiện: trước đây là 3 tab chữ dài trong
            thanh cuộn ngang — trên điện thoại không có cách nào biết còn mục
            nào ngoài màn hình, và dải nhãn dài làm nút trông như chữ. */}
        <div className="no-print sticky top-0 z-10 px-3 sm:px-6 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
          <div role="tablist" aria-label="Mục báo cáo" className="fit-bar grid grid-cols-3 gap-1 bg-slate-200/60 p-1 rounded-xl">
            {([
              { key: 'FINANCIALS', label: 'Tiền & Két', Icon: Banknote },
              { key: 'STOCKTAKE', label: 'Kiểm Kê', Icon: Boxes },
              { key: 'DISCOUNT', label: 'Chiết Khấu', Icon: ShieldAlert },
            ] as const).map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                aria-label={t.label}
                onClick={() => setActiveTab(t.key)}
                className={`fit-btn flex items-center justify-center gap-1 px-1.5 py-2 rounded-lg font-bold transition cursor-pointer min-w-0 ${
                  activeTab === t.key
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                <t.Icon className="fit-icon w-4 h-4 shrink-0" />
                <span className="fit-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Nội dung báo cáo tương tác trên màn hình (Interactive UI) */}
        <div className="no-print p-6 overflow-y-auto flex-1 space-y-6">
          {isLoading ? (
            <div className="py-16 text-center text-slate-400">
              <RefreshCw className="w-7 h-7 animate-spin mx-auto mb-3 text-indigo-500" />
              <p className="text-xs font-bold">Đang tổng hợp số liệu ca bán hàng và kiểm kê kho...</p>
            </div>
          ) : !data ? (
            loadError ? (
              <div className="py-16 text-center text-xs">
                <XCircle className="w-7 h-7 mx-auto mb-3 text-rose-500" />
                <p className="font-bold text-rose-700">Không tải được báo cáo</p>
                <p className="text-slate-500 mt-1">{loadError}</p>
                <p className="text-slate-400 mt-3">Bấm nút tải lại để thử lần nữa.</p>
              </div>
            ) : (
              <div className="py-16 text-center text-slate-400 text-xs">
                Không có dữ liệu báo cáo cho ngày đã chọn.
              </div>
            )
          ) : (
            <>
              {/* TAB 1: DOANH SỐ & ĐỐI SOÁT KÉT TIỀN */}
              {activeTab === 'FINANCIALS' && (
                <div className="space-y-5 animate-in fade-in duration-150">
                  <MoneyHeader
                    data={data}
                    periodLabel={
                      data?.mode === 'range' && data?.reportStartDate && data?.reportEndDate
                        ? `kỳ ${data.reportStartDate} → ${data.reportEndDate}`
                        : undefined
                    }
                  />

                  {data?.mode === 'range' ? (
                    /* Doanh thu theo ngày trong kỳ — cùng shape với dải giờ bản in */
                    <div className="bg-white rounded-2xl border border-slate-200 p-4">
                      <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">
                        Doanh thu theo ngày ({(data?.days || []).length} ngày)
                      </h4>
                      <div className="mt-2 overflow-x-auto max-h-[320px] overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 sticky top-0">
                            <tr>
                              <th className="p-2.5">Ngày</th>
                              <th className="p-2.5 text-right">Số đơn</th>
                              <th className="p-2.5 text-right">Doanh thu</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(data?.days || []).map((d: any) => (
                              <tr key={d.date} className="hover:bg-slate-50/80">
                                <td className="p-2.5 font-mono font-bold text-slate-800">{d.date}</td>
                                <td className="p-2.5 text-right font-mono">{Number(d.orders || 0).toLocaleString('vi-VN')}</td>
                                <td className="p-2.5 text-right font-mono font-bold text-emerald-700">
                                  {Number(d.sales || 0).toLocaleString('vi-VN')} đ
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {data?.stockNote && (
                        <p className="text-[11px] text-slate-500 mt-2 italic">{data.stockNote}</p>
                      )}
                    </div>
                  ) : (
                  <>
                  {/* Số đơn theo giờ — dùng CHUNG `hourlyInWindow`/`hourWin` với dải
                      giờ trên bản in, nên màn hình và giấy luôn nói cùng một câu.
                      Không query thêm: `ordersByHour` đã gom sẵn 24 bucket. */}
                  <HourlyOrdersChart
                    rows={hourlyInWindow}
                    startHour={hourWin.start}
                    endHour={hourEndShown}
                  />

                  {/* Doanh thu theo giờ — cùng dữ liệu/khung giờ với biểu đồ đơn
                      ở trên, chỉ đổi chế độ vẽ sang tiền. */}
                  <HourlyOrdersChart
                    rows={hourlyInWindow}
                    startHour={hourWin.start}
                    endHour={hourEndShown}
                    metric="sales"
                  />
                  </>
                  )}

                  {/* Bán chạy nhất: đủ để người cầm biên bản biết món chủ lực
                      trong ngày mà không phải cuộn qua cả bảng 10 dòng. Bảng đầy
                      đủ đã chuyển sang màn Trạng Thái Hội Chợ. */}
                  {(data?.topSellers || []).length > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-600">
                        Bán chạy nhất: [{data.topSellers[0].code}] {data.topSellers[0].title} ·{' '}
                        {data.topSellers[0].soldCopies} cuốn
                      </p>
                      <button
                        type="button"
                        onClick={() => setFlowOpen(true)}
                        title="Mở Nhịp Bán: xem từng thời điểm bán ra của 1 món trong kỳ"
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition"
                      >
                        <TrendingUp className="w-3.5 h-3.5" />
                        Nhịp Bán
                      </button>
                    </div>
                  )}

                  {/* Đối soát két tiền ca */}
                  <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
                    <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-emerald-600" />
                      {isRangeData ? 'Đối Soát Két Tiền Cuối Kỳ (cộng mọi ca trong kỳ)' : 'Đối Soát Két Tiền Cuối Ngày'}
                    </h4>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Tổng tiền bàn giao đầu các ca:</span>
                        <span className="font-mono font-bold text-slate-800">
                          {(data.cashboxReconciliation?.openingCashTotal || 0).toLocaleString('vi-VN')} đ
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Doanh số tiền mặt bán {isRangeData ? 'trong kỳ' : 'trong ngày'}:</span>
                        <span className="font-mono font-bold text-emerald-700">
                          +{(data.paymentBreakdown?.cash?.sales || 0).toLocaleString('vi-VN')} đ
                        </span>
                      </div>
                      <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold">
                        <span className="text-slate-900">TIỀN MẶT KỲ VỌNG TRONG KÉT:</span>
                        <span className="font-mono text-sm text-slate-900">
                          {(data.cashboxReconciliation?.expectedCashTotal || 0).toLocaleString('vi-VN')} đ
                        </span>
                      </div>
                      <div className="flex justify-between items-center font-bold">
                        <span className="text-slate-900">TIỀN MẶT THỰC ĐẾM BÀN GIAO:</span>
                        <span className="font-mono text-sm text-indigo-700">
                          {(data.cashboxReconciliation?.closingCashActualTotal || 0).toLocaleString('vi-VN')} đ
                        </span>
                      </div>

                      {data.cashboxReconciliation?.cashVariance !== null && (
                        <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-700">Kết quả đối soát chênh lệch két:</span>
                          {data.cashboxReconciliation.cashVariance === 0 ? (
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold">
                              Khớp 100% (±0 đ)
                            </span>
                          ) : data.cashboxReconciliation.cashVariance > 0 ? (
                            <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-extrabold">
                              Thừa két: +{data.cashboxReconciliation.cashVariance.toLocaleString('vi-VN')} đ
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-extrabold">
                              Thiếu két: {data.cashboxReconciliation.cashVariance.toLocaleString('vi-VN')} đ
                            </span>
                          )}
                        </div>
                      )}

                      {/* Trước đây dòng chênh lệch BỊ ẨN im lặng khi còn ca mở — đúng dòng
                          cần kiểm nhất lại biến mất. Giờ nói rõ vì sao chưa đối soát được.
                          Phải dùng `cashVariancePending` chứ không đoán qua
                          `cashVariance === null`: null còn xảy ra khi KHÔNG có ca nào
                          trong ngày, đó là chuyện khác hẳn. */}
                      {data.cashboxReconciliation?.cashVariancePending === true && (
                        <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-xs">
                          <span className="font-bold text-amber-800">
                            Kết quả đối soát chênh lệch két:
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-extrabold">
                            Chưa thể đối soát — {(() => {
                              const open = Number(data.cashboxReconciliation?.openSessionCount || 0);
                              const unrec = Number(data.cashboxReconciliation?.unreconcilableSessionCount || 0);
                              const parts: string[] = [];
                              if (open > 0) parts.push(`${open} ca chưa đóng`);
                              if (unrec > open) parts.push(`${unrec} ca chưa có tiền thực đếm`);
                              return parts.length > 0 ? parts.join(' · ') : 'thiếu số đếm két';
                            })()}
                          </span>
                        </div>
                      )}

                      {/* Bổ sung tiền thực đếm khi có ca đã đóng nhưng chưa có tiền thực đếm */}
                      {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') &&
                        (data.cashboxReconciliation?.sessions || []).some(
                          (s: any) =>
                            s.status === 'CLOSED' &&
                            (s.closingCashActual === null || s.closingCashActual === undefined)
                        ) && (
                          <div className="pt-2 border-t border-slate-200 flex items-center justify-between bg-amber-50/70 p-2.5 rounded-xl border border-amber-200">
                            <div className="text-xs text-amber-900 pr-2">
                              <p className="font-bold flex items-center gap-1">
                                <Coins className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                Có ca đã đóng nhưng chưa có tiền thực đếm
                              </p>
                              <p className="text-[11px] text-amber-700">
                                Nhập tiền thực tế trong két để hệ thống đối soát chênh lệch ngay.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setAuditModalSessionId(null);
                                setIsAuditModalOpen(true);
                              }}
                              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition shrink-0"
                            >
                              <Coins className="w-3.5 h-3.5" />
                              Nhập Tiền Thực Đếm
                            </button>
                          </div>
                        )}

                      {/* Danh sách các ca két trong ngày */}
                      {Array.isArray(data.cashboxReconciliation?.sessions) && data.cashboxReconciliation.sessions.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 space-y-1.5">
                          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            Chi tiết ca két ({data.cashboxReconciliation.sessions.length} ca):
                          </p>
                          <div className="space-y-1.5">
                            {data.cashboxReconciliation.sessions.map((s: any) => {
                              const uncounted =
                                s.status === 'CLOSED' &&
                                (s.closingCashActual === null || s.closingCashActual === undefined);
                              const exp = s.expectedCashLive ?? s.expectedCash ?? 0;
                              const isManager = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
                              return (
                                <div
                                  key={s.id}
                                  className="p-2.5 bg-white rounded-xl border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2"
                                >
                                  <div>
                                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                      <span>Thu ngân: {s.cashierId}</span>
                                      <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                                          s.status === 'OPEN'
                                            ? 'bg-amber-100 text-amber-800'
                                            : uncounted
                                            ? 'bg-rose-100 text-rose-800'
                                            : 'bg-emerald-100 text-emerald-800'
                                        }`}
                                      >
                                        {s.status === 'OPEN'
                                          ? 'Đang mở'
                                          : uncounted
                                          ? 'Chưa đếm két'
                                          : 'Đã đóng'}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                      Kỳ vọng: <span className="font-mono font-medium text-slate-700">{exp.toLocaleString('vi-VN')} đ</span>
                                      {' · '}
                                      Thực đếm:{' '}
                                      <span className="font-mono font-bold text-slate-800">
                                        {s.closingCashActual !== null && s.closingCashActual !== undefined
                                          ? `${s.closingCashActual.toLocaleString('vi-VN')} đ`
                                          : '—'}
                                      </span>
                                    </p>
                                  </div>

                                  {isManager && s.status === 'CLOSED' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAuditModalSessionId(s.id);
                                        setIsAuditModalOpen(true);
                                      }}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition ${
                                        uncounted
                                          ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm'
                                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                                      }`}
                                    >
                                      <Coins className="w-3 h-3" />
                                      {uncounted ? 'Nhập Tiền Thực Đếm' : 'Sửa Tiền Đếm'}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* openShiftAlerts do API trả sẵn (route daily-settlement gắn vào data)
                          nhưng trước đây không màn hình nào đọc.
                          QUAN TRỌNG: `getStaleOpenShiftCheck` trả OBJECT
                          `{ serverTime, cutoff, cutoffSource, count, salesBlocked, shifts }`,
                          KHÔNG phải mảng. Đo `Array.isArray(...)` ⇒ luôn false ⇒ cả khối
                          cảnh báo này chết mà test nguồn vẫn xanh. Phải đọc `.shifts`.
                          Mỗi phần tử có `id/warehouseId/cashierId/openedAt/cutoff/...`
                          — không có `warehouseName`/`cashierName`, nên dùng id làm dự phòng. */}
                      {Array.isArray(data.openShiftAlerts?.shifts) && data.openShiftAlerts.shifts.length > 0 && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-1.5">
                          <p className="text-xs font-extrabold text-rose-800 flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4" />
                            Ca chưa đóng — ngày chưa thể chốt
                          </p>
                          {data.openShiftAlerts.shifts.map((s: any, i: number) => (
                            <p key={i} className="text-[11px] text-rose-700 font-mono">
                              {s.warehouseId} · {s.cashierId} · mở lúc {s.openedAt} · đã{' '}
                              {s.elapsedMinutes} phút
                            </p>
                          ))}
                          <p className="text-[11px] text-rose-800 font-semibold">
                            Ngày chưa thể chốt cho tới khi đóng hết các ca trên.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: KIỂM KÊ TỒN KỆ THỰC TẾ VS MÁY */}
              {activeTab === 'STOCKTAKE' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-2xl p-4 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-indigo-900">Bảng Kiểm Kê Tồn Sách Đóng Thùng {isRangeData ? 'Cuối Kỳ' : 'Cuối Ngày'}</p>
                      <p className="text-indigo-700 text-[11px] mt-0.5">
                        Nhập số đếm thực tế của từng đầu sách trên kệ. Hệ thống tự động so khớp với tồn máy để phát hiện thất thoát.
                      </p>
                      {isRangeData && (data as any)?.stockNote && (
                        <p className="text-indigo-700 text-[11px] mt-0.5 italic">{(data as any).stockNote}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block">Kiểm kê thực tế:</span>
                      {/* KHÔNG in "0 cuốn / Khớp 100%" ở đây. Không có số đếm thật
                          (hệ thống chưa lưu, quy trình không đếm cuối ngày) nên
                          0 là HẸN SỐ BỊA, và bản in này đưa cho kế toán — in số 0
                          tạo ra một biên bản "khớp tuyệt đối" rỗng. Nói thẳng là
                          chưa kiểm kê. */}
                      <span className="font-mono font-black text-sm text-slate-400">
                        Chưa kiểm kê
                      </span>
                    </div>
                  </div>

                  {/* Bảng sách kiểm kê */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="p-3 sm:p-3.5 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <p className="text-[11px] text-amber-900 leading-relaxed flex-1 min-w-0">
                        Cột “Kiểm kê thực tế” chưa có dữ liệu: hệ thống chưa lưu số đếm, và
                        quy trình hiện tại không đếm sách cuối ngày. Số tồn dùng để đối chiếu là
                        <strong> tồn lý thuyết</strong> = tồn trong kho − số đã bán.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {/* Chip lọc nhanh sách sắp hết */}
                        <button
                          type="button"
                          aria-pressed={stocktakeOnlyLow}
                          onClick={() => setStocktakeOnlyLow((prev) => !prev)}
                          className={`px-2.5 py-1.5 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-sm ${
                            stocktakeOnlyLow
                              ? 'bg-rose-50 text-rose-800 border-rose-300 ring-2 ring-rose-200'
                              : 'bg-white hover:bg-rose-50/50 text-slate-700 border-slate-300'
                          }`}
                          title="Chỉ hiển thị các đầu sách có tồn lý thuyết ≤ 5 cuốn"
                        >
                          <Flame className={`w-3.5 h-3.5 shrink-0 ${stocktakeOnlyLow ? 'text-rose-600' : 'text-amber-500'}`} />
                          <span>Sắp hết (≤ 5)</span>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                              stocktakeOnlyLow ? 'bg-rose-200 text-rose-900' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {stocktakeLowCount}
                          </span>
                        </button>

                        {/* Nút sắp xếp */}
                        <button
                          type="button"
                          onClick={() => { setStocktakeSortKey('stock'); setStocktakeSortMode((prev) => (prev === 'ASC' ? 'DESC' : 'ASC')); }}
                          className={`px-2.5 py-1.5 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-sm ${
                            stocktakeSortMode === 'ASC'
                              ? 'bg-rose-50 text-rose-800 border-rose-300 ring-2 ring-rose-200'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-100'
                          }`}
                          title="Đổi chiều sắp xếp tồn lý thuyết"
                        >
                          {stocktakeSortMode === 'ASC' ? (
                            <>
                              <ArrowUp className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                              <span>Tồn: {sortLabel('ASC')}</span>
                            </>
                          ) : (
                            <>
                              <ArrowDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                              <span>Tồn: {sortLabel('DESC')}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <table className="w-full min-w-[620px] text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold text-left border-b border-slate-200">
                            <th className="p-3 w-10 text-center">#</th>
                            <th className="p-3">Ấn phẩm sách</th>
                            <th
                              scope="col"
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                if (stocktakeSortKey !== 'sold') {
                                  setStocktakeSortKey('sold');
                                  setStocktakeSoldDir('DESC');
                                } else {
                                  setStocktakeSoldDir((p) => (p === 'DESC' ? 'ASC' : 'DESC'));
                                }
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStocktakeSortKey('sold'); setStocktakeSoldDir((p) => (p === 'DESC' ? 'ASC' : 'DESC')); } }}
                              aria-sort={stocktakeSortKey === 'sold' ? (stocktakeSoldDir === 'DESC' ? 'descending' : 'ascending') : 'none'}
                              title="Bấm để xếp theo số đã bán (cuối kỳ xem cái này trước tồn)"
                              className="p-3 text-right cursor-pointer select-none hover:bg-slate-200 transition-colors"
                            >
                              <span className="inline-flex items-center gap-1">
                                Đã bán
                                <span aria-hidden="true" className={`font-mono text-[10px] ${stocktakeSortKey === 'sold' ? 'text-indigo-600 font-black' : 'text-slate-300'}`}>
                                  {stocktakeSortKey === 'sold' ? (stocktakeSoldDir === 'DESC' ? '▼' : '▲') : '△'}
                                </span>
                              </span>
                            </th>
                            <th
                              scope="col"
                              role="button"
                              tabIndex={0}
                              onClick={() => { setStocktakeSortKey('stock'); setStocktakeSortMode((prev) => (prev === 'ASC' ? 'DESC' : 'ASC')); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStocktakeSortKey('stock'); setStocktakeSortMode((prev) => (prev === 'ASC' ? 'DESC' : 'ASC')); } }}
                              aria-sort={stocktakeSortKey === 'stock' ? (stocktakeSortMode === 'ASC' ? 'ascending' : 'descending') : 'none'}
                              title={`Bấm để đổi chiều sắp xếp tồn lý thuyết. Đang xếp: ${sortLabel(stocktakeSortMode)}`}
                              className="p-3 text-center min-w-[130px] cursor-pointer select-none hover:bg-slate-200 transition-colors"
                            >
                              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                                <span>Tồn lý thuyết</span>
                                {stocktakeSortMode === 'ASC' ? (
                                  <ArrowUp className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                ) : (
                                  <ArrowDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                )}
                              </div>
                              <span className="block font-normal text-[10px] text-slate-500 whitespace-nowrap">
                                {stocktakeSortMode === 'ASC' ? '▲ Bé → Lớn' : stocktakeSortMode === 'DESC' ? '▼ Lớn → Bé' : 'Bấm để xếp'}
                              </span>
                            </th>
                            <th className="p-3 text-center w-32">Kiểm kê thực tế</th>
                            <th className="p-3 text-center w-28">Chênh lệch</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sortedStocktakeList.map((it: any, idx: number) => {
                            const actual = it.theoreticalStock;
                            const isSortedLow = stocktakeSortMode === 'ASC' || stocktakeOnlyLow;
                            const rowHighlightClass = getStockRowHighlightClass(Number(it.theoreticalStock || 0), isSortedLow);
                            const badge = getStockAlertBadge(Number(it.theoreticalStock || 0));

                            return (
                              <tr key={it.editionId} className={`hover:bg-slate-50 transition-colors ${rowHighlightClass}`}>
                                <td className="p-3 text-center font-mono text-slate-400">{idx + 1}</td>
                                <td className="p-3">
                                  <p className="font-bold text-slate-800">
                                    [{it.code}] {it.title}
                                  </p>
                                  <p className="text-[10px] text-slate-400 font-mono">
                                    {it.productKind === 'GOODS' ? 'Giá bán' : 'Giá bìa'}: {(it.coverPrice || 0).toLocaleString('vi-VN')} đ
                                  </p>
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-slate-600">
                                  {it.soldToday || 0}
                                </td>
                                <td className="p-3 text-center font-mono font-bold bg-slate-50/50">
                                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${badge.bgClass} ${badge.textClass} ${badge.borderClass}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dotClass}`} />
                                    <span>{it.theoreticalStock}</span>
                                  </span>
                                </td>
                                <td className="p-3 text-center font-mono text-slate-400">
                                  {actual}
                                </td>
                                <td className="p-3 text-center">
                                  <span className="font-bold text-slate-400 font-mono">Chưa kiểm kê</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Ghi chú kiểm kê bàn giao khi đóng thùng:
                    </label>
                    <input
                      type="text"
                      value={stocktakeNote}
                      onChange={(e) => setStocktakeNote(e.target.value)}
                      placeholder="Ví dụ: Thùng số 1 đủ 120 cuốn, 1 cuốn bị rách gáy để cách ly..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* TAB 3: GIÁM SÁT CHIẾT KHẤU & TOP SELLERS */}
              {activeTab === 'DISCOUNT' && (
                <div className="space-y-5 animate-in fade-in duration-150">
                  {/* Cảnh báo chiết khấu ngày */}
                  {data.financials?.isDiscountRateWarning ? (
                    <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-xs text-rose-800">
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                      <div>
                        <p className="font-bold">CẢNH BÁO TỶ LỆ CHIẾT KHẤU VƯỢT QUY ĐỊNH GIAN HÀNG</p>
                        <p className="text-[11px] mt-0.5">
                          Tỷ lệ chiết khấu bình quân ngày hôm nay là{' '}
                          <strong className="font-mono text-rose-950 font-black">
                            {((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}%
                          </strong>{' '}
                          (Vượt ngưỡng an toàn 20%). Yêu cầu kiểm tra danh sách đơn duyệt đặc biệt bên dưới.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-xs text-emerald-800">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <p className="font-bold">TỶ LỆ CHIẾT KHẤU NẰM TRONG HẠN MỨC AN TOÀN</p>
                        <p className="text-[11px] mt-0.5">
                          Tỷ lệ chiết khấu bình quân đạt{' '}
                          <strong className="font-mono text-emerald-950">
                            {((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}%
                          </strong>{' '}
                          (Dưới trần kiểm soát 20%).
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Danh sách đơn duyệt chiết khấu đặc biệt */}
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-100 px-4 py-3 border-b border-slate-200">
                      <h4 className="font-bold text-xs text-slate-800 uppercase">
                        Đơn Duyệt Chiết Khấu Từ Trần Cho Phép (≥ 20%) ({data.discountSupervision?.overCapOrdersCount || 0})
                      </h4>
                    </div>

                    <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <table className="w-full min-w-[640px] text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 font-bold text-left border-b border-slate-200">
                            <th className="p-3">Mã Đơn</th>
                            <th className="p-3">Thu Ngân</th>
                            <th className="p-3 text-right">Giá Gốc</th>
                            <th className="p-3 text-center">Chiết Khấu</th>
                            <th className="p-3 text-right">Thực Thu</th>
                            <th className="p-3 text-center">Phương Thức</th>
                            <th className="p-3">Người Duyệt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.discountSupervision?.orders?.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="p-6 text-center text-slate-400 italic">
                                Không có đơn nào vượt trần chiết khấu 20% trong ngày.
                              </td>
                            </tr>
                          ) : (
                            data.discountSupervision?.orders?.map((ord: any) => (
                              <tr key={ord.id} className="hover:bg-slate-50">
                                <td className="p-3 font-mono font-bold text-slate-900">{ord.orderCode}</td>
                                <td className="p-3 text-slate-600">{ord.cashierId}</td>
                                <td className="p-3 text-right font-mono text-slate-500">
                                  {(ord.subtotal || 0).toLocaleString('vi-VN')} đ
                                </td>
                                <td className="p-3 text-center font-mono font-bold text-rose-600">
                                  {/* Tiền thật là số chính, tỉ lệ là số phụ. Trước đây
                                      người dùng phải bấm nút đổi đơn vị để xem được
                                      số còn lại, dễ đọc nhầm tỉ lệ thành tổng chiết khấu. */}
                                  <span>
                                    -{(ord.discountAmount || Math.round((ord.subtotal || 0) * (ord.discountRate || 0))).toLocaleString('vi-VN')} đ
                                  </span>
                                  <span className="block text-[10px] text-slate-400 font-normal">
                                    {Math.round((ord.discountRate || 0) * 100)}%
                                  </span>
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-slate-900">
                                  {(ord.finalAmount || 0).toLocaleString('vi-VN')} đ
                                </td>
                                <td className="p-3 text-center">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 font-mono">
                                    {ord.approvalMethod}
                                  </span>
                                </td>
                                <td className="p-3 font-semibold text-slate-700">{ord.approvedBy}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Chân modal dính đáy: nút In và Đóng luôn ở tầm tay.
            Trước đây chúng nằm trên cùng, giữa báo cáo dài vài trăm dòng thì
            phải cuộn hết lên mới bấm được — đúng lúc người dùng cần nhất. */}
        <div className="no-print sticky bottom-0 z-10 shrink-0 px-3 sm:px-6 py-2 bg-slate-900 text-white flex items-center justify-between gap-2 border-t border-slate-700">
          <button
            onClick={fetchSettlement}
            disabled={isLoading}
            aria-label="Tải lại số liệu báo cáo"
            title="Tải lại số liệu"
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-slate-700 transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <div className="flex items-center gap-2">
            {canExportCsv && isRangeData && (
              <button
                onClick={handleExportCsv}
                disabled={isLoading || isExportingCsv || !data}
                aria-label="Xuất CSV báo cáo cả kỳ"
                title={isRangeData && printStart && printEnd ? `Xuất 3 file CSV kỳ ${printStart}→${printEnd}` : 'Xuất 3 file CSV kỳ đang xem'}
                className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-50 cursor-pointer"
              >
                <ArrowDown className="w-4 h-4" />
                <span>{isExportingCsv ? 'Đang xuất…' : 'Xuất CSV'}</span>
              </button>
            )}
            <button
              onClick={handlePrint}
              disabled={isLoading || !data}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-50 cursor-pointer"
              title="In báo cáo chốt ngày"
            >
              <Printer className="w-4 h-4" />
              <span>In Báo Cáo</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Đóng báo cáo"
              title="Đóng"
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-700 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ============================================================== */}
        {/* NỘI DUNG BIÊN BẢN CHỐT CA KHỔ A4 (CHỈ HIỂN THỊ KHI IN window.print) */}
        {/* ============================================================== */}
        {data && createPortal(
          <div id="printable-settlement-report" className="hidden print:block bg-white text-slate-800 text-[12px] font-sans leading-normal">
            {/* Khối in PHẢI createPortal riêng xuống `document.body`. Nằm trong
                khung modal `overflow-hidden max-h-[92vh]` thì lúc in khung cha
                cắt mất toàn bộ biên bản, window.print() ra trang trắng — đúng
                triệu chứng "bấm In không hiện gì". Ở đây nó là ANH EM của
                backdrop, không nằm trong khung cắt nào. */}
            {/* Header doanh nghiệp */}
            <div className="flex justify-between items-start border-b border-slate-300 pb-3 mb-4">
              <div>
                <h4 className="font-sans font-black text-base tracking-wider uppercase text-slate-900">
                  FORMApubli
                </h4>
                <p className="text-[12px] text-slate-600 mt-1">
                  Gian hàng / Địa điểm: <strong className="text-slate-800">{data.warehouse?.name}</strong> ({data.warehouse?.code})
                </p>
                <p className="text-[12px] text-slate-600">
                  {isRangeData ? (
                    <>Kỳ kết toán: <strong>{printStart} → {printEnd}</strong></>
                  ) : (
                    <>Ngày kết toán: <strong>{data.reportDate}</strong></>
                  )}
                </p>
              </div>
              <div className="text-right text-[12px] text-slate-600">
                <p className="font-bold text-slate-900 text-[12.5px]">BIÊN BẢN SỐ: {isRangeData && printStart && printEnd ? `BB-${printStart.replace(/-/g, '')}-${printEnd.replace(/-/g, '')}` : `BB-${data.reportDate.replace(/-/g, '')}`}</p>
                <p className="text-[11.5px] text-slate-500 italic mt-1">
                  Lập lúc: {new Date().toLocaleTimeString('vi-VN')} ngày {new Date().toLocaleDateString('vi-VN')}
                </p>
              </div>
            </div>

            {/* Tiêu đề Báo Cáo & Biên Bản */}
            <div className="text-center my-3.5">
              <h1 className="font-sans font-bold text-[19px] tracking-wide uppercase text-slate-900">
                {isRangeData ? 'BÁO CÁO DOANH THU & KẾT TOÁN KỲ' : 'BÁO CÁO DOANH THU & KẾT TOÁN NGÀY'}
              </h1>
              <p className="italic text-[12.5px] text-slate-600 mt-1">
                (Biên bản bàn giao ca, đối soát két tiền và kiểm kê tồn kho)
              </p>
            </div>

            {/* I. CHỈ SỐ KINH DOANH & PHÂN TÍCH ĐƠN HÀNG */}
            <div className="print-block mb-4 font-sans">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1 mb-2.5 tracking-wide text-[13px]">
                I. CHỈ SỐ KINH DOANH & PHÂN TÍCH ĐƠN
              </h3>
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-[12px] text-slate-700">
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Doanh thu thực thu:</span>
                  <strong className="font-mono text-slate-950 font-bold">{(data.financials?.netSales || 0).toLocaleString('vi-VN')} đ</strong>
                </div>
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Tổng số đơn bán ra:</span>
                  <strong className="text-slate-950">
                    <span className="font-mono font-bold">{totalOrdersCount}</span> đơn ({cashOrdersCount} TM · {qrTransferOrdersCount} CK)
                  </strong>
                </div>

                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Doanh thu gộp:</span>
                  <strong className="font-mono text-slate-900 font-semibold">{(data.financials?.grossSales || 0).toLocaleString('vi-VN')} đ</strong>
                </div>
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Tổng số cuốn đã bán:</span>
                  <strong className="font-mono text-slate-900 font-semibold">{soldTodayTotal} cuốn</strong>
                </div>

                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Chiết khấu thương mại:</span>
                  <strong className="font-mono text-slate-900 font-semibold">
                    {((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}% (-{(data.financials?.totalDiscount || 0).toLocaleString('vi-VN')} đ)
                  </strong>
                </div>
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Giá trị trung bình / đơn (AOV):</span>
                  <strong className="font-mono text-slate-900 font-semibold">{averageOrderValue.toLocaleString('vi-VN')} đ/đơn</strong>
                </div>

                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Cơ cấu đơn:</span>
                  <strong className="text-slate-900 font-semibold">
                    {cashOrdersCount} TM ({cashOrdersShare}%) · {qrTransferOrdersCount} CK ({qrOrdersShare}%)
                  </strong>
                </div>
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Số cuốn trung bình / đơn:</span>
                  <strong className="font-mono text-slate-900 font-semibold">{averageItemsPerOrder} cuốn/đơn</strong>
                </div>
              </div>
            </div>

            {/* II. CƠ CẤU THANH TOÁN & ĐỐI SOÁT KÉT TIỀN */}
            <div className="print-block mb-4 font-sans">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1 mb-2.5 tracking-wide text-[13px]">
                II. CƠ CẤU THANH TOÁN & ĐỐI SOÁT KÉT TIỀN
              </h3>
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-[12px] text-slate-700">
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>+ Doanh số Tiền mặt:</span>
                  <strong className="font-mono text-slate-900 font-semibold">
                    {(data.paymentBreakdown?.cash?.sales || 0).toLocaleString('vi-VN')} đ ({cashOrdersCount} đơn · {data.paymentBreakdown?.cash?.percentage || 0}%)
                  </strong>
                </div>
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>+ Doanh số Chuyển khoản QR:</span>
                  <strong className="font-mono text-slate-900 font-semibold">
                    {(data.paymentBreakdown?.qrTransfer?.sales || 0).toLocaleString('vi-VN')} đ ({qrTransferOrdersCount} đơn · {data.paymentBreakdown?.qrTransfer?.percentage || 0}%)
                  </strong>
                </div>

                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Tiền đầu ca bàn giao{isRangeData ? ' (cộng mọi ca trong kỳ)' : ''}:</span>
                  <strong className="font-mono text-slate-900 font-semibold">
                    {(data.cashboxReconciliation?.openingCashTotal || 0).toLocaleString('vi-VN')} đ
                  </strong>
                </div>
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Tiền mặt kỳ vọng trong két:</span>
                  <strong className="font-mono text-slate-900 font-semibold">
                    {(data.cashboxReconciliation?.expectedCashTotal || 0).toLocaleString('vi-VN')} đ
                  </strong>
                </div>

                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Tiền mặt thực tế đếm được:</span>
                  <strong className="font-mono text-slate-900 font-semibold">
                    {(data.cashboxReconciliation?.closingCashActualTotal || 0).toLocaleString('vi-VN')} đ
                  </strong>
                </div>
                <div className="flex justify-between items-baseline py-0.5 border-b border-slate-100">
                  <span>- Chênh lệch két tiền:</span>
                  <strong className="font-mono font-bold text-slate-900">
                    {data.cashboxReconciliation?.cashVariance === 0
                      ? 'Khớp 100%'
                      : (data.cashboxReconciliation?.cashVariance ?? 0) > 0
                      ? `Thừa: +${(data.cashboxReconciliation?.cashVariance ?? 0).toLocaleString('vi-VN')} đ`
                      : data.cashboxReconciliation?.cashVariance === null || data.cashboxReconciliation?.cashVariance === undefined
                      ? 'Chưa thể đối soát (Ca chưa đóng)'
                      : `Thiếu: ${(data.cashboxReconciliation?.cashVariance ?? 0).toLocaleString('vi-VN')} đ`}
                  </strong>
                </div>
              </div>

              {/* Tiền mặt theo từng ca — kỳ dài cắt 20 ca đầu + ghi rõ còn lại để
                  không tràn A4 (số tổng đã có ở trên, không mất thông tin). */}
              <div className="mt-3">
                <p className="font-bold uppercase text-slate-800 text-[12px] mb-1.5">- Tiền mặt bán theo từng ca:</p>
                {(data.cashboxReconciliation?.sessions || []).length === 0 ? (
                  <p className="italic text-slate-500 text-[12px] py-1 text-center border border-dashed border-slate-200 rounded">
                    Không có ca két nào {isRangeData ? 'trong kỳ' : 'trong ngày'}.
                  </p>
                ) : (
                  <table className="w-full border-collapse border border-slate-300 text-[12px]">
                    <thead>
                      <tr className="bg-slate-100 font-semibold text-slate-800 text-center">
                        <th className="border border-slate-300 py-1.5 px-2 text-left">Thu ngân</th>
                        <th className="border border-slate-300 py-1.5 px-2 w-24 text-center">Giờ mở</th>
                        <th className="border border-slate-300 py-1.5 px-2 w-24 text-center">Giờ đóng</th>
                        <th className="border border-slate-300 py-1.5 px-2 w-32 text-right">Tiền mặt bán</th>
                        <th className="border border-slate-300 py-1.5 px-2 w-24 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.cashboxReconciliation?.sessions || []).slice(0, isRangeData ? 20 : undefined).map((s: any) => (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="border border-slate-300 py-1.5 px-2 font-mono text-slate-900">{s.cashierId}</td>
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-mono text-slate-700">{vnHm(s.openedAt) || '—'}</td>
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-mono text-slate-700">
                            {s.closedAt ? vnHm(s.closedAt) : '—'}
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2 text-right font-mono font-semibold text-slate-900">
                            {(Number(s.expectedCashLive || 0) - Number(s.openingCash || 0)).toLocaleString('vi-VN')} đ
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2 text-center text-slate-700">
                            {s.status === 'OPEN' ? 'Còn mở' : 'Đã đóng'}
                          </td>
                        </tr>
                      ))}
                      {isRangeData && (data.cashboxReconciliation?.sessions || []).length > 20 && (
                        <tr>
                          <td colSpan={5} className="border border-slate-300 py-1.5 px-2 text-center italic text-slate-500">
                            +{(data.cashboxReconciliation?.sessions || []).length - 20} ca khác (số tổng đã gồm đủ ở trên)
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* III. ĐƠN VƯỢT TRẦN CHIẾT KHẤU */}
            <div className="print-block mb-4 font-sans">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1 mb-2.5 tracking-wide text-[13px]">
                III. ĐƠN VƯỢT TRẦN CHIẾT KHẤU (≥ 20%) — {overCapCount} ĐƠN
              </h3>
              <table className="w-full border-collapse border border-slate-300 text-[12px]">
                <thead>
                  <tr className="bg-slate-100 font-semibold text-slate-800 text-center">
                    <th className="border border-slate-300 py-1.5 px-2 w-10">#</th>
                    <th className="border border-slate-300 py-1.5 px-2 w-28">Mã đơn</th>
                    <th className="border border-slate-300 py-1.5 px-2 text-left">Thu ngân</th>
                    <th className="border border-slate-300 py-1.5 px-2 w-16 text-center">CK</th>
                    <th className="border border-slate-300 py-1.5 px-2 w-28 text-right">Thực thu</th>
                    <th className="border border-slate-300 py-1.5 px-2 text-left">Người duyệt</th>
                  </tr>
                </thead>
                <tbody>
                  {overCapOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="border border-slate-300 py-2.5 px-2 text-center text-slate-500 italic">
                        Không có đơn vượt trần chiết khấu 20% trong ngày.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {overCapOrders.slice(0, 10).map((ord: any, idx: number) => (
                        <tr key={ord.id} className="hover:bg-slate-50">
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-mono text-slate-600">{idx + 1}</td>
                          <td className="border border-slate-300 py-1.5 px-2 font-mono font-bold text-slate-900">{ord.orderCode}</td>
                          <td className="border border-slate-300 py-1.5 px-2 font-mono text-slate-800">{ord.cashierId}</td>
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-mono font-semibold text-amber-700">
                            {Math.round((ord.discountRate || 0) * 100)}%
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2 text-right font-mono font-semibold text-slate-900">
                            {(ord.finalAmount || 0).toLocaleString('vi-VN')} đ
                          </td>
                          <td className="border border-slate-300 py-1.5 px-2 text-slate-800">{ord.approvedBy}</td>
                        </tr>
                      ))}
                      {overCapOrders.length > 10 && (
                        <tr>
                          <td colSpan={6} className="border border-slate-300 py-1.5 px-2 text-center italic font-semibold text-slate-600">
                            +{overCapOrders.length - 10} đơn khác (xem trên màn hình)
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {/* IV. TỒN SÁCH CUỐI NGÀY */}
            <div className="print-table-block mb-4 font-sans">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1 mb-2.5 tracking-wide text-[13px]">
                {isRangeData ? 'IV. TỒN SÁCH HIỆN TẠI (ẤN PHẨM ĐÃ BÁN TRONG KỲ)' : 'IV. TỒN SÁCH CUỐI NGÀY (ẤN PHẨM ĐÃ BÁN)'}
              </h3>
              {isRangeData && (data as any)?.stockNote && (
                <p className="text-[11.5px] italic text-slate-600 mb-2">{(data as any).stockNote}</p>
              )}
              <table className="w-full border-collapse border border-slate-300 text-[11.5px]">
                <thead>
                  <tr className="bg-slate-100 font-semibold text-slate-800 text-center">
                    <th className="border border-slate-300 py-1 px-2 w-10">#</th>
                    <th className="border border-slate-300 py-1 px-2 w-20">Mã</th>
                    <th className="border border-slate-300 py-1 px-2 text-left">Tên ấn phẩm</th>
                    <th className="border border-slate-300 py-1 px-2 w-20 text-right">Đã bán</th>
                    <th className="border border-slate-300 py-1 px-2 w-24 text-right">Tồn còn</th>
                  </tr>
                </thead>
                <tbody>
                  {soldOnlyRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-slate-300 py-2 px-2 text-center text-slate-500 italic">
                        {isRangeData ? 'Trong kỳ không bán ấn phẩm nào.' : 'Trong ngày không bán ấn phẩm nào.'}
                      </td>
                    </tr>
                  ) : (
                    soldOnlyRows.map((it: any, idx: number) => (
                      <tr key={it.editionId} className="hover:bg-slate-50">
                        <td className="border border-slate-300 py-1 px-2 text-center font-mono text-slate-600">{idx + 1}</td>
                        <td className="border border-slate-300 py-1 px-2 text-center font-mono font-bold text-slate-900">{it.code}</td>
                        <td className="border border-slate-300 py-1 px-2 text-slate-900">{it.title}</td>
                        <td className="border border-slate-300 py-1 px-2 text-right font-mono font-semibold text-slate-900">{it.soldToday || 0}</td>
                        <td className="border border-slate-300 py-1 px-2 text-right font-mono font-bold text-slate-900">
                          {it.theoreticalStock}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {/* Tổng kết số cuốn đã bán & tồn lý thuyết */}
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 mt-2 text-[11.5px] text-slate-700">
                <div className="flex justify-between py-0.5 border-b border-slate-100">
                  <span>- TỔNG SỐ CUỐN BÁN RA:</span>
                  <strong className="font-mono font-bold text-slate-950">{soldTodayTotal} cuốn</strong>
                </div>
                <div className="flex justify-between py-0.5 border-b border-slate-100">
                  <span>- Chiết khấu bình quân:</span>
                  <strong className="font-mono font-bold text-slate-950">
                    {((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}%
                  </strong>
                </div>
              </div>
              <p className="text-[11.5px] mt-1.5 text-slate-700">
                - TỔNG SỐ CUỐN TỒN LÝ THUYẾT: <strong className="font-mono font-bold text-slate-950">{totalTheoreticalBooks} cuốn</strong>{' '}
                <span className="italic text-slate-500">(tính theo xuất nhập tồn máy tính, chưa kiểm kê thực tế)</span>
              </p>
              {stocktakeNote && (
                <p className="text-[11.5px] italic mt-1 text-slate-600">
                  Ghi chú đóng thùng: {stocktakeNote}
                </p>
              )}
            </div>

            {/* V. SẮP HẾT — nhóm phải đếm lúc đóng thùng. Chỉ ở chế độ ngày:
                cuối kỳ gộp vào MỘT bảng IV xếp theo đã bán (tồn còn nằm ngay
                cạnh), không in riêng bảng sắp hết nữa. */}
            {!isRangeData && (
            <div className="print-block mb-4 font-sans">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1 mb-2.5 tracking-wide text-[13px]">
                V. SẮP HẾT (TỒN ≤ {STOCK_THRESHOLD_WARNING}) — CẦN ĐẾM CUỐI NGÀY
              </h3>
              <table className="w-full border-collapse border border-slate-300 text-[11.5px]">
                <thead>
                  <tr className="bg-slate-100 font-semibold text-slate-800 text-center">
                    <th className="border border-slate-300 py-1 px-2 w-10">#</th>
                    <th className="border border-slate-300 py-1 px-2 w-20">Mã</th>
                    <th className="border border-slate-300 py-1 px-2 text-left">Tên ấn phẩm</th>
                    <th className="border border-slate-300 py-1 px-2 w-24 text-right">Tồn còn</th>
                    <th className="border border-slate-300 py-1 px-2 w-32 text-center">Số đếm thực tế</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-slate-300 py-2 px-2 text-center text-slate-500 italic">
                        Không có ấn phẩm nào tồn ≤ {STOCK_THRESHOLD_WARNING} cuốn.
                      </td>
                    </tr>
                  ) : (
                    lowStockRows.map((it: any, idx: number) => (
                      <tr key={it.editionId}>
                        <td className="border border-slate-300 py-1 px-2 text-center font-mono text-slate-600">{idx + 1}</td>
                        <td className="border border-slate-300 py-1 px-2 text-center font-mono font-bold text-slate-900">{it.code}</td>
                        <td className="border border-slate-300 py-1 px-2 text-slate-900">{it.title}</td>
                        <td className="border border-slate-300 py-1 px-2 text-right font-mono font-bold text-slate-900">
                          {it.theoreticalStock}
                        </td>
                        {/* Hệ thống KHÔNG lưu số đếm — để trống cho nhân viên điền tay. */}
                        <td className="border border-slate-300 py-1 px-2" />
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <p className="text-[11.5px] italic mt-1 text-slate-600">
                Xếp theo tồn {sortLabel('ASC').toLowerCase()}. Số đếm thực tế do nhân viên điền tay — hệ thống chưa lưu số đếm.
              </p>
            </div>
            )}

            {/* VI. PHÂN TÍCH NHỊP ĐỘ BÁN HÀNG & ẤN PHẨM NỔI BẬT
                (mục V là bảng Sắp hết ở trên — đánh số theo thứ tự thật trên giấy) */}
            <div className="print-block mb-4 font-sans">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1 mb-2.5 tracking-wide text-[13px]">
                VI. PHÂN TÍCH NHỊP ĐỘ BÁN HÀNG & ẤN PHẨM NỔI BẬT
              </h3>
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-[12px] text-slate-700">
                <div className="py-0.5">
                  {data.highlight ? (
                    <span>
                      - Đơn lớn nhất: <strong className="font-mono text-slate-900">{data.highlight.orderCode}</strong> ·{' '}
                      <strong>{(data.highlight.finalAmount || 0).toLocaleString('vi-VN')} đ</strong> ·{' '}
                      {paymentMethodLabel(data.highlight.paymentMethod)} · <strong>{data.highlight.itemCount || 0} SP</strong>
                      {vnHm(data.highlight.createdAt) ? ` (${vnHm(data.highlight.createdAt)})` : ''}
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">- Không có đơn phát sinh {isRangeData ? 'trong kỳ' : 'trong ngày'}.</span>
                  )}
                </div>
                <div className="py-0.5">
                  {isRangeData ? (
                    (data?.peakDay as any)?.orders > 0 ? (
                      <span>
                        - Ngày đỉnh kỳ: <strong className="font-mono text-slate-900">{ddmm((data?.peakDay as any).date)}</strong> (<strong>{(data?.peakDay as any).orders} đơn</strong> · <strong>{Number((data?.peakDay as any).sales || 0).toLocaleString('vi-VN')} đ</strong>)
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">- Chưa ghi nhận ngày đỉnh kỳ.</span>
                    )
                  ) : peakHourOrders > 0 ? (
                    <span>
                      - Khung giờ cao điểm: <strong className="font-mono text-slate-900">{peakHourNumber}h</strong> (<strong>{peakHourOrders} đơn</strong> · <strong>{peakHourSales.toLocaleString('vi-VN')} đ</strong>)
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">- Chưa ghi nhận mốc giờ cao điểm.</span>
                  )}
                </div>
              </div>

              {/* Dải giờ VN vẽ bằng SVG: viewBox 720x68 với BASE_Y=48 và PLOT_H=30 chống lẹm số.
                  Chỉ ở chế độ ngày — chế độ kỳ dùng dải theo ngày bên dưới. */}
              {!isRangeData && (
              <>
              <div className="mt-2.5">
                <p className="font-bold uppercase text-slate-800 text-[12px] mb-1">
                  - Số đơn theo giờ ({hourWin.start}h–{hourEndShown}h, giờ Việt Nam):
                </p>
                <svg
                  viewBox={`0 0 ${BAND_W} ${BAND_H}`}
                  className="w-full h-auto mt-1"
                  fontFamily="monospace"
                  role="img"
                  aria-label={`Số đơn bán theo từng giờ từ ${hourWin.start}h đến ${hourEndShown}h giờ Việt Nam`}
                >
                  {/* Trục đáy mỏng định vị biểu đồ */}
                  <line x1="0" y1={BAND_BASE_Y} x2={BAND_W} y2={BAND_BASE_Y} stroke="#cbd5e1" strokeWidth="1" />

                  {hourlyInWindow.map((h: any, i: number) => {
                    const n = Number(h.orders || 0);
                    const bh = bandBarH(n);
                    const x = (i * bandSlot + 4).toFixed(2);
                    const wRect = Math.max(4, bandSlot - 8).toFixed(2);
                    const isPeak = i === peakIndex && n > 0;
                    return n > 0 ? (
                      <rect
                        key={h.hour}
                        x={x}
                        y={BAND_BASE_Y - bh}
                        width={wRect}
                        height={bh}
                        rx="3"
                        fill="#4f46e5"
                      />
                    ) : (
                      <rect
                        key={h.hour}
                        x={x}
                        y={BAND_BASE_Y - bh}
                        width={wRect}
                        height={bh}
                        rx="1"
                        fill="#cbd5e1"
                      />
                    );
                  })}
                  {/* Số lượng đơn trên các cột có phát sinh đơn (chống lẹm với headroom an toàn) */}
                  {hourlyInWindow.map((h: any, i: number) => {
                    const n = Number(h.orders || 0);
                    if (n <= 0) return null;
                    const bh = bandBarH(n);
                    const isPeak = i === peakIndex;
                    return (
                      <text
                        key={`val-${h.hour}`}
                        x={(i * bandSlot + bandSlot / 2).toFixed(2)}
                        y={BAND_BASE_Y - bh - 4}
                        textAnchor="middle"
                        fontSize={isPeak ? '10.5' : '9.5'}
                        fontWeight={isPeak ? '900' : 'bold'}
                        fill={isPeak ? '#1e1b4b' : '#334155'}
                      >
                        {n}
                      </text>
                    );
                  })}
                  {/* Nhãn giờ: mỗi 3 giờ một nhãn, cộng thêm hai đầu khung */}
                  {hourlyInWindow.map((h: any, i: number) => {
                    const hour = Number(h.hour);
                    const isEnd = i === hourlyInWindow.length - 1;
                    if (hour % 3 !== 0 && i !== 0 && !isEnd) return null;
                    return (
                      <text
                        key={`nhan-${h.hour}`}
                        x={(i * bandSlot + bandSlot / 2).toFixed(2)}
                        y={BAND_BASE_Y + 14}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="500"
                        fill="#475569"
                      >
                        {hour}h
                      </text>
                    );
                  })}
                </svg>
              </div>

              {/* Dải doanh thu theo giờ — cùng khung giờ với dải đơn ở trên,
                  thang riêng theo đồng (không chung thang đếm đơn). In SVG thuần
                  rect/text nên không mất hình khi tắt "Background graphics". */}
              <div className="mt-2.5">
                <p className="font-bold uppercase text-slate-800 text-[12px] mb-1">
                  - Doanh thu theo giờ ({hourWin.start}h–{hourEndShown}h, giờ Việt Nam):
                </p>
                <svg
                  viewBox={`0 0 ${BAND_W} ${BAND_H}`}
                  className="w-full h-auto mt-1"
                  fontFamily="monospace"
                  role="img"
                  aria-label={`Doanh thu theo từng giờ từ ${hourWin.start}h đến ${hourEndShown}h giờ Việt Nam`}
                >
                  {/* Trục đáy mỏng định vị biểu đồ */}
                  <line x1="0" y1={BAND_BASE_Y} x2={BAND_W} y2={BAND_BASE_Y} stroke="#cbd5e1" strokeWidth="1" />

                  {hourlyInWindow.map((h: any, i: number) => {
                    const n = Number(h.sales || 0);
                    const bh = bandBarHMoney(n);
                    const x = (i * bandSlot + 4).toFixed(2);
                    const wRect = Math.max(4, bandSlot - 8).toFixed(2);
                    return n > 0 ? (
                      <rect
                        key={h.hour}
                        x={x}
                        y={BAND_BASE_Y - bh}
                        width={wRect}
                        height={bh}
                        rx="3"
                        fill="#059669"
                      />
                    ) : (
                      <rect
                        key={h.hour}
                        x={x}
                        y={BAND_BASE_Y - bh}
                        width={wRect}
                        height={bh}
                        rx="1"
                        fill="#cbd5e1"
                      />
                    );
                  })}
                  {/* Tiền thu trên các cột có phát sinh (nhãn gọn Tr/N) */}
                  {hourlyInWindow.map((h: any, i: number) => {
                    const n = Number(h.sales || 0);
                    if (n <= 0) return null;
                    const bh = bandBarHMoney(n);
                    const isPeak = i === peakSalesIndex;
                    return (
                      <text
                        key={`tien-${h.hour}`}
                        x={(i * bandSlot + bandSlot / 2).toFixed(2)}
                        y={BAND_BASE_Y - bh - 4}
                        textAnchor="middle"
                        fontSize={isPeak ? '10.5' : '9.5'}
                        fontWeight={isPeak ? '900' : 'bold'}
                        fill={isPeak ? '#064e3b' : '#334155'}
                      >
                        {bandMoneyShort(n)}
                      </text>
                    );
                  })}
                  {/* Nhãn giờ: mỗi 3 giờ một nhãn, cộng thêm hai đầu khung */}
                  {hourlyInWindow.map((h: any, i: number) => {
                    const hour = Number(h.hour);
                    const isEnd = i === hourlyInWindow.length - 1;
                    if (hour % 3 !== 0 && i !== 0 && !isEnd) return null;
                    return (
                      <text
                        key={`nhan-tien-${h.hour}`}
                        x={(i * bandSlot + bandSlot / 2).toFixed(2)}
                        y={BAND_BASE_Y + 14}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="500"
                        fill="#475569"
                      >
                        {hour}h
                      </text>
                    );
                  })}
                </svg>
              </div>
              </>
              )}

              {isRangeData && (
              <>
              <DayBand
                days={(data?.days || []) as Array<{ date: string; orders: number; sales: number }>}
                value="orders"
                color="#4f46e5"
                peakColor="#1e1b4b"
                caption={`- Số đơn theo ngày (${printStart} → ${printEnd}):`}
                ariaLabel={`Số đơn bán theo từng ngày từ ${printStart} đến ${printEnd}`}
                formatVal={(n) => `${n}`}
              />
              <DayBand
                days={(data?.days || []) as Array<{ date: string; orders: number; sales: number }>}
                value="sales"
                color="#059669"
                peakColor="#064e3b"
                caption={`- Doanh thu theo ngày (${printStart} → ${printEnd}):`}
                ariaLabel={`Doanh thu theo từng ngày từ ${printStart} đến ${printEnd}`}
                formatVal={(n) => bandMoneyShort(n)}
              />
              </>
              )}

              {/* Top 10 Bán chạy */}
              <div className="mt-3">
                <p className="font-bold uppercase text-slate-800 text-[12px] mb-1.5">
                  - Top 10 ấn phẩm bán chạy nhất:
                </p>
                <table className="w-full border-collapse border border-slate-300 text-[12px]">
                  <thead>
                    <tr className="bg-slate-100 font-semibold text-slate-800 text-center">
                      <th className="border border-slate-300 py-1.5 px-2 w-10">#</th>
                      <th className="border border-slate-300 py-1.5 px-2 w-20">Mã</th>
                      <th className="border border-slate-300 py-1.5 px-2 text-left">Tên ấn phẩm</th>
                      <th className="border border-slate-300 py-1.5 px-2 w-20 text-right">Số cuốn</th>
                      <th className="border border-slate-300 py-1.5 px-2 w-28 text-right">Doanh thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.topSellers || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="border border-slate-300 py-2.5 px-2 text-center text-slate-500 italic">
                          Không có ấn phẩm nào bán ra trong ngày.
                        </td>
                      </tr>
                    ) : (
                      (data.topSellers || []).map((s: any, i: number) => (
                        <tr key={s.editionId} className="hover:bg-slate-50">
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-mono text-slate-600">{i + 1}</td>
                          <td className="border border-slate-300 py-1.5 px-2 text-center font-mono font-bold text-slate-900">{s.code}</td>
                          <td className="border border-slate-300 py-1.5 px-2 text-slate-900">{s.title}</td>
                          <td className="border border-slate-300 py-1.5 px-2 text-right font-mono font-semibold text-slate-900">{s.soldCopies}</td>
                          <td className="border border-slate-300 py-1.5 px-2 text-right font-mono font-semibold text-slate-900">
                            {(s.soldRevenue || 0).toLocaleString('vi-VN')} đ
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {data.giftSummary?.totalGiftCopies > 0 && (
                  <p className="mt-1.5 text-[11px] text-slate-600 italic">
                    * Đã phát {data.giftSummary.totalGiftCopies} phần quà tặng kèm ({data.giftSummary.items?.map((g: any) => `${g.title}: ${g.copies}`).join(', ')}) — không tính vào doanh số bán chạy.
                  </p>
                )}
              </div>
            </div>

            {/* VI. XÁC NHẬN BÀN GIAO (CHỮ KÝ 3 BÊN) */}
            <div className="print-block font-sans grid grid-cols-3 gap-6 text-center mt-6 pt-2">
              <div>
                <p className="font-bold uppercase text-slate-900 text-[12.5px]">Thu ngân lập biên bản</p>
                <p className="italic text-[11.5px] text-slate-500 mt-0.5">(Ký, ghi rõ họ tên)</p>
                <div className="h-20" />
                <p className="text-slate-400 text-xs">................................................</p>
              </div>

              <div>
                <p className="font-bold uppercase text-slate-900 text-[12.5px]">Quản lý gian hàng / Trưởng ca</p>
                <p className="italic text-[11.5px] text-slate-500 mt-0.5">(Ký, ghi rõ họ tên)</p>
                <div className="h-20" />
                <p className="text-slate-400 text-xs">................................................</p>
              </div>

              <div>
                <p className="font-bold uppercase text-slate-900 text-[12.5px]">Thủ kho nhận bàn giao sách</p>
                <p className="italic text-[11.5px] text-slate-500 mt-0.5">(Ký, ghi rõ họ tên)</p>
                <div className="h-20" />
                <p className="text-slate-400 text-xs">................................................</p>
              </div>
            </div>
          </div>,
          document.body
        )}
        {/* Modal Bổ Sung Tiền Thực Đếm Két */}
        <CashboxAuditCountModal
          isOpen={isAuditModalOpen}
          onClose={() => setIsAuditModalOpen(false)}
          onSuccess={fetchSettlement}
          sessions={data?.cashboxReconciliation?.sessions || []}
          initialSessionId={auditModalSessionId}
        />
        {/* Nhịp Bán 1 món trong kỳ đang xem (day mode = kỳ 1 ngày) */}
        <ProductFlowDrawer
          open={flowOpen}
          onClose={() => setFlowOpen(false)}
          warehouseId={currentWarehouseId}
          startDate={flowStart}
          endDate={flowEnd}
          currentRole={currentRole as UserRole}
        />
      </div>
    </div>,
    document.body
  );
}
