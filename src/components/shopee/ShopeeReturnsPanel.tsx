'use client';

import React, { useEffect, useState } from 'react';
import { RotateCcw, RefreshCw, Ban, PackageX } from 'lucide-react';

type FlowType = 'CANCELLATION' | 'RETURN_REFUND' | 'FAILED_DELIVERY';

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

interface CancelItem {
  orderSn: string;
  orderCode: string;
  shippingStatus: string;
  trackingCode: string | null;
  finalAmount: number;
  createdAt: string;
  packedAt: string | null;
  needHold: boolean;
}

const TABS: Array<{ id: FlowType; label: string; icon: React.ReactNode; color: string; desc: string }> = [
  {
    id: 'CANCELLATION',
    label: 'Hủy đơn',
    icon: <Ban className="w-4 h-4" />,
    color: 'slate',
    desc: 'Đơn bị hủy trước khi giao hàng. Không có mã yêu cầu riêng.',
  },
  {
    id: 'RETURN_REFUND',
    label: 'Trả hàng / Hoàn tiền',
    icon: <RotateCcw className="w-4 h-4" />,
    color: 'orange',
    desc: 'Khách đã nhận hàng và yêu cầu trả lại. Có mã yêu cầu riêng, xử lý theo deadline.',
  },
  {
    id: 'FAILED_DELIVERY',
    label: 'Giao thất bại',
    icon: <PackageX className="w-4 h-4" />,
    color: 'red',
    desc: 'ĐVVC giao thất bại, kiện hàng đang hoàn về kho.',
  },
];

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  ACCEPTED: 'Đã chấp nhận',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};

function dueText(ts: number | null): string {
  if (!ts) return '';
  const days = Math.ceil((ts * 1000 - Date.now()) / 86400000);
  if (days < 0) return 'Quá hạn';
  if (days === 0) return 'Hết hạn hôm nay';
  return `Còn ${days} ngày`;
}

export function ShopeeReturnsPanel({ onToast }: { onToast: (m: string) => void }) {
  const [tab, setTab] = useState<FlowType>('RETURN_REFUND');
  const [returns, setReturns] = useState<ReturnItem[]>([]);
  const [cancels, setCancels] = useState<CancelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = async (t: FlowType) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/shopee/returns?type=${t}`).then((x) => x.json());
      if (r?.success) {
        if (t === 'CANCELLATION') setCancels(r.data || []);
        else setReturns(r.data || []);
        setLoaded(true);
      } else setError(r?.error || 'Tải dữ liệu thất bại.');
    } catch {
      setError('Tải dữ liệu thất bại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/shopee/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 72 }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast(`Đồng bộ xong: ${r.data.pulled} mới, ${r.data.updated} cập nhật.`);
        load(tab);
      } else onToast(r?.error || 'Đồng bộ thất bại.');
    } catch {
      onToast('Đồng bộ thất bại.');
    } finally {
      setSyncing(false);
    }
  };

  const activeTab = TABS.find((t) => t.id === tab)!;
  const items = tab === 'CANCELLATION' ? cancels : returns;

  return (
    <section aria-label="Trả hàng Shopee" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-orange-600" />
          Trả hàng / Hủy đơn
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

      {/* 3 tab luồng */}
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Luồng xử lý">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold min-h-[44px] border transition-colors ${
              tab === t.id
                ? t.color === 'slate'
                  ? 'bg-slate-700 text-white border-slate-700'
                  : t.color === 'red'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-orange-600 text-white border-orange-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">{activeTab.desc}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {loading && !loaded && <p className="text-xs text-slate-400">Đang tải…</p>}
      {loaded && items.length === 0 && (
        <p className="text-xs text-slate-400">Chưa có dữ liệu.</p>
      )}

      <div className="space-y-2">
        {tab === 'CANCELLATION'
          ? (cancels as CancelItem[]).map((c) => (
              <div key={c.orderCode} className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-extrabold text-slate-800">
                    {c.orderCode}
                    <span className="font-normal text-slate-500"> - Shopee {c.orderSn}</span>
                  </p>
                  <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                    Đã hủy
                  </span>
                </div>
                {c.needHold && (
                  <p className="text-[11px] font-bold text-red-600">
                    KHÔNG bàn giao kiện hàng này - mã vận đơn {c.trackingCode}
                  </p>
                )}
                <p className="text-[11px] text-slate-500">
                  {Number(c.finalAmount || 0).toLocaleString('vi-VN')}đ
                  {c.packedAt ? ' · Đã đóng gói' : ' · Chưa đóng gói'}
                  {c.trackingCode ? ` · Vận đơn: ${c.trackingCode}` : ''}
                </p>
              </div>
            ))
          : (returns as ReturnItem[]).map((r) => (
              <div
                key={r.returnSn}
                className={`p-3 rounded-xl border space-y-1 ${
                  tab === 'FAILED_DELIVERY' ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-extrabold text-slate-800">
                    #{r.returnSn}
                    <span className="font-normal text-slate-500"> - Đơn {r.orderSn}</span>
                  </p>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      r.status === 'COMPLETED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : r.status === 'CANCELLED'
                          ? 'bg-slate-200 text-slate-600'
                          : tab === 'FAILED_DELIVERY'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {r.statusLabel || STATUS_LABEL[r.status] || r.status}
                  </span>
                </div>
                {r.reason && <p className="text-[11px] text-slate-600">Lý do: {r.reason}</p>}
                <p className="text-[11px] text-slate-500">
                  Hoàn: {Number(r.refundAmount || 0).toLocaleString('vi-VN')}đ
                  {r.buyerUsername ? ` · Khách: ${r.buyerUsername}` : ''}
                  {r.sellerDueDate ? (
                    <span className="font-bold text-red-600"> · {dueText(r.sellerDueDate)}</span>
                  ) : (
                    ''
                  )}
                </p>
              </div>
            ))}
      </div>
    </section>
  );
}
