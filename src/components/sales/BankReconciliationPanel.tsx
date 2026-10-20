'use client';

import React, { useState } from 'react';
import { Landmark, Upload, Check, X, Hand } from 'lucide-react';
import { UserRole } from '@/lib/roles';

interface MatchInfo {
  confidence: string;
  matchType: string;
  note: string | null;
  orderCode: string | null;
  orderAmount: number | null;
}

interface StatementItem {
  id: string;
  ngayGiaoDich: string;
  phatSinhNo: number;
  phatSinhCo: number;
  donVi: string | null;
  noiDung: string | null;
  butToan: string;
  status: 'MATCHED' | 'REVIEW' | 'UNPROCESSED';
  suggestedCode: string | null;
  match: MatchInfo | null;
}

const STATUS_STYLE: Record<string, string> = {
  MATCHED: 'bg-emerald-100 text-emerald-800',
  REVIEW: 'bg-amber-100 text-amber-800',
  UNPROCESSED: 'bg-slate-100 text-slate-600',
};

const STATUS_LABEL: Record<string, string> = {
  MATCHED: 'Đã khớp',
  REVIEW: 'Chờ review',
  UNPROCESSED: 'Chưa xử lý',
};

const fmt = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/**
 * Panel doi soat sao ke ngan hang (tab Tai chinh, chi Chu/Quan ly).
 * Import xlsx -> tu dong khop -> duyet tay cac dong REVIEW.
 */
export function BankReconciliationPanel({ currentRole }: { currentRole: UserRole }) {
  const [items, setItems] = useState<StatementItem[]>([]);
  const [counts, setCounts] = useState({ MATCHED: 0, REVIEW: 0, UNPROCESSED: 0 });
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignCode, setAssignCode] = useState('');

  if (currentRole !== 'ROLE_OWNER' && currentRole !== 'ROLE_MANAGER') return null;

  const load = async (f = filter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/bank-statements?status=${f}&limit=100`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setItems(json.data.items || []);
      setCounts(json.data.counts || { MATCHED: 0, REVIEW: 0, UNPROCESSED: 0 });
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doImport = async (file: File) => {
    setLoading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/finance/bank-statements/import', { method: 'POST', body: form });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const d = json.data;
      setMessage(`Nhập ${d.imported} dòng (bỏ ${d.skipped}): khớp ${d.high}, chờ duyệt ${d.medium + d.low}, chưa xử lý ${d.unprocessed}.`);
      setOpen(true);
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  };

  const act = async (id: string, action: 'confirm' | 'skip', orderId?: string) => {
    try {
      const res = await fetch(`/api/finance/bank-statements/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderId ? { orderId } : {}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setAssignFor(null);
      setAssignCode('');
      await load();
    } catch (e: any) {
      setMessage(e.message);
    }
  };

  const confirmAssign = async (st: StatementItem) => {
    if (!assignCode.trim()) return;
    await act(st.id, 'confirm', assignCode.trim());
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Landmark className="w-4 h-4 text-sky-600" />
          Đối soát ngân hàng
          <span className="text-[11px] font-bold text-slate-500">
            {counts.MATCHED} khớp / {counts.REVIEW} chờ duyệt / {counts.UNPROCESSED} chưa xử lý
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Nhập sao kê</span>
            <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
          </label>
          <button type="button" onClick={() => { setOpen(!open); if (!open) load(); }} className="px-3 py-2 min-h-[44px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">
            {open ? 'Thu gọn' : 'Mở sổ'}
          </button>
        </div>
      </div>
      {message && <p className="text-xs text-slate-600 mt-2">{message}</p>}
      {open && (
        <div className="mt-3">
          <div className="flex gap-1.5 mb-2">
            {['ALL', 'REVIEW', 'MATCHED', 'UNPROCESSED'].map((f) => (
              <button key={f} type="button" onClick={() => { setFilter(f); load(f); }}
                className={`px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold ${filter === f ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {f === 'ALL' ? 'Tất cả' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
          {/* Desktop: bang full ngang. Mobile: cards doc (block md:table). */}
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="p-2">Ngày</th>
                  <th className="p-2">Nội dung</th>
                  <th className="p-2 text-right">Tiền vào</th>
                  <th className="p-2 text-right">Tiền ra</th>
                  <th className="p-2">Trạng thái</th>
                  <th className="p-2">Gợi ý / Đơn</th>
                  <th className="p-2">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((st) => (
                  <tr key={st.id} className="border-t border-slate-100">
                    <td className="p-2 whitespace-nowrap">{st.ngayGiaoDich}</td>
                    <td className="p-2 max-w-[280px] truncate" title={st.noiDung || ''}>{st.noiDung} <span className="text-slate-400">({st.donVi})</span></td>
                    <td className="p-2 text-right font-bold text-emerald-700">{st.phatSinhCo ? fmt(st.phatSinhCo) : ''}</td>
                    <td className="p-2 text-right text-rose-600">{st.phatSinhNo ? fmt(st.phatSinhNo) : ''}</td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[st.status]}`}>{STATUS_LABEL[st.status]}</span></td>
                    <td className="p-2 text-[11px]">
                      {st.match?.orderCode ? `${st.match.orderCode} (${fmt(st.match.orderAmount || 0)})` : st.suggestedCode || ''}
                      {st.match?.note && <div className="text-slate-500">{st.match.note}</div>}
                    </td>
                    <td className="p-2">
                      {st.status === 'REVIEW' && (
                        <div className="flex flex-wrap gap-1">
                          <button type="button" onClick={() => act(st.id, 'confirm')} aria-label="Xác nhận khớp"
                            className="flex items-center gap-1 px-2 py-2 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold">
                            <Check className="w-3.5 h-3.5" /> Nhận
                          </button>
                          <button type="button" onClick={() => setAssignFor(assignFor === st.id ? null : st.id)} aria-label="Gán tay đơn khác"
                            className="flex items-center gap-1 px-2 py-2 min-h-[44px] bg-slate-200 hover:bg-slate-300 rounded-lg text-[11px] font-bold">
                            <Hand className="w-3.5 h-3.5" /> Gán
                          </button>
                          <button type="button" onClick={() => act(st.id, 'skip')} aria-label="Bỏ qua dòng này"
                            className="flex items-center gap-1 px-2 py-2 min-h-[44px] bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-bold">
                            <X className="w-3.5 h-3.5" /> Bỏ
                          </button>
                        </div>
                      )}
                      {assignFor === st.id && (
                        <div className="flex gap-1 mt-1">
                          <input value={assignCode} onChange={(e) => setAssignCode(e.target.value)} placeholder="ORD..."
                            className="w-32 px-2 py-2 min-h-[44px] border rounded-lg text-xs" aria-label="Mã đơn gán tay" />
                          <button type="button" onClick={() => confirmAssign(st)}
                            className="px-2 py-2 min-h-[44px] bg-sky-600 text-white rounded-lg text-[11px] font-bold">OK</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && !loading && <p className="text-xs text-slate-500 p-3">Chưa có dòng nào. Nhập file sao kê để bắt đầu.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
