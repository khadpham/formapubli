'use client';

import React, { useEffect, useState } from 'react';
import { LayoutDashboard, AlertTriangle, Package, TrendingUp } from 'lucide-react';

interface ChannelStat {
  channel: string;
  count: number;
  revenue: number;
}

interface QueueStat {
  shippingStatus: string;
  count: number;
}

interface OverviewData {
  todayByChannel: ChannelStat[];
  queues: QueueStat[];
  portalPending: number;
  alerts: {
    token: string | null;
    overdueShip: number;
  };
}

const QUEUE_LABEL: Record<string, string> = {
  CREATED: 'Chờ chuẩn bị',
  PICKED_UP: 'Đã bàn giao VC',
  IN_TRANSIT: 'Đang giao',
};

const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');

export function ShopeeOverviewPanel({ onToast }: { onToast: (m: string) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/shopee/overview').then((x) => x.json());
      if (r?.success) setData(r.data);
      else onToast(r?.error || 'Không tải được tổng quan.');
    } catch {
      onToast('Không tải được tổng quan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shopeeToday = data?.todayByChannel.find((c) => c.channel === 'SHOPEE');
  const portalToday = data?.todayByChannel.find((c) => c.channel === 'ONLINE');
  const totalQueue = (data?.queues || []).reduce((s, q) => s + q.count, 0);

  return (
    <section aria-label="Tổng quan đơn online" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-orange-600" />
          Tổng quan hôm nay
        </h2>
        <button
          type="button"
          disabled={loading}
          onClick={load}
          aria-label="Làm mới tổng quan"
          className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold min-h-[40px] disabled:opacity-50"
        >
          {loading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>

      {/* Cảnh báo */}
      {data?.alerts.token && (
        <p className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-bold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {data.alerts.token}
        </p>
      )}
      {data && data.alerts.overdueShip > 0 && (
        <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-bold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {data.alerts.overdueShip} đơn Shopee quá 2 ngày chưa chuẩn bị - sắp trễ gửi hàng.
        </p>
      )}

      {/* Đơn hôm nay theo kênh */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-xl bg-orange-50 border border-orange-100">
          <p className="text-[11px] text-orange-700 font-bold flex items-center gap-1">
            <Package className="w-3 h-3" />
            Shopee hôm nay
          </p>
          <p className="text-lg font-extrabold text-orange-900">{shopeeToday?.count || 0} đơn</p>
          <p className="text-[11px] text-slate-500">{fmt(shopeeToday?.revenue || 0)}đ</p>
        </div>
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
          <p className="text-[11px] text-blue-700 font-bold flex items-center gap-1">
            <Package className="w-3 h-3" />
            Portal hôm nay
          </p>
          <p className="text-lg font-extrabold text-blue-900">{portalToday?.count || 0} đơn</p>
          <p className="text-[11px] text-slate-500">{fmt(portalToday?.revenue || 0)}đ</p>
        </div>
      </div>

      {/* Hàng đợi xử lý */}
      <div>
        <p className="text-xs font-extrabold text-slate-700 mb-2 flex items-center gap-1">
          <TrendingUp className="w-4 h-4" />
          Hàng đợi xử lý ({totalQueue + (data?.portalPending || 0)} đơn)
        </p>
        <div className="space-y-1.5">
          {(data?.queues || []).map((q) => (
            <div key={q.shippingStatus} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs text-slate-700 font-bold">
                Shopee · {QUEUE_LABEL[q.shippingStatus] || q.shippingStatus}
              </span>
              <span className="text-xs font-extrabold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                {q.count}
              </span>
            </div>
          ))}
          {(data?.portalPending || 0) > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs text-slate-700 font-bold">Portal · Chờ xử lý</span>
              <span className="text-xs font-extrabold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                {data?.portalPending}
              </span>
            </div>
          )}
          {totalQueue === 0 && (data?.portalPending || 0) === 0 && (
            <p className="text-xs text-slate-400">Không có đơn nào đang chờ xử lý.</p>
          )}
        </div>
      </div>
    </section>
  );
}
