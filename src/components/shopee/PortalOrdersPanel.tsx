'use client';

import React, { useEffect, useState } from 'react';
import {
  Package,
  PackageCheck,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  RefreshCw,
  X,
  FileCheck,
  MapPin,
  Phone,
  User,
  Gift,
  Hash,
} from 'lucide-react';
import type { UserRole } from '@/lib/roles';

interface PickingItem {
  editionId?: string;
  productId?: string;
  code: string;
  name: string;
  quantity: number;
  isGift: boolean;
}

interface PickingOrder {
  id: string;
  orderCode: string;
  portalRef: string | null;
  customerName: string;
  phone: string;
  address: string;
  paymentMethod: string;
  shippingStatus: string;
  trackingCode: string | null;
  note?: string;
  isDispatched?: boolean;
  createdAt: string;
  items: PickingItem[];
}

const STATUS_LABELS: Record<string, string> = {
  NONE: 'Mới nhận',
  CREATED: 'Đã đóng gói',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đã gửi hàng',
  DELIVERED: 'Đã giao',
};

const STATUS_COLORS: Record<string, string> = {
  NONE: 'bg-slate-100 text-slate-700 border-slate-300',
  CREATED: 'bg-blue-50 text-blue-700 border-blue-300',
  PICKED_UP: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  IN_TRANSIT: 'bg-amber-50 text-amber-700 border-amber-300',
  DELIVERED: 'bg-emerald-50 text-emerald-700 border-emerald-300',
};

const NEXT_STATUS: Record<string, string | null> = {
  NONE: 'CREATED',
  CREATED: 'IN_TRANSIT',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'DELIVERED',
  DELIVERED: null,
};

const NEXT_LABEL: Record<string, string> = {
  NONE: 'Đóng gói',
  CREATED: 'Gửi hàng',
  PICKED_UP: 'Gửi hàng',
  IN_TRANSIT: 'Đã giao',
};

function displayCode(o: PickingOrder): { main: string; sub: string } {
  if (o.portalRef) return { main: o.portalRef, sub: o.orderCode };
  return { main: o.orderCode, sub: '' };
}

export function PortalOrdersPanel({ currentRole }: { currentRole?: UserRole }) {
  const [orders, setOrders] = useState<PickingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PickingOrder | null>(null);
  const [trackingFor, setTrackingFor] = useState<string | null>(null);
  const [trackingValue, setTrackingValue] = useState('');
  const [trackingInputModal, setTrackingInputModal] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null);
  const [confirmDlg, setConfirmDlg] = useState<{ msg: string; onOk: () => void } | null>(null);

  const showToast = (msg: string, type: 'error' | 'success' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchOrders = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/portal-orders/picking', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setOrders(data.data || []);
        setUpdatedAt(new Date());
      } else {
        showToast(data.error || 'Lỗi tải đơn hàng', 'error');
      }
    } catch (e: any) {
      console.error(e);
      showToast('Lỗi mạng khi tải danh sách đơn', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchOrders();
      }
    }, 5000);
    return () => clearInterval(t);
  }, []);

  /** Bước 4: Xác nhận xuất kho (trừ kho thực tế qua /api/portal-orders/[id]/approve) */
  const handleApproveDispatch = async (orderId: string, orderCode: string) => {
    setConfirmDlg({
      msg: `Xác nhận xuất kho cho đơn ${orderCode}? Hệ thống sẽ trừ tồn kho thực tế ngay lập tức.`,
      onOk: async () => {
        setConfirmDlg(null);
        try {
          const res = await fetch(`/api/portal-orders/${orderId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const data = await res.json();
          if (data.success) {
            await fetchOrders();
            // Cập nhật modal đang mở nếu có
            if (selected && selected.id === orderId) {
              setSelected((prev) => (prev ? { ...prev, isDispatched: true } : null));
            }
            showToast(
              data.data?.alreadyApproved
                ? 'Đơn này đã được ghi nhận xuất kho trước đó.'
                : 'Đã xác nhận xuất kho và trừ tồn kho thành công.',
              'success'
            );
          } else {
            showToast('Lỗi xuất kho: ' + (data.error || 'Thao tác không thành công'), 'error');
          }
        } catch {
          showToast('Lỗi mạng khi gửi yêu cầu xuất kho', 'error');
        }
      },
    });
  };

  /** Cập nhật trạng thái giao hàng */
  const handleUpdateShipping = async (orderId: string, newStatus: string, trackingCode?: string) => {
    const body: any = { shippingStatus: newStatus };
    if (newStatus === 'IN_TRANSIT' && trackingCode?.trim()) {
      body.trackingCode = trackingCode.trim();
    }
    try {
      const res = await fetch(`/api/portal-orders/${orderId}/shipping`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setTrackingFor(null);
        setTrackingValue('');
        setTrackingInputModal('');
        await fetchOrders();
        if (selected && selected.id === orderId) {
          setSelected((prev) =>
            prev
              ? {
                  ...prev,
                  shippingStatus: newStatus,
                  trackingCode: trackingCode?.trim() || prev.trackingCode,
                }
              : null
          );
        }
        showToast('Đã cập nhật trạng thái đơn thành công.', 'success');
      } else {
        showToast('Lỗi: ' + (data.error || 'Không cập nhật được trạng thái'), 'error');
      }
    } catch {
      showToast('Lỗi mạng khi cập nhật trạng thái', 'error');
    }
  };

  /** Thao tác nhanh chuyển trạng thái ngoài bảng */
  const handleQuickNext = (o: PickingOrder) => {
    const next = NEXT_STATUS[o.shippingStatus];
    if (!next) return;
    if (next === 'IN_TRANSIT') {
      setTrackingFor(o.id);
      setTrackingValue(o.trackingCode || '');
      return;
    }
    setConfirmDlg({
      msg: `Chuyển đơn ${displayCode(o).main} sang "${NEXT_LABEL[o.shippingStatus]}"?`,
      onOk: () => {
        setConfirmDlg(null);
        handleUpdateShipping(o.id, next);
      },
    });
  };

  /** Xác nhận gửi hàng kèm mã vận đơn */
  const handleConfirmTracking = (o: PickingOrder) => {
    if (!trackingValue.trim()) {
      showToast('Vui lòng nhập mã vận đơn để gửi hàng.', 'error');
      return;
    }
    handleUpdateShipping(o.id, 'IN_TRANSIT', trackingValue);
  };

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.orderCode.toLowerCase().includes(q) ||
      (o.portalRef || '').toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.phone.includes(q) ||
      (o.note || '').toLowerCase().includes(q) ||
      (o.trackingCode || '').toLowerCase().includes(q)
    );
  });

  const countNew = orders.filter((o) => o.shippingStatus === 'NONE').length;
  const countPacked = orders.filter((o) => o.shippingStatus === 'CREATED').length;
  const countInTransit = orders.filter((o) => o.shippingStatus === 'IN_TRANSIT').length;
  const countUndispatched = orders.filter((o) => !o.isDispatched).length;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-8 text-center text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
        Đang tải danh sách đơn online cần soạn...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 relative space-y-4">
      {/* Toast thông báo */}
      {toast && (
        <div
          role="status"
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-bold shadow-xl flex items-center gap-2 ${
            toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
          }`}
        >
          {toast.type === 'error' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Dialog xác nhận */}
      {confirmDlg && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setConfirmDlg(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="font-extrabold text-base text-slate-900 mb-2">Xác nhận thao tác</h4>
            <p className="text-slate-600 text-sm mb-5 leading-relaxed">{confirmDlg.msg}</p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDlg(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 active:scale-95 transition"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={confirmDlg.onOk}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm active:scale-95 transition"
              >
                Đồng ý
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header & Thống kê nhanh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-extrabold text-slate-900">Đơn Online Cần Soạn</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Dành cho thủ kho: Soạn hàng, đóng gói, xác nhận gửi đơn và xuất kho thực tế.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-[11px] text-slate-400">
              Cập nhật {updatedAt.toLocaleTimeString('vi-VN')}
            </span>
          )}
          <button
            type="button"
            onClick={fetchOrders}
            disabled={refreshing}
            aria-label="Làm mới danh sách"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:border-indigo-300 rounded-xl text-xs font-extrabold text-slate-700 bg-white hover:bg-indigo-50/50 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {/* Thanh thẻ số lượng các bước */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>1. Đơn mới</span>
            <Clock className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-xl font-black text-slate-800 mt-1">{countNew}</div>
        </div>
        <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200/80">
          <div className="flex items-center justify-between text-xs font-bold text-blue-700">
            <span>2. Đã đóng gói</span>
            <PackageCheck className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-xl font-black text-blue-900 mt-1">{countPacked}</div>
        </div>
        <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80">
          <div className="flex items-center justify-between text-xs font-bold text-amber-700">
            <span>3. Đang giao hàng</span>
            <Truck className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-black text-amber-900 mt-1">{countInTransit}</div>
        </div>
        <div className="p-3 rounded-xl bg-rose-50/60 border border-rose-200/80">
          <div className="flex items-center justify-between text-xs font-bold text-rose-700">
            <span>4. Chưa xuất kho</span>
            <FileCheck className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-black text-rose-900 mt-1">{countUndispatched}</div>
        </div>
      </div>

      {/* Ô tìm kiếm */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Tìm theo mã đơn, mã portal, tên khách, số điện thoại, ghi chú..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
        />
      </div>

      {/* Bảng danh sách đơn hàng */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          {search ? 'Không tìm thấy đơn nào khớp với từ khóa tìm kiếm.' : 'Không có đơn online nào cần xử lý lúc này 🎉'}
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-3">Mã đơn</th>
                <th className="py-3 px-3">Khách hàng</th>
                <th className="py-3 px-3 min-w-[200px]">Sản phẩm cần soạn</th>
                <th className="py-3 px-3 min-w-[160px]">Ghi chú của khách</th>
                <th className="py-3 px-3 whitespace-nowrap">Trạng thái vận chuyển</th>
                <th className="py-3 px-3 whitespace-nowrap">Kho hàng</th>
                <th className="py-3 px-3 text-right whitespace-nowrap">Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((o) => {
                const code = displayCode(o);
                const next = NEXT_STATUS[o.shippingStatus];
                const isTrackingFor = trackingFor === o.id;

                return (
                  <tr
                    key={o.id}
                    className="hover:bg-indigo-50/30 transition cursor-pointer"
                    onClick={() => setSelected(o)}
                  >
                    {/* Mã đơn */}
                    <td className="py-3 px-3 align-top">
                      <div className="font-mono font-black text-slate-900 text-sm">{code.main}</div>
                      {code.sub && <div className="font-mono text-[10px] text-slate-400">{code.sub}</div>}
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(o.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                        {new Date(o.createdAt).toLocaleDateString('vi-VN')}
                      </div>
                    </td>

                    {/* Khách hàng */}
                    <td className="py-3 px-3 align-top">
                      <div className="font-bold text-slate-900">{o.customerName || 'Khách vãng lai'}</div>
                      {o.phone && <div className="text-slate-500 font-mono text-[11px]">{o.phone}</div>}
                      {o.address && (
                        <div className="text-slate-400 text-[11px] truncate max-w-[180px]" title={o.address}>
                          {o.address}
                        </div>
                      )}
                    </td>

                    {/* Danh sách sản phẩm cần soạn */}
                    <td className="py-3 px-3 align-top">
                      <div className="space-y-1">
                        {o.items.map((it, i) => (
                          <div key={i} className="flex items-center justify-between gap-1.5 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                            <span className="font-semibold text-slate-800 truncate" title={it.name}>
                              {it.name || it.editionId || it.code}
                              {it.isGift && (
                                <span className="ml-1 text-rose-600 font-bold" title="Quà tặng kèm">
                                  🎁
                                </span>
                              )}
                            </span>
                            <span className="font-mono font-black text-indigo-700 shrink-0 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                              ×{it.quantity}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>

                    {/* Ghi chú của khách */}
                    <td className="py-3 px-3 align-top">
                      {o.note ? (
                        <div
                          className="p-2 bg-amber-50 border border-amber-200/90 rounded-xl text-amber-900 font-medium text-xs leading-snug"
                          title={o.note}
                        >
                          <div className="flex items-center gap-1 text-[10px] font-black uppercase text-amber-800 mb-0.5">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            Ghi chú khách
                          </div>
                          <p className="line-clamp-2">{o.note}</p>
                        </div>
                      ) : (
                        <span className="text-slate-300 italic text-[11px]">Không có</span>
                      )}
                    </td>

                    {/* Trạng thái vận chuyển */}
                    <td className="py-3 px-3 align-top whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${
                          STATUS_COLORS[o.shippingStatus] || STATUS_COLORS.NONE
                        }`}
                      >
                        {STATUS_LABELS[o.shippingStatus] || o.shippingStatus}
                      </span>
                      {o.trackingCode && (
                        <div className="text-[10px] text-slate-500 font-mono mt-1">
                          Vận đơn: <span className="font-bold text-slate-700">{o.trackingCode}</span>
                        </div>
                      )}
                    </td>

                    {/* Trạng thái xuất kho */}
                    <td className="py-3 px-3 align-top whitespace-nowrap">
                      {o.isDispatched ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          Đã xuất kho
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-300">
                          <Clock className="w-3 h-3" />
                          Chưa xuất kho
                        </span>
                      )}
                    </td>

                    {/* Thao tác nhanh */}
                    <td className="py-3 px-3 align-top text-right" onClick={(e) => e.stopPropagation()}>
                      {isTrackingFor ? (
                        <div className="flex items-center justify-end gap-1 min-w-[13rem]">
                          <input
                            type="text"
                            value={trackingValue}
                            onChange={(e) => setTrackingValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleConfirmTracking(o)}
                            placeholder="Mã vận đơn..."
                            aria-label="Mã vận đơn"
                            autoFocus
                            className="w-28 px-2 py-1.5 border border-indigo-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => handleConfirmTracking(o)}
                            className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer active:scale-95 transition"
                          >
                            Gửi
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrackingFor(null)}
                            className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold cursor-pointer"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                          {/* Bước 4: Nút Xác nhận xuất kho */}
                          {!o.isDispatched && (
                            <button
                              type="button"
                              onClick={() => handleApproveDispatch(o.id, displayCode(o).main)}
                              title="Xác nhận xuất kho: trừ tồn kho thực tế"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer whitespace-nowrap bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white shadow-sm transition active:scale-95"
                            >
                              <FileCheck className="w-3.5 h-3.5" />
                              Xuất kho
                            </button>
                          )}

                          {/* Bước 2 & 3: Các bước chuyển trạng thái vận chuyển */}
                          {next ? (
                            <button
                              type="button"
                              onClick={() => handleQuickNext(o)}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer whitespace-nowrap shadow-sm transition active:scale-95 ${
                                next === 'IN_TRANSIT'
                                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                  : next === 'DELIVERED'
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                              }`}
                            >
                              {next === 'CREATED' && <PackageCheck className="w-3.5 h-3.5" />}
                              {next === 'IN_TRANSIT' && <Truck className="w-3.5 h-3.5" />}
                              {NEXT_LABEL[o.shippingStatus]} →
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 font-bold px-2 py-1">Hoàn tất</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal chi tiết đơn hàng */}
      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 shadow-2xl border border-slate-100 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Tiêu đề modal */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-slate-900">{displayCode(selected).main}</h3>
                  {displayCode(selected).sub && (
                    <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                      Mã đơn: {displayCode(selected).sub}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Đặt lúc: {new Date(selected.createdAt).toLocaleString('vi-VN')} ·{' '}
                  <span className="font-bold text-slate-700">
                    {selected.paymentMethod === 'COD' ? 'Thu tiền khi giao (COD)' : 'Chuyển khoản'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Đóng"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Thông tin người nhận & Địa chỉ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400 mb-1 flex items-center gap-1">
                  <User className="w-3 h-3" /> Người nhận
                </div>
                <div className="font-extrabold text-slate-900 text-sm">{selected.customerName || 'Khách vãng lai'}</div>
                <div className="text-slate-600 font-mono mt-0.5 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-slate-400" /> {selected.phone || 'Chưa có SĐT'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-slate-400 mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Địa chỉ giao hàng
                </div>
                <div className="text-slate-800 leading-relaxed">{selected.address || 'Chưa có địa chỉ'}</div>
              </div>
            </div>

            {/* Khung Ghi chú của khách */}
            {selected.note ? (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-black uppercase text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Ghi chú quan trọng của khách hàng
                </div>
                <div className="text-xs text-amber-900 whitespace-pre-wrap leading-relaxed font-medium">
                  {selected.note}
                </div>
              </div>
            ) : (
              <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-400 italic">
                Khách hàng không để lại ghi chú.
              </div>
            )}

            {/* Bảng danh sách sản phẩm cần đóng */}
            <div>
              <div className="text-xs font-black uppercase text-slate-500 mb-2 flex items-center justify-between">
                <span>Sản phẩm cần soạn ({selected.items.length} món)</span>
                {selected.isDispatched ? (
                  <span className="text-emerald-700 font-bold flex items-center gap-1 normal-case text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Đã xuất kho
                  </span>
                ) : (
                  <span className="text-amber-700 font-bold flex items-center gap-1 normal-case text-xs">
                    <Clock className="w-3.5 h-3.5" /> Chưa xuất kho
                  </span>
                )}
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
                {selected.items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 p-3 bg-white">
                    <div className="min-w-0">
                      <div className="font-extrabold text-slate-900 text-sm truncate">{it.name || it.editionId}</div>
                      <div className="font-mono text-[11px] text-slate-400">{it.code || it.editionId}</div>
                      {it.isGift && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full">
                          <Gift className="w-3 h-3" /> Quà tặng kèm
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-black text-indigo-700">×{it.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Thao tác trong Modal */}
            <div className="border-t border-slate-100 pt-4 space-y-3">
              {/* Nút Xuất kho nếu chưa xuất */}
              {!selected.isDispatched && (
                <button
                  type="button"
                  onClick={() => handleApproveDispatch(selected.id, displayCode(selected).main)}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-95"
                >
                  <FileCheck className="w-4 h-4" />
                  Xác nhận xuất kho (Trừ tồn kho ngay)
                </button>
              )}

              {/* Luồng cập nhật vận chuyển */}
              {NEXT_STATUS[selected.shippingStatus] === 'IN_TRANSIT' ? (
                <div className="space-y-2 p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                  <label className="text-xs font-bold text-slate-700 block">
                    Nhập mã vận đơn bưu cục / đơn vị vận chuyển:
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={trackingInputModal}
                      onChange={(e) => setTrackingInputModal(e.target.value)}
                      placeholder="VD: SPX123456789, VNPOST..."
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!trackingInputModal.trim()) {
                          showToast('Vui lòng nhập mã vận đơn.', 'error');
                          return;
                        }
                        handleUpdateShipping(selected.id, 'IN_TRANSIT', trackingInputModal);
                      }}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs"
                    >
                      Xác nhận gửi hàng
                    </button>
                  </div>
                </div>
              ) : NEXT_STATUS[selected.shippingStatus] ? (
                <button
                  type="button"
                  onClick={() => handleUpdateShipping(selected.id, NEXT_STATUS[selected.shippingStatus]!)}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs shadow-sm transition active:scale-95 flex items-center justify-center gap-2"
                >
                  {NEXT_STATUS[selected.shippingStatus] === 'CREATED' && <PackageCheck className="w-4 h-4" />}
                  {NEXT_STATUS[selected.shippingStatus] === 'DELIVERED' && <CheckCircle2 className="w-4 h-4" />}
                  Chuyển trạng thái: {NEXT_LABEL[selected.shippingStatus]} →
                </button>
              ) : (
                <div className="text-center py-2 text-xs font-bold text-emerald-700 bg-emerald-50 rounded-xl border border-emerald-200">
                  Đơn hàng đã được giao hoàn tất
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
