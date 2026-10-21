'use client';

import React, { useEffect, useState } from 'react';
import { ShoppingBag, Truck, Printer, AlertTriangle, CheckCircle2, RefreshCw, Store } from 'lucide-react';
import type { UserRole } from '@/lib/roles';
import { PortalOrdersPanel } from './PortalOrdersPanel';

interface QueueOrder {
  id: string;
  orderSn: string;
  customerName: string;
  finalAmount: number;
  paymentMethod: string;
  carrier: string | null;
}

interface ConfirmOrder {
  id: string;
  orderSn: string;
  customerName: string;
  finalAmount: number;
  trackingCode: string | null;
}

interface QuarantineItem {
  id: string;
  orderSn: string;
  sku: string;
  reason: string;
}

/**
 * Tab Shopee - vận hành đơn trong kho được cấp.
 * Ẩn nút thao tác khi cờ server SHOPEE_UI_ENABLED tắt (giống ShopeePanel).
 * Thẻ doanh thu để link chờ tab Chủ, không gọi escrow ở đây.
 */
interface ShopeeStatus {
  connected: boolean;
  shopId: number | null;
  warehouseId: string | null;
  codEnabled: boolean;
}

export function ShopeeTab({ sessionRole }: { sessionRole: UserRole }) {
  const [status, setStatus] = useState<ShopeeStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [uiEnabled, setUiEnabled] = useState(false);
  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [toConfirm, setToConfirm] = useState<ConfirmOrder[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [shippingId, setShippingId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = async () => {
    try {
      const st = await fetch('/api/shopee/status').then((r) => r.json());
      if (st?.success) {
        setUiEnabled(!!st.data?.uiEnabled);
        setStatus({
          connected: !!st.data?.connected,
          shopId: st.data?.shopId ?? null,
          warehouseId: st.data?.warehouseId ?? null,
          codEnabled: !!st.data?.codEnabled,
        });
      }
      if (!st?.data?.uiEnabled) return;
      const q = await fetch('/api/shopee/queue').then((r) => r.json());
      if (q?.success) {
        setQueue(q.data.toPack || []);
        setToConfirm(q.data.toConfirm || []);
        setQuarantine(q.data.quarantine || []);
      }
    } catch {
      /* cờ tắt: tab hiện thông báo chờ, không thao tác */
    }
  };

  useEffect(() => {
    loadAll();
    // Sau ủy quyền Shopee, callback redirect về /?shopee=ok - đón cờ để báo
    // thành công rồi xóa khỏi URL cho sạch (tránh F5 hiện lại).
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('shopee') === 'ok') {
        showToast('Đã kết nối gian hàng Shopee thành công.');
        sp.delete('shopee');
        const qs = sp.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
        loadAll();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectShop = async () => {
    try {
      const r = await fetch('/api/shopee/auth-url').then((x) => x.json());
      if (r?.success && r.data?.url) window.location.href = r.data.url;
      else showToast(r?.error || 'Chưa cấu hình key Shopee.');
    } catch {
      showToast('Không lấy được link ủy quyền.');
    }
  };

  const syncNow = async () => {    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch('/api/shopee/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 24 }),
      }).then((x) => x.json());
      if (r?.success) {
        const d = r.data;
        showToast(`Đồng bộ xong: ${d.pulled} đơn mới, bỏ qua ${d.skipped}${d.quarantined?.length ? `, ${d.quarantined.length} đơn lỗi` : ''}.`);
        loadAll();
      } else showToast(r?.error || 'Đồng bộ thất bại.');
    } catch {
      showToast('Đồng bộ thất bại.');
    } finally {
      setSyncing(false);
    }
  };

  const confirmDelivery = async (o: ConfirmOrder) => {
    setConfirmingId(o.id);
    try {
      const r = await fetch(`/api/orders/${o.id}/confirm-delivery`, { method: 'POST' }).then((x) => x.json());
      if (r?.ok) {
        showToast(`Đã xác nhận khách nhận hàng - đơn ${o.orderSn}. Hóa đơn giờ đã phát hành được.`);
        loadAll();
      } else showToast(r?.error || 'Xác nhận thất bại.');
    } catch {
      showToast('Xác nhận thất bại.');
    } finally {
      setConfirmingId(null);
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
        showToast(
          r.data?.trackingPending
            ? `Đã xếp lịch giao đơn ${orderSn} - mã vận đơn đang chờ Shopee cấp.`
            : `Đã giao đơn ${orderSn} - mã vận đơn ${r.data.trackingCode}.`
        );
        loadAll();
      } else showToast(r?.error || 'Giao hàng thất bại.');
    } catch {
      showToast('Giao hàng thất bại.');
    } finally {
      setShippingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
          {toast}
        </div>
      )}

      {/* Đơn online portal cần soạn cho thủ kho */}
      <PortalOrdersPanel currentRole={sessionRole} />

      {!uiEnabled ? (
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm text-xs text-slate-500">
          Tính năng đồng bộ sàn Shopee đang tắt (chờ quản lý bật).
        </div>
      ) : (
        <>
          <section aria-label="Kết nối Shopee" className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Store className="w-5 h-5 text-orange-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-slate-800">
                  {status?.connected ? `Đã kết nối shop Shopee #${status.shopId}` : 'Chưa kết nối shop Shopee'}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  Kho xuất: {status?.warehouseId || 'chưa cấu hình'} · COD: {status?.codEnabled ? 'bật' : 'tắt'}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={syncing}
              onClick={syncNow}
              aria-label="Đồng bộ đơn Shopee ngay"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
            </button>
            {!status?.connected && sessionRole === 'ROLE_OWNER' && (
              <button
                type="button"
                onClick={connectShop}
                aria-label="Kết nối gian hàng Shopee"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-orange-600 text-orange-700 text-xs font-bold min-h-[44px] shrink-0"
              >
                <Store className="w-4 h-4" />
                Kết nối gian hàng
              </button>
            )}
          </section>
          <section aria-label="Đơn Shopee chờ xử lý" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-orange-600" />
          Đơn Shopee cần gói ({queue.length})
        </h2>
        {queue.length === 0 && <p className="text-xs text-slate-400">Không có đơn nào chờ gói.</p>}
        {queue.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-slate-800 truncate">#{o.orderSn} - {o.customerName}</p>
              <p className="text-[11px] text-slate-500">
                {Number(o.finalAmount || 0).toLocaleString('vi-VN')}đ · {o.paymentMethod} · {o.carrier || '-'}
              </p>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                disabled={shippingId === o.orderSn}
                onClick={() => shipOne(o.orderSn)}
                aria-label={`Giao đơn Shopee ${o.orderSn}`}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50"
              >
                <Truck className="w-4 h-4" />
                {shippingId === o.orderSn ? 'Đang giao…' : 'Giao Hàng'}
              </button>
              <a
                href={`/api/shopee/awb?orderSn=${encodeURIComponent(o.orderSn)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`In vận đơn ${o.orderSn}`}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold min-h-[44px]"
              >
                <Printer className="w-4 h-4" />
                In vận đơn
              </a>
            </div>
          </div>
        ))}
      </section>

      {toConfirm.length > 0 && (
        <section aria-label="Chờ xác nhận khách nhận hàng" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            Chờ xác nhận khách nhận hàng ({toConfirm.length})
          </h2>
          <p className="text-[11px] text-slate-500">
            Hóa đơn của các đơn này chỉ phát hành sau khi xác nhận khách đã nhận hàng. Bấm xác nhận khi đơn vị vận chuyển báo đã giao thành công.
          </p>
          {toConfirm.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-slate-800 truncate">#{o.orderSn} - {o.customerName}</p>
                <p className="text-[11px] text-slate-500">
                  {Number(o.finalAmount || 0).toLocaleString('vi-VN')}đ · Vận đơn {o.trackingCode || '-'}
                </p>
              </div>
              <button
                type="button"
                disabled={confirmingId === o.id}
                onClick={() => confirmDelivery(o)}
                aria-label={`Xác nhận khách đã nhận hàng đơn ${o.orderSn}`}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {confirmingId === o.id ? 'Đang xác nhận…' : 'Đã nhận hàng'}
              </button>
            </div>
          ))}
        </section>
      )}

      {quarantine.length > 0 && (
        <section aria-label="Đơn Shopee lỗi chờ xử lý" className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
          <h3 className="text-sm font-extrabold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Đơn Lỗi Cần Xử Lý ({quarantine.length})
          </h3>
          {quarantine.map((q) => (
            <p key={q.id} className="text-xs text-amber-800">
              <span className="font-extrabold">#{q.orderSn}</span> - {q.reason}
              {q.sku ? ` (SKU: ${q.sku})` : ''}
            </p>
          ))}
        </section>
      )}

      <section aria-label="Doanh thu Shopee" className="p-4 bg-white border border-slate-200 rounded-2xl">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          Doanh Thu Shopee
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Số đối soát phí sàn xem ở tab Chủ sau (đơn chỉ tính khi đã giao).
        </p>
      </section>
        </>
      )}
    </div>
  );
}
