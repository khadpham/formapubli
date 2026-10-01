'use client';

import React, { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';

async function readJsonSafe(res: Response): Promise<any> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

interface Row {
  productId: string;
  productName: string;
  lineCount: number;
  totalQty: number;
}

export function GiftReportPanel() {
  const [inStock, setInStock] = useState<Row[]>([]);
  const [shortfall, setShortfall] = useState<Row[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/reports/gifts', { cache: 'no-store' })
      .then(async (res) => {
        const json = await readJsonSafe(res);
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setError(json.error || 'Máy chủ không phản hồi đúng.');
          return;
        }
        setInStock(json.inStock || []);
        setShortfall(json.shortfall || []);
        setTotalQty(Number(json.totalQty || 0));
      })
      .catch(() => {
        if (!cancelled) setError('Lỗi kết nối.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
      <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
        <Gift className="w-4 h-4 text-amber-600" />
        Quà Tặng ({totalQty} phần)
      </h3>
      {error && <p role="alert" className="text-xs text-rose-700 font-semibold">{error}</p>}
      {loading ? (
        <p className="text-xs text-slate-500">Đang tải...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="font-bold text-emerald-700 mb-1">Còn tồn (đã trừ sổ)</p>
            {inStock.length === 0 ? (
              <p className="text-slate-400">Không có</p>
            ) : (
              inStock.map((r) => (
                <p key={r.productId} className="text-slate-700">
                  {r.productName} — <b>{r.totalQty}</b>
                </p>
              ))
            )}
          </div>
          <div>
            <p className="font-bold text-rose-700 mb-1">Hết tồn (không trừ sổ)</p>
            {shortfall.length === 0 ? (
              <p className="text-slate-400">Không có</p>
            ) : (
              shortfall.map((r) => (
                <p key={r.productId} className="text-slate-700">
                  {r.productName} — <b>{r.totalQty}</b>
                </p>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
