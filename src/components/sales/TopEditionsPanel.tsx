'use client';

import React, { useState, useEffect } from 'react';
import { Trophy, Download, RefreshCw } from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { appendExportWatermark } from '@/lib/export-hash';

interface TopEditionsPanelProps {
  currentRole: UserRole;
}

type Preset = 'TODAY' | 'WEEK' | 'MONTH';

function presetRange(p: Preset): { startDate: string; endDate: string; label: string } {
  const now = new Date();
  const end = now.toISOString();
  if (p === 'TODAY') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { startDate: d.toISOString(), endDate: end, label: 'Hôm nay' };
  }
  if (p === 'WEEK') {
    const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { startDate: d.toISOString(), endDate: end, label: '7 ngày qua' };
  }
  const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { startDate: d.toISOString(), endDate: end, label: '30 ngày qua' };
}

export function TopEditionsPanel({ currentRole }: TopEditionsPanelProps) {
  const canView = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const [preset, setPreset] = useState<Preset>('WEEK');
  const [topN, setTopN] = useState(20);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [totals, setTotals] = useState({ totalQty: 0, totalRevenue: 0 });

  const fetchTop = async (p: Preset = preset, n: number = topN) => {
    if (!canView) return;
    setLoading(true);
    try {
      const r = presetRange(p);
      const params = new URLSearchParams({
        view: 'top-editions',
        startDate: r.startDate,
        endDate: r.endDate,
        top: String(n),
      });
      const res = await fetch(`/api/analytics?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setItems(json.data?.items || []);
        setTotals({ totalQty: json.data?.totalQty || 0, totalRevenue: json.data?.totalRevenue || 0 });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  if (!canView) return null;

  const exportCsv = () => {
    if (items.length === 0) {
      alert('Chưa có dữ liệu sách bán chạy để xuất.');
      return;
    }
    const r = presetRange(preset);
    const headers = ['Hang', 'Ma', 'Tieu de', 'So luong (cuon)', 'So don', 'Doanh thu (VND)', 'Ty trong SL (%)'];
    // Chan Excel formula injection o Ma/Tieu de.
    const cell = (v: string | number) => {
      const s = `${v ?? ''}`;
      return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`;
    };
    const rawObjects = items.map((it: any, i: number) => ({
      rank: i + 1,
      editionId: it.editionId,
      code: it.code,
      title: it.title,
      qty: Number(it.qty || 0),
      orders: Number(it.orders || 0),
      revenue: Number(it.revenue || 0),
    }));
    const rows = items.map((it: any, i: number) => [
      i + 1,
      cell(it.code || ''),
      cell(it.title || ''),
      Number(it.qty || 0),
      Number(it.orders || 0),
      Number(it.revenue || 0),
      (Number(it.qtyShare || 0) * 100).toFixed(2),
    ]);
    const baseCsv = [headers.join(','), ...rows.map((x) => x.join(','))].join('\r\n');
    const watermarked = appendExportWatermark(baseCsv, rawObjects, {
      actorId: 'top-editions',
      actorRole: currentRole,
      reportName: `SACH BAN CHAY (${r.label.toUpperCase()})`,
      fiscalScope: 'ALL',
    });
    const blob = new Blob(['\uFEFF' + watermarked], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Sach_Ban_Chay_${preset}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            Sách Bán Chạy Nhất
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Kỳ {presetRange(preset).label} • Tổng {totals.totalQty.toLocaleString('vi-VN')} cuốn / {totals.totalRevenue.toLocaleString('vi-VN')} đ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['TODAY', 'WEEK', 'MONTH'] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPreset(p); fetchTop(p, topN); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                preset === p ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {p === 'TODAY' ? 'Hôm nay' : p === 'WEEK' ? '7 ngày qua' : '30 ngày qua'}
            </button>
          ))}
          <select
            value={topN}
            onChange={(e) => { const n = Number(e.target.value); setTopN(n); fetchTop(preset, n); }}
            className="bg-slate-50 border border-slate-300 text-xs font-bold rounded-xl px-2.5 py-1.5 outline-none cursor-pointer"
            title="Số đầu sách hiển thị"
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
          </select>
          <button onClick={() => fetchTop()} disabled={loading} className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition disabled:opacity-50" title="Tải lại">
            <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-slate-100 rounded-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 sticky top-0 z-10">
            <tr>
              <th className="p-3 w-12">#</th>
              <th className="p-3">Đầu sách</th>
              <th className="p-3 text-right">SL bán</th>
              <th className="p-3 text-right">Số đơn</th>
              <th className="p-3 text-right">Doanh thu</th>
              <th className="p-3 w-40">Tỷ trọng SL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  {loading ? 'Đang tải số liệu...' : 'Chưa phát sinh đơn bán trong kỳ này.'}
                </td>
              </tr>
            ) : (
              items.map((it: any, i: number) => (
                <tr key={it.editionId} className="hover:bg-slate-50/80">
                  <td className="p-3 font-black text-slate-400 font-mono">{i + 1}</td>
                  <td className="p-3">
                    <span className="font-mono font-bold text-indigo-700">{it.code}</span>
                    <span className="text-slate-600"> — {it.title}</span>
                  </td>
                  <td className="p-3 text-right font-mono font-bold">{Number(it.qty || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 text-right font-mono">{Number(it.orders || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 text-right font-mono font-bold text-emerald-700">{Number(it.revenue || 0).toLocaleString('vi-VN')} đ</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.round(Number(it.qtyShare || 0) * 100)}%` }} />
                      </div>
                      <span className="font-mono font-bold text-slate-800 w-12 text-right">{(Number(it.qtyShare || 0) * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
