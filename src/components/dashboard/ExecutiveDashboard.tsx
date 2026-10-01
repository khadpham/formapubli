'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  DollarSign,
  TrendingUp,
  Boxes,
  ShoppingCart,
  AlertTriangle,
  Receipt,
  ArrowUpRight,
  ShieldCheck,
  Building2,
  RefreshCw,
  Eye,
  CheckCircle2,
  CalendarCheck,
} from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';
import { parseDbTimestamp } from '@/lib/db-timestamp';
import { DailyFairSettlementModal } from '@/components/pos/DailyFairSettlementModal';
import { LiveFairMonitorModal } from '@/components/dashboard/LiveFairMonitorModal';

interface ExecutiveDashboardProps {
  currentRole: UserRole;
  onNavigateTab: (tab: string) => void;
}

export interface DayRevenue {
  key: string;
  label: string;
  total: number;
}

/** Nhãn tiếng Việt (có dấu) cho `warehouses.warehouseType` — dùng ở thẻ "Kho Vận Vật Lý". */
const WAREHOUSE_TYPE_LABEL: Record<string, string> = {
  PHYSICAL_MAIN: 'Kho vật lý chính',
  FAIR_EVENT: 'Gian hàng hội chợ',
  CONSIGNMENT: 'Kho đại lý',
  IN_TRANSIT: 'Hàng đang chuyển',
};

// Mọi cột thời gian trong DB là UTC; ngày/giờ người dùng đọc là giờ Việt Nam
// (UTC+7, không DST). `parseDbTimestamp` đọc được CẢ HAI họ timestamp đang
// cùng tồn tại (ISO 'T' do app ghi và ' ' do SQLite CURRENT_TIMESTAMP ghi).
const VN_TZ = 'Asia/Ho_Chi_Minh';
const vnDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ });
const vnHmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** Ngày nghiệp vụ VN (YYYY-MM-DD) của một mốc thời gian, null nếu dữ liệu hỏng. */
export function vnBusinessDay(value: string | Date | null | undefined): string | null {
  const d = value instanceof Date ? value : parseDbTimestamp(value);
  return d && !Number.isNaN(d.getTime()) ? vnDayFmt.format(d) : null;
}

/** Lùi/trượt một ngày nghiệp vụ (số ngày âm = về quá khứ). Không phụ thuộc múi giờ máy. */
function shiftVnDay(day: string, deltaDays: number): string {
  const [y, mo, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/**
 * Gom doanh thu 7 ngày nghiệp vụ gần nhất.
 *
 * TRƯỚC ĐÂY gom theo `toISOString().slice(0,10)` — tức NGÀY UTC — trong khi
 * nhãn cột lấy theo ngày máy/người dùng. Hai lịch lệch nhau 7 tiếng nên cột
 * "hôm nay" hụt trọn ca 00:00–07:00 và nuốt luôn 17:00–24:00 của hôm qua:
 * đơn 06:30 sáng 10/3 (UTC 23:30 ngày 9/3) rơi vào cột "9/3", cột "10/3" hiện
 * 0 đ. Nay cả khoá lẫn nhãn đều theo GIỜ VIỆT NAM.
 */
export function buildLast7DaysRevenue(orders: any[], now: Date = new Date()): DayRevenue[] {
  const today = vnBusinessDay(now) || vnDayFmt.format(new Date());
  const days: DayRevenue[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = shiftVnDay(today, -i);
    const [, mm, dd] = key.split('-');
    days.push({ key, label: `${Number(dd)}/${Number(mm)}`, total: 0 });
  }
  const map = new Map(days.map((d) => [d.key, d]));
  for (const o of orders as any[]) {
    const bucket = map.get(vnBusinessDay(o?.createdAt) || '');
    if (bucket) bucket.total += Number(o?.finalAmount || 0);
  }
  return days;
}

export interface FiscalSplit {
  tax: number;
  internal: number;
  taxPct: number;
  internalPct: number;
  total: number;
}

/**
 * Tách cơ cấu Sổ Thuế vs Sổ Nội bộ cho biểu đồ vòng.
 *
 * `internalPct` = 100 − `taxPct` thay vì tự làm tròn: làm tròn từng phần có thể
 * ra 1% + 100% = 101% (vòng tròn vẽ chồng) hoặc 99% (hở khoảng trống).
 */
export function buildFiscalSplit(summary: any): FiscalSplit {
  const tax = Number(summary?.officialTax?.revenue || 0);
  const internal = Number(summary?.internalManagement?.revenue || 0);
  const total = tax + internal;
  if (total <= 0) return { tax: 0, internal: 0, taxPct: 0, internalPct: 0, total: 0 };
  const taxPct = Math.round((tax / total) * 100);
  return { tax, internal, taxPct, internalPct: 100 - taxPct, total };
}

/** Giờ Việt Nam trong bảng "Đơn Hàng Gần Đây" — trước đây in thẳng UTC. */
export function formatOrderTime(createdAt: string | null | undefined): string {
  const day = vnBusinessDay(createdAt);
  if (!day) return '—';
  const [, mm, dd] = day.split('-');
  const time = vnHmFmt.format(parseDbTimestamp(createdAt)!);
  return `${dd}/${mm} ${time}`;
}

export function ExecutiveDashboard({
  currentRole,
  onNavigateTab,
}: ExecutiveDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  /** Mốc thời gian nạp xong gần nhất — để nút "Làm mới" có trạng thái SAU khi bấm. */
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [isLiveMonitorOpen, setIsLiveMonitorOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [stockSummary, setStockSummary] = useState<{
    titlesWithStock: number;
    totalUnits: number;
    totalSkus: number;
    warehouseCount: number;
    warehouseNames: string[];
  } | null>(null);
  /**
   * Phạm vi kho của TOÀN TRANG. Trước đây dropdown chỉ đổi kho cho modal báo cáo
   * ngày, còn số liệu tổng quan luôn là toàn hệ thống — bấm kho nào cũng thấy
   * cùng một con số. Nay `selectedWarehouseId` gắn vào MỌI fetch (`/api/orders`
   * và `/api/analytics?view=stock-summary`), nên 4 KPI, tách sổ kép, trend 7 ngày,
   * donut, top 5 và đơn gần đây đều tính từ `orders`/`stockSummary` đã lọc —
   * các khối đó KHÔNG cần sửa code.
   *
* 'ALL' = toàn hệ thống. Được nhớ lại giữa các phiên.
   *
   * KHỞI TẠO LUÔN 'ALL', KHÔNG đọc localStorage trong initializer: initializer chạy
   * cả lúc server render, nên giá trị đọc được ở client (khác 'ALL') sẽ KHÔNG khớp
   * HTML server gửi ⇒ React báo hydration mismatch và vứt cả cây render đi (đã thấy
   * đúng triệu chứng đó trong console). Đọc localStorage trong effect, sau khi đã
   * biết vai trò + kho gán (xem effect bên dưới).
   */
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('ALL');
  /**
   * Kho bị gán cho thu ngân (`/api/auth/me` → `assignedWarehouseId`). Khi có,
   * ép phạm vi về đúng kho của ca và KHÔNG cho chọn kho khác.
   */
  const [lockedWarehouseId, setLockedWarehouseId] = useState<string | null>(null);
  /**
   * Đã biết vai trò + kho gán hay chưa. CHƯA biết thì KHÔNG fetch số liệu: nếu
   * fetch ngay lúc mount, thu ngân nhìn thấy một vòng số "toàn hệ thống" trước khi
   * `/api/auth/me` kịp trả về kho của ca — tức là lộ số của kho khác trước mắt.
   */
  const [assignmentResolved, setAssignmentResolved] = useState(false);
  /** Modal "Báo Cáo Ngày" luôn cần MỘT kho: khi phạm vi là toàn hệ thống thì lấy kho hội chợ đầu tiên (giữ hành vi cũ). */
  const [defaultFairWarehouseId, setDefaultFairWarehouseId] = useState<string>('wh-du-phong');
  /**
   * Số thứ tự request. Bấm "Làm mới" liên tiếp (hoặc đổi kho liên tiếp) sẽ có
   * nhiều request chạy song song; response CŨ đến sau sẽ ghi đè số của response
   * MỚI. Mẫu giống hệt `requestSeqRef` ở DailyFairSettlementModal.
   */
  const requestSeqRef = useRef(0);

  const pickWarehouse = (id: string) => {
    setSelectedWarehouseId(id);
    try {
      localStorage.setItem('dashboard.warehouseId', id);
    } catch {
      /* Safari ẩn danh / chặn storage: bỏ qua, chỉ mất tính năng nhớ lựa chọn */
    }
  };

  const scopeParam = selectedWarehouseId !== 'ALL' ? `&warehouseId=${encodeURIComponent(selectedWarehouseId)}` : '';

  const fetchDashboardData = async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const [orderRes, stockRes] = await Promise.all([
        // no-store: bấm "Làm mới" phải đọc server thật, không phải bản cache
        // của trình duyệt (dynamic route nhưng client fetch vẫn bị HTTP cache).
        fetch(`/api/orders?fiscalScope=ALL${scopeParam}`, { cache: 'no-store' }),
        // Số liệu tồn kho. Trước đây thẻ "Tồn Kho" hiển thị CHỮ VIẾT CỨNG
        // "81 Đầu Sách" + "(3 Kho)" + tên kho viết thẳng, nên không bao giờ đúng.
        fetch(`/api/analytics?view=stock-summary${scopeParam}`, { cache: 'no-store' }),
      ]);
      const orderData = await orderRes.json();
      const stockData = await stockRes.json();

      if (seq !== requestSeqRef.current) return; // response cũ → bỏ, không ghi đè
      if (orderData.success) {
        setOrders(orderData.orders || []);
        setSummary(orderData.summary || null);
        setStockSummary(stockData?.success ? stockData.data : null);
        setLastUpdatedAt(new Date().toLocaleTimeString('vi-VN'));
      }
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      console.error('Lỗi tải dữ liệu dashboard:', err);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  // Chỉ fetch khi ĐÃ rõ vai trò + kho gán (xem `assignmentResolved`).
  useEffect(() => {
    if (!assignmentResolved) return;
    fetchDashboardData();
  }, [currentRole, selectedWarehouseId, assignmentResolved]);

  // Một lệch duy nhất cho cả 2 việc: (a) đọc lựa chọn kho đã nhớ trong
  // localStorage, (b) hỏi kho gán của thu ngân. Chạy trước mọi fetch số liệu.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        const wid = j?.data?.assignedWarehouseId;
        if (wid) {
          // Kho của ca thắng lựa chọn đã nhớ — thu ngân không tự chọn được kho khác.
          setLockedWarehouseId(wid);
          setSelectedWarehouseId(wid);
          return;
        }
        try {
          setSelectedWarehouseId(localStorage.getItem('dashboard.warehouseId') || 'ALL');
        } catch {
          setSelectedWarehouseId('ALL');
        }
      })
      .catch(() => {})
      .finally(() => {
        // Dù hỏi API thất bại cũng phải mở khoá fetch, nếu không trang đứng trống
        // vĩnh viễn với "Đang tải…" khi mạng chập chờn.
        if (alive) setAssignmentResolved(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    async function loadWarehouses() {
      try {
        const res = await fetch('/api/warehouses?all=true', { cache: 'no-store' });
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setWarehouses(json.data);
          // API trả `warehouseType`, KHÔNG có `type` ⇒ trước đây fairWh luôn
          // undefined và kho được ghim cứng 'wh-du-phong'; nếu kho đó không tồn
          // tại, API chốt ngày trả 400 và modal báo "không có dữ liệu" — tưởng
          // không có dữ liệu trong khi thực ra là chọn sai kho.
          const fairWh = json.data.find((w: any) => w.warehouseType === 'FAIR_EVENT');
          if (fairWh) {
            setDefaultFairWarehouseId(fairWh.id);
          }
        }
      } catch (err) {
        console.error('Lỗi tải danh mục kho cho Dashboard:', err);
      }
    }
    loadWarehouses();
  }, []);

  // Kho đã lưu có thể không còn dùng được: đã xoá, HOẶC đã ngưng hoạt động
  // (`isActive = 0`). Cả hai đều làm `/api/analytics?view=stock-summary` trả
  // `warehouseCount = 0` ⇒ thẻ tồn kho hiện "(0 KHO)" và trang trông như hệ
  // thống hết hàng. Trước đây chỉ bắt kho xoá nên kho ngưng lọt qua; nay kiểm
  // cả `isActive`. Không thỏa ⇒ quay về 'ALL' và ghi đè giá trị cũ trong storage.
  useEffect(() => {
    if (warehouses.length === 0 || selectedWarehouseId === 'ALL') return;
    if (lockedWarehouseId) return; // kho gán phải còn thì server mới trả lỗi, đừng âm thầm đổi phạm vi
    if (warehouses.some((w: any) => w.id === selectedWarehouseId && w.isActive)) return;
    setSelectedWarehouseId('ALL');
    try {
      localStorage.setItem('dashboard.warehouseId', 'ALL');
    } catch {
      /* storage bị chặn — không sao, chỉ mất nhớ lựa chọn */
    }
  }, [warehouses, selectedWarehouseId, lockedWarehouseId]);

  // Thẻ "Sách sắp hết hàng" KHÔNG tồn tại trong JSX: `lowStockBooks` cũ chỉ
  // được tính ra rồi bỏ không, và biến `matrixBooks` từng được setState ở đâu đó
  // nhưng không chỗ nào render. Dữ liệu tồn chỉ có ở server prop
  // `page.tsx` → `MasterAppShell`, mà shell KHÔNG truyền xuống Dashboard.
  // Không tự bịa số: cần thêm `books={matrixBooks}` ở MasterAppShell:333 và
  // render thẻ — cả hai đều ngoài phạm vi sửa của phiên này.

  // Ticket 4: 3 chart SVG nhẹ tính từ orders/summary đã fetch — không lib, không API mới.
  const last7Days = React.useMemo(() => buildLast7DaysRevenue(orders), [orders]);

  const maxDayTotal = Math.max(1, ...last7Days.map((d) => d.total));

  const fiscalSplit = React.useMemo(() => buildFiscalSplit(summary), [summary]);

  const topOrders = React.useMemo(() => {
    return [...(orders as any[])]
      .sort((a, b) => Number(b.finalAmount || 0) - Number(a.finalAmount || 0))
      .slice(0, 5);
  }, [orders]);

  const maxTopAmount = Math.max(1, ...topOrders.map((o: any) => Number(o.finalAmount || 0)));

  const isOwnerOrManager = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

  /** Kho mà modal "Báo Cáo Ngày" sẽ mở: kho đang chọn, hoặc kho hội chợ đầu tiên khi phạm vi là toàn hệ thống. */
  const settlementWarehouseId =
    selectedWarehouseId !== 'ALL' ? selectedWarehouseId : defaultFairWarehouseId;

  /** Tên kho dùng cho banner + modal; null khi phạm vi là toàn hệ thống. */
  const scopeWarehouseName =
    selectedWarehouseId === 'ALL'
      ? null
      : (warehouses.find((w: any) => w.id === selectedWarehouseId)?.name ?? selectedWarehouseId);

  /** Thu ngân bị gán kho không được chọn kho khác — chỉ hiện đúng kho của ca. */
  const selectableWarehouses = lockedWarehouseId
    ? warehouses.filter((w: any) => w.id === lockedWarehouseId)
    : warehouses;

  return (
    <div className="space-y-6">
      {/* Top Welcome & Status Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-4 md:p-6 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-indigo-900/50">
        {/* Mobile chỉ giữ cụm nút chức năng (tên trang đã có ở top bar) */}
        <div className="hidden md:block">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Tổng quan điều hành
            </span>
            <span className="text-xs text-slate-400">
              Cập nhật thời gian thực từ Cloudflare D1
            </span>
          </div>
          <h2 className="text-2xl font-black mt-1 text-white tracking-tight">
            Bảng Quản Trị Vận Hành Toàn Cảnh
          </h2>
          {/* Dòng phạm vi: mọi số bên dưới thuộc đúng kho đang chọn ở thanh nút
              trên cùng. Bản desktop nằm ở đây; bản mobile ở ngoài khối
              `hidden md:block` (xem bên dưới) vì mobile không thấy tiêu đề ở
              trên này — mà tên kho là thứ duy nhất cho biết số đang xem. */}
          <p className="hidden md:block text-sm font-bold text-amber-300 mt-0.5">
            Phạm vi: {scopeWarehouseName ?? 'Tất cả kho'}
          </p>
          <p className="text-sm text-slate-300 mt-0.5 max-w-2xl">
            Giám sát toàn diện 3 Khối Cốt Lõi: Kho Hàng 3 Địa Điểm, Quầy Thu Ngân Bán Sách và Sổ Kép Tài Chính.
          </p>
        </div>
        <p className="md:hidden text-sm font-bold text-amber-300 shrink-0">
          Phạm vi: {scopeWarehouseName ?? 'Tất cả kho'}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={fetchDashboardData}
            disabled={loading}
            aria-busy={loading}
            title="Đọc lại số liệu đơn hàng từ server"
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors shrink-0 cursor-pointer ${
              loading
                ? 'bg-slate-800 text-slate-400 border-slate-700 cursor-progress'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Đang tải…' : 'Làm mới số liệu'}
            {!loading && lastUpdatedAt && (
              <span className="font-mono text-[10px] font-normal text-slate-400">
                {lastUpdatedAt}
              </span>
            )}
          </button>
          <button
            onClick={() => onNavigateTab('pos')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all shrink-0"
            title="Mở quầy bán hàng"
            aria-label="Mở quầy bán hàng POS"
          >
            <ShoppingCart className="w-4 h-4" />
            Mở Quầy POS
          </button>
          {/* Trạng thái hội chờ lúc NÀY: ai đang bán, đơn nào chờ tiền, cần duyệt gì.
              Modal tự làm mới 10 giây khi mở và dừng hẳn khi đóng — không tốn
              request khi không ai xem. */}
          <button
            onClick={() => setIsLiveMonitorOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-teal-600/30 transition-all shrink-0"
            title="Xem trạng thái bán hàng hội chợ lúc này"
            aria-label="Xem trạng thái bán hàng hội chợ lúc này"
          >
            <Activity className="w-4 h-4" />
            Xem Trạng Thái
          </button>
          {/* Bộ chọn phạm vi kho: đổi phạm vi thì TOÀN TRANG đổi theo (đã gắn vào mọi fetch) */}
          <div className="flex items-center bg-slate-800/90 border border-slate-700 rounded-xl p-1 shadow-inner shrink-0 max-w-full">
            <Building2 className="w-3.5 h-3.5 text-amber-400 ml-2 mr-1 shrink-0" />
            <select
              value={selectedWarehouseId}
              onChange={(e) => pickWarehouse(e.target.value)}
              className="bg-transparent text-amber-300 text-xs font-bold outline-none cursor-pointer pr-2 max-w-[200px] truncate min-w-0"
              title="Chọn kho muốn xem — mọi số liệu trên trang đổi theo kho này"
              aria-label="Chọn kho để xem số liệu tổng quan"
            >
              {!lockedWarehouseId && (
                <option value="ALL" className="bg-slate-900 text-white">
                  Tất cả kho
                </option>
              )}
              {selectableWarehouses.length > 0 ? (
                selectableWarehouses.map((w) => (
                  <option key={w.id} value={w.id} className="bg-slate-900 text-white">
                    {w.name}
                  </option>
                ))
              ) : (
                <option value={lockedWarehouseId || 'ALL'} className="bg-slate-900 text-white">
                  {lockedWarehouseId || 'Kho 3 - Hội Chợ'}
                </option>
              )}
            </select>
            <button
              onClick={() => setIsSettlementModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer shrink-0"
              title="Xem báo cáo chốt ngày của kho đang chọn. Ngày được máy chốt tự động lúc 23:59, nút này không chốt ngày."
              aria-label="Xem Báo Cáo Ngày của kho đang chọn"
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              Báo Cáo Ngày
            </button>
          </div>
          {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && (
            <button
              onClick={() => onNavigateTab('studio')}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold border border-white/20 transition-all shrink-0"
              title="Mở Không Gian Phân Tích Chuyên Sâu & Dự Báo (Alt+7)"
            >
              🔬 Phân Tích Chuyên Sâu
            </button>
          )}
        </div>
      </div>

      {/* 4 Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Doanh thu Thực tế (Toàn cảnh nội bộ) */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Doanh Thu Thực Tế (All)
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2 font-mono">
            {isOwnerOrManager ? (
              `${(summary?.totalRevenue || 0).toLocaleString('vi-VN')} đ`
            ) : (
              <span className="text-slate-400 text-base font-normal italic">Được ẩn bởi phân quyền</span>
            )}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Gồm bán lẻ hội chợ & đại lý sỉ Đinh Lễ
          </p>
        </div>

        {/* Doanh thu Thuế Kê khai (Chính thức VAT) */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Doanh Thu Kê Khai Thuế
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-emerald-700 mt-2 font-mono">
            {summary?.officialTax ? (
              `${(summary.officialTax.revenue || 0).toLocaleString('vi-VN')} đ`
            ) : (
              '0 đ'
            )}
          </p>
          <p className="text-xs text-emerald-600 font-medium mt-1">
            Hóa đơn VAT hợp pháp nộp Chi cục Thuế
          </p>
        </div>

        {/* Tổng Tồn Kho Vật Lý — số liệu lấy THẬT từ API, không ghi cứng. Lọc theo kho
            KHÔNG cần sửa khối này: `/api/analytics?view=stock-summary&warehouseId=`
            đã trả `warehouseCount=1` + `warehouseNames=[tên kho đó]`. */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Tồn Kho Vật Lý ({stockSummary?.warehouseCount ?? 0} Kho)
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Boxes className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2 font-mono">
            {stockSummary ? stockSummary.titlesWithStock : '…'} Đầu Sách
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {stockSummary
              ? `${stockSummary.totalUnits.toLocaleString('vi-VN')} cuốn · ${stockSummary.warehouseNames.join(' · ')}`
              : 'Đang tải…'}
          </p>
        </div>

        {/* Tổng Đơn Hàng & Sách Bán */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Đơn Hàng Đã Chốt
            </span>
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2 font-mono">
            {summary?.totalOrders || 0} Đơn
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Khấu trừ thẻ kho tức thời 100%
          </p>
        </div>
      </div>

      {/* Middle Section: Cash Flow Breakdown & Quick Action Modules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Dual-Bookkeeping Financial Breakdown */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                Phân Tách Dòng Tiền Sổ Kép
              </h3>
              <p className="text-xs text-slate-500">
                Minh bạch tách bạch giữa Doanh thu Thuế chính thức và Doanh thu Thực tế Nội bộ
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('sales')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              Chi tiết sổ cái <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Box 1: Sổ Thuế */}
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                  Sổ Kế Toán Thuế
                </span>
                <span className="text-[10px] bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full font-bold">
                  Sạch 100%
                </span>
              </div>
              <p className="text-xl font-extrabold text-emerald-900 mt-2 font-mono">
                {summary?.officialTax ? `${(summary.officialTax.revenue || 0).toLocaleString('vi-VN')} đ` : '0 đ'}
              </p>
              <div className="mt-3 text-xs text-emerald-800 space-y-1">
                <div className="flex justify-between">
                  <span>Số đơn hóa đơn VAT:</span>
                  <span className="font-bold">{summary?.officialTax?.ordersCount || 0} đơn</span>
                </div>
                <div className="flex justify-between">
                  <span>Tài khoản nhận tiền:</span>
                  <span className="font-bold">Ngân hàng Công ty</span>
                </div>
              </div>
            </div>

            {/* Box 2: Sổ Quản Trị Thực Tế */}
            <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-800 uppercase tracking-wide">
                  Sổ Quản Trị Thực Tế
                </span>
                <span className="text-[10px] bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded-full font-bold">
                  Bảo Mật
                </span>
              </div>
              <p className="text-xl font-extrabold text-indigo-900 mt-2 font-mono">
                {isOwnerOrManager ? (
                  summary?.internalManagement ? `${(summary.internalManagement.revenue || 0).toLocaleString('vi-VN')} đ` : '0 đ'
                ) : (
                  <span className="text-slate-400 text-sm italic font-normal">Ẩn theo quyền</span>
                )}
              </p>
              <div className="mt-3 text-xs text-indigo-800 space-y-1">
                <div className="flex justify-between">
                  <span>Đơn đại lý & bán lẻ:</span>
                  <span className="font-bold">{summary?.internalManagement?.ordersCount || 0} đơn</span>
                </div>
                <div className="flex justify-between">
                  <span>Hình thức:</span>
                  <span className="font-bold">Tiền mặt / Chuyển khoản cá nhân</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Quick Warehouse Navigation */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
              <Building2 className="w-5 h-5 text-amber-600" />
              Kho Vận Vật Lý
            </h3>
            <button
              onClick={() => onNavigateTab('inventory')}
              className="text-xs font-bold text-amber-600 hover:text-amber-800 flex items-center gap-1"
            >
              Vào kho <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Trước đây 3 thẻ này viết CỨNG tên kho + mô tả — thêm kho thứ 4 là
                sai ngay, còn kho bị xoá thì vẫn hiện. Nay dựng từ /api/warehouses. */}
            {warehouses.length === 0 ? (
              <p className="text-xs text-slate-400">Đang tải danh sách kho…</p>
            ) : (
              warehouses.map((w: any) => (
                <div
                  key={w.id}
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    w.id === selectedWarehouseId
                      ? 'bg-amber-50 border-amber-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">{w.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {WAREHOUSE_TYPE_LABEL[w.warehouseType] || 'Kho'}
                      {w.code ? ` · ${w.code}` : ''}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-lg text-xs font-bold font-mono shrink-0 ml-2 ${
                      w.isActive
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {w.isActive ? 'Hoạt động' : 'Ngưng'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Ticket 4: 3 chart SVG nhẹ kiểu Power BI — trend 7 ngày, donut sổ kép, top 5 đơn */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend doanh thu 7 ngày */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Doanh thu 7 ngày</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Hover từng cột xem số • Tính từ đơn đã fetch</p>
          <div className="mt-3 flex items-end gap-1.5 h-28">
            {last7Days.map((d) => (
              <div key={d.key} className="flex-1 flex flex-col items-center gap-1" title={`${d.key}: ${d.total.toLocaleString('vi-VN')} đ`}>
                <div
                  className="w-full rounded-t-md bg-indigo-500/90 hover:bg-indigo-600 transition-colors"
                  style={{ height: `${Math.max(4, Math.round((d.total / maxDayTotal) * 96))}px` }}
                />
                <span className="text-[9px] font-mono text-slate-400">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Donut cơ cấu sổ Thuế vs Thực */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cơ cấu Sổ Thuế vs Sổ Thực</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Thuế VAT xanh lá • Nội bộ tím</p>
          <div className="mt-3 flex items-center gap-4">
            <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
              <circle cx="48" cy="48" r="38" fill="none" stroke="#e2e8f0" strokeWidth="14" />
              {fiscalSplit.total > 0 && (
                <>
                  <circle
                    cx="48" cy="48" r="38" fill="none" stroke="#10b981" strokeWidth="14"
                    strokeDasharray={`${(fiscalSplit.taxPct / 100) * 238.8} 238.8`}
                    strokeLinecap="round" transform="rotate(-90 48 48)"
                  />
                  <circle
                    cx="48" cy="48" r="38" fill="none" stroke="#8b5cf6" strokeWidth="14"
                    strokeDasharray={`${(fiscalSplit.internalPct / 100) * 238.8} 238.8`}
                    strokeDashoffset={`${-((fiscalSplit.taxPct / 100) * 238.8)}`}
                    strokeLinecap="round" transform="rotate(-90 48 48)"
                  />
                </>
              )}
              <text x="48" y="52" textAnchor="middle" className="font-mono" fontSize="13" fontWeight="800" fill="#0f172a">
                {fiscalSplit.total > 0 ? `${fiscalSplit.taxPct}%` : '—'}
              </text>
            </svg>
            <div className="text-xs space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-slate-600">VAT: </span>
                <span className="font-mono font-bold text-slate-900">{fiscalSplit.tax.toLocaleString('vi-VN')} đ</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                <span className="text-slate-600">Nội bộ: </span>
                {isOwnerOrManager ? (
                  <span className="font-mono font-bold text-slate-900">{fiscalSplit.internal.toLocaleString('vi-VN')} đ</span>
                ) : (
                  <span className="italic text-slate-400">Ẩn theo quyền</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Top 5 đơn lớn nhất */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Top 5 đơn giá trị cao</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Thanh ngang theo thực thu</p>
          <div className="mt-3 space-y-2">
            {topOrders.length === 0 ? (
              <p className="text-xs text-slate-400">Chưa có đơn — mở POS tạo đơn đầu tiên.</p>
            ) : (
              topOrders.map((o: any) => (
                <div key={o.id}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono font-bold text-indigo-700 truncate">{o.orderCode}</span>
                    <span className="font-mono text-slate-600">{Number(o.finalAmount || 0).toLocaleString('vi-VN')} đ</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500"
                      style={{ width: `${Math.max(4, Math.round((Number(o.finalAmount || 0) / maxTopAmount) * 100))}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              Đơn Hàng Gần Đây & Bút Toán Khấu Trừ Kho
            </h3>
            <p className="text-xs text-slate-500">
              Nhật ký bán hàng và cờ phân loại Sổ Kép tài chính
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('sales')}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
          >
            Xem toàn bộ đơn
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
              <tr>
                <th className="p-3.5">Mã Đơn</th>
                <th className="p-3.5">Khách Hàng / Đối Tác</th>
                <th className="p-3.5">Thanh Toán</th>
                <th className="p-3.5">Giá Bìa</th>
                <th className="p-3.5">Chiết Khấu</th>
                <th className="p-3.5">Thực Thu</th>
                <th className="p-3.5">Phân Loại Sổ</th>
                <th className="p-3.5">Thời Gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    Chưa có đơn hàng nào được ghi nhận. Hãy mở Quầy POS để tạo đơn bán đầu tiên!
                  </td>
                </tr>
              ) : (
                orders.slice(0, 5).map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50/80">
                    <td className="p-3.5 font-mono font-bold text-indigo-700">
                      {ord.orderCode}
                    </td>
                    <td className="p-3.5 font-medium text-slate-800">
                      {ord.customerName || 'Khách lẻ'}
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 font-mono">
                        {ord.paymentMethod}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-slate-600">
                      {ord.subtotal.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="p-3.5 font-mono text-amber-600 font-medium">
                      -{ord.discountAmount ? ord.discountAmount.toLocaleString('vi-VN') : 0} đ
                    </td>
                    <td className="p-3.5 font-mono font-bold text-slate-900">
                      {ord.finalAmount.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="p-3.5">
                      {ord.fiscalScope === 'OFFICIAL_TAX' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Hóa đơn VAT
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                          Sổ Quản trị Nội bộ
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-400 text-[11px] font-mono">
                      {formatOrderTime(ord.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Báo Cáo Chốt Ngày Hội Chợ & Đối Soát Kiểm Kê (Sprint 4) */}
      <DailyFairSettlementModal
        isOpen={isSettlementModalOpen}
        onClose={() => setIsSettlementModalOpen(false)}
        warehouseId={settlementWarehouseId}
        warehouseName={
          warehouses.find((w: any) => w.id === settlementWarehouseId)?.name ||
          'Kho 3 - Hội Chợ (Gian hàng sự kiện)'
        }
        currentRole={currentRole}
      />

      {/* Modal Trạng Thái Hội Chợ — lúc này, không phải báo cáo cuối ngày. */}
      <LiveFairMonitorModal
        isOpen={isLiveMonitorOpen}
        onClose={() => setIsLiveMonitorOpen(false)}
      />
    </div>
  );
}
