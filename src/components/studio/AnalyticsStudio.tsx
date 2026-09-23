'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FlaskConical, RefreshCw, Download, Search, AlertTriangle } from 'lucide-react';
import { BundleRoyaltyPanels } from './BundleRoyaltyPanels';
import { UserRole } from '@/lib/roles';

interface ForecastItem {
  editionId: string;
  code: string;
  title: string | null;
  coverPrice: number;
  windowDays: number;
  soldQty: number;
  vSale: number;
  totalStock: number;
  doi: number | null;
  level: 'RED_ALERT' | 'YELLOW_WARNING' | 'HEALTHY_NORMAL';
  suggestedReprintQty: number;
}

interface AnalyticsStudioProps {
  currentRole: UserRole;
}

const LEVEL_ORDER: Record<string, number> = { RED_ALERT: 0, YELLOW_WARNING: 1, HEALTHY_NORMAL: 2 };

export function AnalyticsStudio({ currentRole }: AnalyticsStudioProps) {
  const [items, setItems] = useState<ForecastItem[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'RED_ALERT' | 'YELLOW_WARNING' | 'HEALTHY_NORMAL'>('ALL');
  const [search, setSearch] = useState('');

  const blocked = currentRole === 'ROLE_CASHIER' || currentRole === 'ROLE_TAX' || currentRole === 'ROLE_WAREHOUSE';

  const fetchForecast = async () => {
    if (blocked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('windowDays', String(windowDays));
      params.set('limit', '200');
      if (levelFilter !== 'ALL') params.set('level', levelFilter);
      const res = await fetch(`/api/forecast?${params.toString()}`, {
        headers: { 'x-formapubli-role': currentRole },
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Không tải được dự báo.');
        setItems([]);
      } else {
        setItems(data.data || []);
        setSummary(data.summary || null);
      }
    } catch (e: any) {
      setError(e.message || 'Lỗi kết nối.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays, levelFilter, currentRole]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = [...items].sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        (r.title || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const counts = useMemo(() => {
    return {
      red: items.filter((i) => i.level === 'RED_ALERT').length,
      yellow: items.filter((i) => i.level === 'YELLOW_WARNING').length,
      healthy: items.filter((i) => i.level === 'HEALTHY_NORMAL').length,
    };
  }, [items]);

  const handleExport = () => {
    const header = 'code,title,cover_price,sold_qty,v_sale,total_stock,doi_days,level,suggested_reprint_qty';
    const lines = filtered.map((r) =>
      [
        r.code,
        `"${(r.title || '').replace(/"/g, '""')}"`,
        r.coverPrice,
        r.soldQty,
        r.vSale.toFixed(3),
        r.totalStock,
        r.doi === null ? '' : r.doi.toFixed(1),
        r.level,
        r.suggestedReprintQty,
      ].join(',')
    );
    const csv = '\uFEFF' + [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Du_Bao_Tai_Ban_${windowDays}ngay_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (blocked) {
    return (
      <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center space-y-2">
        <FlaskConical className="w-8 h-8 mx-auto text-slate-300" />
        <h3 className="font-extrabold text-slate-900">Không gian phân tích dành cho Chủ / Quản lý</h3>
        <p className="text-xs text-slate-500">Vai trò hiện tại bị chặn 403 bởi <code>/api/forecast</code> để bảo vệ Sổ Thực.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="hidden md:block">
          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-indigo-600" />
            Không Gian Phân Tích Chuyên Sâu & Dự Báo Tái Bản
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Read-only từ <code>/api/forecast</code> • V_sale từ ledger DISPATCH_SALE + CONSIGNMENT_SOLD • DoI = Tồn / V • EOQ = CEIL(V × 105)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 font-semibold"
            title="Cửa sổ quan sát vận tốc"
          >
            <option value={7}>7 ngày</option>
            <option value={30}>30 ngày</option>
            <option value={60}>60 ngày</option>
          </select>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as any)}
            className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 font-semibold"
          >
            <option value="ALL">Tất cả mức</option>
            <option value="RED_ALERT">🔴 RED ≤30 ngày</option>
            <option value="YELLOW_WARNING">🟡 YELLOW 31-45</option>
            <option value="HEALTHY_NORMAL">🟢 HEALTHY &gt;45</option>
          </select>
          <button onClick={fetchForecast} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200" title="Làm mới">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center">
          <p className="text-2xl font-black text-rose-700 font-mono">{counts.red}</p>
          <p className="text-[11px] font-bold text-rose-600">🔴 RED — in gấp</p>
        </div>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-center">
          <p className="text-2xl font-black text-amber-700 font-mono">{counts.yellow}</p>
          <p className="text-[11px] font-bold text-amber-600">🟡 YELLOW — chuẩn bị HĐ in</p>
        </div>
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
          <p className="text-2xl font-black text-emerald-700 font-mono">{counts.healthy}</p>
          <p className="text-[11px] font-bold text-emerald-600">🟢 HEALTHY — an toàn</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Lọc theo mã / tên sách..."
            className="flex-1 text-sm outline-none"
          />
          <span className="text-[11px] font-mono text-slate-400">{filtered.length} dòng</span>
        </div>
        {loading ? (
          <p className="p-6 text-center text-xs text-slate-400">Đang tải dự báo...</p>
        ) : error ? (
          <p className="p-6 text-center text-xs text-rose-600 flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> {error}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5">Mã</th>
                  <th className="px-3 py-2.5">Tên sách</th>
                  <th className="px-3 py-2.5 text-right">Giá bìa</th>
                  <th className="px-3 py-2.5 text-right">Đã bán</th>
                  <th className="px-3 py-2.5 text-right">V_sale/ngày</th>
                  <th className="px-3 py-2.5 text-right">Tồn</th>
                  <th className="px-3 py-2.5 text-right">DoI (ngày)</th>
                  <th className="px-3 py-2.5 text-right">EOQ in thêm</th>
                  <th className="px-3 py-2.5">Mức</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.editionId} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-mono font-bold text-indigo-700">{r.code}</td>
                    <td className="px-3 py-2 font-medium text-slate-800 max-w-[220px] truncate" title={r.title || ''}>{r.title}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(r.coverPrice).toLocaleString('vi-VN')}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.soldQty}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(r.vSale).toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{r.totalStock}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.doi === null ? '∞' : Number(r.doi).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{r.suggestedReprintQty}</td>
                    <td className="px-3 py-2">
                      {r.level === 'RED_ALERT' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">🔴 RED</span>}
                      {r.level === 'YELLOW_WARNING' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">🟡 YELLOW</span>}
                      {r.level === 'HEALTHY_NORMAL' && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">🟢 OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {summary && (
          <p className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-100">
            Tổng {summary.total ?? items.length} ấn bản • RED {summary.red ?? counts.red} • YELLOW {summary.yellow ?? counts.yellow} • Lead 30 + Buffer 15 + An toàn 60 = ×105
          </p>
        )}
      </div>

      <BundleRoyaltyPanels currentRole={currentRole} />
    </div>
  );
}
