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

interface MarginRow {
  channel: 'ONLINE' | 'RETAIL' | 'AGENCY' | 'SHOPEE';
  productId: string | null;
  name: string;
  qty: number;
  revenue: number;
  cogs: number;
  unknownCostQty: number;
  grossProfit: number;
  margin: number | null;
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
  margin?: MarginRow[];
  cashByAccount?: { accountId: string | null; label: string; amount: number; sources: string[] }[];
  agencyPayments?: {
    partnerId: string;
    partnerName: string;
    receivable: number;
    received: number;
    balance: number;
    overdue: number;
    overdueCount: number;
  }[];
  loans?: {
    totalOutstanding: number;
    activeCount: number;
    dueSoon: { id: string; code: string; lender: string; outstanding: number; dueAt: string | null; daysToDue: number | null }[];
    loans: {
      id: string; code: string; lender: string; principal: number;
      paidPrincipal: number; paidInterest: number; outstanding: number;
      dueAt: string | null; status: string; daysToDue: number | null;
    }[];
  };
  periodLock?: { locked: boolean; info: { month: string; lockedBy: string; lockedAt: string | null; note: string | null } | null };
  expenses: {
    total: number;
    byRecurrence: { MONTHLY: number; ONE_TIME: number };
    entries: ExpenseEntry[];
  };
  profitAfterExpenses: number;
}

const CHANNEL_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  RETAIL: 'Bán lẻ',
  AGENCY: 'Đại lý',
  SHOPEE: 'Shopee',
};

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
  const [marginChannel, setMarginChannel] = useState('');
  // Nợ vay — GĐ3-P4.
  const [loanLender, setLoanLender] = useState('');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanBorrowedAt, setLoanBorrowedAt] = useState('');
  const [loanDueAt, setLoanDueAt] = useState('');
  const [loanRate, setLoanRate] = useState('');
  const [savingLoan, setSavingLoan] = useState(false);

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

  const submitLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    const principal = Number(loanPrincipal);
    if (!loanLender.trim()) {
      showToast('Thiếu tên chủ nợ.');
      return;
    }
    if (!Number.isFinite(principal) || principal <= 0) {
      showToast('Số tiền vay phải lớn hơn 0.');
      return;
    }
    if (!loanBorrowedAt) {
      showToast('Thiếu ngày vay.');
      return;
    }
    setSavingLoan(true);
    try {
      const r = await fetch('/api/owner/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lender: loanLender.trim(),
          principal,
          borrowedAt: loanBorrowedAt,
          dueAt: loanDueAt || undefined,
          interestRate: loanRate ? Number(loanRate) : undefined,
        }),
      }).then((x) => x.json());
      if (r?.success) {
        showToast(`Đã ghi nhận vay: ${loanLender.trim()} ${vnd(principal)}.`);
        setLoanLender('');
        setLoanPrincipal('');
        setLoanBorrowedAt('');
        setLoanDueAt('');
        setLoanRate('');
        load(month);
      } else showToast(r?.error || 'Lưu thất bại.');
    } catch {
      showToast('Lưu thất bại.');
    } finally {
      setSavingLoan(false);
    }
  };

  const lockPeriod = async () => {
    if (!confirm(`Khóa sổ kỳ ${month}? Sau khi khóa sẽ không ghi/sửa chi phí trong kỳ này nữa.`)) return;
    const r = await fetch('/api/owner/period-locks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, action: 'lock' }),
    }).then((x) => x.json());
    if (r?.success) { showToast(`Đã khóa sổ kỳ ${month}.`); load(month); }
    else showToast(r?.error || 'Khóa sổ thất bại.');
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
        {!data.periodLock?.locked && (
          <button
            onClick={lockPeriod}
            className="ml-auto px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-600 min-h-[40px]"
            title="Khóa sổ kỳ này sau khi đã quyết toán"
          >
            🔒 Khóa sổ kỳ {month}
          </button>
        )}
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

      {/* Pivot biên lợi nhuận — GĐ3-P3 */}
      {data.margin && data.margin.length > 0 && (
        <section aria-label="Biên lợi nhuận" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-extrabold text-slate-800">Biên lợi nhuận theo kênh × đầu sách — {month}</h3>
            <label className="text-xs font-bold text-slate-600">
              Kênh
              <select
                value={marginChannel}
                onChange={(e) => setMarginChannel(e.target.value)}
                className="ml-2 px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[40px]"
              >
                <option value="">Tất cả</option>
                <option value="ONLINE">Online</option>
                <option value="RETAIL">Bán lẻ</option>
                <option value="AGENCY">Đại lý</option>
                <option value="SHOPEE">Shopee</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-bold">Kênh</th>
                  <th className="py-2 pr-3 font-bold">Đầu sách</th>
                  <th className="py-2 pr-3 font-bold text-right">SL</th>
                  <th className="py-2 pr-3 font-bold text-right">Doanh thu</th>
                  <th className="py-2 pr-3 font-bold text-right">Giá vốn</th>
                  <th className="py-2 pr-3 font-bold text-right">Lãi gộp</th>
                  <th className="py-2 font-bold text-right">Biên gộp</th>
                </tr>
              </thead>
              <tbody>
                {data.margin
                  .filter((r) => !marginChannel || r.channel === marginChannel)
                  .map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-bold text-slate-600">{CHANNEL_LABEL[r.channel] || r.channel}</td>
                      <td className="py-2 pr-3 text-slate-800">{r.name}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{r.qty}</td>
                      <td className="py-2 pr-3 text-right font-bold text-slate-800">{vnd(r.revenue)}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">
                        {r.unknownCostQty !== 0 ? (
                          <span className="text-amber-600 font-bold" title="Chưa có giá vốn đầy đủ">chưa có GV</span>
                        ) : (
                          vnd(r.cogs)
                        )}
                      </td>
                      <td className={`py-2 pr-3 text-right font-bold ${r.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {r.unknownCostQty !== 0 ? '—' : vnd(r.grossProfit)}
                      </td>
                      <td className="py-2 text-right font-bold text-indigo-700">
                        {r.margin === null ? '—' : `${(r.margin * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">
            Đại lý tính theo phiếu xuất (phải thu). Giá vốn FIFO theo lô, phân bổ về từng dòng theo tỷ lệ số lượng.
          </p>
        </section>
      )}

      {/* Dòng tiền theo nơi tiền đang nằm — GĐ3-P3 */}
      {data.cashByAccount && data.cashByAccount.length > 0 && (
        <section aria-label="Dòng tiền theo tài khoản" className="space-y-3">
          <h3 className="text-sm font-extrabold text-slate-700">Tiền đang nằm ở đâu — {month}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.cashByAccount.map((b, i) => (
              <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <p className="text-[11px] text-slate-500 font-bold">{b.label}</p>
                <p className="text-lg font-extrabold text-slate-900">{vnd(b.amount)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{b.sources.join(' · ')}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tiến độ thanh toán đại lý — GĐ3-P3 */}
      {data.agencyPayments && data.agencyPayments.length > 0 && (
        <section aria-label="Tiến độ thanh toán đại lý" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
          <h3 className="text-sm font-extrabold text-slate-800">Tiến độ thanh toán đại lý</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-bold">Đại lý</th>
                  <th className="py-2 pr-3 font-bold text-right">Phải thu</th>
                  <th className="py-2 pr-3 font-bold text-right">Đã thu</th>
                  <th className="py-2 pr-3 font-bold text-right">Còn lại</th>
                  <th className="py-2 font-bold text-right">Quá hạn</th>
                </tr>
              </thead>
              <tbody>
                {data.agencyPayments.map((p) => (
                  <tr key={p.partnerId} className="border-b border-slate-50">
                    <td className="py-2 pr-3 font-bold text-slate-700">{p.partnerName}</td>
                    <td className="py-2 pr-3 text-right text-slate-600">{vnd(p.receivable)}</td>
                    <td className="py-2 pr-3 text-right text-emerald-700 font-bold">{vnd(p.received)}</td>
                    <td className="py-2 pr-3 text-right font-bold text-slate-800">{vnd(p.balance)}</td>
                    <td className="py-2 text-right">
                      {p.overdue > 0 ? (
                        <span className="font-bold text-rose-700">{vnd(p.overdue)} ({p.overdueCount} phiếu)</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Khóa sổ kỳ — GĐ3-P4 */}
      {data.periodLock?.locked && (
        <div role="status" className="p-3 bg-slate-100 border border-slate-300 rounded-2xl text-xs text-slate-700 font-bold flex items-center justify-between gap-2">
          <span>🔒 Kỳ {month} đã khóa sổ{data.periodLock.info?.lockedBy ? ` bởi ${data.periodLock.info.lockedBy}` : ''} — không ghi/sửa chi phí trong kỳ này nữa.</span>
          <button
            onClick={async () => {
              if (!confirm(`Mở khóa sổ kỳ ${month}?`)) return;
              const r = await fetch('/api/owner/period-locks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ month, action: 'unlock' }),
              }).then((x) => x.json());
              if (r?.success) { showToast(`Đã mở khóa kỳ ${month}.`); load(month); }
              else showToast(r?.error || 'Mở khóa thất bại.');
            }}
            className="px-3 py-2 rounded-xl bg-slate-700 text-white text-xs font-bold min-h-[40px]"
          >
            Mở khóa
          </button>
        </div>
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

      {/* Nợ vay — GĐ3-P4 */}
      {data.loans && (
        <section aria-label="Nợ vay" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
          <h3 className="text-sm font-extrabold text-slate-800">
            Nợ vay / Vốn huy động — dư nợ {vnd(data.loans.totalOutstanding)} ({data.loans.activeCount} khoản)
          </h3>

          {data.loans.dueSoon.length > 0 && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 font-bold space-y-1">
              <p>⚠️ Sắp đến hạn:</p>
              {data.loans.dueSoon.map((l) => (
                <p key={l.id}>
                  {l.lender} — {vnd(l.outstanding)} (hạn {l.dueAt}
                  {l.daysToDue !== null && l.daysToDue < 0 ? `, quá ${-l.daysToDue} ngày` : l.daysToDue === 0 ? ', hôm nay' : `, còn ${l.daysToDue} ngày`})
                </p>
              ))}
            </div>
          )}

          {data.loans.loans.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="py-2 pr-3 font-bold">Chủ nợ</th>
                    <th className="py-2 pr-3 font-bold text-right">Vay</th>
                    <th className="py-2 pr-3 font-bold text-right">Đã trả gốc</th>
                    <th className="py-2 pr-3 font-bold text-right">Dư nợ</th>
                    <th className="py-2 pr-3 font-bold">Hạn</th>
                    <th className="py-2 font-bold">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {data.loans.loans.map((l) => (
                    <tr key={l.id} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-bold text-slate-700">{l.lender}<span className="block font-normal text-slate-400">{l.code}</span></td>
                      <td className="py-2 pr-3 text-right text-slate-600">{vnd(l.principal)}</td>
                      <td className="py-2 pr-3 text-right text-emerald-700 font-bold">{vnd(l.paidPrincipal)}</td>
                      <td className="py-2 pr-3 text-right font-bold text-slate-800">{vnd(l.outstanding)}</td>
                      <td className="py-2 pr-3 text-slate-600">{l.dueAt || '—'}</td>
                      <td className="py-2 text-slate-600">{l.status === 'ACTIVE' ? 'Đang vay' : l.status === 'PAID' ? 'Đã trả hết' : 'Đã hủy'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={submitLoan} className="flex flex-wrap items-end gap-2" aria-label="Thêm khoản vay">
            <label className="text-xs font-bold text-slate-600">
              Chủ nợ
              <input type="text" value={loanLender} onChange={(e) => setLoanLender(e.target.value)} placeholder="VD: Anh A"
                className="mt-1 block w-36 px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]" />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Số tiền vay
              <input type="number" min="1" step="1" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} placeholder="VD: 500000000"
                className="mt-1 block w-36 px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]" />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Ngày vay
              <input type="date" value={loanBorrowedAt} onChange={(e) => setLoanBorrowedAt(e.target.value)}
                className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]" />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Kỳ hạn
              <input type="date" value={loanDueAt} onChange={(e) => setLoanDueAt(e.target.value)}
                className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]" />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Lãi suất %/năm
              <input type="number" min="0" step="0.1" value={loanRate} onChange={(e) => setLoanRate(e.target.value)} placeholder="VD: 8"
                className="mt-1 block w-28 px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]" />
            </label>
            <button type="submit" disabled={savingLoan}
              className="px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-bold min-h-[44px] disabled:opacity-50">
              {savingLoan ? 'Đang lưu…' : 'Ghi nhận vay'}
            </button>
          </form>
        </section>
      )}

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
