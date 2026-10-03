'use client';

import React, { useEffect, useState } from 'react';
import { ShoppingBag, PlugZap, Truck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { UserRole } from '@/lib/roles';

interface ShopeePanelProps {
  sessionRole: UserRole;
}

interface StatusData {
  uiEnabled: boolean;
  connected: boolean;
  shopId: number | null;
  warehouseId: string | null;
  codEnabled: boolean;
}

interface QueueItem {
  id: string;
  orderSn: string;
  customerName: string;
  finalAmount: number;
  paymentMethod: string;
  carrier: string | null;
  createdAt: string;
}

interface QuarantineItem {
  id: string;
  orderSn: string;
  sku: string;
  reason: string;
  createdAt: string;
}

/**
 * Mục Shopee trong Cài Đặt — ẨN khi cờ server SHOPEE_UI_ENABLED tắt.
 * - Chủ: thẻ kết nối (ủy quyền, kho xuất, cờ COD) + hàng đợi.
 * - Thủ kho/Quản lý: chỉ hàng đợi (đơn cần gói + đơn lỗi).
 */
export function ShopeePanel({ sessionRole }: ShopeePanelProps) {
  const isOwner = sessionRole === 'ROLE_OWNER';
  const [status, setStatus] = useState<StatusData | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [shippingId, setShippingId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = async () => {
    try {
      const st = await fetch('/api/shopee/status').then((r) => r.json());
      if (st?.success) setStatus(st.data);
      if (!st?.data?.uiEnabled) return;
      const q = await fetch('/api/shopee/queue').then((r) => r.json());
      if (q?.success) {
        setQueue(q.data.toPack || []);
        setQuarantine(q.data.quarantine || []);
      }
      if (isOwner) {
        const wh = await fetch('/api/warehouses?all=true').then((r) => r.json());
        if (wh?.success && Array.isArray(wh.data)) setWarehouses(wh.data);
      }
    } catch {
      /* panel ẩn im lặng khi chưa bật cờ */
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status?.uiEnabled) return null;

  const connectShop = async () => {
    try {
      const r = await fetch('/api/shopee/auth-url').then((x) => x.json());
      if (r?.success && r.data?.url) window.location.href = r.data.url;
      else showToast(r?.error || 'Chưa cấu hình key Shopee.');
    } catch {
      showToast('Không lấy được link ủy quyền.');
    }
  };

  const saveConfig = async (patch: { warehouseId?: string; codEnabled?: boolean }) => {
    try {
      const r = await fetch('/api/shopee/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((x) => x.json());
      if (r?.success) {
        setStatus((s) => (s ? { ...s, ...r.data } : s));
        showToast('Đã lưu cấu hình Shopee.');
      } else showToast(r?.error || 'Lưu thất bại.');
    } catch {
      showToast('Lưu thất bại.');
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
        showToast(`Đã giao đơn ${orderSn} — mã vận đơn ${r.data.trackingCode}.`);
        loadAll();
      } else showToast(r?.error || 'Giao hàng thất bại.');
    } catch {
      showToast('Giao hàng thất bại.');
    } finally {
      setShippingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
          {toast}
        </div>
      )}

      {isOwner && (
        <section aria-label="Kết nối gian hàng Shopee" className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-orange-600" />
            Kết Nối Gian Hàng Shopee
          </h3>
          <div className="flex items-center gap-2 text-xs">
            {status.connected ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                <CheckCircle2 className="w-4 h-4" /> Đã nối shop {status.shopId}
              </span>
            ) : (
              <>
                <span className="text-slate-500 font-bold">Chưa nối gian hàng.</span>
                <button
                  type="button"
                  onClick={connectShop}
                  className="px-3 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[44px]"
                >
                  Ủy Quyền Ngay
                </button>
              </>
            )}
          </div>
          <label className="block text-xs font-bold text-slate-600">
            Kho xuất hàng Shopee
            <select
              value={status.warehouseId || ''}
              onChange={(e) => saveConfig({ warehouseId: e.target.value })}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
            >
              <option value="">— Chọn kho —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 min-h-[44px]">
            <input
              type="checkbox"
              checked={status.codEnabled}
              onChange={(e) => saveConfig({ codEnabled: e.target.checked })}
              className="w-5 h-5"
            />
            Cho phép đơn COD (mặc định tắt)
          </label>
        </section>
      )}

      <section aria-label="Đơn Shopee chờ xử lý" className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-indigo-600" />
          Đơn Chờ Gói ({queue.length})
        </h3>
        {queue.length === 0 && <p className="text-xs text-slate-400">Không có đơn nào chờ gói.</p>}
        {queue.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-slate-800 truncate">#{o.orderSn} — {o.customerName}</p>
              <p className="text-[11px] text-slate-500">
                {Number(o.finalAmount || 0).toLocaleString('vi-VN')}đ · {o.paymentMethod} · {o.carrier || '—'}
              </p>
            </div>
            <button
              type="button"
              disabled={shippingId === o.orderSn}
              onClick={() => shipOne(o.orderSn)}
              aria-label={`Giao đơn Shopee ${o.orderSn}`}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50"
            >
              <Truck className="w-4 h-4" />
              {shippingId === o.orderSn ? 'Đang giao…' : 'Giao Hàng'}
            </button>
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
    </div>
  );
}
