'use client';

import { useEffect, useState } from 'react';
import { X, Megaphone } from 'lucide-react';
import { PortalToBody } from '../PortalToBody';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import { CampaignPanel } from './CampaignPanel';
import { BatchTransferModal } from './BatchTransferModal';
import type { UserRole } from '@/lib/roles';

interface Campaign {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'ENDED';
  warehouseId?: string | null;
  sourceWarehouseId?: string | null;
}

interface CampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: any[];
  warehouses: Array<{ id: string; code: string; name: string; isActive?: boolean }>;
  currentRole?: UserRole;
}

/**
 * Modal "Chiến dịch bán ngắn hạn" - chỉ Chủ/Quản lý.
 * Luật 1 modal/lúc: chuyển hàng vào là 1 view bên trong, không modal chồng modal.
 * Gom đầy đủ: tạo/vận hành + kho hội chợ (POS, ngưng/mở, TK nhận tiền) + nhân sự.
 */
export function CampaignModal({ isOpen, onClose, books, warehouses, currentRole }: CampaignModalProps) {
  const [mounted, setMounted] = useState(false);
  const [transferFor, setTransferFor] = useState<Campaign | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [fullWh, setFullWh] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [banks, setBanks] = useState<Array<{ id: string; label: string; accountNo: string }>>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const panelRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, () => {
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!isOpen) return;
    setMsg(null);
    setTransferFor(null);
    (async () => {
      try {
        const [c, w, s, b] = await Promise.all([
          fetch('/api/campaigns', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
          fetch('/api/warehouses?all=true&includeInactive=true', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
          fetch('/api/staff', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
          fetch('/api/bank-accounts').then((r) => r.json()).catch(() => null),
        ]);
        if (Array.isArray(c?.data)) {
          setCampaigns(c.data);
          setDetailId((prev) => prev || c.data.find((x: Campaign) => x.status === 'ACTIVE')?.id || c.data[0]?.id || null);
        }
        if (Array.isArray(w?.data)) setFullWh(w.data);
        if (Array.isArray(s?.data)) setStaff(s.data);
        const blist = Array.isArray(b?.data?.list) ? b.data.list : Array.isArray(b?.data) ? b.data : [];
        setBanks(blist);
      } catch {}
    })();
  }, [isOpen]);

  if (!isOpen || !mounted) return null;
  if (currentRole !== 'ROLE_OWNER' && currentRole !== 'ROLE_MANAGER') return null;

  const patch = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) throw new Error(j?.error || 'Thao tác thất bại.');
    return j.data;
  };

  const refreshDetail = async () => {
    try {
      const w = await fetch('/api/warehouses?all=true&includeInactive=true', { cache: 'no-store' }).then((r) => r.json());
      if (Array.isArray(w?.data)) setFullWh(w.data);
      const s = await fetch('/api/staff', { cache: 'no-store' }).then((r) => r.json());
      if (Array.isArray(s?.data)) setStaff(s.data);
    } catch {}
  };

  const runDetail = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await refreshDetail();
      setMsg(`✅ ${label}`);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || label + ' thất bại.'}`);
    } finally {
      setBusy(false);
    }
  };

  const detail = campaigns.find((c) => c.id === detailId) || null;  const fairWh = detail?.warehouseId ? fullWh.find((w) => w.id === detail.warehouseId) : null;
  const sourceWh = detail?.sourceWarehouseId
    ? fullWh.find((w) => w.id === detail.sourceWarehouseId) || warehouses.find((w) => w.id === detail.sourceWarehouseId)
    : null;
  const assignedStaff = fairWh ? staff.filter((s) => `${s.assignedWarehouseId || ''}` === fairWh.id && s.isActive !== false) : [];

  // Luật 1 modal/lúc: view chuyển hàng THAY shell chiến dịch, không đè lên.
  if (transferFor?.warehouseId) {
    return (
      <BatchTransferModal
        isOpen
        onClose={() => setTransferFor(null)}
        books={books}
        warehouses={warehouses}
        onSuccess={() => setTransferFor(null)}
        initialToWarehouseId={transferFor.warehouseId}
      />
    );
  }

  return (
    <PortalToBody
      className="fixed inset-0 z-[90] bg-slate-950/70 flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chiến dịch bán ngắn hạn"
        className="w-full max-w-[min(44rem,calc(100vw-1.5rem))] min-w-0 my-auto rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-extrabold text-slate-900 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-indigo-600" />
            Chiến Dịch Bán Ngắn Hạn
          </p>
          <button
            type="button"
            aria-label="Đóng chiến dịch"
            onClick={onClose}
            disabled={busy}
            className="shrink-0 min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {(
          <div className="p-4 space-y-4 max-h-[min(40rem,80vh)] overflow-y-auto">
            {msg && (
              <p role="status" className="text-[11px] font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-700 break-words">
                {msg}
              </p>
            )}
            <CampaignPanel books={books} warehouses={warehouses} onOpenTransfer={setTransferFor} />

            {campaigns.length > 0 && (
              <section aria-label="Chi tiết chiến dịch" className="rounded-xl border border-slate-200 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-bold text-slate-700" htmlFor="campaign-detail-select">
                    Chi tiết:
                  </label>
                  <select
                    id="campaign-detail-select"
                    value={detailId || ''}
                    onChange={(e) => setDetailId(e.target.value || null)}
                    className="flex-1 min-w-[12rem] px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold outline-none"
                  >
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {detail && (
                  <div className="text-xs text-slate-600 space-y-1">
                    <p>
                      <span className="font-bold text-slate-800">Kho hội chợ:</span>{' '}
                      {fairWh ? fairWh.name : detail.warehouseId || '(chưa sinh - bấm Bắt đầu)'}
                    </p>
                    <p>
                      <span className="font-bold text-slate-800">Kho nguồn:</span>{' '}
                      {sourceWh ? sourceWh.name : detail.sourceWarehouseId || '-'}
                    </p>
                    <p>
                      <span className="font-bold text-slate-800">Thời gian:</span> {detail.startDate} → {detail.endDate}
                    </p>
                  </div>
                )}

                {fairWh && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          runDetail(`${fairWh.isSellableOnPos ? 'Đã tắt' : 'Đã bật'} bán POS`, () =>
                            patch(`/api/warehouses/${encodeURIComponent(fairWh.id)}`, 'PATCH', {
                              isSellableOnPos: !fairWh.isSellableOnPos,
                            })
                          )
                        }
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 cursor-pointer"
                      >
                        {fairWh.isSellableOnPos ? 'Tắt bán POS' : 'Bật bán POS'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          runDetail(`${fairWh.isActive ? 'Đã ngưng' : 'Đã mở lại'} kho`, () =>
                            patch(`/api/warehouses/${encodeURIComponent(fairWh.id)}`, 'PATCH', {
                              isActive: !fairWh.isActive,
                            })
                          )
                        }
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        {fairWh.isActive ? 'Ngưng kho' : 'Mở lại kho'}
                      </button>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1" htmlFor="campaign-bank-select">
                        TK nhận VietQR của kho hội chợ:
                      </label>
                      <select
                        id="campaign-bank-select"
                        value={fairWh.defaultBankAccountId || ''}
                        disabled={busy}
                        onChange={(e) =>
                          runDetail('Đã gán TK nhận tiền', () =>
                            patch('/api/bank-accounts', 'PATCH', {
                              warehouseId: fairWh.id,
                              bankAccountId: e.target.value || null,
                            })
                          )
                        }
                        className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none"
                      >
                        <option value="">- TK mặc định chung -</option>
                        {banks.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label} - {b.accountNo}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-slate-700 mb-1">
                        Nhân sự tại kho ({assignedStaff.length}):
                      </p>
                      {assignedStaff.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {assignedStaff.map((s) => (
                            <span
                              key={s.staffId}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800"
                            >
                              {s.fullName || s.staffId}
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={`Gỡ ${s.fullName || s.staffId} khỏi kho`}
                                onClick={() =>
                                  runDetail(`Đã gỡ ${s.fullName || s.staffId}`, () =>
                                    patch(`/api/staff/${encodeURIComponent(s.staffId)}`, 'PATCH', {
                                      assignedWarehouseId: null,
                                    })
                                  )
                                }
                                className="text-emerald-500 hover:text-emerald-800 disabled:opacity-50 cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 mb-2">Chưa gán ai - thu ngân tự chọn kho.</p>
                      )}
                      <select
                        aria-label="Gán nhân sự vào kho hội chợ"
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          const id = e.target.value;
                          if (!id) return;
                          const person = staff.find((s) => s.staffId === id);
                          runDetail(`Đã gán ${person?.fullName || id}`, () =>
                            patch(`/api/staff/${encodeURIComponent(id)}`, 'PATCH', {
                              assignedWarehouseId: fairWh.id,
                            })
                          );
                        }}
                        className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none"
                      >
                        <option value="">+ Gán nhân sự...</option>
                        {staff
                          .filter((s) => s.isActive !== false && `${s.assignedWarehouseId || ''}` !== fairWh.id)
                          .map((s) => (
                            <option key={s.staffId} value={s.staffId}>
                              {s.fullName || s.staffId} ({s.staffId})
                            </option>
                          ))}
                      </select>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </PortalToBody>
  );
}
