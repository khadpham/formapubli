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
} from 'lucide-react';
import { UserRole } from '@/lib/roles';

// 1.2: TTL giữ chỗ ATP (giờ) — đồng bộ với PENDING_TTL_HOURS trong order.service.ts
const PENDING_TTL_HOURS = 48;

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
            <option value="wh-au-co">Kho 1 - Âu Cơ</option>
            <option value="wh-quynh-mai">Kho 2 - Quỳnh Mai</option>
            <option value="wh-fair">Kho 3 - Hội Chợ</option>
          </select>

          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="ALL">Tất cả kênh</option>
            <option value="RETAIL_ONLINE_SOCIAL">Facebook / Chat</option>
            <option value="RETAIL_ONLINE_WEB">Website</option>
            <option value="RETAIL_DIRECT">Quầy trực tiếp</option>
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
            Đơn tạo từ công cụ Dán Chat FB/Zalo hoặc Web sẽ xuất hiện tại đây để Quản lý kiểm tra.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
          {filteredOrders.map((o) => {
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
                      {o.channel === 'RETAIL_ONLINE_SOCIAL' ? 'Facebook Chat' : o.channel === 'RETAIL_ONLINE_WEB' ? 'Website' : o.channel || 'ONLINE'}
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
                      · {o.paymentMethod} · Kho xuất: {o.warehouseId === 'wh-au-co' ? 'Âu Cơ' : o.warehouseId === 'wh-quynh-mai' ? 'Quỳnh Mai' : 'Hội Chợ'}
                    </span>
                  </p>

                  {o.note && (
                    <p className="text-[11px] text-slate-500 truncate mt-0.5" title={o.note}>
                      <span className="font-medium text-slate-600">Ghi chú:</span> {o.note}
                    </p>
                  )}
                </div>

                {canModerate && (
                  <div className="flex items-center gap-2 shrink-0">
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal / Panel Xác nhận Hủy đơn */}
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
