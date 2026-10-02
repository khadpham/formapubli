'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Search,
  Filter,
  PackageCheck,
  ShoppingBag,
  TimerReset,
  Eye,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';

// 1.2: TTL giữ chỗ ATP (giờ) — đồng bộ với PENDING_TTL_HOURS trong order.service.ts
const PENDING_TTL_HOURS = 48;

// Mặc định chỉ hiện 5 đơn mới nhất; bấm "Xem hết" mới bung toàn bộ đơn trong ngày.
const DEFAULT_VISIBLE_COUNT = 5;

function channelLabel(channel: string | null): string {
  if (channel === 'RETAIL_ONLINE_SOCIAL') return 'Facebook Chat';
  if (channel === 'RETAIL_ONLINE_WEB') return 'Website';
  if (channel === 'FAIR_EVENT') return 'Tại quầy hội chợ';
  if (channel === 'RETAIL_OFFICE') return 'Tại quầy';
  if (channel === 'WHOLESALE_PARTNER') return 'Bán sỉ';
  if (channel === 'ONLINE') return 'Online';
  return channel || 'ONLINE';
}

interface PendingOrder {
  id: string;
  orderCode: string;
  customerName: string | null;
  channel: string | null;
  warehouseId: string;
  subtotal: number;
  finalAmount: number;
  paymentMethod: string;
  note: string | null;
  createdAt: string | null;
}

interface OrderDetailItem {
  id: string;
  quantity: number;
  productId: string;
  editionId: string | null;
  unitCoverPrice: number;
  unitDiscountRate: number | null;
  unitSellingPrice: number;
  totalAmount: number;
  isGiftLine: boolean | null;
  productName: string | null;
  productCode: string | null;
}

function ageInfo(createdAt: string | null) {
  if (!createdAt) return { ageH: 0, leftH: PENDING_TTL_HOURS, expired: false, label: '—' };
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return { ageH: 0, leftH: PENDING_TTL_HOURS, expired: false, label: '—' };
  const ageH = (Date.now() - t) / 3600000;
  const leftH = PENDING_TTL_HOURS - ageH;
  const expired = leftH <= 0;
  const label = expired
    ? `Quá hạn ${Math.floor(ageH - PENDING_TTL_HOURS)}h`
    : leftH < 1
    ? `Còn ${Math.floor(leftH * 60)} phút`
    : `Còn ${Math.floor(leftH)}h${Math.floor((leftH % 1) * 60)}p`;
  return { ageH, leftH, expired, label };
}

export function PendingOrdersView({ currentRole }: { currentRole: UserRole }) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState('ALL');
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [showAll, setShowAll] = useState(false);
  const [warehouseNames, setWarehouseNames] = useState<Record<string, string>>({});
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<any | null>(null);
  const [detailItems, setDetailItems] = useState<OrderDetailItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const canModerate = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/orders?status=PENDING_CONFIRMATION', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Lỗi tải đơn chờ');
      setOrders(json.orders || []);
    } catch (e: any) {
      setError(e.message || 'Lỗi tải đơn chờ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  // Tên kho thật (không map cứng 3 kho cũ — kho hội chợ tạo theo từng sự kiện).
  useEffect(() => {
    let alive = true;
    fetch('/api/warehouses?all=true', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const w of j?.data || []) map[`${w.id}`] = `${w.name}`;
        setWarehouseNames(map);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const warehouseLabel = useCallback(
    (id: string) => warehouseNames[id] || id,
    [warehouseNames]
  );

  const openDetail = useCallback(async (orderId: string) => {
    setDetailOrderId(orderId);
    setDetailOrder(null);
    setDetailItems([]);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không xem được chi tiết đơn');
      setDetailOrder(json.order || null);
      setDetailItems(json.items || []);
    } catch (e: any) {
      setDetailError(e.message || 'Không xem được chi tiết đơn');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOrderId(null);
    setDetailOrder(null);
    setDetailItems([]);
    setDetailError(null);
  }, []);

  // Tick đồng hồ TTL mỗi phút
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  void now;

  // Lọc và sắp xếp đơn hàng theo tiêu chí
  const filteredOrders = useMemo(() => {
    return orders
      .filter((o) => {
        if (selectedWarehouse !== 'ALL' && o.warehouseId !== selectedWarehouse) return false;
        if (channelFilter !== 'ALL' && o.channel !== channelFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchCode = o.orderCode?.toLowerCase().includes(q);
          const matchCustomer = o.customerName?.toLowerCase().includes(q);
          const matchNote = o.note?.toLowerCase().includes(q);
          if (!matchCode && !matchCustomer && !matchNote) return false;
        }
        return true;
      })
      .sort((a, b) => `${a.createdAt || ''}`.localeCompare(`${b.createdAt || ''}`));
  }, [orders, selectedWarehouse, channelFilter, searchQuery]);

  // Tính toán KPI nhanh
  const kpi = useMemo(() => {
    const total = orders.length;
    let urgentCount = 0;
    let expiredCount = 0;
    let totalPendingValue = 0;

    for (const ord of orders) {
      const { leftH, expired } = ageInfo(ord.createdAt);
      if (expired) {
        expiredCount++;
      } else if (leftH <= 12) {
        urgentCount++;
      }
      totalPendingValue += ord.finalAmount || 0;
    }

    return { total, urgentCount, expiredCount, totalPendingValue };
  }, [orders]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const doAction = async (action: 'CONFIRM' | 'CANCEL', orderId: string, reason?: string) => {
    setActingId(orderId);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, orderId, reason }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || `Lỗi ${action}`);
      flash(action === 'CONFIRM' ? 'Đã duyệt — kho vật lý đã trừ.' : 'Đã hủy — giữ chỗ ATP đã nhả.');
      setCancelId(null);
      setCancelReason('');
      await fetchPending();
    } catch (e: any) {
      setError(e.message || 'Lỗi thao tác');
    } finally {
      setActingId(null);
    }
  };

  const doCleanup = async () => {
    setActingId('__cleanup__');
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CLEANUP' }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Lỗi dọn đơn');
      flash(`Đã dọn ${json.data?.cleaned ?? 0} đơn quá hạn.`);
      await fetchPending();
    } catch (e: any) {
      setError(e.message || 'Lỗi dọn đơn');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-5 mt-6">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            Đơn Online Chờ Xác Nhận & Giữ Chỗ ATP ({orders.length})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cơ chế giữ chỗ ATP tự động trong {PENDING_TTL_HOURS}h — Chỉ trừ kho vật lý khi Quản lý duyệt, quá hạn tự nhả chỗ.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchPending}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
          {canModerate && (
            <button
              type="button"
              onClick={doCleanup}
              disabled={actingId === '__cleanup__' || kpi.expiredCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-700 text-white transition disabled:opacity-40 cursor-pointer"
              title="Tự động hủy toàn bộ đơn quá 48h giữ chỗ để giải phóng ATP cho quầy"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              Dọn {kpi.expiredCount} đơn hết hạn
            </button>
          )}
        </div>
      </div>

      {/* KPI Scorecards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
          <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
            <ShoppingBag className="w-3.5 h-3.5 text-indigo-600" /> Tổng đơn chờ
          </span>
          <p className="text-lg font-black text-slate-900 mt-0.5">{kpi.total}</p>
        </div>
        <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl">
          <span className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
            <TimerReset className="w-3.5 h-3.5 text-amber-600" /> Gấp (&le; 12h)
          </span>
          <p className="text-lg font-black text-amber-800 mt-0.5">{kpi.urgentCount}</p>
        </div>
        <div className="p-3 bg-rose-50/60 border border-rose-200/80 rounded-xl">
          <span className="text-[11px] font-semibold text-rose-700 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Quá hạn (&gt; 48h)
          </span>
          <p className="text-lg font-black text-rose-800 mt-0.5">{kpi.expiredCount}</p>
        </div>
        <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl">
          <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
            <PackageCheck className="w-3.5 h-3.5 text-emerald-600" /> Giá trị giữ chỗ
          </span>
          <p className="text-lg font-black text-emerald-800 mt-0.5">
            {kpi.totalPendingValue.toLocaleString('vi-VN')} đ
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm theo mã đơn, tên khách, SĐT, ghi chú..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedWarehouse}
            onChange={(e) => setSelectedWarehouse(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="ALL">Tất cả kho xuất</option>
            {Object.entries(warehouseNames).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>

          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="ALL">Tất cả kênh</option>
            <option value="FAIR_EVENT">Tại quầy hội chợ</option>
            <option value="RETAIL_OFFICE">Tại quầy</option>
            <option value="RETAIL_ONLINE_SOCIAL">Facebook / Chat</option>
            <option value="RETAIL_ONLINE_WEB">Website</option>
          </select>
        </div>
      </div>

      {/* Alerts */}
      {toast && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-1.5 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> {toast}
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </p>
      )}

      {/* Orders List */}
      {filteredOrders.length === 0 && !loading ? (
        <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs font-semibold text-slate-600">
            {orders.length === 0 ? 'Hiện không có đơn online nào đang chờ duyệt' : 'Không có đơn nào khớp với bộ lọc hiện tại'}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Đơn tạo từ quầy chuyển khoản/QR hoặc công cụ Dán Chat FB/Zalo sẽ xuất hiện tại đây để Quản lý kiểm tra.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
          {(showAll ? filteredOrders : filteredOrders.slice(-DEFAULT_VISIBLE_COUNT).reverse()).map((o) => {
            const age = ageInfo(o.createdAt);
            const busy = actingId === o.id;
            return (
              <div
                key={o.id}
                className={`p-3.5 rounded-xl border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  age.expired
                    ? 'bg-rose-50/70 border-rose-200'
                    : age.leftH <= 12
                    ? 'bg-amber-50/50 border-amber-200'
                    : 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      {o.orderCode}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">
                      {channelLabel(o.channel)}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                        age.expired
                          ? 'bg-rose-100 text-rose-700 border-rose-300'
                          : age.leftH <= 12
                          ? 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      <Clock className="w-3 h-3 inline" />
                      {age.label}
                    </span>
                  </div>

                  <p className="text-xs text-slate-800 font-semibold truncate mt-1.5">
                    {o.customerName || 'Khách online'} ·{' '}
                    <span className="font-mono font-black text-emerald-700">
                      {(o.finalAmount || 0).toLocaleString('vi-VN')} đ
                    </span>
                    <span className="text-slate-400 font-normal">
                      {' '}
                      · {o.paymentMethod} · Kho xuất: {warehouseLabel(o.warehouseId)}
                    </span>
                  </p>

                  {o.note && (
                    <p className="text-[11px] text-slate-500 truncate mt-0.5" title={o.note}>
                      <span className="font-medium text-slate-600">Ghi chú:</span> {o.note}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => openDetail(o.id)}
                    className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1 shadow-sm cursor-pointer"
                    aria-label={`Xem chi tiết đơn ${o.orderCode}`}
                  >
                    <Eye className="w-3.5 h-3.5" /> Xem
                  </button>
                {canModerate && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => doAction('CONFIRM', o.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50 flex items-center gap-1 shadow-sm cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Duyệt xuất kho
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (cancelId === o.id) {
                          setCancelId(null);
                        } else {
                          setCancelId(o.id);
                          setCancelReason('');
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-200 hover:bg-rose-100 hover:text-rose-700 text-slate-700 transition disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Hủy
                    </button>
                  </>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filteredOrders.length > DEFAULT_VISIBLE_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full px-3 py-2 rounded-xl text-xs font-extrabold bg-slate-900 hover:bg-slate-700 text-white transition cursor-pointer"
        >
          {showAll ? 'Thu gọn — chỉ hiện 5 đơn mới nhất' : `Xem hết ${filteredOrders.length} đơn`}
        </button>
      )}

      {/* Popup chi tiết đơn — đủ để đối soát mà không cần hỏi ai */}
      {detailOrderId && (
        <div className="p-4 bg-indigo-50/60 border border-indigo-200 rounded-xl space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-indigo-600" />
              Chi tiết đơn {detailOrder?.orderCode || ''}
            </p>
            <button
              type="button"
              onClick={closeDetail}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Đóng
            </button>
          </div>
          {detailLoading && <p className="text-xs text-slate-500">Đang tải chi tiết đơn...</p>}
          {detailError && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{detailError}</p>
          )}
          {detailOrder && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <p><span className="text-slate-500">Khách:</span> <span className="font-bold">{detailOrder.customerName || 'Khách lẻ'}</span></p>
                <p><span className="text-slate-500">Thu ngân:</span> <span className="font-bold">{detailOrder.cashierName || detailOrder.cashierId}</span></p>
                <p><span className="text-slate-500">Kho:</span> <span className="font-bold">{detailOrder.warehouseName || detailOrder.warehouseId}</span></p>
                <p><span className="text-slate-500">Kênh:</span> <span className="font-bold">{channelLabel(detailOrder.channel)}</span></p>
                <p><span className="text-slate-500">Thanh toán:</span> <span className="font-bold">{detailOrder.paymentMethod}</span></p>
                <p><span className="text-slate-500">Tạo lúc:</span> <span className="font-bold">{detailOrder.createdAt ? new Date(detailOrder.createdAt).toLocaleString('vi-VN') : '—'}</span></p>
                <p><span className="text-slate-500">Tiền hàng:</span> <span className="font-bold">{Number(detailOrder.subtotal || 0).toLocaleString('vi-VN')} đ</span></p>
                <p><span className="text-slate-500">Thực thu:</span> <span className="font-black text-emerald-700">{Number(detailOrder.finalAmount || 0).toLocaleString('vi-VN')} đ</span></p>
              </div>
              {detailOrder.note && <p className="text-[11px] text-slate-600">Ghi chú: {detailOrder.note}</p>}
              <div className="space-y-1.5">
                {detailItems.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {it.productName || it.productId} × {it.quantity}
                        {it.isGiftLine ? <span className="ml-1.5 text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">Quà</span> : null}
                      </p>
                      <p className="text-[11px] text-slate-500">Bìa {Number(it.unitCoverPrice || 0).toLocaleString('vi-VN')}đ · Bán {Number(it.unitSellingPrice || 0).toLocaleString('vi-VN')}đ</p>
                    </div>
                    <p className="text-xs font-black text-slate-900 shrink-0">{Number(it.totalAmount || 0).toLocaleString('vi-VN')}đ</p>
                  </div>
                ))}
                {detailItems.length === 0 && !detailLoading && (
                  <p className="text-[11px] text-slate-400">Đơn không có dòng hàng.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {cancelId && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex flex-col sm:flex-row gap-2 animate-in fade-in">
          <input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Lý do hủy giữ chỗ (VD: khách đổi ý, không liên lạc được, hết hàng...)"
            className="flex-1 px-3 py-2 bg-white border border-rose-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={actingId === cancelId}
              onClick={() => doAction('CANCEL', cancelId, cancelReason.trim() || undefined)}
              className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-rose-600 hover:bg-rose-500 text-white transition disabled:opacity-50 cursor-pointer"
            >
              {actingId === cancelId ? 'Đang hủy...' : 'Xác nhận hủy đơn'}
            </button>
            <button
              type="button"
              onClick={() => setCancelId(null)}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {!canModerate && (
        <p className="text-[11px] text-slate-400 italic">
          * Ghi chú: Tài khoản thu ngân hoặc kế toán chỉ có quyền xem danh sách đơn giữ chỗ. Quyền Duyệt hoặc Hủy đơn thuộc về Quản lý / Chủ doanh nghiệp.
        </p>
      )}
    </div>
  );
}
