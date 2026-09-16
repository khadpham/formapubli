'use client';

import React, { useState, useEffect } from 'react';
import { Truck, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { UserRole } from '@/lib/roles';

interface TransitPanelProps {
  currentRole: UserRole;
}

export function TransitPanel({ currentRole }: TransitPanelProps) {
  const [shipments, setShipments] = useState<any[]>([]);
  const [staleIds, setStaleIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [receiveLines, setReceiveLines] = useState<Record<string, { r: string; d: string; l: string }>>({});
  const [acting, setActing] = useState(false);

  if (currentRole === 'ROLE_TAX') {
    return <p className="p-6 text-center text-xs text-slate-400">Kế toán thuế bị chặn 403 ở /api/transfers.</p>;
  }

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, staleRes] = await Promise.all([
        fetch('/api/transfers?status=IN_TRANSIT&limit=50', { headers: { 'x-formapubli-role': currentRole } }),
        fetch('/api/transfers?staleHours=12', { headers: { 'x-formapubli-role': currentRole } }),
      ]);
      const listData = await listRes.json();
      const staleData = await staleRes.json();
      if (!listData.success) throw new Error(listData.error);
      setShipments(listData.data || []);
      setStaleIds(new Set((staleData.data || []).map((s: any) => s.id)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  const openDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/transfers?id=${encodeURIComponent(id)}`, {
        headers: { 'x-formapubli-role': currentRole },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setDetail(data.data);
      const init: Record<string, { r: string; d: string; l: string }> = {};
      for (const it of data.data.items || []) {
        init[it.editionId] = { r: String(it.dispatchedQty || 0), d: '0', l: '0' };
      }
      setReceiveLines(init);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const submitReceive = async () => {
    if (!detail) return;
    setActing(true);
    try {
      const items = (detail.items || []).map((it: any) => ({
        editionId: it.editionId,
        receivedQty: parseInt(receiveLines[it.editionId]?.r || '0', 10),
        damagedQty: parseInt(receiveLines[it.editionId]?.d || '0', 10),
        lostQty: parseInt(receiveLines[it.editionId]?.l || '0', 10),
      }));
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-formapubli-role': currentRole },
        body: JSON.stringify({
          action: 'receive',
          shipmentId: detail.id,
          items,
          // CP3-B1.1 (mục 4): route bắt buộc idempotencyKey — sinh key mỗi lần bấm.
          idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ui-recv-${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setDetail(null);
      fetchList();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActing(false);
    }
  };

  const submitCancel = async (id: string) => {
    if (!confirm(`Hủy phiếu ${id} và rút hàng về kho gửi?`)) return;
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-formapubli-role': currentRole },
        body: JSON.stringify({
          action: 'cancel',
          shipmentId: id,
          // CP3-B1.1 (mục 4): route bắt buộc idempotencyKey — sinh key mỗi lần bấm.
          idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ui-cancel-${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      fetchList();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Truck className="w-4 h-4 text-indigo-600" />
          Hàng Đang Đi Đường (wh-in-transit) — R + D + L = X
        </div>
        <button onClick={fetchList} className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <p className="px-4 py-2 text-xs text-rose-600 bg-rose-50">{error}</p>}
      {loading ? (
        <p className="p-6 text-center text-xs text-slate-400">Đang tải chuyến xe...</p>
      ) : shipments.length === 0 ? (
        <p className="p-6 text-center text-xs text-slate-400">Không có xe nào đang đi đường. Tạo phiếu xuất chuyển ở tab Ma trận.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {shipments.map((s) => (
            <div key={s.id} className={`px-4 py-3 flex items-center justify-between gap-3 ${staleIds.has(s.id) ? 'bg-amber-50/60' : ''}`}>
              <div className="min-w-0">
                <p className="font-mono text-xs font-bold text-slate-900 flex items-center gap-2">
                  {s.id}
                  {staleIds.has(s.id) && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Kẹt &gt;12h
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{s.fromWarehouseId} → {s.toWarehouseId} • {s.dispatchedAt}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => openDetail(s.id)} className="px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-50">
                  Nhận hàng
                </button>
                <button onClick={() => submitCancel(s.id)} className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
                  Hủy
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="border-t border-slate-200 p-4 bg-slate-50/60 space-y-2">
          <p className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Biên bản nhận {detail.id} — nhập R lành + D hỏng + L mất = X gửi
          </p>
          {(detail.items || []).map((it: any) => (
            <div key={it.editionId} className="grid grid-cols-4 gap-2 items-center bg-white p-2 rounded-lg border border-slate-200">
              <span className="font-mono text-[11px] font-bold truncate col-span-1" title={it.editionId}>
                X gửi: {it.dispatchedQty}
              </span>
              {(['r', 'd', 'l'] as const).map((k) => (
                <label key={k} className="text-[10px] text-slate-500 flex items-center gap-1">
                  {k === 'r' ? 'Lành' : k === 'd' ? 'Hỏng' : 'Mất'}
                  <input
                    type="number" min={0}
                    value={receiveLines[it.editionId]?.[k] || '0'}
                    onChange={(e) => setReceiveLines((p) => ({ ...p, [it.editionId]: { ...p[it.editionId], [k]: e.target.value } }))}
                    className="w-16 border border-slate-300 rounded px-1.5 py-1 text-xs font-mono"
                  />
                </label>
              ))}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button disabled={acting} onClick={submitReceive} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold">
              {acting ? 'Đang chốt...' : 'Chốt biên bản nhận'}
            </button>
            <button onClick={() => setDetail(null)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
