'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, TrendingUp, ArrowLeft, Receipt } from 'lucide-react';
import { createPortal } from 'react-dom';
import { buildFlowInsights } from '@/lib/product-flow';
import { OrderDetailModal } from '@/components/orders/OrderDetailModal';
import { UserRole } from '@/lib/roles';

interface ProductFlowDrawerProps {
  open: boolean;
  onClose: () => void;
  warehouseId: string;
  startDate: string;
  endDate: string;
  /** Mở thẳng chi tiết món này (bấm từ dòng top). */
  initialProductId?: string | null;
  currentRole?: UserRole;
  onConsumedInitial?: () => void;
}

interface ListItem {
  editionId?: string | null;
  code?: string | null;
  title?: string | null;
  qty?: number | null;
  revenue?: number | null;
}

export function ProductFlowDrawer({
  open,
  onClose,
  warehouseId,
  startDate,
  endDate,
  initialProductId,
  currentRole,
  onConsumedInitial,
}: ProductFlowDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<'list' | 'detail'>(initialProductId ? 'detail' : 'list');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [productId, setProductId] = useState<string | null>(initialProductId || null);
  const [timeline, setTimeline] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [metric, setMetric] = useState<'qty' | 'revenue'>('qty');
  const [from, setFrom] = useState(startDate);
  const [to, setTo] = useState(endDate);
  const [wh, setWh] = useState(warehouseId);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Mở drawer = đồng bộ kỳ/kho từ ngoài vào; initialProductId thì vào thẳng chi tiết.
  useEffect(() => {
    if (!open) return;
    setFrom(startDate);
    setTo(endDate);
    setWh(warehouseId);
    if (initialProductId) {
      setProductId(initialProductId);
      setView('detail');
      onConsumedInitial?.();
    } else {
      setView('list');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedOrderId) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, selectedOrderId]);

  const fetchList = useCallback(async () => {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    setLoadingList(true);
    try {
      const p = new URLSearchParams({ view: 'top-editions', top: '100' });
      if (from) p.set('startDate', from);
      if (to) p.set('endDate', to);
      if (wh && wh !== 'ALL') p.set('warehouseId', wh);
      const res = await fetch(`/api/analytics?${p.toString()}`, { signal: c.signal, cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (c.signal.aborted) return;
      setList(json?.success ? json.data?.items || [] : []);
    } catch {
      if (!c.signal.aborted) setList([]);
    } finally {
      if (!c.signal.aborted) setLoadingList(false);
    }
  }, [from, to, wh]);

  const fetchDetail = useCallback(async (pid: string) => {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const p = new URLSearchParams({ view: 'product-timeline', productId: pid });
      if (from) p.set('startDate', from);
      if (to) p.set('endDate', to);
      if (wh && wh !== 'ALL') p.set('warehouseId', wh);
      const res = await fetch(`/api/analytics?${p.toString()}`, { signal: c.signal, cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (c.signal.aborted) return;
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Không tải được nhịp bán.');
      setTimeline(json.data);
    } catch (err: any) {
      if (!c.signal.aborted) {
        setTimeline(null);
        setDetailError(err?.message || 'Không tải được nhịp bán.');
      }
    } finally {
      if (!c.signal.aborted) setLoadingDetail(false);
    }
  }, [from, to, wh]);

  useEffect(() => {
    if (!open) return;
    if (view === 'list') fetchList();
    else if (productId) fetchDetail(productId);
  }, [open, view, productId, fetchList, fetchDetail]);

  const openDetail = (pid: string) => {
    setProductId(pid);
    setTimeline(null);
    setView('detail');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) =>
      `${it.code || ''} ${it.title || ''}`.toLowerCase().includes(q)
    );
  }, [list, query]);

  const insights = useMemo(
    () => buildFlowInsights(timeline?.buckets || [], timeline?.events || [], wh),
    [timeline, wh]
  );
  const buckets: Array<{ date: string; qty: number; revenue: number; orders: number }> = timeline?.buckets || [];
  const maxV = Math.max(1, ...buckets.map((b) => (metric === 'qty' ? b.qty : b.revenue)));
  const money = (n: number) => n.toLocaleString('vi-VN');

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-sm flex justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nhịp bán sản phẩm"
        className="bg-white w-full max-w-lg h-full shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {view === 'detail' && (
              <button
                type="button"
                onClick={() => setView('list')}
                aria-label="Về danh sách sản phẩm"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                Nhịp Bán
              </h3>
              <p className="text-[11px] text-slate-500 truncate">
                {view === 'list' ? 'Chọn 1 món để xem từng thời điểm bán ra' : timeline?.product?.name || timeline?.product?.code || '…'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng nhịp bán"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Kỳ đang xem */}
        <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-1.5 text-[11px] shrink-0">
          <input type="date" aria-label="Từ ngày" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 border border-slate-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-indigo-500" />
          <span className="text-slate-400">→</span>
          <input type="date" aria-label="Đến ngày" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 border border-slate-200 rounded-lg font-mono outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {view === 'list' ? (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm mã, tên, ISBN…"
                  aria-label="Tìm sản phẩm trong kỳ"
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {loadingList ? (
                <p className="text-xs text-slate-400">Đang tải danh sách món bán trong kỳ…</p>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-slate-400">Kỳ này chưa có món nào bán ra (hoặc không khớp tìm kiếm).</p>
              ) : (
                filtered.map((it, i) => (
                  <button
                    key={String(it.editionId || it.code || i)}
                    type="button"
                    onClick={() => it.editionId && openDetail(String(it.editionId))}
                    className="w-full text-left p-2.5 rounded-xl border border-slate-200 hover:border-indigo-400 hover:shadow-sm transition flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-900 truncate">
                        {it.title || '—'} <span className="font-mono font-normal text-slate-400">[{it.code || '—'}]</span>
                      </span>
                      <span className="block text-[11px] text-slate-500 font-mono">
                        {Number(it.qty || 0).toLocaleString('vi-VN')} cuốn · {Number(it.revenue || 0).toLocaleString('vi-VN')} đ
                      </span>
                    </span>
                    <span className="font-mono font-black text-slate-300 shrink-0">{i + 1}</span>
                  </button>
                ))
              )}
            </>
          ) : loadingDetail ? (
            <p className="text-xs text-slate-400">Đang tải nhịp bán…</p>
          ) : detailError ? (
            <p className="text-xs text-rose-700">{detailError}</p>
          ) : !timeline || insights.totalQty === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm font-bold text-slate-700">Chưa bán trong kỳ</p>
              <p className="text-xs text-slate-500 mt-1">Món này không phát sinh đơn nào trong khoảng đang xem.</p>
            </div>
          ) : (
            <>
              {/* 4 số */}
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  [insights.totalQty.toLocaleString('vi-VN'), 'cuốn'],
                  [money(insights.totalRevenue), 'đ'],
                  [String(insights.totalOrders), 'đơn'],
                  [String(insights.activeDays), 'ngày bán'],
                ].map(([v, l]) => (
                  <div key={l} className="bg-slate-50 border border-slate-200 rounded-xl px-1 py-2">
                    <p className="text-sm font-black font-mono text-slate-900 truncate">{v}</p>
                    <p className="text-[10px] text-slate-500">{l}</p>
                  </div>
                ))}
              </div>

              {/* Cột theo ngày + gạt cuốn/tiền */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Theo ngày</p>
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Đơn vị biểu đồ">
                    {(['qty', 'revenue'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMetric(m)}
                        aria-pressed={metric === m}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${metric === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}
                      >
                        {m === 'qty' ? 'Cuốn' : 'Tiền'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-end gap-1 h-28">
                  {buckets.map((b) => {
                    const v = metric === 'qty' ? b.qty : b.revenue;
                    return (
                      <div key={b.date} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${b.date}: ${b.qty} cuốn · ${money(b.revenue)} đ`}>
                        <div
                          className="w-full max-w-[26px] rounded-t bg-indigo-500"
                          style={{ height: `${v > 0 ? Math.max(6, Math.round((v / maxV) * 100)) : 2}%` }}
                        />
                        <span className="text-[9px] font-mono text-slate-400 mt-0.5">{b.date.slice(8)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Insight cho Chủ */}
              <div className="rounded-xl bg-amber-50/70 border border-amber-200/80 p-3 text-xs text-slate-700 space-y-1">
                <p className="font-extrabold text-amber-800 text-[11px] uppercase tracking-wider">Chủ đọc nhanh</p>
                {insights.peakDay && <p>Đỉnh <b>{insights.peakDay.date}</b> ({insights.peakDay.qty} cuốn).</p>}
                {insights.peakHour != null && <p>Giờ vàng <b>{insights.peakHour}h</b>.</p>}
                <p>Bán tại kho đang xem <b>{Math.round(insights.fairShare * 100)}%</b> · kênh mạnh nhất <b>{insights.topChannel || '—'}</b>.</p>
                <p>Tốc độ <b>{insights.pacePerDay}</b> cuốn/ngày bán{insights.quietDays > 0 ? ` · ${insights.quietDays} ngày im ắng` : ''}.</p>
              </div>

              {/* Dòng sự kiện */}
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Từng lần bán ({(timeline?.events || []).length})</p>
                <div className="space-y-1.5">
                  {(timeline?.events || []).map((e: any) => (
                    <div key={`${e.orderId}-${e.createdAt}`} className="flex items-center justify-between gap-2 p-2 rounded-xl border border-slate-100 text-xs">
                      <span className="font-mono text-slate-500 shrink-0">
                        {e.createdAt ? new Date(e.createdAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span className="font-mono font-bold text-slate-800 shrink-0">×{Number(e.qty || 0)}</span>
                      <button
                        type="button"
                        onClick={() => e.orderId && setSelectedOrderId(String(e.orderId))}
                        className="font-mono font-bold text-indigo-700 hover:underline truncate flex items-center gap-1"
                        title="Mở chi tiết đơn"
                      >
                        <Receipt className="w-3 h-3 shrink-0" />
                        {e.orderCode || '—'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <OrderDetailModal
        orderId={selectedOrderId}
        isOpen={!!selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        currentRole={currentRole}
      />
    </div>,
    document.body
  );
}
