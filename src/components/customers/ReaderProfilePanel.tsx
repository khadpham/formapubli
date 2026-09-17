'use client';

import React, { useState } from 'react';
import { UserRound, Loader2 } from 'lucide-react';

/**
 * 5.4 tối thiểu: bấm vào khách -> xem hồ sơ 360° (read-only).
 * Mọi số liệu từ GET /api/ai/reader-persona?customerId=.
 */
export function ReaderProfilePanel({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (profile) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/reader-persona?customerId=${encodeURIComponent(customerId)}`);
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || `Lỗi ${res.status}`);
      setProfile(json.data);
    } catch (e: any) {
      setError(e.message || 'Không tải được hồ sơ.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={load}
        className="px-2 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200"
      >
        {open ? 'Đóng hồ sơ' : 'Hồ sơ'}
      </button>
      {open && (
        <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
          {loading && (
            <p className="flex items-center gap-1.5 text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải hồ sơ {customerName}...
            </p>
          )}
          {error && <p className="text-rose-600">{error}</p>}
          {profile && (
            <>
              <p className="font-extrabold text-slate-900 flex items-center gap-1.5">
                <UserRound className="w-3.5 h-3.5 text-indigo-600" />
                {profile.customer?.fullName} — {profile.orders?.count ?? 0} đơn · {(profile.orders?.spent ?? 0).toLocaleString('vi-VN')} đ · {profile.orders?.booksQty ?? 0} cuốn
              </p>
              {profile.tags?.length > 0 && (
                <p className="text-slate-600">
                  Thẻ: {profile.tags.join(', ')}
                </p>
              )}
              {profile.topCategories?.length > 0 && (
                <p className="text-slate-600">
                  Thể loại ưa thích: {profile.topCategories.map((c: any) => `${c.category} (x${c.qty})`).join(' · ')}
                </p>
              )}
              {profile.topEditions?.length > 0 && (
                <div className="space-y-1">
                  {profile.topEditions.map((e: any) => (
                    <p key={e.editionId} className="text-slate-700">
                      <span className="font-mono font-bold text-indigo-700">[{e.code}]</span> {e.title} — x{e.qty}
                    </p>
                  ))}
                </div>
              )}
              {profile.orders?.count === 0 && <p className="text-slate-400">Chưa có đơn mua nào.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
