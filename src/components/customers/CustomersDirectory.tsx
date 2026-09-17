'use client';

import React, { useState, useEffect } from 'react';
import { Search, Users, RefreshCw } from 'lucide-react';
import { ReaderProfilePanel } from './ReaderProfilePanel';

export function CustomersDirectory() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchList = async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      params.set('limit', '50');
      const res = await fetch(`/api/customers?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setRows(data.data || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList('');
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
          <Users className="w-4 h-4 text-rose-600" />
          Danh Bạ Độc Giả (GĐ1 read-only) — {total} hồ sơ
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 border border-slate-300 rounded-lg px-2 py-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchList(q)}
              placeholder="SĐT / tên / mã KH..."
              className="text-xs outline-none w-44"
            />
          </div>
          <button onClick={() => fetchList(q)} className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold">
            Tìm
          </button>
          <button onClick={() => fetchList(q)} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      {error && <p className="px-4 py-2 text-xs text-rose-600 bg-rose-50">{error}</p>}
      {loading ? (
        <p className="p-4 text-center text-xs text-slate-400">Đang tải danh bạ...</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-xs text-slate-400">
          Chưa có hồ sơ nào (seed Sheets cũ chưa nạp customers). Thêm/sửa để sprint CRM sau — ticket này chỉ đọc.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100">
              <tr>
                <th className="px-3 py-2">Mã KH</th>
                <th className="px-3 py-2">Họ tên</th>
                <th className="px-3 py-2">SĐT</th>
                <th className="px-3 py-2">Kênh</th>
                <th className="px-3 py-2">Phân khúc</th>
                <th className="px-3 py-2 text-right">Tổng chi tiêu</th>
                <th className="px-3 py-2">Hồ sơ 360°</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono font-bold text-rose-700">{c.code}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{c.fullName}</td>
                  <td className="px-3 py-2 font-mono">{c.phone || '—'}</td>
                  <td className="px-3 py-2">{c.channel || '—'}</td>
                  <td className="px-3 py-2">{c.segment || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{Number(c.totalSpent || 0).toLocaleString('vi-VN')} đ</td>
                  <td className="px-3 py-2"><ReaderProfilePanel customerId={c.id} customerName={c.fullName} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-100">
        Tích lũy LTV / tủ sách chống trùng / gói Mùa để sprint CRM sau — không nhúng vào POS ở ticket này để giữ speed 2-3s.
      </p>
    </div>
  );
}
