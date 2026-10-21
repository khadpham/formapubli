'use client';

import React, { useEffect, useState } from 'react';
import { ShoppingBag, Truck, Printer, CheckCircle2, Search, RefreshCw, Package, Copy, X } from 'lucide-react';

/**
 * Danh sách đơn Shopee - riêng kênh SHOPEE.
 * Quyết định 2026-10-21: tách riêng theo kênh (kênh nào ra kênh nấy) do khối
 * lượng tác vụ Shopee lớn, luồng thao tác riêng (in phiếu SPX, ĐVVC...).
 * Đơn portal xem ở mục "Đơn Portal" (PortalOrdersPanel).
 * Lọc theo vòng đời: Chờ xác nhận / Chờ lấy hàng / Đang giao / Đã giao / Hủy-Hoàn trả.
 */
interface HubItem {
  name: string;
  quantity: number;
}

interface HubOrder {
  id: string;
  orderCode: string;
  channel: string;
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
  packedAt: string | null;
  awbPrintedAt: string | null;
  createdAt: string;
  items: HubItem[];
}

// Khung trạng thái vòng đời hợp nhất (mục 3.2.2).
const TABS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'moi', label: 'Chờ xác nhận' },
  { key: 'ban_giao', label: 'Chờ lấy hàng' },
  { key: 'dang_giao', label: 'Đang giao' },
  { key: 'hoan_thanh', label: 'Đã giao' },
  { key: 'huy_hoan_tra', label: 'Trả hàng/Hủy' },
] as const;

const CYCLE_LABEL: Record<string, string> = {
  CREATED: 'Mới',
  PICKED_UP: 'Đã bàn giao VC',
  IN_TRANSIT: 'Đang giao',
  DELIVERED: 'Hoàn thành',
  RETURNED: 'Hoàn trả',
  FAILED: 'Giao thất bại',
  NONE: 'Mới',
};

function cycleLabel(o: HubOrder): string {
  if (o.status === 'CANCELLED') return 'Đã hủy';
  return CYCLE_LABEL[o.shippingStatus] || o.shippingStatus;
}

function invoiceBadge(o: HubOrder): { text: string; cls: string } | null {
  if (o.deliveryConfirmedAt) return { text: 'Đã phát hành HĐ', cls: 'bg-emerald-100 text-emerald-800' };
  if (o.shippingStatus === 'DELIVERED' || o.shippingStatus === 'PICKED_UP' || o.shippingStatus === 'IN_TRANSIT') {
    return { text: 'Chờ XN nhận hàng', cls: 'bg-amber-100 text-amber-800' };
  }
  return { text: 'Chưa đủ ĐK', cls: 'bg-slate-100 text-slate-500' };
}

/** Thanh tiến trình 4 bước xử lý đơn Shopee. */
function FulfillSteps({ o }: { o: HubOrder }) {
  const steps = [
    { label: 'Đã đóng gói', done: !!o.packedAt },
    { label: 'Đã xếp lịch', done: !!o.trackingCode },
    { label: 'Đã in phiếu', done: !!o.awbPrintedAt },
    { label: 'Đã bàn giao', done: ['IN_TRANSIT', 'DELIVERED'].includes(o.shippingStatus) },
  ];
  return (
    <div className="flex items-center gap-1" aria-label="Tiến trình xử lý đơn">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          {i > 0 && <div className={`h-0.5 w-4 sm:w-6 rounded ${steps[i - 1].done ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          <div className="flex items-center gap-1">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
              {s.done ? '✓' : i + 1}
            </span>
            <span className={`text-[10px] font-bold hidden sm:inline ${s.done ? 'text-emerald-700' : 'text-slate-400'}`}>{s.label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/** Dialog chọn hình thức giao hàng: tự mang ra bưu cục hoặc ĐVVC đến lấy. */
function ShipDialog({
  orderSn,
  onClose,
  onConfirm,
  confirming,
}: {
  orderSn: string;
  onClose: () => void;
  onConfirm: (mode: 'pickup' | 'dropoff') => void;
  confirming: boolean;
}) {
  const [mode, setMode] = useState<'pickup' | 'dropoff'>('dropoff');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-label={`Xếp lịch giao đơn ${orderSn}`}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="text-base font-extrabold text-slate-900">Xếp lịch giao hàng</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className="p-2 rounded-xl hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-600">Đơn #{orderSn} - chọn hình thức bàn giao cho SPX Express:</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('dropoff')}
              aria-pressed={mode === 'dropoff'}
              className={`p-4 rounded-xl border-2 text-left ${mode === 'dropoff' ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}`}
            >
              <Package className="w-6 h-6 text-orange-600 mb-2" />
              <p className="text-xs font-extrabold text-slate-800">Tự mang ra bưu cục</p>
              <p className="text-[11px] text-slate-500 mt-1">Mang hàng đến điểm SPX gần nhất</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('pickup')}
              aria-pressed={mode === 'pickup'}
              className={`p-4 rounded-xl border-2 text-left ${mode === 'pickup' ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}`}
            >
              <Truck className="w-6 h-6 text-orange-600 mb-2" />
              <p className="text-xs font-extrabold text-slate-800">ĐVVC đến lấy hàng</p>
              <p className="text-[11px] text-slate-500 mt-1">SPX đến kho lấy theo lịch hẹn</p>
            </button>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold min-h-[44px]">
            Hủy
          </button>
          <button
            type="button"
            disabled={confirming}
            onClick={() => onConfirm(mode)}
            className="px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold min-h-[44px] disabled:opacity-50"
          >
            {confirming ? 'Đang xếp lịch…' : 'Xác nhận xếp lịch'}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [packingId, setPackingId] = useState<string | null>(null);
  const [shipDialogSn, setShipDialogSn] = useState<string | null>(null);

  const load = async (t: string = tab, keyword: string = q) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ tab: t, channel: 'SHOPEE' });
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

  const packOne = async (orderSn: string) => {
    setPackingId(orderSn);
    try {
      const r = await fetch('/api/shopee/pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderSn }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast(`Đã xác nhận đóng gói đơn ${orderSn}.`);
        load(tab, q);
      } else onToast(r?.error || 'Xác nhận đóng gói thất bại.');
    } catch {
      onToast('Xác nhận đóng gói thất bại.');
    } finally {
      setPackingId(null);
    }
  };

  const shipOne = async (orderSn: string, mode: 'pickup' | 'dropoff') => {
    setShippingId(orderSn);
    try {
      const r = await fetch('/api/shopee/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderSn, mode }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast(
          r.data?.trackingPending
            ? `Đã xếp lịch giao đơn ${orderSn} - mã vận đơn đang chờ Shopee cấp.`
            : `Đã xếp lịch giao đơn ${orderSn} - mã vận đơn ${r.data.trackingCode}.`
        );
        setShipDialogSn(null);
        load(tab, q);
      } else onToast(r?.error || 'Xếp lịch giao thất bại.');
    } catch {
      onToast('Xếp lịch giao thất bại.');
    } finally {
      setShippingId(null);
    }
  };

  const copyTracking = (code: string) => {
    navigator.clipboard?.writeText(code).then(
      () => onToast(`Đã copy mã vận đơn ${code}.`),
      () => onToast('Không copy được mã vận đơn.')
    );
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
    <section aria-label="Đơn hàng Shopee" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
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

      {/* Tabs vòng đời đơn Shopee */}
      <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Vòng đời đơn">
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
            aria-label="Tìm kiếm đơn online"
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

      {/* Danh sách đơn hợp nhất */}
      {loading && <p className="text-xs text-slate-400">Đang tải…</p>}
      {!loading && orders.length === 0 && (
        <p className="text-xs text-slate-400">Không có đơn nào trong mục này.</p>
      )}
      <div className="space-y-3">
        {orders.map((o) => {
          const badge = invoiceBadge(o);
          const canPack = !o.packedAt && o.status !== 'CANCELLED' && o.shippingStatus === 'CREATED';
          const canShip = !!o.packedAt && !o.trackingCode && o.status !== 'CANCELLED';
          const canPrint = !!o.trackingCode && o.status !== 'CANCELLED';
          return (
            <div key={o.id} className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-800">
                    #{o.orderSn} <span className="font-normal text-slate-500">- {o.customerName || 'Khách'}</span>
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
                  {cycleLabel(o)}
                </span>
              </div>
              {/* Thanh tiến trình 4 bước */}
              {o.status !== 'CANCELLED' && <FulfillSteps o={o} />}
              {/* Mã vận đơn nổi bật + nút copy */}
              {o.trackingCode && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-blue-50 border border-blue-200">
                  <Truck className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-sm font-extrabold text-blue-900 tracking-wide">{o.trackingCode}</span>
                  <button
                    type="button"
                    onClick={() => copyTracking(o.trackingCode!)}
                    aria-label={`Copy mã vận đơn ${o.trackingCode}`}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold min-h-[32px]"
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] text-slate-500">
                  {Number(o.finalAmount || 0).toLocaleString('vi-VN')}đ · {o.paymentMethod}
                  {o.carrier ? ` · ${o.carrier}` : ''}
                </p>
                {badge && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>
                    HĐ: {badge.text}
                  </span>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                {/* Bước 1: Xác nhận đã đóng gói */}
                {canPack && (
                  <button
                    type="button"
                    disabled={packingId === o.orderSn}
                    onClick={() => packOne(o.orderSn)}
                    aria-label={`Xác nhận đã đóng gói đơn ${o.orderSn}`}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-700 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
                  >
                    <Package className="w-4 h-4" />
                    {packingId === o.orderSn ? 'Đang xác nhận…' : 'Đã đóng gói'}
                  </button>
                )}
                {/* Bước 2: Xếp lịch giao (mở dialog chọn pickup/dropoff) */}
                {canShip && (
                  <button
                    type="button"
                    onClick={() => setShipDialogSn(o.orderSn)}
                    aria-label={`Xếp lịch giao đơn ${o.orderSn}`}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold min-h-[40px]"
                  >
                    <Truck className="w-4 h-4" />
                    Xếp lịch giao
                  </button>
                )}
                {/* Bước 3: In vận đơn (chỉ khi đã có mã) */}
                {canPrint && (
                  <a
                    href={`/api/shopee/awb?orderSn=${encodeURIComponent(o.orderSn)}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`In vận đơn ${o.orderSn}`}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold min-h-[40px]"
                  >
                    <Printer className="w-4 h-4" />
                    In vận đơn{o.awbPrintedAt ? ' lại' : ''}
                  </a>
                )}
                {/* Xác nhận nhận hàng (D1) */}
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
      {shipDialogSn && (
        <ShipDialog
          orderSn={shipDialogSn}
          onClose={() => setShipDialogSn(null)}
          onConfirm={(mode) => shipOne(shipDialogSn, mode)}
          confirming={shippingId === shipDialogSn}
        />
      )}
    </section>
  );
}
