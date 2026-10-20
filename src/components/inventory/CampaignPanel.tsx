'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BatchTransferModal } from './BatchTransferModal';
import Modal from '../ui/Modal';

interface Campaign {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'ENDED';
  warehouseId?: string | null;
  sourceWarehouseId?: string | null;
}

interface LeftoverLine {
  editionId: string;
  name: string;
  quantity: number;
}

interface CampaignPanelProps {
  books: any[];
  warehouses: Array<{ id: string; code: string; name: string; isActive?: boolean }>;
  /** Mở chuyển hàng ở modal cha (1 modal/lúc) thay vì modal chồng modal. */
  onOpenTransfer?: (c: Campaign) => void;
}

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Nháp', ACTIVE: 'Đang chạy', ENDED: 'Đã xong' };

export function CampaignPanel({ books, warehouses, onOpenTransfer }: CampaignPanelProps) {
  const [list, setList] = useState<Campaign[]>([]);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', sourceWarehouseId: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<Campaign | null>(null);
  /** Dialog xac nhan thay window.confirm. */
  const [confirmDlg, setConfirmDlg] = useState<{ msg: string; onOk: () => void } | null>(null);
  const [leftover, setLeftover] = useState<{ campaign: Campaign; lines: LeftoverLine[] } | null>(null);
  const [report, setReport] = useState<{ campaign: Campaign; data: any } | null>(null);

  const openReport = async (c: Campaign) => {
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(c.id)}/report`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setError(j.error || 'Chưa có báo cáo kỳ.'); return; }
      setReport({ campaign: c, data: j.data });
    } catch {
      setError('Không tải được báo cáo kỳ.');
    }
  };

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/campaigns', { cache: 'no-store' }).then((r) => r.json());
      if (j?.success && Array.isArray(j.data)) setList(j.data);
    } catch {}
  }, []);

  useEffect(() => { void load(); }, [load]);

  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error(j.error || 'Thao tác thất bại.');
    return j.data;
  };

  const doCreate = async () => {
    setError(null); setNotice(null);
    try {
      await call('/api/campaigns', 'POST', form);
      setNotice(`Đã tạo chiến dịch "${form.name}".`);
      setForm({ name: '', startDate: '', endDate: '', sourceWarehouseId: '' });
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const doStart = async (c: Campaign) => {
    setConfirmDlg({
      msg: `Bắt đầu "${c.name}" (sinh kho hội chợ)?`,
      onOk: async () => {
        setConfirmDlg(null);
        setError(null); setNotice(null);
        try {
          await call(`/api/campaigns/${encodeURIComponent(c.id)}/start`, 'POST', {});
          setNotice(`Đã bắt đầu "${c.name}".`);
          await load();
        } catch (e: any) { setError(e.message); }
      },
    });
  };

  const openEnd = async (c: Campaign) => {
    setError(null); setNotice(null);
    try {
      const lines = await call(`/api/campaigns/${encodeURIComponent(c.id)}/leftover`, 'GET');
      setLeftover({ campaign: c, lines: (lines || []).map((l: LeftoverLine) => ({ ...l })) });
    } catch (e: any) { setError(e.message); }
  };

  const doEnd = async () => {
    if (!leftover) return;
    const lv = leftover;
    setConfirmDlg({
      msg: `Kết thúc "${lv.campaign.name}" (chuyển tồn về + ngưng kho)?`,
      onOk: async () => {
        setConfirmDlg(null);
    setError(null); setNotice(null);
    try {
      await call(`/api/campaigns/${encodeURIComponent(leftover.campaign.id)}/end`, 'POST', {
        items: leftover.lines.filter((l) => Number(l.quantity) > 0),
      });
      setNotice(`Đã kết thúc "${leftover.campaign.name}".`);
      setLeftover(null);
      await load();
    } catch (e: any) { setError(e.message); }
      },
    });
  };

  const activeSources = warehouses.filter((w) => (w as any).isActive !== false);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3 relative">
      <Modal open={!!confirmDlg} onClose={() => setConfirmDlg(null)} size="sm" title="Xác nhận">
        {confirmDlg && (
          <>
            <p className="text-slate-900 font-medium">{confirmDlg.msg}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setConfirmDlg(null)} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50">Hủy</button>
              <button onClick={confirmDlg.onOk} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">Xác nhận</button>
            </div>
          </>
        )}
      </Modal>
      <h3 className="text-sm font-extrabold text-slate-900">Chiến dịch bán ngắn hạn</h3>
      {error && <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
      {notice && <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Tên chiến dịch" className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none min-w-[160px]" />
        <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none" />
        <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none" />
        <select value={form.sourceWarehouseId} onChange={(e) => setForm({ ...form, sourceWarehouseId: e.target.value })}
          className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none max-w-[190px]">
          <option value="">- Kho nguồn -</option>
          {activeSources.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
        </select>
        <button type="button" onClick={doCreate}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer">
          Tạo
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-slate-400">Chưa có chiến dịch nào.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {list.map((c) => (
            <div key={c.id} className="py-2 flex flex-wrap items-center gap-2">
              <div className="min-w-[200px] flex-1">
                <p className="text-xs font-extrabold text-slate-900">{c.name}</p>
                <p className="text-[11px] text-slate-500">{c.startDate} → {c.endDate} · {STATUS_LABEL[c.status] || c.status}</p>
              </div>
              {c.status === 'DRAFT' && (
                <button type="button" onClick={() => doStart(c)}
                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold cursor-pointer">
                  Bắt đầu
                </button>
              )}
              {c.status === 'ACTIVE' && (
                <>
                  <button type="button" onClick={() => (onOpenTransfer ? onOpenTransfer(c) : setTransferFor(c))}
                    className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold cursor-pointer">
                    Chuyển hàng vào
                  </button>
                  <button type="button" onClick={() => openEnd(c)}
                    className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold cursor-pointer">
                    Kết thúc
                  </button>
                </>
              )}
              {c.status === 'ENDED' && (
                <button type="button" onClick={() => openReport(c)}
                  className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-[11px] font-bold cursor-pointer">
                  Báo cáo kỳ
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {leftover && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-extrabold text-amber-900">Tồn thừa "{leftover.campaign.name}" - sửa số rồi Duyệt:</p>
          {leftover.lines.length === 0 && <p className="text-[11px] text-slate-500">Kho trống - Duyệt để ngưng kho luôn.</p>}
          {leftover.lines.map((l, i) => (
            <div key={l.editionId} className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-700 flex-1 truncate">{l.name}</span>
              <input type="number" min={0} value={l.quantity}
                onChange={(e) => setLeftover({
                  ...leftover,
                  lines: leftover.lines.map((x, j) => (j === i ? { ...x, quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)),
                })}
                className="w-20 px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-right outline-none" />
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={doEnd}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold cursor-pointer">
              Duyệt
            </button>
            <button type="button" onClick={() => setLeftover(null)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold text-slate-600 cursor-pointer">
              Hủy
            </button>
          </div>
        </div>
      )}

      {!onOpenTransfer && transferFor?.warehouseId && (
        <BatchTransferModal
          isOpen={!!transferFor}
          onClose={() => setTransferFor(null)}
          books={books}
          warehouses={warehouses}
          onSuccess={() => setTransferFor(null)}
          initialToWarehouseId={transferFor.warehouseId}
        />
      )}

      {report && (
        <Modal open={!!report} onClose={() => setReport(null)} title={`Báo cáo kỳ - ${report.campaign.name}`} size="lg">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">DOANH THU</p>
                <p className="text-base font-extrabold text-slate-900">{Number(report.data.revenue || 0).toLocaleString('vi-VN')}đ</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">SỐ ĐƠN</p>
                <p className="text-base font-extrabold text-slate-900">{report.data.orderCount}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">CUỐN ĐÃ BÁN</p>
                <p className="text-base font-extrabold text-slate-900">{report.data.itemsSold}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">THỪA CHUYỂN VỀ</p>
                <p className="text-base font-extrabold text-slate-900">{report.data.leftoverQuantity} cuốn</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Kỳ: {report.campaign.startDate} đến {report.campaign.endDate} · Sinh lúc {report.data.createdAt} · Nguồn: {report.data.generatedBy === 'system-cron' || report.data.generatedBy === 'system-auto' ? 'Tự động' : report.data.generatedBy}
            </p>
            {Array.isArray(report.data.soldItems) && report.data.soldItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-700 mb-1">Đã bán</p>
                <div className="divide-y divide-slate-100 max-h-48 overflow-auto">
                  {report.data.soldItems.map((it: any) => (
                    <div key={it.editionId} className="py-1 flex justify-between text-[11px]">
                      <span className="text-slate-700 truncate flex-1">{it.name}</span>
                      <span className="font-mono font-bold">{it.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(report.data.leftoverItems) && report.data.leftoverItems.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-700 mb-1">Thừa chuyển về kho nguồn</p>
                <div className="divide-y divide-slate-100 max-h-48 overflow-auto">
                  {report.data.leftoverItems.map((it: any) => (
                    <div key={it.editionId} className="py-1 flex justify-between text-[11px]">
                      <span className="text-slate-700 truncate flex-1">{it.name || it.editionId}</span>
                      <span className="font-mono font-bold">{it.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={() => setReport(null)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-[11px] font-bold cursor-pointer">
                Đóng
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
