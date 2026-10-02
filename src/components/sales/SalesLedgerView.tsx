'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GiftReportPanel } from './GiftReportPanel';
import {
  Receipt,
  ShieldCheck,
  Building2,
  Calendar,
  Filter,
  RefreshCw,
  Search,
  FileSpreadsheet,
  Percent,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { matchesAnyVietnameseField } from '@/lib/vietnamese';
import {
  buildSalesCsv,
  channelLabel,
  fiscalScopeLabel,
  lastNDays,
  monthPreset,
  paymentLabel,
  vnHour,
  vnToday,
} from '@/lib/sales-view';
import { RevenueAnalyticsPanel } from './RevenueAnalyticsPanel';
import { TopEditionsPanel } from './TopEditionsPanel';

// Slicer kenh ban -> nhom nguon (pivot nhanh kieu Excel).
// Đây là PHÂN NHÓM slicer, KHÔNG phải nhãn hiển thị — nhãn hiển thị lấy từ
// `channelLabel` (src/lib/sales-view.ts) để cả màn Doanh Số chỉ có một từ điển.
const CHANNEL_GROUP_OF: Record<string, 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'GIFT'> = {
  FAIR_EVENT: 'RETAIL',
  RETAIL_OFFICE: 'RETAIL',
  WHOLESALE_PARTNER: 'WHOLESALE',
  ONLINE: 'ONLINE',
  RETAIL_ONLINE_WEB: 'ONLINE',
  RETAIL_ONLINE_SOCIAL: 'ONLINE',
  SPONSORSHIP: 'GIFT',
};

/** Tổng doanh thu do SERVER tính (`GET /api/orders` → `summary`). */
interface SalesSummary {
  totalOrders: number;
  totalSubtotal: number;
  totalDiscount: number;
  totalRevenue: number;
}

interface SalesLedgerViewProps {
  currentRole: UserRole;
}

export function SalesLedgerView({ currentRole }: SalesLedgerViewProps) {
  const [orders, setOrders] = useState<any[]>([]);
  // Tổng doanh số do SERVER tính (`getSalesSummary`), KHÔNG cộng lại từ `orders`.
  // Cộng client sai ở 3 chỗ: (1) slicer kênh + ô tìm kiếm lọc `orders` nhưng thẻ
  // tổng phải theo đúng bộ lọc server; (2) server đã loại SPONSORSHIP khỏi doanh
  // thu bán, client cộng lại là lệch; (3) `getOrders` không giới hạn số dòng.
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeScope, setActiveScope] = useState<'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT'>('ALL');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('ALL');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [discountDisplayMode, setDiscountDisplayMode] = useState<'PERCENT' | 'VND'>('PERCENT');
  const [datePreset, setDatePreset] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  // Slicer + phan trang cuc bo: gioi han chieu cao bang, mac dinh 20 don
  const [channelSlicer, setChannelSlicer] = useState<'ALL' | 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'GIFT'>('ALL');
  const [pageSize, setPageSize] = useState<number>(20); // 20 | 50 | 100 | -1 (tat ca)
  // Mã nhân viên THẬT đóng watermark mọi lượt xuất CSV. Trước đây ghi cứng
  // 'cashier-pos' ⇒ không lượt xuất nào truy vết được về người đã bấm.
  const [actorId, setActorId] = useState<string>('');

  const isTaxAccountant = currentRole === 'ROLE_TAX';
  // Spec §5: thu ngân KHÔNG được thấy nút chọn Sổ Thuế — server ép INTERNAL cho
  // thu ngân nên để nút đó là hứa một thứ rồi trả thứ khác (cashier bấm "Sổ Thuế"
  // mà cột toàn "Sổ Quản trị Nội bộ"). Chỉ Owner/Manager được chuyển sổ.
  const canViewTaxScope = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  // Sổ đang xem: kế toán thuế bị ÉP OFFICIAL_TAX (xem useEffect bên dưới), người
  // khác tự chọn. 'ALL' = xem cả hai sổ. MỘT nơi tính, dùng lại cho cả danh sách
  // lẫn các panel con — không để mỗi panel tự suy luận lại.
  const scopeParam: 'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT' = isTaxAccountant
    ? 'OFFICIAL_TAX'
    : activeScope;

  // Tải danh mục kho động từ server
  useEffect(() => {
    async function loadWarehouses() {
      try {
        const res = await fetch('/api/warehouses?all=true');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setWarehouses(json.data);
        }
      } catch (err) {
        console.error('Lỗi tải danh mục kho:', err);
      }
    }
    loadWarehouses();
  }, []);

  // Tên kho CHỈ lấy từ API. Trước đây kho lạ bị đổ thành 'Kho Quỳnh Mai' ⇒ người
  // dùng thấy trên sổ một tên kho không tồn tại rồi tưởng đang xem sai kho.
  // Thiếu tên thì hiện '—' thành thật.
  const warehouseNameById = useMemo(
    () => new Map<string, string>((warehouses || []).map((w: any) => [w.id, w.name])),
    [warehouses]
  );
  const warehouseNameOf = useCallback(
    (id: string | null | undefined) => (id ? warehouseNameById.get(id) || '—' : '—'),
    [warehouseNameById]
  );

  // Nút "Làm mới" chỉ gọi lại `fetchOrders` — KHÔNG nạp lại `/api/warehouses`
  // (useEffect kho chạy một lần lúc mount). Nên nhắc người dùng "tải lại
  // trang", đừng hứa "bấm Làm mới" rồi kho vẫn trống.
  // Người đăng nhập thật (đóng watermark CSV). Rỗng thì KHÔNG xuất được: ký
  // bằng mã bịa thì tệ hơn là không có dấu vết.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.success) setActorId(json.data?.actorId || '');
      })
      .catch(() => {
        /* im lặng: nút Xuất tự khoá, không chặn cả màn hình */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nếu là Kế toán thuế: Ép cứng chỉ được xem OFFICIAL_TAX
  useEffect(() => {
    if (isTaxAccountant) {
      setActiveScope('OFFICIAL_TAX');
    }
  }, [currentRole, isTaxAccountant]);

  // Xử lý chuyển đổi Preset ngày — dùng helper dùng chung (`sales-view.ts`):
  // "Tháng này" = THÁNG LỊCH VN, "7 ngày" = ĐÚNG 7 ngày tính cả hôm nay.
  // Ngày gửi dạng TRẦN 'YYYY-MM-DD' = ngày nghiệp vụ (xem `createdAtBetween`),
  // nên KHÔNG gắn hậu tố 'T23:59:59'.
  const handleDatePresetChange = (preset: 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM') => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'ALL') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'TODAY') {
      const today = vnToday(now);
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'WEEK') {
      const r = lastNDays(7, now);
      setStartDate(r.startDate);
      setEndDate(r.endDate);
    } else if (preset === 'MONTH') {
      const r = monthPreset(now);
      setStartDate(r.startDate);
      setEndDate(r.endDate);
    } else {
      // CUSTOM phải XOÁ ngày cũ: trước đây nhánh này rỗng nên bấm "Tùy chọn" sau
      // khi đang lọc "7 ngày" vẫn hiện 7 ngày đó, tưởng đã tự lọc theo.
      setStartDate('');
      setEndDate('');
    }
  };

  const abortRef = useRef<AbortController | null>(null);

  const fetchOrders = useCallback(async () => {
    // Bấm liên tiếp nhiều preset/kho thì request cũ vẫn bay về và ghi đè kết
    // quả mới. Huỷ request trước đó thay vì so timestamp.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('fiscalScope', scopeParam);
      if (selectedWarehouse !== 'ALL') {
        params.set('warehouseId', selectedWarehouse);
      }
      if (startDate) {
        params.set('startDate', startDate);
      }
      if (endDate) {
        params.set('endDate', endDate);
      }

      const res = await fetch(`/api/orders?${params.toString()}`, { signal: controller.signal });
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
        setSummary(data.summary ?? null);
      } else {
        setOrders([]);
        setSummary(null);
        setLoadError(data.error || 'Không tải được danh sách doanh số.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Lỗi tải danh sách doanh số:', err);
      setLoadError('Không tải được danh sách doanh số. Kiểm tra mạng rồi bấm "Làm mới".');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [activeScope, currentRole, selectedWarehouse, startDate, endDate]);

  useEffect(() => {
    fetchOrders();
    return () => abortRef.current?.abort();
  }, [fetchOrders]);

  const filteredOrders = orders.filter((ord) => {
    if (channelSlicer !== 'ALL' && CHANNEL_GROUP_OF[ord.channel] !== channelSlicer) return false;
    // Chuẩn hoá dấu: gõ "truong" phải ra "Trường". `toLowerCase().includes()`
    // cũ không bao giờ khớp tên có dấu.
    return matchesAnyVietnameseField(searchQuery, [ord.orderCode, ord.customerName, ord.vatInvoiceCode]);
  });

  // Gioi han so dong hien thi de bang gon trong 1 man hinh (cuon doc xem tiep)
  const visibleOrders = pageSize === -1 ? filteredOrders : filteredOrders.slice(0, pageSize);

  // Đơn quà 0đ (tặng 100%) vẫn đếm vào totalOrders của server — ghi rõ để người
  // đọc không tưởng "N đơn = N đơn có tiền".
  const zeroValueCount = orders.filter((o) => Number(o?.finalAmount) === 0).length;

  const avgDiscountPercent =
    summary && summary.totalSubtotal > 0
      ? ((summary.totalDiscount / summary.totalSubtotal) * 100).toFixed(1)
      : '0.0';

  // Xuất CSV dùng helper dùng chung: header có dấu, kênh/giờ tiếng Việt, watermark
  // ký đúng người đang đăng nhập.
  const exportToCSV = () => {
    if (filteredOrders.length === 0) {
      alert('Không có dữ liệu đơn hàng để xuất CSV.');
      return;
    }
    if (!actorId) {
      alert('Chưa đọc được người đăng nhập nên chưa xuất được. Tải lại trang rồi thử lại.');
      return;
    }

    const rows = filteredOrders.map((ord) => ({
      orderCode: ord.orderCode,
      warehouseName: warehouseNameOf(ord.warehouseId),
      channel: ord.channel,
      customerName: ord.customerName,
      paymentMethod: ord.paymentMethod,
      subtotal: Number(ord.subtotal || 0),
      discountAmount: Number(ord.discountAmount || 0),
      finalAmount: Number(ord.finalAmount || 0),
      fiscalScope: ord.fiscalScope,
      vatInvoiceCode: ord.vatInvoiceCode,
      createdAt: ord.createdAt,
    }));

    const watermarkedCsv = buildSalesCsv(rows, actorId, {
      actorRole: currentRole,
      reportName: 'BÁO CÁO DOANH SỐ BÁN SÁCH (SỔ KÉP)',
      fiscalScope: isTaxAccountant ? 'OFFICIAL_TAX' : activeScope,
    });

    // BOM để Excel đọc đúng tiếng Việt có dấu; tên file đặt theo NGÀY VIỆT NAM.
    const csvContent = '\uFEFF' + watermarkedCsv;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const ddmmyyyy = vnToday().split('-').reverse().join('-');
    link.setAttribute('download', `Bao_Cao_Doanh_So_FORMApubli_${ddmmyyyy}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  return (
    <div className="space-y-6">
      <GiftReportPanel currentRole={currentRole} from={startDate} to={endDate} />
      {/* Header Controls */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="hidden md:block">
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sky-600" />
            Sổ Doanh Số & Dòng Tiền
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản trị kép: Phân tách rõ ràng giữa Báo Cáo Kế Toán Thuế và Sổ Quản Trị Thực Tế Nội Bộ
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={() => setDiscountDisplayMode((prev) => (prev === 'PERCENT' ? 'VND' : 'PERCENT'))}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold shadow-sm transition-colors cursor-pointer"
            title="Chuyển đổi hiển thị chiết khấu giữa % và số tiền VNĐ"
          >
            <Percent className="w-3.5 h-3.5 text-amber-600" />
            <span>Đơn vị CK:</span>
            <span className="font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-extrabold text-[11px]">
              {discountDisplayMode === 'PERCENT' ? '%' : 'VNĐ'}
            </span>
          </button>
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
          <button
            onClick={exportToCSV}
            disabled={filteredOrders.length === 0 || !actorId}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            title={
              actorId
                ? 'Xuất bảng tính Excel/CSV tương thích font tiếng Việt'
                : 'Chưa đọc được người đăng nhập nên chưa xuất được (tải lại trang)'
            }
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Xuất Excel/CSV</span>
          </button>
          {/* Nút "In Phiếu" ĐÃ GỠ (2026-10-02): nó gọi `window.print()` trên
              cả trang app ⇒ ra giấy trắng vì không có CSS in riêng cho sổ.
              Giữ nút là lời hứa sai với người dùng. Nối phiếu nhiệt thật là
              việc riêng, phải làm cùng driver/mẫu in chứ không vá bằng print. */}
        </div>
      </div>

      {/* Scope Switcher Banner (Chỉ cho phép Quản lý & Điều hành chuyển đổi) */}
      {!isTaxAccountant && canViewTaxScope ? (
        <div className="flex items-center p-1.5 bg-slate-200/80 rounded-2xl max-w-xl">
          <button
            onClick={() => setActiveScope('ALL')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeScope === 'ALL'
                ? 'bg-white text-indigo-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Toàn Cảnh Thực Tế (All)
          </button>
          <button
            onClick={() => setActiveScope('OFFICIAL_TAX')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeScope === 'OFFICIAL_TAX'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sổ Kế Toán Thuế (VAT)
          </button>
          <button
            onClick={() => setActiveScope('INTERNAL_MANAGEMENT')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeScope === 'INTERNAL_MANAGEMENT'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sổ Quản Trị Nội Bộ
          </button>
        </div>
      ) : isTaxAccountant ? (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>
            Chế độ Kế Toán Thuế đang kích hoạt: Hệ thống tự động áp dụng bộ lọc cách ly, chỉ trích xuất các đơn hàng có hóa đơn VAT hợp pháp.
          </span>
        </div>
      ) : (
        <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2 font-medium">
          <ShieldCheck className="w-4 h-4 text-slate-500" />
          <span>
            Thu ngân chỉ xem sổ nội bộ đơn của mình.
          </span>
        </div>
      )}

      {/* Multi-Dimensional Filter Bar: Date Presets & Warehouse Filter */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* Date Filter Presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            Thời gian:
          </span>
          {(
            [
              { id: 'ALL', label: 'Tất cả' },
              { id: 'TODAY', label: 'Hôm nay' },
              { id: 'WEEK', label: '7 ngày qua' },
              { id: 'MONTH', label: 'Tháng này' },
              { id: 'CUSTOM', label: 'Tùy chọn' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              onClick={() => handleDatePresetChange(p.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                datePreset === p.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}

          {/* Custom Date Inputs if CUSTOM selected */}
          {datePreset === 'CUSTOM' && (
            <div className="flex items-center gap-1.5 ml-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-xs text-slate-400">-</span>
              <input
                type="date"
                value={endDate.slice(0, 10)}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Warehouse Filter */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-bold text-slate-500 shrink-0 flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            Kho hàng:
          </span>
          <select
            value={selectedWarehouse}
            onChange={(e) => setSelectedWarehouse(e.target.value)}
            className="bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-sky-500 cursor-pointer min-h-[36px]"
          >
            <option value="ALL">Tất cả các kho (Toàn hệ thống)</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {/* Không ghi cứng tên kho dự phòng: trước đây khi API rỗng, danh sách
              này vẫn hiện 3 kho bịa ⇒ người dùng lọc nhầm kho không tồn tại. */}
          {warehouses.length === 0 && (
            <span className="text-[10px] text-amber-600 font-medium">
              Chưa tải được danh mục kho — tải lại trang
            </span>
          )}
        </div>
      </div>

      {/* Financial Summary Cards — số do SERVER tổng (`GET /api/orders` → `summary`),
          KHÔNG cộng lại từ danh sách đang lọc trên màn hình. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Tổng Giá Bìa (Niêm yết)
          </span>
          {loading && !summary ? (
            <div className="mt-1.5 h-7 w-32 rounded-lg bg-slate-200 animate-pulse" aria-label="Đang tải" />
          ) : (
            <p className="text-xl font-extrabold text-slate-900 mt-1 font-mono">
              {(summary?.totalSubtotal ?? 0).toLocaleString('vi-VN')} đ
            </p>
          )}
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {discountDisplayMode === 'PERCENT' ? 'Tỷ Lệ Chiết Khấu Bình Quân' : 'Tổng Tiền Chiết Khấu Đã Giảm'}
          </span>
          {loading && !summary ? (
            <div className="mt-1.5 h-7 w-32 rounded-lg bg-slate-200 animate-pulse" aria-label="Đang tải" />
          ) : (
            <>
              <p className="text-xl font-extrabold text-amber-600 mt-1 font-mono">
                {discountDisplayMode === 'PERCENT'
                  ? `${avgDiscountPercent}%`
                  : `-${(summary?.totalDiscount ?? 0).toLocaleString('vi-VN')} đ`}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                {discountDisplayMode === 'PERCENT'
                  ? `Quy đổi tiền: -${(summary?.totalDiscount ?? 0).toLocaleString('vi-VN')} đ`
                  : `Tỷ lệ bình quân: ${avgDiscountPercent}%`}
              </p>
            </>
          )}
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Doanh Thu Thực Thu
          </span>
          {loading && !summary ? (
            <div className="mt-1.5 h-7 w-32 rounded-lg bg-slate-200 animate-pulse" aria-label="Đang tải" />
          ) : (
            <p className="text-xl font-extrabold text-emerald-700 mt-1 font-mono">
              {(summary?.totalRevenue ?? 0).toLocaleString('vi-VN')} đ
            </p>
          )}
          {/* Nhãn luôn hiện (không chỉ khi có slicer): trước đây khi
              `channelSlicer === 'ALL'` và không tìm kiếm thì thẻ trông như đang
              bám theo bảng, và người dùng tưởng số đổi theo bảng. */}
          {/* Skeleton đang bật thì `summary` còn null ⇒ hiện "0 đơn hoàn tất"
              nhảy xuống rồi mới có số ⇒ nhấp nháy giả. Hiện "Đang tải…" thay vì số 0. */}
          <p className="text-[10px] text-slate-400 mt-0.5">
            {loading && !summary
              ? 'Đang tải…'
              : `${(summary?.totalOrders ?? 0).toLocaleString('vi-VN')} đơn hoàn tất · doanh thu gộp chưa trừ hoàn${zeroValueCount > 0 ? ` · gồm ${zeroValueCount.toLocaleString('vi-VN')} đơn quà 0đ` : ''}`}
          </p>
          <p className="text-[10px] text-slate-400">
            Thẻ tổng theo kho/ngày/sổ; nút kênh và ô tìm kiếm chỉ lọc bảng bên dưới.
          </p>
        </div>
      </div>

      {loadError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
          {loadError}
        </div>
      )}

      {/* Orders List Table — gioi han chieu cao + cuon, keo xuong la toi panel phan tich */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm mã đơn, tên khách, số hóa đơn..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-500 font-medium">
                Hiển thị <strong>{visibleOrders.length}/{filteredOrders.length}</strong> đơn
              </span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-slate-50 border border-slate-300 text-xs font-bold rounded-xl px-2.5 py-1.5 outline-none cursor-pointer"
                title="Số đơn hiển thị"
              >
                <option value={20}>20 đơn</option>
                <option value={50}>50 đơn</option>
                <option value={100}>100 đơn</option>
                <option value={-1}>Xem toàn bộ</option>
              </select>
            </div>
          </div>
          {/* Slicer kenh ban kieu pivot */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              Kênh:
            </span>
            {(
              [
                { id: 'ALL', label: 'Tất cả kênh' },
                { id: 'RETAIL', label: 'Bán lẻ' },
                { id: 'WHOLESALE', label: 'Đại lý' },
                { id: 'ONLINE', label: 'Online' },
                { id: 'GIFT', label: 'Tặng' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                onClick={() => setChannelSlicer(s.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  channelSlicer === s.id
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 sticky top-0 z-10">
              <tr>
                <th className="p-3.5">Mã Đơn Hàng</th>
                <th className="p-3.5">Kho Xuất</th>
                <th className="p-3.5">Khách Hàng / Đại Lý</th>
                <th className="p-3.5">Kênh</th>
                <th className="p-3.5">Thanh Toán</th>
                <th className="p-3.5">Tổng Bìa</th>
                <th className="p-3.5">{discountDisplayMode === 'PERCENT' ? 'Chiết Khấu (%)' : 'Chiết Khấu (VNĐ)'}</th>
                <th className="p-3.5">Thực Thu</th>
                <th className="p-3.5">Phân Loại Sổ</th>
                <th className="p-3.5">Thời Gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && orders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    <span className="inline-block h-4 w-40 rounded bg-slate-200 animate-pulse align-middle" />
                    <span className="ml-2">Đang tải danh sách đơn…</span>
                  </td>
                </tr>
              ) : visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    Không tìm thấy đơn hàng nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                visibleOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50/80">
                    <td className="p-3.5 font-mono font-bold text-indigo-700">
                      {ord.orderCode}
                    </td>
                    <td className="p-3.5 font-medium text-slate-700">
                      {warehouseNameOf(ord.warehouseId)}
                    </td>
                    <td className="p-3.5 font-medium text-slate-900">
                      {ord.customerName}
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {channelLabel(ord.channel)}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                        {paymentLabel(ord.paymentMethod)}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-slate-600">
                      {ord.subtotal.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="p-3.5 font-mono text-amber-600">
                      {discountDisplayMode === 'PERCENT' ? (
                        <div>
                          <span className="font-bold">
                            {ord.subtotal > 0 ? `${Math.round(((ord.discountAmount || 0) / ord.subtotal) * 100)}%` : '0%'}
                          </span>
                          <span className="block text-[10px] text-slate-400">
                            -{Number(ord.discountAmount || 0).toLocaleString('vi-VN')} đ
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span className="font-bold">
                            -{Number(ord.discountAmount || 0).toLocaleString('vi-VN')} đ
                          </span>
                          <span className="block text-[10px] text-slate-400">
                            {ord.subtotal > 0 ? `${Math.round(((ord.discountAmount || 0) / ord.subtotal) * 100)}%` : '0%'}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="p-3.5 font-mono font-bold text-emerald-700">
                      {ord.finalAmount.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="p-3.5">
                      {ord.fiscalScope === 'OFFICIAL_TAX' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {fiscalScopeLabel(ord.fiscalScope)}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                          {fiscalScopeLabel(ord.fiscalScope)}
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-500 font-mono text-[11px]">
                      {vnHour(ord.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pageSize !== -1 && filteredOrders.length > visibleOrders.length && (
          <button
            onClick={() => setPageSize(-1)}
            className="w-full py-2.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-t border-indigo-100 transition"
          >
            Xem toàn bộ {filteredOrders.length} đơn ↓
          </button>
        )}
      </div>

      {/* Sach ban chay nhat (OWNER/MANAGER) — dung CHUNG bo loc cua tab (ngay/kho) va
          actor that cua So Kep, y het RevenueAnalyticsPanel: panel khong tu dat
          preset ngay rieng nen so cua no luon khop bang so tren bang. */}
      <TopEditionsPanel
        currentRole={currentRole}
        startDate={startDate}
        endDate={endDate}
        warehouseId={selectedWarehouse}
        warehouseLabel={selectedWarehouse === 'ALL' ? 'Tất cả kho' : warehouseNameOf(selectedWarehouse)}
        fiscalScope={scopeParam === 'ALL' ? undefined : scopeParam}
        actorId={actorId}
      />

      {/* Phan tich nguon doanh thu & dong tien (OWNER/MANAGER) — Ban le / Dai ly / Online / Tang.
          Dùng CHUNG bo loc cua tab (kho/ngay/so) va actor that cua Sổ Kép: panel khong
          tu dat filter rieng, nen so cua no luon khop bang so tren bang. */}
      <RevenueAnalyticsPanel
        currentRole={currentRole}
        startDate={startDate}
        endDate={endDate}
        warehouseId={selectedWarehouse}
        fiscalScope={scopeParam === 'ALL' ? undefined : scopeParam}
        actorId={actorId}
      />
    </div>
  );
}
