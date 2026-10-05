'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import { ManagerApprovalDrawer } from '@/components/pos/ManagerApprovalDrawer';
import {
  Activity, AlertTriangle, Banknote, Landmark, CalendarDays, CheckCircle2, Clock,
  DoorOpen, MapPin, RefreshCw, ShieldAlert, TrendingUp, Trophy, X,
} from 'lucide-react';

/**
 * Trạng thái quầy hội chợ — LÚC NÀY, không phải báo cáo.
 *
 * Ba điều làm nên khác Báo Cáo Chốt Ngày:
 *  - tự làm mới khi đang mở, dừng hẳn khi đóng / tab ẩn (0 request khi không xem);
 *  - theo kho dashboard đang chọn, hoặc TẤT CẢ kho hội chợ khi chưa chọn kho nào;
 *  - thấy đơn CHƯA ĐÓNG — thứ báo cáo ngày không bao giờ hiện.
 *
 * `isOpen` là cổng duy nhất quyết định có poll hay không. Đây là bản sao có
 * chủ đích của cách ManagerApprovalDrawer làm; sai chỗ là poll vô tình tiêu
 * request của từng người mở app.
 */

const POLL_MS = 10_000;
const BACKOFF_MS = [10_000, 20_000, 40_000];
const STALE_AFTER_MS = 30_000;

interface MonitorPayload {
  businessDate: string;
  timezoneNote: string;
  fairWarehouses: Array<{ id: string; code: string; name: string }>;
  today: {
    orderCount: number; revenue: number; cashRevenue: number; transferRevenue: number;
    otherRevenue: number; transferPct: number; avgOrderValue: number;
    totalDiscount: number; overCapCount: number;
  };
  openShifts: Array<{
    id: string; warehouseName: string; cashierName: string; cashierId: string;
    openedAt: string | null; elapsedMinutes: number | null; expectedCashLive: number;
    overdue: boolean; cutoffAt: string; cutoff: string;
  }>;
  pending: Array<{
    id: string; orderCode: string; cashierName: string; warehouseName: string;
    finalAmount: number; paymentMethod: string; minutesLeft: number | null; overdue: boolean;
  }>;
  recentClosed: Array<{
    orderCode: string; warehouseName: string; finalAmount: number;
    paymentMethod: string; createdAt: string | null;
  }>;
  topSellers: Array<{ code: string; title: string; copies: number; revenue: number }>;
  /** Đơn giá trị cao nhất trong ngày đang xem — chuyển từ Báo Cáo Chốt Ngày sang. */
  largestOrder: {
    orderCode: string; warehouseName: string; finalAmount: number;
    paymentMethod: string; itemCount: number; createdAt: string | null;
  } | null;
  generatedAt: string;
}

const PAY_LABEL: Record<string, string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  QR_CODE: 'QR ngân hàng',
  COD: 'Thu hộ',
};

function payLabel(m?: string | null) {
  return PAY_LABEL[`${m}`] || `${m || '—'}`;
}

function money(v: number | null | undefined) {
  return `${Number(v || 0).toLocaleString('vi-VN')} đ`;
}

function clockOf(iso: string | null | undefined) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function LiveFairMonitorModal({
  isOpen,
  onClose,
  warehouseId,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Kho đang chọn ở dashboard. undefined = xem TẤT CẢ kho hội chợ (mặc định cũ). */
  warehouseId?: string;
}) {
  const [data, setData] = useState<MonitorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Kho đang xem. Mặc định lấy từ dashboard đang chọn; rỗng = TẤT CẢ kho hội chợ.
  // Nhớ lựa chọn của chính người dùng qua localStorage: người hay xem 1 kho
  // hội chợ cụ thể, mở lại thấy đúng kho đó thì không phải chọn lại.
  const [scopeWarehouseId, setScopeWarehouseId] = useState<string>(warehouseId || '');
  // Ngày đang xem. KHÔNG nhớ — mỗi lần mở về hôm nay, vì mở nhầm ngày cũ
  // khiến người dùng tưởng hôm nay chưa bán được gì (số liệu = 0).
  const [viewDate, setViewDate] = useState<string>(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem('formapubli.liveMonitor.warehouseId');
      if (saved) setScopeWarehouseId(saved);
    } catch { /* trình duyệt chặn storage: bỏ qua */ }
  }, []);
  useEffect(() => {
    try {
      if (scopeWarehouseId) localStorage.setItem('formapubli.liveMonitor.warehouseId', scopeWarehouseId);
    } catch { /* như trên */ }
  }, [scopeWarehouseId]);

  const panelRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, onClose);
  const approvalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const aliveRef = useRef(true);
  const backoffRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kho đang chọn MỚI NHẤT, đọc được từ bên trong callback đã cũ. Gán lúc render
  // là đủ: chỉ cần đúng ở thời điểm response về, mà mọi response đều về sau
  // commit của lần render đã gán.
  const warehouseIdRef = useRef(warehouseId);
  warehouseIdRef.current = warehouseId;
  // Tương tự cho ngày đang xem: response về sau khi đổi ngày thì bỏ.
  const viewDateRef = useRef(viewDate);
  viewDateRef.current = viewDate;
  // Kho dùng cho lần nạp. KHÔNG fallback về prop: nếu có fallback thì chọn
  // "Tất cả kho hội chợ" (giá trị rỗng) sẽ bị bỏ qua và API vẫn lấy 1 kho,
  // trong khi ô chọn lại hiện "Tất cả" ⇒ quản lý tưởng đang xem cả hội chợ.
  const scopeWarehouseIdRef = useRef(scopeWarehouseId);
  scopeWarehouseIdRef.current = scopeWarehouseId;

  // Drawer duyệt chiết khấu cũng render ra document.body, cùng cấp với modal
  // monitor. useModalFocusTrap chỉ đánh dấu inert lên #app-main-content, không
  // đụng tới monitor ⇒ Tab trong drawer nhảy được xuống modal dưới. Phải tự
  // inert panel. React 18 chưa hỗ trợ prop `inert` (tính từ React 19) nên set
  // attribute trực tiếp.
  //
  // Thứ tự cũ thật sự: cleanup của hook drawer chạy TRƯỚC effect này trong cùng
  // một commit, nên lúc nó gọi previousFocus.focus() thì panel vẫn còn inert và
  // focus() bị bỏ qua âm thầm. Vì vậy phải tự trả focus về nút đã bấm.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (approvalOpen) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
    if (!approvalOpen) approvalTriggerRef.current?.focus();
  }, [approvalOpen, panelRef]);

  useEffect(() => { setMounted(true); }, []);

  const flash = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const load = useCallback(async () => {
    // Kho + ngày của LẦN NẠP NÀY. Phải chụp lại vì `load` đóng bằng state lúc
    // tạo: so trong closure là so với chính nó, luôn bằng ⇒ vô dụng.
    const scope = scopeWarehouseIdRef.current;
    const date = viewDateRef.current;
    try {
      // Có kho đang chọn thì giới hạn phạm vi 1 kho, khác hẳn URL cũ (TẤT CẢ).
      // Luôn gửi kèm ngày: server mặc định là hôm nay, nhưng gửi tường minh
      // để ngày trên màn khớp đúng ngày server tính.
      const qs = new URLSearchParams();
      if (scope) qs.set('warehouseId', scope);
      qs.set('date', date);
      const url = `/api/pos/live-monitor?${qs.toString()}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Không tải được trạng thái (HTTP ${res.status}).`);
      }
      const j = await res.json();
      if (!aliveRef.current) return;
      // Fetch kho/ngày cũ về sau khi đã đổi: BỎ, đừng set state. `aliveRef` không
      // chặn được chuyện này — nó chỉ đổi khi ĐÓNG modal, còn đổi kho/ngày thì
      // modal vẫn mở ⇒ không có state nào báo là lần nạp này đã lỗi thời.
      if (scope !== scopeWarehouseIdRef.current || date !== viewDateRef.current) return;
      setData(j.data);
      setLastUpdatedAt(new Date().toISOString());
      setIsStale(false);
      setError(null);
      backoffRef.current = 0;
    } catch (e: any) {
      if (!aliveRef.current) return;
      if (scope !== scopeWarehouseIdRef.current || date !== viewDateRef.current) return;
      setError(e?.message || 'Không tải được trạng thái.');
      // Mạng hội chợ yếu: giãn dần thay vì dội 10 giây/lần cho tới khi hết pin.
      backoffRef.current = Math.min(backoffRef.current + 1, BACKOFF_MS.length - 1);
    }
  }, []);

  const schedule = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    const wait = BACKOFF_MS[backoffRef.current] ?? POLL_MS;
    pollRef.current = setTimeout(async () => {
      // setInterval bị throttle khi màn hình điện thoại khoá; dùng setTimeout +
      // kiểm tra visibility để không đốt request lúc người dùng không nhìn.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      await load();
      schedule();
    }, wait);
  }, [load]);

  /** Nạp lại ngay theo yêu cầu của người dùng (nút làm mới / Tải lại). */
  const refresh = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
    // Bấm tay là bằng chứng mạng đã hồi, nên không giữ backoff của lần lỗi trước.
    backoffRef.current = 0;
    setLoading(true);
    void load().finally(() => setLoading(false));
    schedule();
  }, [load, schedule]);

  // Đổi kho lúc modal đang mở: xoá số của kho cũ NGAY, không để KPI kho A nằm
  // dưới nhãn kho B trong lúc chờ nạp. Chạy sau effect cổng isOpen (fetch bất
  // đồng bộ ⇒ setData tới sau), nên thứ tự không sao.
  useEffect(() => {
    setData(null);
    setError(null);
    setLastUpdatedAt(null);
    setIsStale(false);
  }, [warehouseId]);

  // Cổng duy nhất quyết định có poll hay không.
  useEffect(() => {
    if (!isOpen) {
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
      return;
    }
    aliveRef.current = true;
    setLoading(true);
    void load().finally(() => setLoading(false));
    schedule();
    return () => {
      aliveRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    };
  }, [isOpen, load, schedule]);

  // Đổi kho hoặc đổi ngày thì nạp NGAY. Không có effect này thì màn vẫn hiện số
  // của kho/ngày cũ cho tới lượt poll kế tiếp (10s, hoặc 40s nếu đang backoff) —
  // người dùng chọn "hôm qua" rồi thấy số của hôm nay, tưởng hôm nay chưa bán.
  useEffect(() => {
    if (!isOpen) return;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
    backoffRef.current = 0;
    void load();
    schedule();
  }, [isOpen, scopeWarehouseId, viewDate, load, schedule]);

  // Quay lại tab thì nạp ngay, không bắt thu ngân chờ tới lượt poll kế tiếp.
  useEffect(() => {
    if (!isOpen) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
      backoffRef.current = 0;
      void load();
      schedule();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isOpen, load, schedule]);

  // Cũ quá 30s mà không nạp được gì thì nói ra, thay vì để số liệu đứng yên
  // trông như còn đúng.
  useEffect(() => {
    if (!isOpen || !lastUpdatedAt) return;
    const t = setInterval(() => {
      if (Date.now() - new Date(lastUpdatedAt).getTime() > STALE_AFTER_MS) setIsStale(true);
    }, 5000);
    return () => clearInterval(t);
  }, [isOpen, lastUpdatedAt, data]);

  const cancelOrder = async (orderId: string, orderCode: string) => {
    setBusyOrder(orderId);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CANCEL',
          orderId,
          reason: 'Hủy từ Trạng Thái Hội Chợ (quá hạn chờ tiền)',
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        flash(`Không huỷ được ${orderCode}: ${j?.error || `HTTP ${res.status}`}`);
        return;
      }
      flash(`Đã huỷ: ${orderCode}`);
      await load();
    } catch {
      flash(`Không huỷ được ${orderCode} — mạng lỗi.`);
    } finally {
      setBusyOrder(null);
    }
  };

  if (!isOpen) return null;

  const t = data?.today;
  const showStaleBanner = isStale || (!!error && !!data);
  // Tên kho lấy từ chính payload (server đã trả kèm fairWarehouses) — không cần
  // thêm prop thứ hai. Chỉ hiện khi đã có tên: đừng in ra id thô cho người dùng.
  const scopeName = scopeWarehouseId
    ? data?.fairWarehouses?.find((w) => w.id === scopeWarehouseId)?.name || null
    : null;
  // Khi lỗi thì `data` chưa có ⇒ chưa biết tên, chỉ còn id. Vẫn phải nói rõ đang
  // xem kho nào, nếu không người dùng tưởng lỗi nằm ở "hệ thống".
  const scopeLabel = scopeName
    ? ` của kho ${scopeName}`
    : warehouseId
      ? ` của kho ${warehouseId}`
      : '';

  // createPortal trực tiếp, khớt với 18 file khác trong src/components. Lưu ý:
  // KHÔNG dùng PortalToBody ở đây. Helper đó gate nội dung bằng state `mounted` riêng
  // nên panel xuất hiện ở commit SAU commit mà useModalFocusTrap chạy effect
  // (deps của hook là [isOpen]) — ref chưa có mặt lúc đó, hook return sớm và không
  // bao giờ thử lại ⇒ mất cả bẫy focus lẫn `inert` trên #app-main-content.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[85] bg-slate-900/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget && !busyOrder) {
            onClose();
          }
        }}
      >
        <div
          ref={panelRef}
          className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-6xl shadow-2xl border border-slate-200 my-auto flex flex-col max-h-[92vh]"
        >
          <div className="no-print shrink-0 bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 shrink-0 rounded-2xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center">
                <Activity className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-extrabold text-sm sm:text-base whitespace-nowrap">Trạng Thái Hội Chợ</h3>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                  {data
                    ? `Ngày ${data.businessDate} · cập nhật lúc ${clockOf(lastUpdatedAt)}`
                    : error
                      ? 'Không tải được dữ liệu'
                      : 'Đang tải…'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refresh}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition"
                title="Làm mới số liệu"
                aria-label="Làm mới số liệu trạng thái hội chợ"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="Đóng"
                aria-label="Đóng bảng trạng thái hội chợ"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Chọn kho + ngày. Trước đây màn này chỉ xem được TẤT CẢ kho hội chợ
              và chỉ hôm nay — không có đường vào một kho cụ thể. */}
          <div className="no-print shrink-0 px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
              <MapPin className="w-3.5 h-3.5 text-indigo-500" />
              Kho
              <select
                aria-label="Chọn kho hội chợ"
                value={scopeWarehouseId}
                onChange={(e) => setScopeWarehouseId(e.target.value)}
                className="text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">Tất cả kho hội chợ</option>
                {(data?.fairWarehouses || []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              Ngày
              <input
                type="date"
                aria-label="Chọn ngày"
                value={viewDate}
                onChange={(e) => setViewDate(e.target.value)}
                className="text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
            </label>

            {/* Chọn ngày khác hôm nay thì nhắc rõ, không để người dùng tưởng
                số liệu 0 là "hôm nay chưa bán được gì". */}
            {viewDate !== new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) && (
              <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1">
                Đang xem ngày {viewDate}, không phải hôm nay
              </span>
            )}
          </div>

          {scopeName && (
            <p className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 text-[11px] font-bold text-indigo-800 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              Đang xem kho: {scopeName}
            </p>
          )}

          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Tự làm mới mỗi 10 giây khi đang mở · dừng khi bạn chuyển tab
            </span>
            {showStaleBanner && (
              <span className="inline-flex items-center gap-1.5 text-rose-700 font-bold">
                <AlertTriangle className="w-3.5 h-3.5" />
                {error ? `Không làm mới được: ${error}` : 'Số liệu đã cũ hơn 30 giây'}
              </span>
            )}
          </div>

          <div className="p-4 overflow-y-auto flex-1 space-y-5">
            {notice && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold" role="status">
                {notice}
              </div>
            )}

            {!data && loading && (
              <p className="py-14 text-center text-slate-400 text-xs font-bold">Đang tải trạng thái các gian hàng…</p>
            )}

            {!data && !loading && !error && (
              <p className="py-14 text-center text-slate-400 text-xs">Chưa có số liệu.</p>
            )}

            {/* Lỗi mà chưa có data ⇒ thân modal TRỐNG nếu không có khối này: người
                dùng thấy modal mở ra rồi trắng, không biết là hỏng hay đang tải. */}
            {!data && error && (
              <div className="p-3.5 rounded-2xl border border-rose-200 bg-rose-50 space-y-2.5">
                <p className="text-xs font-extrabold text-rose-800 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Không tải được trạng thái{scopeLabel}
                </p>
                <p className="text-[11px] text-rose-700">{error}</p>
                {warehouseId && (
                  <p className="text-[11px] text-rose-700">
                    Chỉ xem được kho hội chợ đang hoạt động. Chọn kho khác, hoặc bấm Tải lại.
                  </p>
                )}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={refresh}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow transition flex items-center gap-1.5 cursor-pointer"
                    title="Tải lại trạng thái hội chợ"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Tải lại
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs transition cursor-pointer"
                    title="Đóng bảng trạng thái"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            )}

            {data && (
              <>
                {/* 1. KPI hôm nay */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Kpi label="Đơn hôm nay" value={`${t?.orderCount ?? 0}`} sub={`Đơn TB ${money(t?.avgOrderValue)}`} tone="slate" />
                  <Kpi label="Doanh thu hôm nay" value={money(t?.revenue)} sub={`Chiết khấu −${money(t?.totalDiscount)}`} tone="indigo" />
                  <Kpi
                    label="Tiền mặt / Chuyển khoản"
                    value={money(t?.cashRevenue)}
                    // COD không phải tiền mặt cũng không phải chuyển khoản, nhưng
                    // vẫn nằm trong doanh thu. Không in ra thì tổng "TM + CK" không
                    // cộng lại bằng doanh thu và người dùng tưởng mất tiền.
                    sub={`CK ${money(t?.transferRevenue)} · ${t?.transferPct ?? 0}%${t?.otherRevenue ? ` · COD ${money(t?.otherRevenue)}` : ''}`}
                    tone="emerald"
                  />
                  <Kpi
                    label="Chờ tiền"
                    value={`${data.pending.length}`}
                    sub={`${data.pending.filter((p) => p.overdue).length} quá hạn`}
                    tone={data.pending.some((p) => p.overdue) ? 'rose' : 'amber'}
                  />
                </div>

                {t && t.overCapCount > 0 && (
                  <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    {t.overCapCount} đơn có chiết khấu từ 20% trở lên hôm nay.
                  </p>
                )}

                {/* 2. Ai đang bán ở đâu */}
                <Block icon={DoorOpen} title="Đang mở ca">
                  {data.openShifts.length === 0 ? (
                    <Empty text="Chưa có ca nào đang mở ở kho hội chợ." />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {data.openShifts.map((s) => (
                        <li key={s.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">
                              {s.cashierName} <span className="text-slate-400 font-normal">·</span>{' '}
                              <span className="text-slate-600">{s.warehouseName}</span>
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono">
                              Mở {clockOf(s.openedAt)}
                              {s.elapsedMinutes != null ? ` · đã ${s.elapsedMinutes} phút` : ''}
                            </p>
                            {s.overdue && (
                              <p className="text-[11px] font-extrabold text-rose-600 mt-0.5">
                                Quá giờ chốt ngày {s.cutoff}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-slate-400">Dự kiến trong két</p>
                            <p className="font-mono font-bold text-slate-800">{money(s.expectedCashLive)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>

                {/* 3. Đơn đang chờ tiền */}
                <Block icon={Landmark} title="Đơn đang chờ tiền">
                  {data.pending.length === 0 ? (
                    <Empty text="Không có đơn nào đang chờ." />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {data.pending.map((p) => (
                        <li key={p.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-slate-900">{p.orderCode}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {p.cashierName} · {p.warehouseName} · {payLabel(p.paymentMethod)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right">
                              <p className="font-mono font-bold text-slate-900">{money(p.finalAmount)}</p>
                              {p.overdue ? (
                                <p className="text-[10px] font-bold text-rose-600">Quá hạn — cần NV chụp lại ảnh</p>
                              ) : p.minutesLeft != null ? (
                                <p className="text-[10px] font-mono text-slate-400">còn {p.minutesLeft} phút</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => cancelOrder(p.id, p.orderCode)}
                              disabled={busyOrder === p.id}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[11px] font-bold shadow transition flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                              title={`Huỷ đơn ${p.orderCode} đang chờ tiền`}
                              aria-label={`Huỷ đơn ${p.orderCode}`}
                            >
                              {busyOrder === p.id ? '…' : 'Huỷ'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>

                {/* 4. Đơn vừa đóng */}
                <Block icon={CheckCircle2} title="Đơn vừa đóng">
                  {data.recentClosed.length === 0 ? (
                    <Empty text="Chưa có đơn nào đóng." />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {data.recentClosed.map((o, i) => (
                        <li key={`${o.orderCode}-${i}`} className="py-2 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-slate-900 truncate">{o.orderCode}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {o.warehouseName} · {payLabel(o.paymentMethod)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono font-bold text-slate-900">{money(o.finalAmount)}</p>
                            <p className="text-[10px] font-mono text-slate-400">{clockOf(o.createdAt)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 5a. Đơn lớn nhất — chuyển từ Báo Cáo Chốt Ngày sang đây vì nó
                      thuộc loại "đang bán gì", không phải quyết toán tiền cuối ngày. */}
                  <Block icon={Trophy} title="Đơn lớn nhất">
                    {!data.largestOrder ? (
                      <Empty text="Chưa có đơn nào trong ngày đang xem." />
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <p className="font-mono font-black text-base text-slate-900">
                              {data.largestOrder.orderCode}
                            </p>
                            <p className="font-mono font-bold text-sm text-emerald-700">
                              {money(data.largestOrder.finalAmount)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5 justify-end">
                            <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700">
                              {PAY_LABEL[(data.largestOrder.paymentMethod || 'CASH').toUpperCase()] || 'Khác'}
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700">
                              {data.largestOrder.itemCount} SP
                            </span>
                          </div>
                        </div>
                        {t && t.revenue > 0 && (
                          <p className="text-[11px] font-bold text-slate-500">
                            Chiếm {((data.largestOrder.finalAmount / t.revenue) * 100).toFixed(1)}% doanh thu
                            ngày {data.businessDate}
                          </p>
                        )}
                      </div>
                    )}
                  </Block>

                  {/* 5b. Top sản phẩm */}
                  <Block icon={TrendingUp} title="Bán chạy nhất">
                    {data.topSellers.length === 0 ? (
                      <Empty text="Chưa có bán hôm nay." />
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {data.topSellers.map((s, i) => (
                          <li key={s.code} className="py-2 flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-5 h-5 shrink-0 rounded-full bg-slate-200 text-slate-700 font-bold font-mono text-[10px] flex items-center justify-center">
                                {i + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="font-bold text-slate-800 truncate max-w-[190px]">[{s.code}] {s.title}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{money(s.revenue)}</p>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 font-bold font-mono text-xs shrink-0">
                              {s.copies} cuốn
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Block>

                  {/* 6. Duyệt chiết khấu — tái dùng drawer có sẵn, không viết lại logic */}
                  <Block icon={ShieldAlert} title="Cần Quản lý duyệt">
                    <button
                      type="button"
                      ref={approvalTriggerRef}
                      onClick={() => setApprovalOpen(true)}
                      className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold shadow transition flex items-center justify-center gap-2 cursor-pointer"
                      title="Mở danh sách yêu cầu duyệt chiết khấu"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      Xem &amp; Duyệt Yêu Cầu
                    </button>
                    <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      Đơn chờ tiền không phải đơn chờ duyệt — hai việc khác nhau.
                    </p>
                  </Block>
                </div>

                <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                  {data.timezoneNote}
                </p>
              </>
            )}
          </div>

          <div className="no-print shrink-0 px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <Banknote className="w-3.5 h-3.5" />
              {lastUpdatedAt ? `Cập nhật lúc ${clockOf(lastUpdatedAt)}` : 'Chưa cập nhật'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs transition cursor-pointer"
              title="Đóng bảng trạng thái"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>

      {/* Drawer duyệt chiết khấu: tự fetch + tự poll, không cần props POS.
          Cả hai đều nằm ở document.body, nên useModalFocusTrap chỉ inert
          #app-main-content — nó KHÔNG chạm tới modal monitor. Không tự inert
          panel ở đây thì Tab trong drawer nhảy được xuống modal phía dưới. */}
      {approvalOpen && (
        <ManagerApprovalDrawer isOpen onClose={() => setApprovalOpen(false)} onActionCompleted={() => { void load(); }} />
      )}
    </>,
    document.body
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-50 border-slate-200',
    indigo: 'bg-indigo-50/70 border-indigo-200/80',
    emerald: 'bg-emerald-50/70 border-emerald-200/80',
    amber: 'bg-amber-50/70 border-amber-200/80',
    rose: 'bg-rose-50/70 border-rose-200/80',
  };
  return (
    <div className={`p-3 rounded-2xl border ${tones[tone]}`}>
      <p className="text-[11px] font-bold text-slate-600">{label}</p>
      <p className="text-sm font-black font-mono text-slate-900 mt-1 truncate">{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</p>
    </div>
  );
}

function Block({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2">
      <h4 className="font-extrabold text-[11px] uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-indigo-500" />
        {title}
      </h4>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 py-3 text-center">{text}</p>;
}
