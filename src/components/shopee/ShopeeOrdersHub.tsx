'use client';

import React, { useEffect, useState } from 'react';
import { ShoppingBag, Truck, Printer, CheckCircle2, Search, RefreshCw } from 'lucide-react';

interface HubItem {
  name: string;
  quantity: number;
}

interface HubOrder {
  id: string;
  orderCode: string;
  orderSn: string;
  customerName: string;
  finalAmount: number;
  paymentMethod: string;
  status: string;
  shippingStatus: string;
  carrier: string | null;
  trackingCode: string | null;
  invoiceStatus: string;
  deliveryConfirmedAt: string | null;
  createdAt: string;
  items: HubItem[];
}

const TABS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'to_confirm', label: 'Chờ xác nhận' },
  { key: 'to_ship', label: 'Chờ lấy hàng' },
  { key: 'shipping', label: 'Đang giao' },
  { key: 'delivered', label: 'Đã giao' },
  { key: 'returns', label: 'Trả hàng/Hủy' },
] as const;

const SHIP_LABEL: Record<string, string> = {
  NONE: 'Chưa tạo',
  CREATED: 'Chờ xác nhận',
  PICKED_UP: 'Chờ lấy hàng',
  IN_TRANSIT: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã trả hàng',
  FAILED: 'Giao thất bại',
};

function invoiceBadge(o: HubOrder): { text: string; cls: string } | null {
  if (o.deliveryConfirmedAt) return { text: 'Đã phát hành HĐ', cls: 'bg-emerald-100 text-emerald-800' };
  if (o.shippingStatus === 'DELIVERED' || o.shippingStatus === 'PICKED_UP' || o.shippingStatus === 'IN_TRANSIT') {
    return { text: 'Chờ XN nhận hàng', cls: 'bg-amber-100 text-amber-800' };
  }
  return { text: 'Chưa đủ ĐK', cls: 'bg-slate-100 text-slate-500' };
}

export function ShopeeOrdersHub({ onToast }: { onToast: (m: string) => void }) {
  const [tab, setTab] = useState<string>('all');
  const [orders, setOrders] = useState<HubOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [shippingId, setShippingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = async (t: string = tab, keyword: string = q) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ tab: t });
      if (keyword.trim()) sp.set('q', keyword.trim());
      const r = await fetch(`/api/shopee/orders?${sp.toString()}`).then((x) => x.json());
      if (r?.success) {
        setOrders(r.data.orders || []);
        setCounts(r.data.counts || {});
      }
    } catch {
      /* giữ dữ liệu cũ */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('all', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = (t: string) => {
    setTab(t);
    load(t, q);
  };

  const doSearch = () => load(tab, q);

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch('/api/shopee/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      }).then((x) => x.json());
      if (r?.success) {
        const d = r.data;
        onToast(`Đồng bộ xong: ${d.pulled} đơn mới, bỏ qua ${d.skipped}${d.quarantined?.length ? `, ${d.quarantined.length} đơn lỗi` : ''}.`);
        load(tab, q);
      } else onToast(r?.error || 'Đồng bộ thất bại.');
    } catch {
      onToast('Đồng bộ thất bại.');
    } finally {
      setSyncing(false);
    }
  };

  const shipOne = async (orderSn: string) => {
    setShippingId(orderSn);
    try {
      const r = await fetch('/api/shopee/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderSn }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast(
          r.data?.trackingPending
            ? `Đã xếp lịch giao đơn ${orderSn} - mã vận đơn đang chờ Shopee cấp.`
            : `Đã giao đơn ${orderSn} - mã vận đơn ${r.data.trackingCode}.`
        );
        load(tab, q);
      } else onToast(r?.error || 'Giao hàng thất bại.');
    } catch {
      onToast('Giao hàng thất bại.');
    } finally {
      setShippingId(null);
    }
  };

  const confirmDelivery = async (o: HubOrder) => {
    setConfirmingId(o.id);
    try {
      const r = await fetch(`/api/orders/${o.id}/confirm-delivery`, { method: 'POST' }).then((x) => x.json());
      if (r?.ok) {
        onToast(`Đã xác nhận khách nhận hàng - đơn ${o.orderSn}.`);
        load(tab, q);
      } else onToast(r?.error || 'Xác nhận thất bại.');
    } catch {
      onToast('Xác nhận thất bại.');
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <section aria-label="Quản lý đơn Shopee" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-orange-600" />
          Đơn Shopee
        </h2>
        <button
          type="button"
          disabled={syncing}
          onClick={syncNow}
          aria-label="Đồng bộ đơn Shopee ngay"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
        </button>
      </div>

      {/* Tabs trạng thái */}
      <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Trạng thái đơn">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => switchTab(t.key)}
            className={`px-3 py-2 rounded-xl text-xs font-bold min-h-[40px] ${
              tab === t.key
                ? 'bg-orange-600 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t.label}
            {typeof counts[t.key] === 'number' && counts[t.key] > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${tab === t.key ? 'bg-white/25' : 'bg-slate-200'}`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tìm kiếm */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="Tìm mã đơn, tên khách…"
            aria-label="Tìm kiếm đơn Shopee"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-xs min-h-[44px]"
          />
        </div>
        <button
          type="button"
          onClick={doSearch}
          aria-label="Tìm kiếm"
          className="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold min-h-[44px]"
        >
          Tìm
        </button>
      </div>

      {/* Danh sách đơn */}
      {loading && <p className="text-xs text-slate-400">Đang tải…</p>}
      {!loading && orders.length === 0 && (
        <p className="text-xs text-slate-400">Không có đơn nào trong mục này.</p>
      )}
      <div className="space-y-3">
        {orders.map((o) => {
          const badge = invoiceBadge(o);
          return (
            <div key={o.id} className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-800">
                    #{o.orderSn} <span className="font-normal text-slate-500">- {o.customerName || 'Khách Shopee'}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {o.items.map((i) => `${i.name} x${i.quantity}`).join(' · ') || '—'}
                  </p>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-bold ${
                  o.shippingStatus === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800'
                  : o.shippingStatus === 'CREATED' ? 'bg-blue-100 text-blue-800'
                  : o.status === 'CANCELLED' ? 'bg-red-100 text-red-800'
                  : 'bg-slate-200 text-slate-700'
                }`}>
                  {SHIP_LABEL[o.shippingStatus] || o.shippingStatus}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] text-slate-500">
                  {Number(o.finalAmount || 0).toLocaleString('vi-VN')}đ · {o.paymentMethod} · {o.carrier || '-'}
                  {o.trackingCode ? ` · ${o.trackingCode}` : ''}
                </p>
                {badge && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>
                    HĐ: {badge.text}
                  </span>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {o.shippingStatus === 'CREATED' && o.status !== 'CANCELLED' && (
                  <>
                    <button
                      type="button"
                      disabled={shippingId === o.orderSn}
                      onClick={() => shipOne(o.orderSn)}
                      aria-label={`Chuẩn bị hàng đơn ${o.orderSn}`}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
                    >
                      <Truck className="w-4 h-4" />
                      {shippingId === o.orderSn ? 'Đang giao…' : 'Chuẩn bị hàng'}
                    </button>
                    <a
                      href={`/api/shopee/awb?orderSn=${encodeURIComponent(o.orderSn)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`In vận đơn ${o.orderSn}`}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold min-h-[40px]"
                    >
                      <Printer className="w-4 h-4" />
                      In vận đơn
                    </a>
                  </>
                )}
                {(o.shippingStatus === 'PICKED_UP' || o.shippingStatus === 'IN_TRANSIT' || o.shippingStatus === 'DELIVERED') && !o.deliveryConfirmedAt && (
                  <button
                    type="button"
                    disabled={confirmingId === o.id}
                    onClick={() => confirmDelivery(o)}
                    aria-label={`Xác nhận khách đã nhận hàng đơn ${o.orderSn}`}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {confirmingId === o.id ? 'Đang xác nhận…' : 'Đã nhận hàng'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
