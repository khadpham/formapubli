'use client';

import React, { useState } from 'react';
import { Send, Loader2, Phone } from 'lucide-react';

/**
 * 5.4 tối thiểu: nhập mã SKU sách mới -> danh sách độc giả phù hợp để chào hàng.
 * Dùng GET /api/ai/reader-persona?matchForCode= (read-only, có giải thích điểm).
 */
export function ReaderMatchPanel() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const clean = code.trim();
    if (!clean || loading) return;
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const res = await fetch(`/api/ai/reader-persona?matchForCode=${encodeURIComponent(clean)}&limit=20`);
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || `Lỗi ${res.status}`);
      setRows(json.data || []);
    } catch (e: any) {
      setError(e.message || 'Không gợi ý được.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
      <div>
        <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
          <Send className="w-4 h-4 text-emerald-600" />
          Gợi ý độc giả cho sách mới
        </h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Nhập mã SKU ấn bản sắp ra mắt → hệ thống chấm điểm độc giả đã mua cùng tác giả/thể loại (loại người đã sở hữu).
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Mã SKU (VD: H01)"
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500 font-mono uppercase w-44"
        />
        <button
          type="button"
          onClick={search}
          disabled={loading || !code.trim()}
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Gợi ý
        </button>
      </div>
      {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {rows !== null && (
        rows.length === 0 ? (
          <p className="text-xs text-slate-400">Không có độc giả phù hợp (hoặc tất cả đã sở hữu).</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r: any) => (
              <div key={r.customerId} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <p className="font-bold text-slate-900">
                  {r.fullName} <span className="font-mono text-slate-500">[{r.code}]</span>
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">điểm {r.score}</span>
                </p>
                <p className="text-slate-500 mt-0.5">
                  {r.phone ? <span className="inline-flex items-center gap-1 font-mono"><Phone className="w-3 h-3" />{r.phone}</span> : 'Chưa có SĐT'}
                  {r.reasons?.length > 0 && <span className="ml-2">· Vì sao: {r.reasons.join('; ')}</span>}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
