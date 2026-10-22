'use client';

import React, { useEffect, useState } from 'react';
import { Store, Scale, RefreshCw } from 'lucide-react';

const vnd = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : Math.round(Number(n)).toLocaleString('vi-VN') + 'đ';

interface PnlData {
  period: string;
  orderCount: number;
  revenue: number;
  fees: { commissionFee: number; transactionFee: number; serviceFee: number; totalFees: number };
  marketing: number;
  withholding: number;
  cogs: number | null;
  netProfit: number | null;
}

interface PayoutRow {
  id: string;
  period: string;
  totalRevenue: number;
  totalFees: number;
  totalMarketing: number;
  totalWithholding: number;
  totalCogs: number | null;
  netProfit: number | null;
  orderCount: number;
  bankStatementAmount: number | null;
  diff: number | null;
  reconciledAt: string | null;
}

function currentPeriod(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function OwnerShopeePnl({ onToast }: { onToast: (m: string) => void }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bankAmount, setBankAmount] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async (p: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/owner/shopee-pnl?period=${encodeURIComponent(p)}`).then((x) => x.json());
      if (r?.success) setPnl(r.data);
      else onToast(r?.error || 'Không tải được P&L Shopee.');
      const q = await fetch('/api/owner/shopee-payouts').then((x) => x.json());
      if (q?.success) setPayouts(q.data || []);
    } catch {
      onToast('Không tải được P&L Shopee.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncEscrow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch('/api/shopee/finance/sync', { method: 'POST' }).then((x) => x.json());
      if (r?.success) {
        onToast(`Đồng bộ escrow xong: ${r.data.synced} đơn, lỗi ${r.data.failed}.`);
        load(period);
      } else onToast(r?.error || 'Đồng bộ escrow thất bại.');
    } catch {
      onToast('Đồng bộ escrow thất bại.');
    } finally {
      setSyncing(false);
    }
  };

  const reconcile = async () => {
    const amt = Number(bankAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      onToast('Nhập số tiền sao kê hợp lệ.');
      return;
    }
    setReconciling(true);
    try {
      const r = await fetch('/api/owner/shopee-payouts/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, bankStatementAmount: amt }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast(
          r.data.matched
            ? `Đối soát khớp: chênh lệch ${vnd(r.data.diff)}.`
            : `Đã lưu. Chênh lệch ${vnd(r.data.diff)} - cần kiểm tra.`
        );
        setBankAmount('');
        load(period);
      } else onToast(r?.error || 'Đối soát thất bại.');
    } catch {
      onToast('Đối soát thất bại.');
    } finally {
      setReconciling(false);
    }
  };

  return (
    <section
      aria-label="P&L Shopee"
      className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <Store className="w-4 h-4 text-orange-600" />
          P&L Shopee theo kỳ (chỉ Chủ xem)
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Chọn kỳ"
            className="px-2 py-2 rounded-xl border border-slate-200 text-xs min-h-[40px]"
          />
          <button
            type="button"
            onClick={syncEscrow}
            disabled={syncing}
            aria-label="Đồng bộ escrow Shopee"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Đang đồng bộ…' : 'Đồng bộ escrow'}
          </button>
          <button
            type="button"
            onClick={() => load(period)}
            disabled={loading}
            aria-label="Xem P&L Shopee"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Xem
          </button>
        </div>
      </div>

      {pnl && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
              <p className="text-[11px] text-emerald-700 font-bold">Doanh thu (escrow)</p>
              <p className="text-lg font-extrabold text-emerald-900">{vnd(pnl.revenue)}</p>
              <p className="text-[10px] text-slate-500">{pnl.orderCount} đơn đã giao</p>
            </div>
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
              <p className="text-[11px] text-amber-700 font-bold">Phí Shopee</p>
              <p className="text-lg font-extrabold text-amber-900">{vnd(pnl.fees.totalFees)}</p>
              <p className="text-[10px] text-slate-500">
                HH {vnd(pnl.fees.commissionFee)} + GD {vnd(pnl.fees.transactionFee)} + DV {vnd(pnl.fees.serviceFee)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-sky-50 border border-sky-100">
              <p className="text-[11px] text-sky-700 font-bold">Marketing đã chi</p>
              <p className="text-lg font-extrabold text-sky-900">{vnd(pnl.marketing)}</p>
              <p className="text-[10px] text-slate-500">voucher shop + giảm giá</p>
            </div>
            <div className="p-4 rounded-xl bg-violet-50 border border-violet-100">
              <p className="text-[11px] text-violet-700 font-bold">Lãi ròng</p>
              <p className="text-lg font-extrabold text-violet-900">{vnd(pnl.netProfit)}</p>
              <p className="text-[10px] text-slate-500">
                sau phí, marketing, COGS {pnl.cogs !== null ? vnd(pnl.cogs) : '(thiếu giá vốn)'}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Thuế khấu trừ tại nguồn: {vnd(pnl.withholding)} (tách riêng, không gộp vào phí sàn).
          </p>
        </>
      )}

      <div className="border-t border-slate-100 pt-4 space-y-3">
        <h4 className="text-xs font-extrabold text-slate-700 flex items-center gap-2">
          <Scale className="w-4 h-4 text-slate-600" />
          Đối soát với sao kê ngân hàng - kỳ {period}
        </h4>
        <div className="flex gap-2 items-end flex-wrap">
          <label className="text-xs text-slate-600">
            Số tiền sao kê
            <input
              type="number"
              min="0"
              value={bankAmount}
              onChange={(e) => setBankAmount(e.target.value)}
              placeholder="Nhập số tiền thực nhận"
              className="ml-2 px-2 py-2 rounded-xl border border-slate-200 text-xs min-h-[40px] w-48"
            />
          </label>
          <button
            type="button"
            onClick={reconcile}
            disabled={reconciling}
            aria-label="Đối soát sao kê"
            className="px-4 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
          >
            {reconciling ? 'Đang đối soát…' : 'Đối soát'}
          </button>
        </div>

        {payouts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-2 font-bold">Kỳ</th>
                  <th className="py-2 pr-2 font-bold text-right">Doanh thu</th>
                  <th className="py-2 pr-2 font-bold text-right">Sao kê</th>
                  <th className="py-2 pr-2 font-bold text-right">Chênh lệch</th>
                  <th className="py-2 font-bold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="py-2 pr-2 font-bold text-slate-800">{p.period}</td>
                    <td className="py-2 pr-2 text-right">{vnd(p.totalRevenue)}</td>
                    <td className="py-2 pr-2 text-right">{vnd(p.bankStatementAmount)}</td>
                    <td
                      className={`py-2 pr-2 text-right font-bold ${
                        p.diff === null ? '' : Math.abs(p.diff) < 1000 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {vnd(p.diff)}
                    </td>
                    <td className="py-2">
                      {p.diff === null ? (
                        <span className="text-slate-400">Chưa đối soát</span>
                      ) : Math.abs(p.diff) < 1000 ? (
                        <span className="text-emerald-700 font-bold">Khớp</span>
                      ) : (
                        <span className="text-rose-700 font-bold">Lệch - cần kiểm tra</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
