'use client';

import React, { useState, useEffect } from 'react';
import {
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
} from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';

interface ExecutiveDashboardProps {
  currentRole: UserRole;
  onNavigateTab: (tab: string) => void;
}

export function ExecutiveDashboard({
  currentRole,
  onNavigateTab,
}: ExecutiveDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [matrixBooks, setMatrixBooks] = useState<any[]>([]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [orderRes] = await Promise.all([
        fetch('/api/orders?fiscalScope=ALL'),
      ]);
      const orderData = await orderRes.json();

      if (orderData.success) {
        setOrders(orderData.orders || []);
        setSummary(orderData.summary || null);
      }
    } catch (err) {
      console.error('Lỗi tải dữ liệu dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [currentRole]);

  // Sách sắp hết hàng (tồn kho tổng dưới 15 cuốn hoặc bằng 0)
  const lowStockBooks = matrixBooks.filter((b) => (b.totalStock || 0) < 15).slice(0, 5);

  const isOwnerOrManager = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

  return (
    <div className="space-y-6">
      {/* Top Welcome & Status Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-indigo-900/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Executive View
            </span>
            <span className="text-xs text-slate-400">
              Cập nhật thời gian thực từ Cloudflare D1
            </span>
          </div>
          <h2 className="text-2xl font-black mt-1 text-white tracking-tight">
            Bảng Quản Trị Vận Hành Toàn Cảnh
          </h2>
          <p className="text-sm text-slate-300 mt-0.5 max-w-2xl">
            Giám sát toàn diện 3 Khối Cốt Lõi: Kho Hàng 3 Địa Điểm, Quầy Thu Ngân Bán Sách và Sổ Kép Tài Chính.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDashboardData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới số liệu
          </button>
          <button
            onClick={() => onNavigateTab('pos')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all"
          >
            <ShoppingCart className="w-4 h-4" />
            Mở Quầy POS
          </button>
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
            Gồm bán lẻ hội chợ & đầu nậu Đinh Lễ
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

        {/* Tổng Tồn Kho 3 Địa điểm */}
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Tồn Kho Vật Lý (3 Kho)
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Boxes className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-extrabold text-slate-900 mt-2 font-mono">
            81 Đầu Sách
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Kho 1 Âu Cơ | Kho 2 Quỳnh Mai | Kho 3 Hội Chợ
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
                Phân Tách Dòng Tiền Sổ Kép (Dual Projection Architecture)
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
                  Sổ Kế Toán Thuế (Official VAT)
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
                  Sổ Quản Trị Thực Tế (Internal)
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
                  <span>Đơn đầu nậu & bán lẻ:</span>
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
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-900">Kho 1 - Âu Cơ</p>
                <p className="text-[11px] text-slate-500">Văn phòng chính & Xuất lẻ</p>
              </div>
              <span className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 font-mono">
                Sẵn sàng
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-900">Kho 2 - Quỳnh Mai</p>
                <p className="text-[11px] text-slate-500">Kho lưu trữ tổng số lượng lớn</p>
              </div>
              <span className="px-2 py-1 rounded-lg text-xs font-bold bg-slate-200 text-slate-700 font-mono">
                Kho tổng
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-900">Kho 3 - Hội Chợ</p>
                <p className="text-[11px] text-slate-500">Gian hàng sự kiện lưu động</p>
              </div>
              <span className="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 font-mono">
                POS Bán
              </span>
            </div>
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
                      {ord.customerName || 'Khách vãng lai'}
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
                          Nội bộ / Đầu nậu
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-400 text-[11px] font-mono">
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
