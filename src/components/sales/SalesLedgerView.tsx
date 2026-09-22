'use client';

import React, { useState, useEffect } from 'react';
import {
  Receipt,
  ShieldCheck,
  Building2,
  Calendar,
  Filter,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { appendExportWatermark } from '@/lib/export-hash';
import { RevenueAnalyticsPanel } from './RevenueAnalyticsPanel';
import { TopEditionsPanel } from './TopEditionsPanel';

// Slicer kenh ban -> nhom nguon (pivot nhanh kieu Excel)
const CHANNEL_GROUP_OF: Record<string, 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'GIFT'> = {
  FAIR_EVENT: 'RETAIL',
  RETAIL_OFFICE: 'RETAIL',
  WHOLESALE_PARTNER: 'WHOLESALE',
  ONLINE: 'ONLINE',
  RETAIL_ONLINE_WEB: 'ONLINE',
  RETAIL_ONLINE_SOCIAL: 'ONLINE',
  SPONSORSHIP: 'GIFT',
};

// Nhan kenh hien thi (map thay nested ternary 7 cap).
const CHANNEL_LABEL: Record<string, string> = {
  FAIR_EVENT: 'Hội chợ',
  RETAIL_OFFICE: 'Bán lẻ',
  WHOLESALE_PARTNER: 'Đại lý',
  RETAIL_ONLINE_WEB: 'Web',
  RETAIL_ONLINE_SOCIAL: 'Mạng xã hội',
  ONLINE: 'Online',
  SPONSORSHIP: 'Tặng',
};

interface SalesLedgerViewProps {
  currentRole: UserRole;
}

export function SalesLedgerView({ currentRole }: SalesLedgerViewProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeScope, setActiveScope] = useState<'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT'>('ALL');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('ALL');
  const [datePreset, setDatePreset] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  // Slicer + phan trang cuc bo: gioi han chieu cao bang, mac dinh 20 don
  const [channelSlicer, setChannelSlicer] = useState<'ALL' | 'RETAIL' | 'WHOLESALE' | 'ONLINE' | 'GIFT'>('ALL');
  const [pageSize, setPageSize] = useState<number>(20); // 20 | 50 | 100 | -1 (tat ca)

  const isTaxAccountant = currentRole === 'ROLE_TAX';

  // Nếu là Kế toán thuế: Ép cứng chỉ được xem OFFICIAL_TAX
  useEffect(() => {
    if (isTaxAccountant) {
      setActiveScope('OFFICIAL_TAX');
    }
  }, [currentRole, isTaxAccountant]);

  // Xử lý chuyển đổi Preset ngày
  const handleDatePresetChange = (preset: 'ALL' | 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM') => {
    setDatePreset(preset);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (preset === 'ALL') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'TODAY') {
      setStartDate(todayStr);
      setEndDate(todayStr + 'T23:59:59');
    } else if (preset === 'WEEK') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setStartDate(weekAgo);
      setEndDate(todayStr + 'T23:59:59');
    } else if (preset === 'MONTH') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      setStartDate(monthAgo);
      setEndDate(todayStr + 'T23:59:59');
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const scopeParam = isTaxAccountant ? 'OFFICIAL_TAX' : activeScope;
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

      const res = await fetch(`/api/orders?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách doanh số:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [activeScope, currentRole, selectedWarehouse, startDate, endDate]);

  const filteredOrders = orders.filter((ord) => {
    if (channelSlicer !== 'ALL' && CHANNEL_GROUP_OF[ord.channel] !== channelSlicer) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      ord.orderCode?.toLowerCase().includes(q) ||
      ord.customerName?.toLowerCase().includes(q) ||
      ord.vatInvoiceCode?.toLowerCase().includes(q)
    );
  });

  // Gioi han so dong hien thi de bang gon trong 1 man hinh (cuon doc xem tiep)
  const visibleOrders = pageSize === -1 ? filteredOrders : filteredOrders.slice(0, pageSize);

  // The tong theo dung nhung gi dang thay (slicer kenh + tim kiem) de khong lech voi bang.
  const viewSummary = {
    totalSubtotal: filteredOrders.reduce((s, o) => s + Number(o.subtotal || 0), 0),
    totalDiscount: filteredOrders.reduce((s, o) => s + Number(o.discountAmount || 0), 0),
    totalRevenue: filteredOrders.reduce((s, o) => s + Number(o.finalAmount || 0), 0),
  };

  // Xuất file CSV chuẩn UTF-8 BOM cho Excel
  const exportToCSV = () => {
    if (filteredOrders.length === 0) {
      alert('Không có dữ liệu đơn hàng để xuất CSV.');
      return;
    }

    // Chan Excel formula injection: o text bat dau =,+,-,@ thi chen ' phia truoc.
    const cell = (v: string | number) => {
      const s = `${v ?? ''}`;
      return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`;
    };
    const headers = [
      'Mã Đơn Hàng',
      'Kho Xuất',
      'Khách Hàng',
      'Phương Thức TT',
      'Tổng Giá Bìa (VND)',
      'Tiền Chiết Khấu (VND)',
      'Thực Thu (VND)',
      'Phân Loại Sổ',
      'Số HĐ VAT',
      'Thời Gian',
    ];

    const rawObjectsForHash = filteredOrders.map((ord) => ({
      orderCode: ord.orderCode || '',
      warehouseId: ord.warehouseId,
      customerName: ord.customerName || '',
      paymentMethod: ord.paymentMethod || '',
      subtotal: Number(ord.subtotal || 0),
      discountAmount: Number(ord.discountAmount || 0),
      finalAmount: Number(ord.finalAmount || 0),
      fiscalScope: ord.fiscalScope,
      vatInvoiceCode: ord.vatInvoiceCode || '',
      createdAt: ord.createdAt || '',
    }));

    const rows = filteredOrders.map((ord) => [
      cell(ord.orderCode || ''),
      cell(ord.warehouseId === 'wh-au-co' ? 'Kho Âu Cơ' : ord.warehouseId === 'wh-du-phong' ? 'Kho Hội Chợ' : 'Kho Quỳnh Mai'),
      cell(ord.customerName || ''),
      cell(ord.paymentMethod || ''),
      ord.subtotal || 0,
      ord.discountAmount || 0,
      ord.finalAmount || 0,
      cell(ord.fiscalScope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Sổ Quản trị Nội bộ'),
      cell(ord.vatInvoiceCode || ''),
      cell(ord.createdAt || ''),
    ]);

    const baseCsv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const watermarkedCsv = appendExportWatermark(baseCsv, rawObjectsForHash, {
      actorId: 'cashier-pos',
      actorRole: currentRole,
      reportName: 'BÁO CÁO DOANH SỐ BÁN SÁCH & DÒNG TIỀN (SỔ KÉP)',
      fiscalScope: activeScope,
    });

    const csvContent = '\uFEFF' + watermarkedCsv;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Bao_Cao_Doanh_So_FormaPubli_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sky-600" />
            Sổ Doanh Số & Dòng Tiền (Dual Fiscal Ledger)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản trị kép: Phân tách rõ ràng giữa Báo Cáo Kế Toán Thuế và Sổ Quản Trị Thực Tế Nội Bộ
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
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
            disabled={filteredOrders.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            title="Xuất bảng tính Excel/CSV tương thích font tiếng Việt"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Xuất Excel/CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>In Phiếu</span>
          </button>
        </div>
      </div>

      {/* Scope Switcher Banner (Chỉ cho phép Quản lý & Điều hành chuyển đổi) */}
      {!isTaxAccountant ? (
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
      ) : (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>
            Chế độ Kế Toán Thuế đang kích hoạt: Hệ thống tự động áp dụng bộ lọc cách ly, chỉ trích xuất các đơn hàng có hóa đơn VAT hợp pháp.
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
                onChange={(e) => setEndDate(e.target.value ? e.target.value + 'T23:59:59' : '')}
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
            <option value="wh-au-co">Kho 1 - Âu Cơ (VP chính)</option>
            <option value="wh-du-phong">Kho 3 - Hội Chợ (Sự kiện)</option>
            <option value="wh-quynh-mai">Kho 2 - Quỳnh Mai (Kho tổng)</option>
          </select>
        </div>
      </div>

      {/* Financial Summary Cards — theo dung bo loc dang xem */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Tổng Giá Bìa (Niêm yết)
          </span>
          <p className="text-xl font-extrabold text-slate-900 mt-1 font-mono">
            {(viewSummary.totalSubtotal || 0).toLocaleString('vi-VN')} đ
          </p>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Tổng Tiền Chiết Khấu Đã Giảm
          </span>
          <p className="text-xl font-extrabold text-amber-600 mt-1 font-mono">
            -{(viewSummary.totalDiscount || 0).toLocaleString('vi-VN')} đ
          </p>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Doanh Thu Thực Thu
          </span>
          <p className="text-xl font-extrabold text-emerald-700 mt-1 font-mono">
            {(viewSummary.totalRevenue || 0).toLocaleString('vi-VN')} đ
          </p>
          {(channelSlicer !== 'ALL' || searchQuery) && (
            <p className="text-[10px] text-slate-400 mt-0.5">Theo bộ lọc đang xem (kênh/tìm kiếm)</p>
          )}
        </div>
      </div>

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
                <th className="p-3.5">Chiết Khấu</th>
                <th className="p-3.5">Thực Thu</th>
                <th className="p-3.5">Phân Loại Sổ</th>
                <th className="p-3.5">Thời Gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleOrders.length === 0 ? (
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
                      {ord.warehouseId === 'wh-au-co'
                        ? 'Kho Âu Cơ'
                        : ord.warehouseId === 'wh-du-phong'
                        ? 'Kho Hội Chợ'
                        : 'Kho Quỳnh Mai'}
                    </td>
                    <td className="p-3.5 font-medium text-slate-900">
                      {ord.customerName}
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {CHANNEL_LABEL[ord.channel] || ord.channel || '—'}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 font-mono">
                        {ord.paymentMethod}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-slate-600">
                      {ord.subtotal.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="p-3.5 font-mono text-amber-600">
                      -{ord.discountAmount ? ord.discountAmount.toLocaleString('vi-VN') : 0} đ
                    </td>
                    <td className="p-3.5 font-mono font-bold text-emerald-700">
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
                    <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                      {ord.createdAt?.slice(0, 16).replace('T', ' ')}
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

      {/* Sach ban chay nhat (OWNER/MANAGER) — tra loi "cuon nao ban chay nhat hom nay/tuan nay/thang nay" */}
      <TopEditionsPanel currentRole={currentRole} />

      {/* Phan tich nguon doanh thu & dong tien (OWNER/MANAGER) — Ban le / Dai ly / Online / Tang */}
      <RevenueAnalyticsPanel currentRole={currentRole} />
    </div>
  );
}
