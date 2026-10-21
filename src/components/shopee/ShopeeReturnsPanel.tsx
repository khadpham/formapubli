'use client';

import React, { useEffect, useState } from 'react';
import { RotateCcw, RefreshCw } from 'lucide-react';

interface ReturnItem {
  returnSn: string;
  orderSn: string;
  status: string;
  statusLabel: string;
  reason: string | null;
  refundAmount: number;
  buyerUsername: string | null;
  sellerDueDate: number | null;
  createdAt: string;
}

export function ShopeeReturnsPanel({ onToast }: { onToast: (m: string) => void }) {
  const [items, setItems] = useState<ReturnItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/shopee/returns').then((x) => x.json());
      if (r?.success) {
        setItems(r.data || []);
        setLoaded(true);
      }
    } catch {
      /* giữ dữ liệu cũ */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/shopee/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 72 }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast(`Đồng bộ trả hàng xong: ${r.data.pulled} mới, ${r.data.updated} cập nhật.`);
        load();
      } else onToast(r?.error || 'Đồng bộ thất bại.');
    } catch {
      onToast('Đồng bộ thất bại.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section aria-label="Trả hàng Shopee" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-orange-600" />
          Trả hàng / Hoàn tiền
          {loaded && items.length > 0 && (
            <span className="text-xs font-bold text-slate-500">({items.length})</span>
          )}
        </h2>
        <button
          type="button"
          disabled={syncing}
          onClick={syncNow}
          aria-label="Đồng bộ trả hàng"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Đang đồng bộ…' : 'Đồng bộ'}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Yêu cầu trả hàng từ Shopee. Xử lý trên Seller Center theo deadline, ERP theo dõi trạng thái.
      </p>
      {loading && !loaded && <p className="text-xs text-slate-400">Đang tải…</p>}
      {loaded && items.length === 0 && (
        <p className="text-xs text-slate-400">Chưa có yêu cầu trả hàng nào.</p>
      )}
      <div className="space-y-2">
        {items.map((r) => (
          <div key={r.returnSn} className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-extrabold text-slate-800">
                #{r.returnSn}
                <span className="font-normal text-slate-500"> - Đơn {r.orderSn}</span>
              </p>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                r.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800'
                : r.status === 'CANCELLED' ? 'bg-slate-200 text-slate-600'
                : 'bg-amber-100 text-amber-800'
              }`}>
                {r.statusLabel}
              </span>
            </div>
            {r.reason && <p className="text-[11px] text-slate-600">Lý do: {r.reason}</p>}
            <p className="text-[11px] text-slate-500">
              Hoàn: {Number(r.refundAmount || 0).toLocaleString('vi-VN')}đ
              {r.buyerUsername ? ` · Khách: ${r.buyerUsername}` : ''}
              {r.sellerDueDate ? ` · Hạn xử lý: ${new Date(r.sellerDueDate * 1000).toLocaleDateString('vi-VN')}` : ''}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
