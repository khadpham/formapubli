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
} from 'lucide-react';
import { UserRole } from '@/lib/roles';

interface SalesLedgerViewProps {
  currentRole: UserRole;
}

export function SalesLedgerView({ currentRole }: SalesLedgerViewProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeScope, setActiveScope] = useState<'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const isTaxAccountant = currentRole === 'ROLE_TAX';

  // Nếu là Kế toán thuế: Ép cứng chỉ được xem OFFICIAL_TAX
  useEffect(() => {
    if (isTaxAccountant) {
      setActiveScope('OFFICIAL_TAX');
    }
  }, [currentRole, isTaxAccountant]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const scopeParam = isTaxAccountant ? 'OFFICIAL_TAX' : activeScope;
      const res = await fetch(`/api/orders?fiscalScope=${scopeParam}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
        setSummary(data.summary || null);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách doanh số:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [activeScope, currentRole]);

  const filteredOrders = orders.filter((ord) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      ord.orderCode?.toLowerCase().includes(q) ||
      ord.customerName?.toLowerCase().includes(q) ||
      ord.vatInvoiceCode?.toLowerCase().includes(q)
    );
  });

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
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất Báo Cáo
          </button>
        </div>
      </div>

      {/* Scope Switcher Banner (Chỉ cho phép Chủ quản lý & Quản lý vận hành chuyển đổi) */}
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
            Nội Bộ / Đầu Nậu
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

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Tổng Giá Bìa (Niêm yết)
          </span>
          <p className="text-xl font-extrabold text-slate-900 mt-1 font-mono">
            {(summary?.totalSubtotal || 0).toLocaleString('vi-VN')} đ
          </p>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Tổng Tiền Chiết Khấu Đã Giảm
          </span>
          <p className="text-xl font-extrabold text-amber-600 mt-1 font-mono">
            -{(summary?.totalDiscount || 0).toLocaleString('vi-VN')} đ
          </p>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Doanh Thu Thực Thu
          </span>
          <p className="text-xl font-extrabold text-emerald-700 mt-1 font-mono">
            {(summary?.totalRevenue || 0).toLocaleString('vi-VN')} đ
          </p>
        </div>
      </div>

      {/* Orders List Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
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
          <span className="text-xs text-slate-500 font-medium shrink-0">
            Tìm thấy <strong>{filteredOrders.length}</strong> đơn hàng
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
              <tr>
                <th className="p-3.5">Mã Đơn Hàng</th>
                <th className="p-3.5">Kho Xuất</th>
                <th className="p-3.5">Khách Hàng / Đầu Nậu</th>
                <th className="p-3.5">Thanh Toán</th>
                <th className="p-3.5">Tổng Bìa</th>
                <th className="p-3.5">Chiết Khấu</th>
                <th className="p-3.5">Thực Thu</th>
                <th className="p-3.5">Phân Loại Sổ</th>
                <th className="p-3.5">Thời Gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Không tìm thấy đơn hàng nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((ord) => (
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
                          Nội bộ / Đầu nậu
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
      </div>
    </div>
  );
}
