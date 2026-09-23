'use client';

import React, { useState, useEffect } from 'react';
import { Package, Scale } from 'lucide-react';
import { UserRole } from '@/lib/roles';

export function BundleRoyaltyPanels({ currentRole }: { currentRole: UserRole }) {
  const [bundles, setBundles] = useState<any[]>([]);
  const [royalties, setRoyalties] = useState<any[]>([]);
  const [royaltyBlocked, setRoyaltyBlocked] = useState(false);

  useEffect(() => {
    fetch('/api/bundles')
      .then((r) => r.json())
      .then((d) => d.success && setBundles(d.data || []))
      .catch(() => {});
    fetch('/api/royalties?lifecycle=ACTIVE', { headers: { 'x-formapubli-role': currentRole } })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setRoyalties(d.data || []);
        else setRoyaltyBlocked(true);
      })
      .catch(() => setRoyaltyBlocked(true));
  }, [currentRole]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <Package className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-extrabold text-slate-900">Combo / Boxset đang bán</h3>
          <span className="ml-auto text-[10px] text-slate-400">read-only • bottleneck ở POS sprint sau</span>
        </div>
        {bundles.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">Chưa định nghĩa combo nào (tạo qua POST /api/bundles).</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {bundles.slice(0, 10).map((b: any) => (
              <div key={b.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-slate-900">{b.code}</p>
                  <p className="text-[11px] text-slate-500 truncate">{b.seasonName} • {b.releaseDate || ''}</p>
                </div>
                <span className="font-mono text-xs font-bold text-indigo-700 shrink-0">
                  {Number(b.comboPrice || 0).toLocaleString('vi-VN')} đ
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-extrabold text-slate-900">Bản quyền & Nhuận bút</h3>
          <span className="ml-auto text-[10px] text-slate-400">Owner/Manager</span>
        </div>
        {royaltyBlocked ? (
          <p className="p-4 text-xs text-slate-400">Vai trò hiện tại bị chặn 403 ở /api/royalties.</p>
        ) : royalties.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">Chưa có hợp đồng ACTIVE nào.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {royalties.slice(0, 10).map((c: any) => (
              <div key={c.id} className="px-4 py-2.5">
                <p className="font-mono text-xs font-bold text-slate-900">{c.contractNumber || c.id}</p>
                <p className="text-[11px] text-slate-500">
                  {c.licensorName || ''} • rate {Math.round(Number(c.royaltyRate || 0) * 100)}% • quota {c.printQuota ?? '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
