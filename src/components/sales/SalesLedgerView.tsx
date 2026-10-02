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
  Eye,
  X,
  AlertTriangle,
  Trash2,
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

  // Chi tiết đơn hàng và Hủy đơn
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<any | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [orderDetailError, setOrderDetailError] = useState<string | null>(null);

  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidForce, setVoidForce] = useState(false);
  const [voidLoading, setVoidLoading] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccess, setVoidSuccess] = useState<string | null>(null);

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

  const openOrderDetail = async (id: string) => {
    setSelectedOrderId(id);
    setOrderDetail(null);
    setOrderDetailLoading(true);
    setOrderDetailError(null);
    setShowVoidConfirm(false);
    setVoidReason('');
    setVoidForce(false);
    setVoidError(null);
    setVoidSuccess(null);

    try {
      const res = await fetch(`/api/orders/${id}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Không thể tải chi tiết đơn hàng.');
      }
      setOrderDetail(json);
    } catch (err: any) {
      setOrderDetailError(err.message || 'Lỗi kết nối khi tải chi tiết đơn hàng.');
    } finally {
      setOrderDetailLoading(false);
    }
  };

  const handleVoidOrder = async () => {
    if (!selectedOrderId) return;
    if (!voidReason || voidReason.trim().length < 5) {
      setVoidError('Vui lòng nhập lý do hủy đơn cụ thể (tối thiểu 5 ký tự).');
      return;
    }

    setVoidLoading(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/orders/${selectedOrderId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: voidReason.trim(),
          force: voidForce,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Hủy đơn hàng thất bại.');
      }
      setVoidSuccess('Đã hủy đơn hàng và hoàn trả tồn kho thành công.');
      if (orderDetail?.order) {
        setOrderDetail({
          ...orderDetail,
          order: {
            ...orderDetail.order,
            status: 'CANCELLED',
            note: (orderDetail.order.note ? orderDetail.order.note + ' | ' : '') + `[HỦY ĐƠN: ${voidReason.trim()}]`,
          },
        });
      }
      setShowVoidConfirm(false);
      fetchOrders();
    } catch (err: any) {
      setVoidError(err.message || 'Lỗi khi gửi yêu cầu hủy đơn.');
    } finally {
      setVoidLoading(false);
    }
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
        <div className="flex items-center p-1.5 bg-slate-200/80 rounded-2xl max-w-xl overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveScope('ALL')}
            className={`flex-1 min-w-fit whitespace-nowrap py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeScope === 'ALL'
                ? 'bg-white text-indigo-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Toàn Cảnh Thực Tế (All)
          </button>
          <button
            onClick={() => setActiveScope('OFFICIAL_TAX')}
            className={`flex-1 min-w-fit whitespace-nowrap py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeScope === 'OFFICIAL_TAX'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sổ Kế Toán Thuế (VAT)
          </button>
          <button
            onClick={() => setActiveScope('INTERNAL_MANAGEMENT')}
            className={`flex-1 min-w-fit whitespace-nowrap py-2 px-3 rounded-xl text-xs font-bold transition-all ${
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
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
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
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto min-w-0">
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
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
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
                <th className="p-3.5 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && orders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
                    <span className="inline-block h-4 w-40 rounded bg-slate-200 animate-pulse align-middle" />
                    <span className="ml-2">Đang tải danh sách đơn…</span>
                  </td>
                </tr>
              ) : visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-400">
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
                    <td className="p-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => openOrderDetail(ord.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-sky-200"
                        title="Xem chi tiết đơn hàng"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Xem</span>
                      </button>
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

      {/* Modal Chi Tiết Đơn Hàng & Thao Tác Hủy Đơn An Toàn */}
      {selectedOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <Receipt className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Chi Tiết Đơn Hàng {orderDetail?.order?.orderCode ? `· ${orderDetail.order.orderCode}` : ''}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Thông tin chứng từ bán hàng, phân loại sổ và danh mục ấn phẩm
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderId(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200/60 transition cursor-pointer"
                title="Đóng cửa sổ"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {orderDetailLoading ? (
                <div className="py-12 text-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-2" />
                  <p className="text-sm font-medium">Đang tải chi tiết đơn hàng…</p>
                </div>
              ) : orderDetailError ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-800 font-medium">
                  {orderDetailError}
                </div>
              ) : orderDetail?.order ? (
                <>
                  {voidSuccess && (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-bold text-emerald-800 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{voidSuccess}</span>
                    </div>
                  )}

                  {/* Order Overview Meta Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200/70 text-xs">
                    <div>
                      <span className="text-slate-400 block font-medium">Trạng thái:</span>
                      {orderDetail.order.status === 'COMPLETED' ? (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                          Hoàn tất
                        </span>
                      ) : orderDetail.order.status === 'CANCELLED' ? (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full font-bold bg-rose-100 text-rose-800">
                          Đã hủy
                        </span>
                      ) : (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800">
                          {orderDetail.order.status}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Thời gian:</span>
                      <span className="font-bold text-slate-800">{vnHour(orderDetail.order.createdAt)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Kho xuất:</span>
                      <span className="font-bold text-slate-800">{orderDetail.order.warehouseName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Thu ngân:</span>
                      <span className="font-bold text-slate-800">{orderDetail.order.cashierName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Kênh bán:</span>
                      <span className="font-bold text-slate-800">{channelLabel(orderDetail.order.channel)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Thanh toán:</span>
                      <span className="font-bold text-slate-800">{paymentLabel(orderDetail.order.paymentMethod)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Phân loại sổ:</span>
                      <span className="font-bold text-slate-800">{fiscalScopeLabel(orderDetail.order.fiscalScope)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-medium">Khách hàng:</span>
                      <span className="font-bold text-slate-800">{orderDetail.order.customerName || 'Khách lẻ'}</span>
                    </div>
                  </div>

                  {orderDetail.order.note && (
                    <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900">
                      <strong>Ghi chú:</strong> {orderDetail.order.note}
                    </div>
                  )}

                  {/* Items Table */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Danh mục ấn phẩm & quà tặng ({orderDetail.items?.length || 0})
                    </h4>
                    <div className="border border-slate-200 rounded-2xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                          <tr>
                            <th className="p-3">Sản phẩm</th>
                            <th className="p-3 text-center">Số lượng</th>
                            <th className="p-3 text-right">Giá bìa</th>
                            <th className="p-3 text-right">Chiết khấu</th>
                            <th className="p-3 text-right">Đơn giá</th>
                            <th className="p-3 text-right">Thành tiền</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(orderDetail.items || []).map((it: any) => (
                            <tr key={it.id} className="hover:bg-slate-50/50">
                              <td className="p-3">
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{it.productName || it.productId}</span>
                                  {it.isGiftLine && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-pink-100 text-pink-700">
                                      Quà tặng
                                    </span>
                                  )}
                                  {it.isGiftShortfall && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                      Hết tồn
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">{it.productCode || it.productId}</span>
                              </td>
                              <td className="p-3 text-center font-bold font-mono">{it.quantity}</td>
                              <td className="p-3 text-right font-mono text-slate-500">
                                {Number(it.unitCoverPrice || 0).toLocaleString('vi-VN')} đ
                              </td>
                              <td className="p-3 text-right font-mono text-amber-600">
                                {it.unitDiscountRate ? `${Math.round(it.unitDiscountRate * 100)}%` : '0%'}
                              </td>
                              <td className="p-3 text-right font-mono text-slate-700">
                                {Number(it.unitSellingPrice || 0).toLocaleString('vi-VN')} đ
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-slate-900">
                                {Number(it.totalAmount || 0).toLocaleString('vi-VN')} đ
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Financial Summary Breakdown */}
                  <div className="flex justify-end">
                    <div className="w-full sm:w-72 space-y-1.5 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
                      <div className="flex justify-between text-slate-500">
                        <span>Tổng tiền niêm yết:</span>
                        <span className="font-mono">{Number(orderDetail.order.subtotal || 0).toLocaleString('vi-VN')} đ</span>
                      </div>
                      <div className="flex justify-between text-amber-600">
                        <span>Chiết khấu:</span>
                        <span className="font-mono">-{Number(orderDetail.order.discountAmount || 0).toLocaleString('vi-VN')} đ</span>
                      </div>
                      <div className="border-t border-slate-200 pt-1.5 flex justify-between font-extrabold text-sm text-emerald-700">
                        <span>Thực thu:</span>
                        <span className="font-mono">{Number(orderDetail.order.finalAmount || 0).toLocaleString('vi-VN')} đ</span>
                      </div>
                    </div>
                  </div>

                  {/* Section Hủy Đơn Hàng cho Quản lý / Chủ */}
                  {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') &&
                    orderDetail.order.status === 'COMPLETED' && (
                      <div className="border-t border-slate-200 pt-4">
                        {!showVoidConfirm ? (
                          <div className="flex justify-between items-center bg-rose-50/50 border border-rose-200/60 p-3.5 rounded-2xl">
                            <div>
                              <h5 className="text-xs font-bold text-rose-900">Thao tác Quản trị</h5>
                              <p className="text-[11px] text-rose-600">
                                Hủy đơn quét nhầm / sai lệch để hoàn tồn kho và điều chỉnh doanh thu
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setShowVoidConfirm(true);
                                setVoidError(null);
                              }}
                              className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Hủy đơn</span>
                            </button>
                          </div>
                        ) : (
                          <div className="bg-rose-50 border border-rose-300 p-4 rounded-2xl space-y-3">
                            <div className="flex items-start gap-2 text-rose-900">
                              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                              <div>
                                <h5 className="text-xs font-extrabold">Xác nhận Hủy Đơn Hàng Hoàn Tất</h5>
                                <p className="text-[11px] text-rose-700 mt-0.5">
                                  Hành động này sẽ: (1) Trả 100% sách & quà về kho xuất qua bút toán Thẻ kho RETURN_INBOUND; (2) Trừ khỏi doanh số ca đang mở; (3) Lưu nhật ký kiểm toán.
                                </p>
                              </div>
                            </div>

                            {voidError && (
                              <div className="p-2.5 bg-rose-100 border border-rose-300 rounded-xl text-xs text-rose-900 font-bold">
                                {voidError}
                              </div>
                            )}

                            <div>
                              <label className="block text-xs font-bold text-slate-700 mb-1">
                                Lý do hủy đơn (bắt buộc):
                              </label>
                              <input
                                type="text"
                                value={voidReason}
                                onChange={(e) => setVoidReason(e.target.value)}
                                placeholder="Ví dụ: Quét nhầm phương thức thanh toán, khách đổi ý..."
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500 font-medium"
                              />
                            </div>

                            {currentRole === 'ROLE_OWNER' && (
                              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-rose-800">
                                <input
                                  type="checkbox"
                                  checked={voidForce}
                                  onChange={(e) => setVoidForce(e.target.checked)}
                                  className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                                />
                                <span>Xác nhận cưỡng chế nếu ca két đã đóng (Chủ doanh nghiệp phê duyệt)</span>
                              </label>
                            )}

                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                disabled={voidLoading}
                                onClick={() => {
                                  setShowVoidConfirm(false);
                                  setVoidError(null);
                                }}
                                className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition cursor-pointer"
                              >
                                Đóng
                              </button>
                              <button
                                type="button"
                                disabled={voidLoading}
                                onClick={handleVoidOrder}
                                className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
                              >
                                {voidLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                                <span>Xác nhận hủy đơn</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/70 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedOrderId(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
