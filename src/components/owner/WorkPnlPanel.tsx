'use client';

import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ';

interface PnlRow {
  workId: string;
  workCode: string;
  workTitle: string;
  qty: number;
  revenue: number;
  unitCost: number | null;
  cogs: number | null;
  gross: number | null;
  marginPct: number | null;
}

interface BookData {
  rows: PnlRow[];
  totalQty: number;
  totalRevenue: number;
  totalCogs: number;
  totalGross: number;
}

interface CostItem {
  id: string;
  costType: string;
  amount: number;
  costDate: string;
  notes: string | null;
  label: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  all: 'Tất cả kênh',
  pos: 'POS',
  online: 'Portal',
  shopee: 'Shopee',
  wholesale: 'Đại lý/Ký gửi',
};

const BOOK_LABEL: Record<string, string> = {
  ALL: 'Cả 2 sổ',
  TAX: 'Sổ thuế',
  INTERNAL: 'Sổ nội bộ',
};

function todayVn(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function WorkPnlPanel() {
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState(todayVn());
  const [channel, setChannel] = useState('all');
  const [book, setBook] = useState('ALL');
  const [data, setData] = useState<{
    books: Record<string, BookData>;
    expenses: { total: number; byCategory: { category: string; total: number }[] };
    net: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openWork, setOpenWork] = useState<string | null>(null);
  const [costDetail, setCostDetail] = useState<Record<string, {
    items: CostItem[]; totalCost: number; contractTotal: number; printingTotal: number; receivedQty: number; unitCost: number | null;
  }>>({});
  const [works, setWorks] = useState<{ id: string; code: string; title: string }[]>([]);
  const [workId, setWorkId] = useState('');

  useEffect(() => {
    fetch('/api/owner/works', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (j.success && Array.isArray(j.data)) setWorks(j.data);
      })
      .catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ from, to, channel, book });
      if (workId) q.set('work_id', workId);
      const r = await fetch(`/api/owner/pnl?${q.toString()}`, { credentials: 'include' });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Không tải được P&L.');
      setData(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleDetail = async (wid: string) => {
    if (openWork === wid) { setOpenWork(null); return; }
    setOpenWork(wid);
    if (!costDetail[wid]) {
      try {
        const r = await fetch(`/api/owner/cogs?work_id=${encodeURIComponent(wid)}`, { credentials: 'include' });
        const j = await r.json();
        if (j.success) setCostDetail((p) => ({ ...p, [wid]: j.data }));
      } catch { /* bỏ qua, bảng chính vẫn hiện */ }
    }
  };

  const bookKeys = data ? Object.keys(data.books) : [];

  return (
    <section aria-label="Lãi lỗ theo đầu sách" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-emerald-600" />
          Lãi / lỗ theo đầu sách
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold disabled:opacity-50 min-h-[40px]"
        >
          {loading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-slate-600">
          Từ ngày
          <input type="date" value={from} min="2026-01-01" onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]" />
        </label>
        <label className="text-xs font-bold text-slate-600">
          Đến ngày
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]" />
        </label>
        <label className="text-xs font-bold text-slate-600">
          Kênh
          <select value={channel} onChange={(e) => setChannel(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px] bg-white">
            {Object.entries(CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          Sổ
          <select value={book} onChange={(e) => setBook(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px] bg-white">
            {Object.entries(BOOK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          Đầu sách
          <select value={workId} onChange={(e) => setWorkId(e.target.value)}
            className="mt-1 block px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px] bg-white max-w-[220px]">
            <option value="">Tất cả</option>
            {works.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.title}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="text-xs text-rose-600 font-bold">{error}</p>}

      {data && bookKeys.map((bk) => {
        const b = data.books[bk];
        return (
          <div key={bk} className="space-y-2">
            {bookKeys.length > 1 && (
              <p className="text-xs font-extrabold text-slate-700">{BOOK_LABEL[bk] || bk}</p>
            )}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="text-left px-3 py-2 font-bold">Đầu sách</th>
                    <th className="text-right px-3 py-2 font-bold">SL bán</th>
                    <th className="text-right px-3 py-2 font-bold">Doanh thu</th>
                    <th className="text-right px-3 py-2 font-bold">Giá vốn</th>
                    <th className="text-right px-3 py-2 font-bold">Lãi gộp</th>
                    <th className="text-right px-3 py-2 font-bold">Biên %</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">Không có số liệu trong kỳ.</td></tr>
                  )}
                  {b.rows.map((r) => (
                    <React.Fragment key={r.workId}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => toggleDetail(r.workId)}
                            className="font-bold text-slate-800 hover:text-emerald-700 text-left"
                            aria-label={`Xem cấu thành giá vốn ${r.workTitle}`}>
                            {r.workCode ? `${r.workCode} - ` : ''}{r.workTitle}
                            <span className="ml-1 text-slate-400">{openWork === r.workId ? '▾' : '▸'}</span>
                          </button>
                        </td>
                        <td className="text-right px-3 py-2 font-mono">{r.qty.toLocaleString('vi-VN')}</td>
                        <td className="text-right px-3 py-2 font-mono font-bold">{vnd(r.revenue)}</td>
                        <td className="text-right px-3 py-2 font-mono">{r.cogs == null ? <span className="text-slate-400">chưa có</span> : vnd(r.cogs)}</td>
                        <td className={`text-right px-3 py-2 font-mono font-extrabold ${(r.gross ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {r.gross == null ? <span className="text-slate-400">chưa có</span> : vnd(r.gross)}
                        </td>
                        <td className="text-right px-3 py-2 font-mono">{r.marginPct == null ? '-' : `${r.marginPct.toFixed(1)}%`}</td>
                      </tr>
                      {openWork === r.workId && (
                        <tr className="border-t border-slate-100 bg-emerald-50/50">
                          <td colSpan={6} className="px-4 py-3">
                            {costDetail[r.workId] ? (
                              <div className="space-y-1">
                                <p className="text-[11px] font-extrabold text-slate-700">
                                  Cấu thành giá vốn: tổng {vnd(costDetail[r.workId].totalCost)}
                                  {' '}(HĐ {vnd(costDetail[r.workId].contractTotal)} · In ấn {vnd(costDetail[r.workId].printingTotal)})
                                  {' '}÷ {costDetail[r.workId].receivedQty.toLocaleString('vi-VN')} bản nhập
                                  {' '}= <span className="text-emerald-700">{costDetail[r.workId].unitCost != null ? vnd(costDetail[r.workId].unitCost as number) + '/bản' : 'chưa tính được'}</span>
                                </p>
                                <ul className="text-[11px] text-slate-600 space-y-0.5">
                                  {costDetail[r.workId].items.map((c) => (
                                    <li key={c.id}>· [{c.label}] {c.notes || c.id} - {vnd(c.amount)} ({c.costDate})</li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-400">Đang tải chi tiết...</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {b.rows.length > 0 && (
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-extrabold">
                      <td className="px-3 py-2">Tổng</td>
                      <td className="text-right px-3 py-2 font-mono">{b.totalQty.toLocaleString('vi-VN')}</td>
                      <td className="text-right px-3 py-2 font-mono">{vnd(b.totalRevenue)}</td>
                      <td className="text-right px-3 py-2 font-mono">{vnd(b.totalCogs)}</td>
                      <td className={`text-right px-3 py-2 font-mono ${b.totalGross >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{vnd(b.totalGross)}</td>
                      <td className="text-right px-3 py-2 font-mono">{b.totalRevenue > 0 ? `${((b.totalGross / b.totalRevenue) * 100).toFixed(1)}%` : '-'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600 px-1">
              <span>Tầng 2 - Chi phí chung kỳ này: <b className="text-rose-700">{vnd(data.expenses.total)}</b></span>
              <span>Lãi ròng sau chi phí chung: <b className={(data.net[bk] ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{vnd(data.net[bk] ?? 0)}</b></span>
            </div>
          </div>
        );
      })}

      <p className="text-[11px] text-slate-400">
        Giá vốn = tổng chi phí HĐ (gross) + tiền in ấn, chia bình quân cho tổng số bản đã nhập kho từ 01/01/2026.
        Bấm vào tên đầu sách để xem cấu thành giá vốn.
      </p>
    </section>
  );
}
