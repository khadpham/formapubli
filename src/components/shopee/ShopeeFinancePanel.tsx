'use client';

import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, TrendingUp } from 'lucide-react';

interface FinanceDetail {
  orderSn: string;
  buyerTotal: number;
  escrowAmount: number;
  commissionFee: number;
  transactionFee: number;
  serviceFee: number;
  totalFee: number;
  withholdingVat: number;
  withholdingPit: number;
  withholdingCit: number;
  totalWithholding: number;
  cogs: number | null;
  netProfit: number | null;
  syncedAt: string;
}

interface FinanceSummary {
  totalEscrow: number;
  totalFee: number;
  totalWithholding: number;
  totalNet: number;
  orderCount: number;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');

export function ShopeeFinancePanel({ onToast }: { onToast: (m: string) => void }) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [details, setDetails] = useState<FinanceDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/shopee/finance?from=${from}&to=${to}`).then((x) => x.json());
      if (r?.success) {
        setSummary(r.data.summary);
        setDetails(r.data.details || []);
      } else onToast(r?.error || 'Không tải được dữ liệu tài chính.');
    } catch {
      onToast('Không tải được dữ liệu tài chính.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncEscrow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch('/api/shopee/finance/sync', { method: 'POST' }).then((x) => x.json());
      if (r?.success) {
        onToast(`Đồng bộ escrow xong: ${r.data.synced} đơn, lỗi ${r.data.failed}.`);
        load();
      } else onToast(r?.error || 'Đồng bộ escrow thất bại.');
    } catch {
      onToast('Đồng bộ escrow thất bại.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section aria-label="Tài chính Shopee" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <Wallet className="w-5 h-5 text-orange-600" />
          Tài chính Shopee
        </h2>
        <button
          type="button"
          disabled={syncing}
          onClick={syncEscrow}
          aria-label="Đồng bộ escrow Shopee"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Đang đồng bộ…' : 'Đồng bộ escrow'}
        </button>
      </div>

      <div className="flex gap-2 items-end flex-wrap">
        <label className="text-xs text-slate-600">
          Từ ngày
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="ml-2 px-2 py-2 rounded-xl border border-slate-200 text-xs min-h-[40px]"
          />
        </label>
        <label className="text-xs text-slate-600">
          Đến ngày
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="ml-2 px-2 py-2 rounded-xl border border-slate-200 text-xs min-h-[40px]"
          />
        </label>
        <button
          type="button"
          onClick={load}
          aria-label="Xem tài chính"
          className="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold min-h-[40px]"
        >
          Xem
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
            <p className="text-[11px] text-emerald-700 font-bold">Thực nhận (escrow)</p>
            <p className="text-lg font-extrabold text-emerald-900">{fmt(summary.totalEscrow)}đ</p>
            <p className="text-[10px] text-slate-500">{summary.orderCount} đơn</p>
          </div>
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
            <p className="text-[11px] text-amber-700 font-bold">Phí Shopee</p>
            <p className="text-lg font-extrabold text-amber-900">{fmt(summary.totalFee)}đ</p>
            <p className="text-[10px] text-slate-500">hoa hồng + giao dịch + DV</p>
          </div>
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
            <p className="text-[11px] text-blue-700 font-bold">Thuế khấu trừ</p>
            <p className="text-lg font-extrabold text-blue-900">{fmt(summary.totalWithholding)}đ</p>
            <p className="text-[10px] text-slate-500">VAT + TNCN + TNDN</p>
          </div>
          <div className="p-4 rounded-xl bg-violet-50 border border-violet-100">
            <p className="text-[11px] text-violet-700 font-bold flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              Lãi ròng (sau COGS)
            </p>
            <p className="text-lg font-extrabold text-violet-900">{fmt(summary.totalNet)}đ</p>
            <p className="text-[10px] text-slate-500">escrow - giá vốn</p>
          </div>
        </div>
      )}

      {loading && <p className="text-xs text-slate-400">Đang tải…</p>}
      {!loading && details.length === 0 && (
        <p className="text-xs text-slate-400">
          Chưa có dữ liệu đối soát. Bấm "Đồng bộ escrow" để kéo số liệu các đơn đã giao.
        </p>
      )}
      {details.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-2 font-bold">Mã đơn</th>
                <th className="py-2 pr-2 font-bold text-right">Khách trả</th>
                <th className="py-2 pr-2 font-bold text-right">Thực nhận</th>
                <th className="py-2 pr-2 font-bold text-right">Phí sàn</th>
                <th className="py-2 pr-2 font-bold text-right">Thuế KT</th>
                <th className="py-2 font-bold text-right">Lãi ròng</th>
              </tr>
            </thead>
            <tbody>
              {details.map((d) => (
                <tr key={d.orderSn} className="border-b border-slate-50">
                  <td className="py-2 pr-2 font-bold text-slate-800">#{d.orderSn}</td>
                  <td className="py-2 pr-2 text-right">{fmt(d.buyerTotal)}đ</td>
                  <td className="py-2 pr-2 text-right text-emerald-700 font-bold">{fmt(d.escrowAmount)}đ</td>
                  <td className="py-2 pr-2 text-right text-amber-700">{fmt(d.totalFee)}đ</td>
                  <td className="py-2 pr-2 text-right text-blue-700">{fmt(d.totalWithholding)}đ</td>
                  <td className="py-2 text-right font-bold text-violet-800">
                    {d.netProfit === null ? '-' : `${fmt(d.netProfit)}đ`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Chi tiết lãi/lỗ theo đầu sách xem ở tab Chủ.
      </p>
    </section>
  );
}
