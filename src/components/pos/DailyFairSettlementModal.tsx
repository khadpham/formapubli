'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Receipt,
  Banknote,
  QrCode,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Printer,
  Calendar,
  Building2,
  TrendingUp,
  Package,
  Boxes,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  X,
  Lock,
  Layers,
  Percent,
  Trophy,
} from 'lucide-react';
import { parseDbTimestamp } from '@/lib/db-timestamp';

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

// Hình học dải giờ trên bản in: viewBox 240×46, co giãn theo bề rộng khung in.
// Nét VÀ CHỮ đều là nội dung SVG nên in mặc định (khác màu nền CSS).
const BAND_W = 240;
const BAND_H = 46;
const BAND_BASE_Y = 34;
const BAND_PLOT_H = 26;

/** Nhãn tiếng Việt của hình thức thanh toán — cùng cách chia 3 nhóm với service. */
function paymentMethodLabel(method: string | null | undefined): string {
  const key = (method || 'CASH').toUpperCase();
  if (key === 'CASH') return 'Tiền mặt';
  if (key === 'BANK_TRANSFER' || key === 'QR_CODE' || key === 'TRANSFER') return 'Chuyển khoản';
  return 'Thẻ';
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
  const [isLoading, setIsLoading] = useState(false);
  const [currentWarehouseId, setCurrentWarehouseId] = useState(warehouseId);
  const [warehouseList, setWarehouseList] = useState<any[]>([]);
  const [discountDisplayMode, setDiscountDisplayMode] = useState<'PERCENT' | 'VND'>('PERCENT');
  // Ngày mặc định phải là NGÀY NGHIỆP VỤ VIỆT NAM. Trước đây dùng
  // `toISOString().slice(0,10)` là ngày UTC ⇒ từ 00:00 đến 07:00 giờ VN, modal mở
  // báo cáo của HÔM QUA, lệch hẳn với cron chốt ngày theo giờ VN.
  // Tính tại chỗ (không import từ order.service) vì đó là module server nặng —
  // import vào client component sẽ kéo cả tầng db vào bundle. Cùng cách với
  // `vnToday()` ở GET /api/pos/live-monitor.
  const [selectedDate, setSelectedDate] = useState(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
  );
  const [activeTab, setActiveTab] = useState<'FINANCIALS' | 'STOCKTAKE' | 'DISCOUNT'>('FINANCIALS');

  // Số đếm thực tế KHÔNG được lưu ở đâu: chỉ nằm trong useState này, không có
  // lệnh nào gửi đi. Chủ sở hữu đã quyết định (2026-09-29): cuối ngày không đếm
  // sách thật, tồn tính bằng "tồn trong kho − số bán" — đúng bằng cột
  // theoreticalStock mà API đã trả sẵn. Nên bỏ ô nhập, chỉ hiện tồn lý thuyết và
  // nói rõ chưa kiểm kê, để không ai tưởng đã đếm.
  const [stocktakeNote, setStocktakeNote] = useState('');
  const [mounted, setMounted] = useState(false);
  // Lý do chặn in, hiện ra màn hình. Trước đây handlePrint gọi window.print()
  // vô điều kiện nên bấm lúc chưa tải xong (hoặc tải lỗi) ra đúng MỘT TRANG
  // TRẮNG — người dùng tưởng máy in hỏng. Giữ thông báo ở state để nói rõ
  // vì sao không in, thay vì im lặng cho ra trang trắng.
  const [printNotice, setPrintNotice] = useState<string | null>(null);

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
    try {
      const res = await fetch(
        `/api/pos/daily-settlement?warehouseId=${encodeURIComponent(currentWarehouseId)}&date=${encodeURIComponent(selectedDate)}`,
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
    if (isOpen && currentWarehouseId) {
      fetchSettlement();
    }
  }, [isOpen, currentWarehouseId, selectedDate]);

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
  // Tỉ lệ đơn lớn nhất so với doanh thu thực thu. CÓ THỂ VƯỢT 100%: thẻ đơn
  // thanh toán một phần (đặt cọc) nên `final_amount` của một đơn có thể lớn hơn
  // tổng thực thu của ngày. Vì vậy chỉ thanh ngang mới bị chặn 100, còn CON SỐ
  // hiển thị phải là tỉ lệ thật — in ra "100.0%" cho một tỉ lệ 130% là báo sai.
  const highlightShare = (() => {
    const net = Number(data?.financials?.netSales || 0);
    const top = Number(data?.highlight?.finalAmount || 0);
    if (!(net > 0) || !(top > 0)) return 0;
    return (top / net) * 100;
  })();
  // Thanh ngang không được vượt rộng khung.
  const highlightBarWidth = Math.min(100, highlightShare);
  // Ấn phẩm bán chạy nhất làm chuẩn cho thanh ngang Top 10 (bằng 0 thì chia 0).
  const maxTopCopies = Math.max(
    1,
    ...(data?.topSellers || []).map((s: any) => Number(s.soldCopies || 0))
  );
  // Ngày in ra LUÔN là ngày của số liệu (`data.reportDate` do API trả), không
  // phải ngày đang chọn trên ô date. Ô date là ý định của người dùng; `reportDate`
  // mới là ngày mà số tiền/số sách thuộc về. Lệch hai thứ này chính là lúc biên bản
  // bàn giao cho kế toán mang số tiện của ngày này dưới dấu ngày khác.
  const shownReportDate = data?.reportDate || selectedDate;
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

  // Bảng tồn gọn trên bản in: chỉ ấn phẩm ĐÃ BÁN trong ngày, không cap dòng.
  const soldOnlyRows: any[] = (data?.inventoryReconciliation || []).filter(
    (it: any) => Number(it.soldToday || 0) > 0
  );
  const soldTodayTotal = soldOnlyRows.reduce((sum: number, it: any) => sum + Number(it.soldToday || 0), 0);

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
               hẳn khối in-flow, padding chỉ giữ được ở trang đầu. Khối in vốn đã là
               portal thẳng xuống document.body (anh em của backdrop, ngoài khung modal
               cắt tràn) nên không cần absolute để ra khỏi khung cắt. */
            width: 100%;
            background: white !important;
            /* LỀ THẬT của bản in nằm ở padding này, KHÔNG nằm ở @page. Chrome bỏ qua
               margin đặt trong @page khi hộp thoại In để Margins = Default (đa số
               máy in mặc định vậy) ⇒ owner in ra chữ dính sát mép trên, không có
               lề. Padding của chính khối in thì luôn được áp dụng. */
            padding: 12mm 10mm !important;
            margin: 0 !important;
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
          }
          .no-print {
            display: none !important;
          }
          /* Biên bản gọn: mỗi khối nằm trọn trong một trang, không để trình
             duyệt cắt ngang giữa chừng (bảng dài sẽ vỡ, bản in loạn dòng). */
          #printable-settlement-report .print-block {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          /* Khối in hoá đơn nhiệt cũng đặt @page trong @media print với
             margin: 0mm !important — không giữ !important ở đây thì biên bản
             A4 mất lề, vì rule !important thắng cả rule thường đến sau nó.
             Lề của biên bản do PADDING của khối in quyết định (xem trên), nên
             @page đặt margin: 0 — đặt margin ở đây là may mắn có tác dụng,
             phần lớn máy in bỏ qua. LƯU Ý: viết comment trong khối <style> này
             không dùng ngoặc nhọn, test đọc file bằng regex sẽ dừng ở dấu }. */
          @page {
            size: A4 portrait;
            margin: 0;
          }
        }
      `}</style>

      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden border border-slate-200 my-auto flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
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
                <span className="ml-1 sm:ml-0">Ngày: <span className="font-mono text-amber-300">{shownReportDate}</span></span>
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
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-800 text-white text-xs px-2.5 py-1.5 rounded-xl border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
            <button
              onClick={handlePrint}
              disabled={isLoading || !data}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-50 cursor-pointer"
              title="In báo cáo chốt ngày"
            >
              <Printer className="w-4 h-4" />
              <span>In Báo Cáo</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
              title="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
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

        {/* Tab Navigation (ẩn khi in) — cuộn ngang gọn trên mobile, không tràn khung */}
        <div className="no-print px-3 sm:px-6 pt-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
            <button
              onClick={() => setActiveTab('FINANCIALS')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'FINANCIALS'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Banknote className="w-4 h-4" />
              Doanh Số & Két Tiền
            </button>
            <button
              onClick={() => setActiveTab('STOCKTAKE')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'STOCKTAKE'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Boxes className="w-4 h-4" />
              Kiểm Kê Đóng Thùng
            </button>
            <button
              onClick={() => setActiveTab('DISCOUNT')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'DISCOUNT'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              Giám Sát Chiết Khấu
            </button>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => setDiscountDisplayMode((prev) => (prev === 'PERCENT' ? 'VND' : 'PERCENT'))}
              className="px-2.5 py-1 text-xs font-bold rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1.5 shadow-sm transition"
              title="Chuyển đổi cách hiển thị chiết khấu giữa % và số tiền VNĐ"
            >
              <Percent className="w-3.5 h-3.5 text-amber-600" />
              <span>Đơn vị CK:</span>
              <span className="font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-extrabold text-[11px]">
                {discountDisplayMode === 'PERCENT' ? '%' : 'VNĐ'}
              </span>
            </button>

            <button
              onClick={fetchSettlement}
              className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-slate-200 transition"
              title="Tải lại số liệu"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
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
                  {/* ĐƠN GIÁ TRỊ CAO NHẤT — "điểm nhấn" của ngày: đơn lớn nhất
                      để thu ngân/quản lý nhìn thấy ngay mà không phải lần trong
                      danh sách. Không có đơn thì KHÔNG hiện thẻ rỗng. Thanh ngang
                      = tỉ lệ đơn này chiếm bao nhiêu doanh thu thực thu. */}
                  {data.highlight && (
                    <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 space-y-3">
                      <h4 className="font-extrabold text-xs text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
                        <Trophy className="w-4 h-4 text-amber-600" />
                        Đơn Giá Trị Cao Nhất
                      </h4>

                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <p className="font-mono font-black text-base text-slate-900 leading-tight">
                            {data.highlight.orderCode}
                          </p>
                          <p className="font-mono font-bold text-sm text-emerald-700">
                            {(data.highlight.finalAmount || 0).toLocaleString('vi-VN')} đ
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="px-2 py-0.5 rounded-lg bg-white border border-amber-200 text-[11px] font-bold text-slate-700">
                            TT: {paymentMethodLabel(data.highlight.paymentMethod)}
                          </span>
                          <span className="px-2 py-0.5 rounded-lg bg-white border border-amber-200 text-[11px] font-bold text-slate-700">
                            {data.highlight.itemCount || 0} SP
                          </span>
                          {vnHm(data.highlight.createdAt) && (
                            <span className="px-2 py-0.5 rounded-lg bg-white border border-amber-200 text-[11px] font-mono font-bold text-slate-700">
                              {vnHm(data.highlight.createdAt)} giờ VN
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        role="img"
                        aria-label={`Chiếm ${highlightShare.toFixed(1)}% doanh thu thực thu trong ngày`}
                      >
                        <div className="h-2.5 rounded-full bg-amber-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${highlightBarWidth.toFixed(1)}%` }}
                          />
                        </div>
                        <p className="text-[10px] font-bold text-amber-800 mt-1">
                          Chiếm {highlightShare.toFixed(1)}% doanh thu thực thu trong ngày
                        </p>
                      </div>
                    </div>
                  )}

                  {/* TOP 10 BÁN CHẠY — chuyển từ tab Chiết Khấu sang đây: nó là
                      thứ bán được bao nhiêu, không phải thứ chiết khấu bao nhiêu.
                      Tab Chiết Khấu giữ bảng đơn vượt trần + cảnh báo tỷ lệ. */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      Top 10 Ấn Phẩm Bán Chạy Nhất Tại Gian Hàng
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {data.topSellers?.map((seller: any, idx: number) => (
                        <div
                          key={seller.editionId}
                          className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 font-bold font-mono text-[10px] flex items-center justify-center">
                                {idx + 1}
                              </span>
                              <div>
                                <p className="font-bold text-slate-800 truncate max-w-[180px]">
                                  [{seller.code}] {seller.title}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono">
                                  {(seller.soldRevenue || 0).toLocaleString('vi-VN')} đ
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 font-bold font-mono text-xs">
                              {seller.soldCopies} cuốn
                            </span>
                          </div>
                          {/* Thanh ngang CSS thuần (không lib): độ dài = số cuốn so
                              với ấn phẩm bán chạy nhất. Chuẩn là chính danh sách
                              này nên không cần trục số. */}
                          <div
                            role="img"
                            aria-label={`${seller.soldCopies} cuốn, so với ấn phẩm bán chạy nhất trong ngày`}
                            title={`${seller.soldCopies} cuốn so với ấn phẩm bán chạy nhất`}
                            className="h-1.5 rounded-full bg-slate-200 overflow-hidden"
                          >
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{
                                width: `${Math.round(((Number(seller.soldCopies) || 0) / maxTopCopies) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
                      <p className="text-[11px] font-bold text-slate-500">Doanh thu gộp:</p>
                      <p className="text-base font-black font-mono text-slate-900 mt-1">
                        {(data.financials?.grossSales || 0).toLocaleString('vi-VN')} đ
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{data.financials?.totalOrdersCount || 0} đơn hàng</p>
                    </div>

                    <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200/80">
                      <p className="text-[11px] font-bold text-amber-700">
                        {discountDisplayMode === 'PERCENT' ? 'Chiết khấu bình quân:' : 'Tổng chiết khấu đã cấp:'}
                      </p>
                      {discountDisplayMode === 'PERCENT' ? (
                        <>
                          <p className="text-base font-black font-mono text-rose-600 mt-1">
                            {((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}%
                          </p>
                          <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
                            Quy đổi tiền: -{(data.financials?.totalDiscount || 0).toLocaleString('vi-VN')} đ
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-base font-black font-mono text-rose-600 mt-1">
                            -{(data.financials?.totalDiscount || 0).toLocaleString('vi-VN')} đ
                          </p>
                          <p className="text-[10px] text-amber-600 font-semibold mt-0.5">
                            Tỷ lệ bình quân: {((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}%
                          </p>
                        </>
                      )}
                    </div>

                    <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200/80">
                      <p className="text-[11px] font-bold text-emerald-800">Thực thu:</p>
                      <p className="text-base font-black font-mono text-emerald-700 mt-1">
                        {(data.financials?.netSales || 0).toLocaleString('vi-VN')} đ
                      </p>
                      <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">Đã ghi nhận thanh toán</p>
                    </div>

                    <div className="bg-indigo-50/60 p-4 rounded-2xl border border-indigo-200/80">
                      <p className="text-[11px] font-bold text-indigo-700">Phiên ca làm việc:</p>
                      <p className="text-base font-black text-indigo-900 mt-1">
                        {data.sessionsCount || 0} phiên
                      </p>
                      <p className="text-[10px] font-bold text-indigo-600 mt-0.5">
                        {data.hasOpenSession ? '⚠️ Có phiên chưa chốt' : '✅ Đã chốt ca 100%'}
                      </p>
                    </div>
                  </div>

                  {/* Cơ cấu thanh toán (Breakdown) */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-indigo-600" />
                      Cơ Cấu Phương Thức Thanh Toán
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Tiền mặt */}
                      <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                            <Banknote className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">Tiền Mặt</p>
                            <p className="text-[11px] text-slate-400">
                              {data.paymentBreakdown?.cash?.ordersCount || 0} đơn ({data.paymentBreakdown?.cash?.percentage || 0}%)
                            </p>
                          </div>
                        </div>
                        <p className="font-mono font-bold text-sm text-emerald-700">
                          {(data.paymentBreakdown?.cash?.sales || 0).toLocaleString('vi-VN')} đ
                        </p>
                      </div>

                      {/* Chuyển khoản QR */}
                      <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                            <QrCode className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">Chuyển Khoản / VietQR</p>
                            <p className="text-[11px] text-slate-400">
                              {data.paymentBreakdown?.qrTransfer?.ordersCount || 0} đơn ({data.paymentBreakdown?.qrTransfer?.percentage || 0}%)
                            </p>
                          </div>
                        </div>
                        <p className="font-mono font-bold text-sm text-indigo-700">
                          {(data.paymentBreakdown?.qrTransfer?.sales || 0).toLocaleString('vi-VN')} đ
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Đối soát két tiền ca */}
                  <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
                    <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-emerald-600" />
                      Đối Soát Két Tiền Cuối Ngày
                    </h4>

                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Tổng tiền bàn giao đầu các ca:</span>
                        <span className="font-mono font-bold text-slate-800">
                          {(data.cashboxReconciliation?.openingCashTotal || 0).toLocaleString('vi-VN')} đ
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Doanh số tiền mặt bán trong ngày:</span>
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
                      <p className="font-bold text-indigo-900">Bảng Kiểm Kê Tồn Sách Đóng Thùng Cuối Ngày</p>
                      <p className="text-indigo-700 text-[11px] mt-0.5">
                        Nhập số đếm thực tế của từng đầu sách trên kệ. Hệ thống tự động so khớp với tồn máy để phát hiện thất thoát.
                      </p>
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
                    <p className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900">
                      Cột “Kiểm kê thực tế” chưa có dữ liệu: hệ thống chưa lưu số đếm, và
                      quy trình hiện tại không đếm sách cuối ngày. Số tồn dùng để đối chiếu là
                      <strong> tồn lý thuyết</strong> = tồn trong kho − số đã bán.
                    </p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 font-bold text-left border-b border-slate-200">
                          <th className="p-3 w-10 text-center">#</th>
                          <th className="p-3">Ấn phẩm sách</th>
                          <th className="p-3 text-right">Đã bán</th>
                          <th className="p-3 text-center">Tồn lý thuyết</th>
                          <th className="p-3 text-center w-32">Kiểm kê thực tế</th>
                          <th className="p-3 text-center w-28">Chênh lệch</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.inventoryReconciliation?.map((it: any, idx: number) => {
                          const actual = it.theoreticalStock;

                          return (
                            <tr key={it.editionId} className="hover:bg-slate-50">
                              <td className="p-3 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="p-3">
                                <p className="font-bold text-slate-800">
                                  [{it.code}] {it.title}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono">
                                  Giá bìa: {(it.coverPrice || 0).toLocaleString('vi-VN')} đ
                                </p>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-slate-600">
                                {it.soldToday || 0}
                              </td>
                              <td className="p-3 text-center font-mono font-bold text-slate-900 bg-slate-50/50">
                                {it.theoreticalStock}
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
                        Đơn Hàng Duyệt Chiết Khấu Từ Trần Cho Phép (≥ 20%) ({data.discountSupervision?.overCapOrdersCount || 0})
                      </h4>
                    </div>

                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 font-bold text-left border-b border-slate-200">
                          <th className="p-3">Mã Đơn</th>
                          <th className="p-3">Thu Ngân</th>
                          <th className="p-3 text-right">Giá Gốc</th>
                          <th className="p-3 text-center">{discountDisplayMode === 'PERCENT' ? 'Tỷ Lệ CK' : 'Chiết Khấu'}</th>
                          <th className="p-3 text-right">Thực Thu</th>
                          <th className="p-3 text-center">Phương Thức</th>
                          <th className="p-3">Người Duyệt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.discountSupervision?.orders?.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-slate-400 italic">
                              Không có đơn hàng nào vượt trần chiết khấu 20% trong ngày.
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
                                {discountDisplayMode === 'PERCENT' ? (
                                  <div>
                                    <span>{Math.round((ord.discountRate || 0) * 100)}%</span>
                                    <span className="block text-[10px] text-slate-400 font-normal">
                                      -{(ord.discountAmount || Math.round((ord.subtotal || 0) * (ord.discountRate || 0))).toLocaleString('vi-VN')} đ
                                    </span>
                                  </div>
                                ) : (
                                  <div>
                                    <span>-{(ord.discountAmount || Math.round((ord.subtotal || 0) * (ord.discountRate || 0))).toLocaleString('vi-VN')} đ</span>
                                    <span className="block text-[10px] text-slate-400 font-normal">
                                      {Math.round((ord.discountRate || 0) * 100)}%
                                    </span>
                                  </div>
                                )}
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
              )}
            </>
          )}
        </div>

        {/* ============================================================== */}
        {/* NỘI DUNG BIÊN BẢN CHỐT CA KHỔ A4 (CHỈ HIỂN THỊ KHI IN window.print) */}
        {/* ============================================================== */}
        {data && createPortal(
          <div id="printable-settlement-report" className="hidden print:block bg-white text-slate-900 text-[12px] leading-relaxed font-serif">
            {/* Khối in PHẢI createPortal riêng xuống `document.body`. Nằm trong
                khung modal `overflow-hidden max-h-[92vh]` thì lúc in khung cha
                cắt mất toàn bộ biên bản, window.print() ra trang trắng — đúng
                triệu chứng "bấm In không hiện gì". Ở đây nó là ANH EM của
                backdrop, không nằm trong khung cắt nào. */}
            {/* Header doanh nghiệp */}
            <div className="flex justify-between items-start border-b border-slate-400 pb-3 mb-4">
              <div>
                <h4 className="font-sans font-black text-sm tracking-wider uppercase text-slate-900">
                  CÔNG TY TNHH XUẤT BẢN FORMA
                </h4>
                <p className="font-sans text-[11px] text-slate-600">
                  Gian hàng / Địa điểm: <strong>{data.warehouse?.name}</strong> ({data.warehouse?.code})
                </p>
                <p className="font-sans text-[11px] text-slate-600">
                  Ngày kết toán: <strong>{data.reportDate}</strong>
                </p>
              </div>
              <div className="text-right font-sans text-[11px] text-slate-600">
                <p className="font-bold text-slate-800">BIÊN BẢN SỐ: BB-{data.reportDate.replace(/-/g, '')}</p>
                <p className="italic">Lập lúc: {new Date().toLocaleTimeString('vi-VN')} ngày {new Date().toLocaleDateString('vi-VN')}</p>
              </div>
            </div>

            {/* Tiêu đề Biên Bản */}
            <div className="text-center my-4">
              <h1 className="font-sans font-black text-xl tracking-wide uppercase text-slate-900">
                BIÊN BẢN BÀN GIAO CA & ĐỐI SOÁT KIỂM KÊ HỘI CHỢ
              </h1>
              <p className="font-sans italic text-xs text-slate-600 mt-0.5">
                (Dùng cho kiểm kê két tiền, cơ cấu thanh toán và tồn sách thực tế đóng thùng cuối ngày)
              </p>
            </div>

            {/* I. Số liệu Doanh thu & Két tiền */}
            <div className="print-block space-y-2 mb-4 font-sans text-xs">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1">
                I. TỔNG HỢP DOANH THU & ĐỐI SOÁT KÉT TIỀN
              </h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                <div>- Tổng số đơn hàng bán ra: <strong>{data.financials?.totalOrdersCount} đơn</strong></div>
                <div>- Doanh thu gộp: <strong>{(data.financials?.grossSales || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>- Tổng chiết khấu thương mại: <strong>{((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}%</strong> (-{(data.financials?.totalDiscount || 0).toLocaleString('vi-VN')} đ)</div>
                <div>- Doanh thu thực thu: <strong>{(data.financials?.netSales || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>+ Doanh số tiền mặt: <strong>{(data.paymentBreakdown?.cash?.sales || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>+ Doanh số Chuyển khoản QR: <strong>{(data.paymentBreakdown?.qrTransfer?.sales || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>- Tiền đầu ca bàn giao: <strong>{(data.cashboxReconciliation?.openingCashTotal || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>- Tiền mặt kỳ vọng trong két: <strong>{(data.cashboxReconciliation?.expectedCashTotal || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>- Tiền mặt thực tế đếm được: <strong>{(data.cashboxReconciliation?.closingCashActualTotal || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>
                  - Chênh lệch két tiền:{' '}
                  <strong>
                    {/* `cashVariance === null` = CHƯA ĐỦ CĂN CỨ (còn ca mở, hoặc ca
                        chưa ai đếm két), KHÔNG phải chênh lệch bằng 0. Biểu thức
                        cũ `(null || 0) > 0` rơi vào nhánh cuối và in ra
                        "Thiếu: 0 đ" — tức bản in bàn giao cho kế toán mang một lời
                        buộc tội bịa ra. In "Chưa thể đối soát" thay vì đoán. */}
                    {data.cashboxReconciliation?.cashVariance === 0
                      ? 'Khớp 100%'
                      : (data.cashboxReconciliation?.cashVariance ?? 0) > 0
                      ? `Thừa: +${(data.cashboxReconciliation?.cashVariance ?? 0).toLocaleString('vi-VN')} đ`
                      : data.cashboxReconciliation?.cashVariance === null || data.cashboxReconciliation?.cashVariance === undefined
                      ? 'Chưa thể đối soát — ca chưa đóng hoặc chưa có tiền thực đếm'
                      : `Thiếu: ${(data.cashboxReconciliation?.cashVariance ?? 0).toLocaleString('vi-VN')} đ`}
                  </strong>
                </div>
              </div>
            </div>

            {/* I-BIS. ĐIỂM NHẤN NGÀY — phần đọc nhanh của biên bản: đơn lớn
                nhất, top 10 bán chạy, giờ cao điểm và tiền mặt theo từng ca.
                Không có highlight (ngày không bán được gì) thì nói thẳng, không in
                dòng rỗng. */}
            <div className="print-block space-y-1.5 mb-4 font-sans text-xs">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1">
                I-BIS. ĐIỂM NHẤN NGÀY
              </h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                <div>- Doanh thu thực thu: <strong>{(data.financials?.netSales || 0).toLocaleString('vi-VN')} đ</strong></div>
                <div>- Số đơn bán ra: <strong>{data.financials?.totalOrdersCount || 0} đơn</strong></div>
              </div>
              {data.highlight ? (
                <div>
                  - Đơn giá trị cao nhất: <strong className="font-mono">{data.highlight.orderCode}</strong> ·{' '}
                  <strong>{(data.highlight.finalAmount || 0).toLocaleString('vi-VN')} đ</strong> · TT:{' '}
                  {paymentMethodLabel(data.highlight.paymentMethod)} · <strong>{data.highlight.itemCount || 0} SP</strong>
                  {vnHm(data.highlight.createdAt) ? ` · ${vnHm(data.highlight.createdAt)} giờ VN` : ''}
                </div>
              ) : (
                <div className="italic text-slate-600">- Ngày này không có đơn hàng nào.</div>
              )}

              {/* Top 10: mã + tên + số cuốn + tiền. KHÔNG cap ở 5 như bản cũ — bản in
                  nay còn chỗ và số liệu này dùng để đối chiếu bàn giao sách. */}
              <table className="w-full border-collapse border border-slate-900 text-[10px] mt-1">
                <thead>
                  <tr className="bg-slate-100 font-bold text-center">
                    <th className="border border-slate-900 p-1 w-8">#</th>
                    <th className="border border-slate-900 p-1 w-16">Mã</th>
                    <th className="border border-slate-900 p-1 text-left">Tên ấn phẩm</th>
                    <th className="border border-slate-900 p-1 w-14 text-right">Số cuốn</th>
                    <th className="border border-slate-900 p-1 w-24 text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.topSellers || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-slate-900 p-1 text-center italic">
                        Không có ấn phẩm nào bán ra trong ngày.
                      </td>
                    </tr>
                  ) : (
                    (data.topSellers || []).map((s: any, i: number) => (
                      <tr key={s.editionId}>
                        <td className="border border-slate-900 p-1 text-center font-mono">{i + 1}</td>
                        <td className="border border-slate-900 p-1 text-center font-mono font-bold">{s.code}</td>
                        <td className="border border-slate-900 p-1">{s.title}</td>
                        <td className="border border-slate-900 p-1 text-right font-mono">{s.soldCopies}</td>
                        <td className="border border-slate-900 p-1 text-right font-mono">
                          {(s.soldRevenue || 0).toLocaleString('vi-VN')} đ
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* Dải giờ VN vẽ bằng SVG, KHÔNG bằng div màu nền: Chrome lược màu
                  nền khi hộp thoại In để "Background graphics" tắt (đang tắt) ⇒
                  bản in ra dải cột TRỐNG trong khi chữ vẫn in đủ. Nét và chữ
                  SVG là nội dung nên in mặc định. Khung giờ lấy động từ
                  `hourWindow` (giờ mở ca + giờ có đơn), không hard-code. */}
              <div className="mt-1.5">
                <p className="font-bold uppercase text-slate-800">
                  - Số đơn theo giờ ({hourWin.start}h–{hourEndShown}h, giờ Việt Nam):
                </p>
                <svg
                  viewBox={`0 0 ${BAND_W} ${BAND_H}`}
                  className="w-full h-auto mt-1"
                  fontFamily="monospace"
                  role="img"
                  aria-label={`Số đơn bán theo từng giờ từ ${hourWin.start}h đến ${hourEndShown}h giờ Việt Nam`}
                >
                  {hourlyInWindow.map((h: any, i: number) => {
                    const n = Number(h.orders || 0);
                    const bh = bandBarH(n);
                    const x = (i * bandSlot + 0.6).toFixed(2);
                    const wRect = Math.max(0.5, bandSlot - 1.2).toFixed(2);
                    // Hai nhánh tách riêng để màu nằm thẳng trong thẻ in: giờ có đơn
                    // màu chàm, giờ trống màu xám nhạt — xám VẪN THẤY để đọc ra
                    // giờ nào không bán, không in ra khoảng trống mờ mịt.
                    return n > 0 ? (
                      <rect key={h.hour} x={x} y={BAND_BASE_Y - bh} width={wRect} height={bh} fill="#4f46e5" />
                    ) : (
                      <rect key={h.hour} x={x} y={BAND_BASE_Y - bh} width={wRect} height={bh} fill="#cbd5e1" />
                    );
                  })}
                  {/* Số đơn của giờ cao điểm, đặt trên đỉnh cột max (một chữ số). Ngày không bán
                      được gì thì KHÔNG in số: cột xám đã nói lý do, in "0" lên
                      nó là bịa ra một mốc cao điểm không tồn tại. */}
                  {hourlyInWindow.length > 0 && Number(hourlyInWindow[peakIndex]?.orders || 0) > 0 && (
                    <text
                      x={(peakIndex * bandSlot + bandSlot / 2).toFixed(2)}
                      y={BAND_BASE_Y - bandBarH(Number(hourlyInWindow[peakIndex]?.orders || 0)) - 1.5}
                      textAnchor="middle"
                      fontSize="5"
                      fontWeight="bold"
                      fill="#1e293b"
                    >
                      {Number(hourlyInWindow[peakIndex]?.orders || 0)}
                    </text>
                  )}
                  {/* Nhãn giờ: mỗi 3 giờ một nhãn, cộng thêm hai đầu khung. */}
                  {hourlyInWindow.map((h: any, i: number) => {
                    const hour = Number(h.hour);
                    const isEnd = i === hourlyInWindow.length - 1;
                    if (hour % 3 !== 0 && i !== 0 && !isEnd) return null;
                    return (
                      <text
                        key={`nhan-${h.hour}`}
                        x={(i * bandSlot + bandSlot / 2).toFixed(2)}
                        y={BAND_BASE_Y + 6}
                        textAnchor="middle"
                        fontSize="4.5"
                        fill="#64748b"
                      >
                        {hour}h
                      </text>
                    );
                  })}
                </svg>
              </div>

              {/* Tiền mặt theo từng ca. `expectedCashLive − openingCash` = tiền mặt
                  bán TRONG ca đó, cùng đúng định nghĩa mà dòng kỳ vọng ở mục I
                  đang cộng lên — không trộn hai phạm vi khác nhau. */}
              <div className="mt-1.5">
                <p className="font-bold uppercase text-slate-800">- Tiền mặt bán theo từng ca:</p>
                {(data.cashboxReconciliation?.sessions || []).length === 0 ? (
                  <p className="italic text-slate-600">- Không có ca két nào trong ngày.</p>
                ) : (
                  <table className="w-full border-collapse border border-slate-900 text-[10px] mt-1">
                    <thead>
                      <tr className="bg-slate-100 font-bold text-center">
                        <th className="border border-slate-900 p-1 text-left">Thu ngân</th>
                        <th className="border border-slate-900 p-1 w-24 text-center">Giờ mở</th>
                        <th className="border border-slate-900 p-1 w-24 text-center">Giờ đóng</th>
                        <th className="border border-slate-900 p-1 w-28 text-right">Tiền mặt bán</th>
                        <th className="border border-slate-900 p-1 w-20 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.cashboxReconciliation?.sessions || []).map((s: any) => (
                        <tr key={s.id}>
                          <td className="border border-slate-900 p-1 font-mono">{s.cashierId}</td>
                          <td className="border border-slate-900 p-1 text-center font-mono">{vnHm(s.openedAt) || '—'}</td>
                          <td className="border border-slate-900 p-1 text-center font-mono">
                            {s.closedAt ? vnHm(s.closedAt) : '—'}
                          </td>
                          <td className="border border-slate-900 p-1 text-right font-mono">
                            {(Number(s.expectedCashLive || 0) - Number(s.openingCash || 0)).toLocaleString('vi-VN')} đ
                          </td>
                          <td className="border border-slate-900 p-1 text-center">
                            {s.status === 'OPEN' ? 'Còn mở' : 'Đã đóng'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* II. Đơn vượt trần chiết khấu — người duyệt phải chịu trách nhiệm
                nên giữ đủ tên người duyệt + thu ngân trên bản in. Trên 10 dòng thì
                cắt và đếm phần dư, không kéo dài biên bản.

                KHÔNG ép `break-before: page` ở đây: đo thật bằng Chrome headless với
                dữ liệu tải nặng (10 ấn phẩm bán chạy + 14 đơn vượt trần + 22 ấn phẩm
                đã bán), ép ngắt trang và không ép đều ra ĐÚNG 3 TRANG — ép chỉ làm
                trang 2 chỉ chứa mục II rồi bỏ trống, đúng thứ owner phàn về (thừa
                giấy trắng). Vẫn giữ `break-inside: avoid` cho từng khối. */}
            <div className="print-block space-y-1.5 mb-4 font-sans text-xs">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1">
                II. ĐƠN VƯỢT TRẦN CHIẾT KHẤU (≥ 20%) — {overCapCount} ĐƠN
              </h3>
              <table className="w-full border-collapse border border-slate-900 text-[10px]">
                <thead>
                  <tr className="bg-slate-100 font-bold text-center">
                    <th className="border border-slate-900 p-1 w-8">#</th>
                    <th className="border border-slate-900 p-1 w-20">Mã đơn</th>
                    <th className="border border-slate-900 p-1 text-left">Thu ngân</th>
                    <th className="border border-slate-900 p-1 w-14 text-center">CK</th>
                    <th className="border border-slate-900 p-1 w-24 text-right">Thực thu</th>
                    <th className="border border-slate-900 p-1 text-left">Người duyệt</th>
                  </tr>
                </thead>
                <tbody>
                  {overCapOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="border border-slate-900 p-1.5 text-center italic">
                        Không có đơn vượt trần chiết khấu 20% trong ngày.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {overCapOrders.slice(0, 10).map((ord: any, idx: number) => (
                        <tr key={ord.id}>
                          <td className="border border-slate-900 p-1 text-center font-mono">{idx + 1}</td>
                          <td className="border border-slate-900 p-1 font-mono font-bold">{ord.orderCode}</td>
                          <td className="border border-slate-900 p-1 font-mono">{ord.cashierId}</td>
                          <td className="border border-slate-900 p-1 text-center font-mono">
                            {Math.round((ord.discountRate || 0) * 100)}%
                          </td>
                          <td className="border border-slate-900 p-1 text-right font-mono">
                            {(ord.finalAmount || 0).toLocaleString('vi-VN')} đ
                          </td>
                          <td className="border border-slate-900 p-1">{ord.approvedBy}</td>
                        </tr>
                      ))}
                      {overCapOrders.length > 10 && (
                        <tr>
                          <td colSpan={6} className="border border-slate-900 p-1 text-center italic font-bold">
                            +{overCapOrders.length - 10} đơn khác (xem trên màn hình)
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {/* III. Tồn gọn — CHỈ ấn phẩm thực sự bán ra trong ngày (soldToday > 0).
                Ấn phẩm tồn không bán là tĩnh, không in (một gian hàng có 81 ấn bản
                thì bảng đầy đủ đẩy biên bản ra trang 3-4 vô nghĩa). Bảng này KHÔNG
                cap: đã bán mấy ấn phẩm thì in hết mấy ấn phẩm — thiếu dòng là
                báo thiếu hàng, mà cột này là biên bản bàn giao cho kế toán. */}
            <div className="print-block space-y-1.5 mb-4 font-sans text-xs">
              <h3 className="font-bold text-slate-900 uppercase border-b border-slate-300 pb-1">
                III. TỒN SÁCH CUỐI NGÀY (ẤN PHẨM ĐÃ BÁN)
              </h3>
              <table className="w-full border-collapse border border-slate-900 text-[10px]">
                <thead>
                  <tr className="bg-slate-100 font-bold text-center">
                    <th className="border border-slate-900 p-1 w-8">#</th>
                    <th className="border border-slate-900 p-1 w-16">Mã</th>
                    <th className="border border-slate-900 p-1 text-left">Tên ấn phẩm</th>
                    <th className="border border-slate-900 p-1 w-16 text-right">Đã bán</th>
                    <th className="border border-slate-900 p-1 w-20 text-right">Tồn còn</th>
                  </tr>
                </thead>
                <tbody>
                  {soldOnlyRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border border-slate-900 p-1.5 text-center italic">
                        Trong ngày không bán ấn phẩm nào.
                      </td>
                    </tr>
                  ) : (
                    soldOnlyRows.map((it: any, idx: number) => (
                      <tr key={it.editionId}>
                        <td className="border border-slate-900 p-1 text-center font-mono">{idx + 1}</td>
                        <td className="border border-slate-900 p-1 text-center font-mono font-bold">{it.code}</td>
                        <td className="border border-slate-900 p-1">{it.title}</td>
                        <td className="border border-slate-900 p-1 text-right font-mono">{it.soldToday || 0}</td>
                        <td className="border border-slate-900 p-1 text-right font-mono font-bold">
                          {it.theoreticalStock}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {/* 2 dòng tổng kết cuối ngày. Tổng số cuốn bán ra cộng ở TRÌNH DUYỆT từ
                  `soldToday` của chính các dòng in ở bảng trên — nguồn là
                  `inventoryReconciliation`, tức CHỈ ấn phẩm có dòng tồn ghi nhận
                  trong kho; ấn phẩm bán mà không có dòng tồn thì không vào
                  bảng này (không phải tổng quantity mọi order_items của ngày). */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 mt-1">
                <div>
                  - TỔNG SỐ CUỒN BÁN RA: <strong className="font-mono">{soldTodayTotal} cuốn</strong>
                </div>
                <div>
                  - Chiết khấu bình quân:{' '}
                  <strong className="font-mono">{((data.financials?.averageDiscountRate || 0) * 100).toFixed(1)}%</strong>
                </div>
              </div>
              <p className="text-[11px]">
                - TỔNG SỐ CUỐN TỒN LÝ THUYẾT: <strong className="font-mono">{totalTheoreticalBooks} cuốn</strong>{' '}
                <span className="italic text-amber-800">(chưa kiểm kê thực tế)</span>
              </p>
              {stocktakeNote && (
                <p className="font-sans text-[11px] italic mt-1 text-slate-700">
                  Ghi chú đóng thùng: {stocktakeNote}
                </p>
              )}
            </div>

            {/* IV. Chữ ký 3 bên thu thấp (h-12) để biên bản vẫn vừa trang mà chỗ
                ký vẫn đủ để viết tay — biên bản này người ta KÝ THẬT. */}
            <div className="print-block font-sans grid grid-cols-3 gap-4 text-center text-xs mt-6 pt-2">
              <div>
                <p className="font-bold uppercase text-slate-900">Thu ngân lập biên bản</p>
                <p className="italic text-[11px] text-slate-500">(Ký, ghi rõ họ tên)</p>
                <div className="h-12" />
                <p className="font-bold text-slate-800">................................</p>
              </div>

              <div>
                <p className="font-bold uppercase text-slate-900">Quản lý gian hàng / Trưởng ca</p>
                <p className="italic text-[11px] text-slate-500">(Ký, ghi rõ họ tên)</p>
                <div className="h-12" />
                <p className="font-bold text-slate-800">................................</p>
              </div>

              <div>
                <p className="font-bold uppercase text-slate-900">Thủ kho nhận bàn giao sách</p>
                <p className="italic text-[11px] text-slate-500">(Ký, ghi rõ họ tên)</p>
                <div className="h-12" />
                <p className="font-bold text-slate-800">................................</p>
              </div>
            </div>
            </div>,
          document.body
        )}
      </div>
    </div>,
    document.body
  );
}
