'use client';

import React, { useEffect, useState } from 'react';
import { Crown, Wallet, ReceiptText, PiggyBank, Pencil } from 'lucide-react';

interface ExpenseEntry {
  id: string;
  category: string;
  amount: number;
  note: string | null;
  entryDate: string;
  staffId: string | null;
  recurrence: string;
}

interface FinanceData {
  month: string;
  shopee: { orders: number; escrowTotal: number; feeTotal: number; netProfitTotal: number };
  channels?: {
    agency: { orders: number; receivable: number; received: number; balance: number };
    online: { orders: number; revenue: number };
    retail: { orders: number; revenue: number; cash: number; bankQr: number };
  };
  totals?: { cashCollected: number };
  expenses: {
    total: number;
    byRecurrence: { MONTHLY: number; ONE_TIME: number };
    entries: ExpenseEntry[];
  };
  profitAfterExpenses: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  SALARY: 'Lương',
  BONUS: 'Thưởng',
  RENT_LOCATION: 'Thuê địa điểm',
  UTILITIES: 'Điện nước–Mạng',
  EQUIPMENT: 'Thiết bị',
  OPERATIONS: 'Vận hành',
  OTHER: 'Khác',
};
const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

function vnMonthNow(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 7);
}

/**
 * Tab Chủ GĐ2: doanh thu Shopee + chi phí đầy đủ (7 loại × Định kỳ/Phát sinh,
 * sửa có audit, lương gắn nhân viên) + Lãi ròng sau chi phí theo tháng.
 * Chỉ ROLE_OWNER (nav + API đều đã chặn).
 */
export function OwnerTab() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [month, setMonth] = useState(vnMonthNow());
  const [category, setCategory] = useState('OTHER');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [staffId, setStaffId] = useState('');
  const [recurrence, setRecurrence] = useState('ONE_TIME');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editNote, setEditNote] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async (m: string) => {
    try {
      const j = await fetch(`/api/owner/finance?month=${encodeURIComponent(m)}`).then((r) => r.json());
      if (j?.success) setData(j.data);
      else showToast(j?.error || 'Không tải được số liệu.');
    } catch {
      showToast('Không tải được số liệu.');
    }
  };

  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Số tiền phải lớn hơn 0.');
      return;
    }
    if ((category === 'SALARY' || category === 'BONUS') && !staffId) {
      showToast('Lương/Thưởng phải chọn nhân viên.');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/owner/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          amount: amt,
          note: note || undefined,
          staffId: staffId || undefined,
          recurrence,
          entryDate: `${month}-01`,
        }),
      }).then((x) => x.json());
      if (r?.success) {
        showToast(`Đã thêm: ${CATEGORY_LABEL[category] || category} ${vnd(amt)}.`);
        setAmount('');
        setNote('');
        load(month);
      } else showToast(r?.error || 'Lưu thất bại.');
    } catch {
      showToast('Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    const amt = Number(editAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Số tiền phải lớn hơn 0.');
      return;
    }
    try {
      const r = await fetch(`/api/owner/finance/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, note: editNote || null }),
      }).then((x) => x.json());
      if (r?.success) {
        showToast('Đã sửa chi phí.');
        setEditingId(null);
        load(month);
      } else showToast(r?.error || 'Sửa thất bại.');
    } catch {
      showToast('Sửa thất bại.');
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

  // Nhóm chi phí theo loại (7 nhóm, tổng từng nhóm).
  const byCategory = new Map<string, { total: number; count: number }>();
  for (const e of data.expenses.entries) {
    const cur = byCategory.get(e.category) || { total: 0, count: 0 };
    byCategory.set(e.category, { total: cur.total + e.amount, count: cur.count + 1 });
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
          {toast}
        </div>
      )}

      {/* Bộ chọn tháng */}
      <div className="flex items-center gap-3 bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm">
        <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <Crown className="w-4 h-4 text-purple-600" />
          Kỳ xem:
        </h2>
        <label className="text-xs font-bold text-slate-600">
          Tháng
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || vnMonthNow())}
            className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[40px]"
          />
        </label>
        <span className="text-[11px] text-slate-400">Số theo tháng VN đã chọn.</span>
      </div>

      {/* Doanh thu theo kênh — GĐ3-P1 (chưa có giá vốn/biên) */}
      {data.channels && (
        <section aria-label="Doanh thu theo kênh" className="space-y-3">
          <h3 className="text-sm font-extrabold text-slate-700">
            Doanh thu theo kênh — {month} · Thực thu {vnd(data.totals?.cashCollected ?? 0)}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
              <p className="text-[11px] text-blue-700 font-bold">Đại lý — thực thu</p>
              <p className="text-lg font-extrabold text-blue-900">{vnd(data.channels.agency.received)}</p>
              <p className="text-[11px] text-blue-600 mt-0.5">
                Phải thu {vnd(data.channels.agency.receivable)} · Còn lại {vnd(data.channels.agency.balance)} · {data.channels.agency.orders} phiếu
              </p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
              <p className="text-[11px] text-amber-700 font-bold">Online</p>
              <p className="text-lg font-extrabold text-amber-900">{vnd(data.channels.online.revenue)}</p>
              <p className="text-[11px] text-amber-600 mt-0.5">{data.channels.online.orders} đơn</p>
            </div>
            <div className="p-3 rounded-xl bg-teal-50 border border-teal-100">
              <p className="text-[11px] text-teal-700 font-bold">Bán lẻ (POS)</p>
              <p className="text-lg font-extrabold text-teal-900">{vnd(data.channels.retail.revenue)}</p>
              <p className="text-[11px] text-teal-600 mt-0.5">
                Tiền mặt {vnd(data.channels.retail.cash)} · CK/QR {vnd(data.channels.retail.bankQr)} · {data.channels.retail.orders} đơn
              </p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100">
              <p className="text-[11px] text-indigo-700 font-bold">Shopee — tiền về</p>
              <p className="text-lg font-extrabold text-indigo-900">{vnd(s.escrowTotal)}</p>
              <p className="text-[11px] text-indigo-600 mt-0.5">{s.orders} đơn đã giao</p>
            </div>
          </div>
        </section>
      )}

      {/* Hàng 4 thẻ theo kỳ */}
      <section aria-label="Doanh thu Shopee" className="space-y-3">
        <h3 className="text-sm font-extrabold text-slate-700">Doanh thu Shopee — {month}</h3>
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

      {/* Thẻ Lãi ròng sau chi phí */}
      <section aria-label="Lãi ròng sau chi phí" className="p-4 bg-purple-50 border border-purple-200 rounded-2xl">
        <h3 className="text-sm font-extrabold text-purple-900 flex items-center gap-2">
          <PiggyBank className="w-4 h-4" />
          Lãi ròng sau chi phí — {month}
        </h3>
        <p className="text-2xl font-black text-purple-900 mt-1">{vnd(data.profitAfterExpenses)}</p>
        <p className="text-[11px] text-purple-700 mt-0.5">
          Lãi ròng Shopee − chi phí {vnd(data.expenses.total)} (Định kỳ {vnd(data.expenses.byRecurrence.MONTHLY)} · Phát sinh {vnd(data.expenses.byRecurrence.ONE_TIME)}).
        </p>
      </section>

      {/* Bảng chi phí */}
      <section aria-label="Chi phí công ty" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-amber-600" />
          Chi phí — {month} ({vnd(data.expenses.total)})
        </h3>

        <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="Thêm chi phí">
          <label className="text-xs font-bold text-slate-600">
            Loại
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
            >
              {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Nhân viên
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              disabled={category !== 'SALARY' && category !== 'BONUS'}
              className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px] disabled:opacity-50"
            >
              <option value="">—</option>
              {['ADMIN-01', 'QL-01', 'NV-01', 'NV-02', 'NV-03', 'NV-04', 'KHO-01', 'SHP-01'].map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            Kỳ
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
            >
              <option value="ONE_TIME">Phát sinh một lần</option>
              <option value="MONTHLY">Định kỳ hàng tháng</option>
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
              className="mt-1 block w-36 px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
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

        {/* Nhóm theo loại */}
        {byCategory.size === 0 ? (
          <p className="text-xs text-slate-400">Chưa có chi phí nào trong kỳ.</p>
        ) : (
          <div className="space-y-4">
            {Array.from(byCategory.entries()).map(([cat, agg]) => (
              <div key={cat} className="rounded-xl border border-slate-100 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                  <span className="text-xs font-extrabold text-slate-700">
                    {CATEGORY_LABEL[cat] || cat} ({agg.count})
                  </span>
                  <span className="text-xs font-extrabold text-rose-700">{vnd(agg.total)}</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {data.expenses.entries.filter((e) => e.category === cat).map((e) => (
                    <li key={e.id} className="px-3 py-2 space-y-1">
                      {editingId === e.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editAmount}
                            onChange={(ev) => setEditAmount(ev.target.value)}
                            aria-label="Sửa số tiền"
                            className="w-32 px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
                          />
                          <input
                            type="text"
                            value={editNote}
                            onChange={(ev) => setEditNote(ev.target.value)}
                            placeholder="Ghi chú"
                            aria-label="Sửa ghi chú"
                            className="grow px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => saveEdit(e.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold"
                          >
                            Lưu
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-xs font-bold"
                          >
                            Bỏ
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-700">
                            <ReceiptText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                            {e.entryDate}
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold border ${e.recurrence === 'MONTHLY' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                              {e.recurrence === 'MONTHLY' ? 'Định kỳ' : 'Phát sinh'}
                            </span>
                            {e.staffId ? <span className="ml-1 text-slate-500">· {e.staffId}</span> : null}
                            {e.note ? ` — ${e.note}` : ''}
                          </span>
                          <span className="shrink-0 flex items-center gap-2">
                            <span className="text-xs font-extrabold text-rose-700">{vnd(e.amount)}</span>
                            <button
                              type="button"
                              onClick={() => { setEditingId(e.id); setEditAmount(String(e.amount)); setEditNote(e.note || ''); }}
                              aria-label={`Sửa chi phí ${e.entryDate} ${CATEGORY_LABEL[cat] || cat}`}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
