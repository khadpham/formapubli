'use client';

import React, { useState, useEffect } from 'react';
import { Scale } from 'lucide-react';
import { UserRole } from '@/lib/roles';

/**
 * Danh sách hợp đồng bản quyền đang hiệu lực. Trước đây nằm trong tab
 * "Báo cáo" (BundleRoyaltyPanels) - chuyển về tab "Dự án & Hợp đồng" vì
 * đây là danh mục quản trị hợp đồng.
 */
export function RoyaltyContractsPanel({ currentRole }: { currentRole: UserRole }) {
  const [royalties, setRoyalties] = useState<any[]>([]);
  const [royaltyError, setRoyaltyError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/royalties?lifecycle=ACTIVE', { headers: { 'x-formapubli-role': currentRole } })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setRoyalties(d.data || []);
        else setRoyaltyError(d.error || 'Không tải được danh sách hợp đồng bản quyền.');
      })
      .catch(() => setRoyaltyError('Không kết nối được máy chủ - kiểm tra mạng rồi tải lại trang.'));
  }, [currentRole]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center gap-2">
        <Scale className="w-4 h-4 text-amber-600" />
        <h3 className="text-sm font-extrabold text-slate-900">Bản quyền & Nhuận bút</h3>
        <span className="ml-auto text-[10px] text-slate-400">Hợp đồng đang hiệu lực</span>
      </div>
      {royaltyError ? (
        <p className="p-4 text-xs text-rose-700">Không tải được hợp đồng bản quyền - {royaltyError}</p>
      ) : royalties.length === 0 ? (
        <p className="p-4 text-xs text-slate-400">Chưa có hợp đồng bản quyền nào đang hiệu lực.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {royalties.slice(0, 10).map((c: any) => (
            <div key={c.id} className="px-4 py-2.5">
              <p className="font-mono text-xs font-bold text-slate-900">{c.contractNumber || c.id}</p>
              <p className="text-[11px] text-slate-500">
                {c.licensorName || ''} • rate {Math.round(Number(c.royaltyRate || 0) * 100)}% • quota {c.printQuota ?? '-'}
              </p>
              <p className="text-[11px] text-amber-700">
                Cơ sở: {c.royaltyBasis === 'COVER_PRICE' ? 'Giá bìa' : 'Tiền thực thu (sau chiết khấu)'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
