'use client';

import React, { useEffect, useState } from 'react';
import { Crown, Wallet, ReceiptText, PiggyBank } from 'lucide-react';

interface FinanceData {
  shopee: { orders: number; escrowTotal: number; feeTotal: number; netProfitTotal: number };
  expenses: {
    total: number;
    entries: Array<{ id: string; category: string; amount: number; note: string | null; entryDate: string }>;
  };
  profitAfterExpenses: number;
}

const CATEGORY_LABEL: Record<string, string> = { SALARY: 'Lương', RENT: 'Thuê', OTHER: 'Khác' };
const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

/**
 * Tab Chủ GĐ1: doanh thu Shopee (escrow − phí − COGS) + chi phí ghi tay +
 * lãi ròng sau chi phí. Chỉ ROLE_OWNER (nav + API đều đã chặn).
 */
export function OwnerTab() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [category, setCategory] = useState('OTHER');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    try {
      const j = await fetch('/api/owner/finance').then((r) => r.json());
      if (j?.success) setData(j.data);
    } catch {
      showToast('Không tải được số liệu.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Số tiền phải lớn hơn 0.');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/owner/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, amount: amt, note: note || undefined }),
      }).then((x) => x.json());
      if (r?.success) {
        showToast(`Đã thêm: ${CATEGORY_LABEL[category] || category} ${vnd(amt)}.`);
        setAmount('');
        setNote('');
        load();
      } else showToast(r?.error || 'Lưu thất bại.');
    } catch {
      showToast('Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
        <p className="text-xs text-slate-500">Đang tải số liệu…</p>
      </div>
    );
  }

  const s = data.shopee;

  return (
    <div className="space-y-6">
      {toast && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
          {toast}
        </div>
      )}

      {/* Khối 1: Doanh thu Shopee */}
      <section aria-label="Doanh thu Shopee" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <Crown className="w-5 h-5 text-purple-600" />
          Doanh thu Shopee
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <p className="text-[11px] text-slate-500 font-bold">Đơn đã giao</p>
            <p className="text-lg font-extrabold text-slate-900">{s.orders}</p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
            <p className="text-[11px] text-emerald-700 font-bold">Tiền về (escrow)</p>
            <p className="text-lg font-extrabold text-emerald-800">{vnd(s.escrowTotal)}</p>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-100">
            <p className="text-[11px] text-rose-700 font-bold">Phí sàn</p>
            <p className="text-lg font-extrabold text-rose-800">{vnd(s.feeTotal)}</p>
          </div>
          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100">
            <p className="text-[11px] text-indigo-700 font-bold">Lãi ròng Shopee</p>
            <p className="text-lg font-extrabold text-indigo-800">{vnd(s.netProfitTotal)}</p>
          </div>
        </div>
      </section>

      {/* Khối 3: Lãi ròng sau chi phí */}
      <section aria-label="Lãi ròng sau chi phí" className="p-4 bg-purple-50 border border-purple-200 rounded-2xl">
        <h3 className="text-sm font-extrabold text-purple-900 flex items-center gap-2">
          <PiggyBank className="w-4 h-4" />
          Lãi ròng sau chi phí
        </h3>
        <p className="text-2xl font-black text-purple-900 mt-1">{vnd(data.profitAfterExpenses)}</p>
        <p className="text-[11px] text-purple-700 mt-0.5">Lãi ròng Shopee − tổng chi phí đã ghi.</p>
      </section>

      {/* Khối 2: Chi phí */}
      <section aria-label="Chi phí công ty" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-amber-600" />
          Chi phí ({vnd(data.expenses.total)})
        </h3>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="Thêm chi phí">
          <label className="text-xs font-bold text-slate-600">
            Loại
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
            >
              <option value="SALARY">Lương</option>
              <option value="RENT">Thuê</option>
              <option value="OTHER">Khác</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Số tiền
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ví dụ 5000000"
              className="mt-1 block w-40 px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
            />
          </label>
          <label className="text-xs font-bold text-slate-600 grow">
            Ghi chú
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ lương tháng 10"
              className="mt-1 block w-full px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50"
          >
            {saving ? 'Đang lưu…' : 'Thêm chi phí'}
          </button>
        </form>
        {data.expenses.entries.length === 0 ? (
          <p className="text-xs text-slate-400">Chưa có chi phí nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.expenses.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-xs font-bold text-slate-700">
                  <ReceiptText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                  {e.entryDate} · {CATEGORY_LABEL[e.category] || e.category}
                  {e.note ? ` — ${e.note}` : ''}
                </span>
                <span className="text-xs font-extrabold text-rose-700">{vnd(e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
