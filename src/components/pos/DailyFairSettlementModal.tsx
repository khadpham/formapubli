'use client';

import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';

interface DailyFairSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouseId: string;
  warehouseName?: string;
  currentRole?: string;
}

export function DailyFairSettlementModal({
  isOpen,
  onClose,
  warehouseId,
  warehouseName,
  currentRole = 'ROLE_CASHIER',
}: DailyFairSettlementModalProps) {
  const [data, setData] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentWarehouseId, setCurrentWarehouseId] = useState(warehouseId);
  const [warehouseList, setWarehouseList] = useState<any[]>([]);
  const [discountDisplayMode, setDiscountDisplayMode] = useState<'PERCENT' | 'VND'>('PERCENT');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState<'FINANCIALS' | 'STOCKTAKE' | 'DISCOUNT'>('FINANCIALS');

  // Lưu số đếm thực tế của từng đầu sách khi đóng thùng (editionId -> actualCount)
  const [actualCounts, setActualCounts] = useState<Record<string, number>>({});
  const [stocktakeNote, setStocktakeNote] = useState('');
  const [mounted, setMounted] = useState(false);

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
    try {
      setIsLoading(true);
      const res = await fetch(
        `/api/pos/daily-settlement?warehouseId=${encodeURIComponent(currentWarehouseId)}&date=${encodeURIComponent(selectedDate)}`,
        { headers: { 'x-formapubli-role': currentRole } }
      );
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        // Tự động điền số đếm thực tế bằng số lý thuyết ban đầu
        const initialCounts: Record<string, number> = {};
        for (const item of json.data.inventoryReconciliation || []) {
          initialCounts[item.editionId] = item.theoreticalStock;
        }
        setActualCounts(initialCounts);
      }
    } catch (err) {
      console.error('Lỗi tải báo cáo chốt ngày hội chợ:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && currentWarehouseId) {
      fetchSettlement();
    }
  }, [isOpen, currentWarehouseId, selectedDate]);

  if (!isOpen) return null;

  const handleActualCountChange = (editionId: string, val: string) => {
    const num = parseInt(val, 10);
    setActualCounts((prev) => ({
      ...prev,
      [editionId]: isNaN(num) ? 0 : Math.max(0, num),
    }));
  };

  const handlePrint = () => {
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
  const totalActualBooks = (data?.inventoryReconciliation || []).reduce(
    (sum: number, it: any) => sum + (actualCounts[it.editionId] ?? it.theoreticalStock ?? 0),
    0
  );
  const totalBookVariance = totalActualBooks - totalTheoreticalBooks;

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
          body * {
            visibility: hidden;
          }
          #printable-settlement-report,
          #printable-settlement-report * {
            visibility: visible;
          }
          #printable-settlement-report {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4 portrait;
            margin: 10mm;
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
                <span className="ml-1 sm:ml-0">Ngày: <span className="font-mono text-amber-300">{selectedDate}</span></span>
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
            <div className="py-16 text-center text-slate-400 text-xs">
              Không có dữ liệu báo cáo cho ngày đã chọn.
            </div>
          ) : (
            <>
              {/* TAB 1: DOANH SỐ & ĐỐI SOÁT KÉT TIỀN */}
              {activeTab === 'FINANCIALS' && (
                <div className="space-y-5 animate-in fade-in duration-150">
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
                      <span className="text-[11px] text-slate-500 block">Chênh lệch tổng:</span>
                      <span
                        className={`font-mono font-black text-sm ${
                          totalBookVariance === 0
                            ? 'text-emerald-700'
                            : totalBookVariance > 0
                            ? 'text-blue-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {totalBookVariance > 0 ? `+${totalBookVariance}` : totalBookVariance} cuốn
                      </span>
                    </div>
                  </div>

                  {/* Bảng sách kiểm kê */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 font-bold text-left border-b border-slate-200">
                          <th className="p-3 w-10 text-center">#</th>
                          <th className="p-3">Ấn phẩm sách</th>
                          <th className="p-3 text-right">Đã bán</th>
                          <th className="p-3 text-center">Tồn máy (Lý thuyết)</th>
                          <th className="p-3 text-center w-32">Thực đếm (Kệ)</th>
                          <th className="p-3 text-center w-28">Chênh lệch</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.inventoryReconciliation?.map((it: any, idx: number) => {
                          const actual = actualCounts[it.editionId] ?? it.theoreticalStock;
                          const diff = actual - it.theoreticalStock;

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
                              <td className="p-3 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  value={actual}
                                  onChange={(e) => handleActualCountChange(it.editionId, e.target.value)}
                                  className="w-20 px-2 py-1 text-center font-bold font-mono border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </td>
                              <td className="p-3 text-center">
                                {diff === 0 ? (
                                  <span className="font-bold text-emerald-600 font-mono">Khớp (0)</span>
                                ) : diff > 0 ? (
                                  <span className="font-bold text-blue-600 font-mono">+{diff} (Thừa)</span>
                                ) : (
                                  <span className="font-bold text-rose-600 font-mono bg-rose-50 px-1.5 py-0.5 rounded">
                                    {diff} (Thất thoát)
                                  </span>
                                )}
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

                  {/* Top Sellers */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      Top 10 Ấn Phẩm Bán Chạy Nhất Tại Gian Hàng
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {data.topSellers?.map((seller: any, idx: number) => (
                        <div
                          key={seller.editionId}
                          className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between"
                        >
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
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ============================================================== */}
        {/* NỘI DUNG BIÊN BẢN CHỐT CA KHỔ A4 (CHỈ HIỂN THỊ KHI IN window.print) */}
        {/* ============================================================== */}
        {data && (
          <div
            id="printable-settlement-report"
            className="hidden print:block bg-white p-8 text-slate-900 text-[12px] leading-relaxed font-serif"
          >
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
                  Ngày kết toán: <strong>{selectedDate}</strong>
                </p>
              </div>
              <div className="text-right font-sans text-[11px] text-slate-600">
                <p className="font-bold text-slate-800">BIÊN BẢN SỐ: BB-{selectedDate.replace(/-/g, '')}</p>
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
            <div className="space-y-2 mb-4 font-sans text-xs">
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
                    {data.cashboxReconciliation?.cashVariance === 0
                      ? 'Khớp 100%'
                      : (data.cashboxReconciliation?.cashVariance || 0) > 0
                      ? `Thừa: +${(data.cashboxReconciliation?.cashVariance || 0).toLocaleString('vi-VN')} đ`
                      : `Thiếu: ${(data.cashboxReconciliation?.cashVariance || 0).toLocaleString('vi-VN')} đ`}
                  </strong>
                </div>
              </div>
            </div>

            {/* II. Bảng đối soát tồn sách */}
            <div className="space-y-2 mb-4">
              <h3 className="font-sans font-bold text-xs text-slate-900 uppercase border-b border-slate-300 pb-1">
                II. ĐỐI SOÁT TỒN SÁCH TRÊN KỆ & BÀN GIAO ĐÓNG THÙNG
              </h3>
              <table className="w-full border-collapse border border-slate-900 text-[11px]">
                <thead>
                  <tr className="bg-slate-100 font-sans font-bold text-center">
                    <th className="border border-slate-900 p-1.5 w-8">STT</th>
                    <th className="border border-slate-900 p-1.5 w-16">Mã SKU</th>
                    <th className="border border-slate-900 p-1.5 text-left">Tên tác phẩm / Ấn phẩm</th>
                    <th className="border border-slate-900 p-1.5 w-16 text-right">Đã bán POS</th>
                    <th className="border border-slate-900 p-1.5 w-20 text-center">Tồn máy tính</th>
                    <th className="border border-slate-900 p-1.5 w-20 text-center">Thực đếm kệ</th>
                    <th className="border border-slate-900 p-1.5 w-24 text-center">Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inventoryReconciliation?.map((it: any, idx: number) => {
                    const actual = actualCounts[it.editionId] ?? it.theoreticalStock;
                    const diff = actual - it.theoreticalStock;
                    return (
                      <tr key={it.editionId}>
                        <td className="border border-slate-900 p-1 text-center font-mono">{idx + 1}</td>
                        <td className="border border-slate-900 p-1 text-center font-mono font-bold">{it.code}</td>
                        <td className="border border-slate-900 p-1 font-medium">{it.title}</td>
                        <td className="border border-slate-900 p-1 text-right font-mono">{it.soldToday || 0}</td>
                        <td className="border border-slate-900 p-1 text-center font-mono font-bold">{it.theoreticalStock}</td>
                        <td className="border border-slate-900 p-1 text-center font-mono font-bold">{actual}</td>
                        <td className="border border-slate-900 p-1 text-center font-mono">
                          {diff === 0 ? 'Khớp (0)' : diff > 0 ? `+${diff}` : `${diff}`}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="font-bold bg-slate-50 font-sans">
                    <td colSpan={4} className="border border-slate-900 p-1.5 text-center uppercase">
                      TỔNG CỘNG SỐ CUỐN KIỂM KÊ:
                    </td>
                    <td className="border border-slate-900 p-1.5 text-center font-mono">{totalTheoreticalBooks}</td>
                    <td className="border border-slate-900 p-1.5 text-center font-mono">{totalActualBooks}</td>
                    <td className="border border-slate-900 p-1.5 text-center font-mono">
                      {totalBookVariance === 0 ? '0' : totalBookVariance > 0 ? `+${totalBookVariance}` : `${totalBookVariance}`}
                    </td>
                  </tr>
                </tbody>
              </table>
              {stocktakeNote && (
                <p className="font-sans text-[11px] italic mt-1 text-slate-700">
                  Ghi chú đóng thùng: {stocktakeNote}
                </p>
              )}
            </div>

            {/* III. Chữ ký 3 bên */}
            <div className="font-sans grid grid-cols-3 gap-4 text-center text-xs mt-8 pt-4">
              <div>
                <p className="font-bold uppercase text-slate-900">Thu ngân lập biên bản</p>
                <p className="italic text-[11px] text-slate-500">(Ký, ghi rõ họ tên)</p>
                <div className="h-20" />
                <p className="font-bold text-slate-800">................................</p>
              </div>

              <div>
                <p className="font-bold uppercase text-slate-900">Quản lý gian hàng / Trưởng ca</p>
                <p className="italic text-[11px] text-slate-500">(Ký, ghi rõ họ tên)</p>
                <div className="h-20" />
                <p className="font-bold text-slate-800">................................</p>
              </div>

              <div>
                <p className="font-bold uppercase text-slate-900">Thủ kho nhận bàn giao sách</p>
                <p className="italic text-[11px] text-slate-500">(Ký, ghi rõ họ tên)</p>
                <div className="h-20" />
                <p className="font-bold text-slate-800">................................</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
