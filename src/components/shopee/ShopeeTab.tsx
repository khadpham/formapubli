'use client';

import React, { useEffect, useState } from 'react';
import { ShoppingBag, Truck, Printer, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { UserRole } from '@/lib/roles';

interface QueueOrder {
  id: string;
  orderSn: string;
  customerName: string;
  finalAmount: number;
  paymentMethod: string;
  carrier: string | null;
}

interface QuarantineItem {
  id: string;
  orderSn: string;
  sku: string;
  reason: string;
}

/**
 * Tab Shopee — vận hành đơn trong kho được cấp.
 * Ẩn nút thao tác khi cờ server SHOPEE_UI_ENABLED tắt (giống ShopeePanel).
 * Thẻ doanh thu để link chờ tab Chủ, không gọi escrow ở đây.
 */
export function ShopeeTab({ sessionRole }: { sessionRole: UserRole }) {
  const [uiEnabled, setUiEnabled] = useState(false);
  const [queue, setQueue] = useState<QueueOrder[]>([]);
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
      if (st?.success) setUiEnabled(!!st.data?.uiEnabled);
      if (!st?.data?.uiEnabled) return;
      const q = await fetch('/api/shopee/queue').then((r) => r.json());
      if (q?.success) {
        setQueue(q.data.toPack || []);
        setQuarantine(q.data.quarantine || []);
      }
    } catch {
      /* cờ tắt: tab hiện thông báo chờ, không thao tác */
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shipOne = async (orderSn: string) => {
    setShippingId(orderSn);
    try {
      const r = await fetch('/api/shopee/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderSn }),
      }).then((x) => x.json());
      if (r?.success) {
        showToast(`Đã giao đơn ${orderSn} — mã vận đơn ${r.data.trackingCode}.`);
        loadAll();
      } else showToast(r?.error || 'Giao hàng thất bại.');
    } catch {
      showToast('Giao hàng thất bại.');
    } finally {
      setShippingId(null);
    }
  };

  if (!uiEnabled) {
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
        <p className="text-xs text-slate-500">Tab Shopee đang tắt (chờ quản lý bật).</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
          {toast}
        </div>
      )}

      <section aria-label="Đơn Shopee chờ xử lý" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-orange-600" />
          Đơn Shopee cần gói ({queue.length})
        </h2>
        {queue.length === 0 && <p className="text-xs text-slate-400">Không có đơn nào chờ gói.</p>}
        {queue.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-slate-800 truncate">#{o.orderSn} — {o.customerName}</p>
              <p className="text-[11px] text-slate-500">
                {Number(o.finalAmount || 0).toLocaleString('vi-VN')}đ · {o.paymentMethod} · {o.carrier || '—'}
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

      {quarantine.length > 0 && (
        <section aria-label="Đơn Shopee lỗi chờ xử lý" className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
          <h3 className="text-sm font-extrabold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Đơn Lỗi Cần Xử Lý ({quarantine.length})
          </h3>
          {quarantine.map((q) => (
            <p key={q.id} className="text-xs text-amber-800">
              <span className="font-extrabold">#{q.orderSn}</span> — {q.reason}
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
    </div>
  );
}
