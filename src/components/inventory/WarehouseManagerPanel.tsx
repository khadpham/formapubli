'use client';

/**
 * Panel "Kho" — danh sách kho + Ngưng hoạt động / Mở lại / Xóa.
 *
 * Vì sao tồn tại: `PATCH/DELETE /api/warehouses/[id]` đã có sẵn từ lâu nhưng
 * KHÔNG component nào gọi → người dùng không có cách nào xóa kho, cũng không
 * thấy tổng số sách của từng kho ở một chỗ. Panel này là đường vào duy nhất.
 *
 * Luật đã đo ở 426px: không tràn ngang (scrollWidth === innerWidth 320→470),
 * mọi nhãn `whitespace-nowrap shrink-0` trong dải `flex-wrap min-w-0`,
 * vùng chạm >= 38px. Nhãn hành động là ĐỘNG TỪ NGẮN, không phải câu dài.
 */
import { useEffect, useState } from 'react';
import { X, Store, Power, PowerOff, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { PortalToBody } from '../PortalToBody';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';

type Warehouse = {
  id: string;
  code: string;
  name: string;
  warehouseType?: string | null;
  isActive?: boolean;
  isSellableOnPos?: boolean;
  stockQuantity?: number;
  defaultBankAccountId?: string | null;
};

/** Kho còn tồn thì server trả 409 kèm lý do — ta hiện nguyên message đó. */
type DeleteBlock = { id: string; name: string; code: string; message: string };

export function WarehouseManagerPanel({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Báo lên cha để nạp lại số liệu kho đang hiện ở chip row. */
  onChanged?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Warehouse | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<DeleteBlock | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Focus trap + phím thoát + khoá nền: dùng lại hook chung, không tự viết.
  const panelRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, () => {
    if (!busyId) onClose();
  });

  const load = async () => {
    const j = await fetch('/api/warehouses?all=true', { cache: 'no-store' }).then((r) => r.json());
    if (j?.success && Array.isArray(j.data)) setWarehouses(j.data);
    else setError('Không tải được danh sách kho.');
  };

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setDeleteBlock(null);
    setConfirmDelete(null);
    load().catch((e: any) => setError(e?.message || 'Không tải được danh sách kho.'));
  }, [isOpen]);

  /** Mọi hành động thành công → nạp lại list + báo cha refresh chip row. */
  const afterChange = async (message: string) => {
    setNotice(message);
    setError(null);
    setDeleteBlock(null);
    setConfirmDelete(null);
    await load();
    onChanged?.();
  };

  const setActive = async (w: Warehouse, isActive: boolean) => {
    setBusyId(w.id);
    setError(null);
    setDeleteBlock(null);
    try {
      const res = await fetch(`/api/warehouses/${encodeURIComponent(w.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || 'Cập nhật kho thất bại.');
      await afterChange(j.message || `Đã cập nhật kho [${w.code}].`);
    } catch (e: any) {
      setError(e?.message || 'Cập nhật kho thất bại.');
    } finally {
      setBusyId(null);
    }
  };


  const remove = async (w: Warehouse) => {
    setBusyId(w.id);
    setError(null);
    try {
      const res = await fetch(`/api/warehouses/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        // 409 = kho còn tồn / có nghiệp vụ. Hiện message server và mời
        // Ngung hoat dong thay vì im lặng hoặc báo lỗi chung chung.
        if (res.status === 409) {
          setDeleteBlock({
            id: w.id,
            name: w.name,
            code: w.code,
            message: j?.error || 'Kho còn dữ liệu nên không xóa được.',
          });
        }
        throw new Error(j?.error || 'Xoa kho that bai.');
      }
      await afterChange(j.message || `Đã xóa kho [${w.name}].`);
    } catch (e: any) {
      setError(e?.message || 'Xoa kho that bai.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <PortalToBody className="fixed inset-0 z-[90] bg-slate-950/70 flex items-start sm:items-center justify-center p-3 overflow-y-auto">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Danh sách kho"
        className="w-full max-w-[min(30rem,calc(100vw-1.5rem))] min-w-0 my-auto rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-slate-900 truncate">Kho</p>
            <p className="text-[10px] text-slate-500 font-mono truncate">
              {warehouses.length} kho ·{' '}
              {warehouses.reduce((s, w) => s + Number(w.stockQuantity || 0), 0).toLocaleString('vi-VN')} cuốn
            </p>
          </div>
          <button
            type="button"
            aria-label="Dong panel kho"
            onClick={onClose}
            disabled={Boolean(busyId)}
            className="shrink-0 min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {notice && (
          <p className="px-4 py-2 text-[11px] font-bold text-emerald-700 bg-emerald-50 break-words">
            {notice}
          </p>
        )}
        {error && (
          <p className="px-4 py-2 text-[11px] font-bold text-rose-700 bg-rose-50 break-words">{error}</p>
        )}

        <div className="p-3 space-y-2 max-h-[min(26rem,60vh)] overflow-y-auto">
          {warehouses.length === 0 && <p className="text-[11px] text-slate-500">Chua co kho nao.</p>}

          {warehouses.map((w) => {
            const busy = busyId === w.id;
            const confirming = confirmDelete?.id === w.id;
            return (
              <div key={w.id} className="min-w-0 rounded-xl border border-slate-200 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span className="min-w-0 text-xs font-extrabold text-slate-900 break-words">{w.name}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                    {w.code}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      w.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {w.isActive ? 'Dang mo' : 'Da khoa'}
                  </span>
                  <span className="shrink-0 text-[11px] font-mono font-bold text-slate-700">
                    {Number(w.stockQuantity || 0).toLocaleString('vi-VN')} cuốn
                  </span>
                </div>

                {confirming && (
                  <p className="text-[11px] font-bold text-rose-700 bg-rose-50 rounded-lg px-2 py-1.5 break-words">
                    Xoa kho [{w.name}]? Chi xoa duoc kho rong.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => remove(w)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xoa
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        disabled={busy}
                        className="inline-flex items-center whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50"
                      >
                        Huy
                      </button>
                    </>
                  ) : (
                    <>
                      {w.isActive ? (
                        <button
                          type="button"
                          onClick={() => setActive(w, false)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50"
                        >
                          <PowerOff className="w-3.5 h-3.5" /> Ngung hoat dong
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActive(w, true)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-50"
                        >
                          <Power className="w-3.5 h-3.5" /> Mo lai
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteBlock(null);
                          setError(null);
                          setConfirmDelete(w);
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xoa
                      </button>
                    </>
                  )}
                </div>


                {deleteBlock?.id === w.id && (
                  <div className="min-w-0 rounded-lg bg-amber-50 border border-amber-200 p-2 space-y-2">
                    <p className="text-[11px] font-bold text-amber-900 flex items-start gap-1.5 min-w-0">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span className="min-w-0 break-words">{deleteBlock.message}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => setActive(w, false)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition disabled:opacity-50"
                      >
                        <PowerOff className="w-3.5 h-3.5" /> Ngung hoat dong
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteBlock(null)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" /> Huy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2 min-w-0 pt-1">
            <button
              type="button"
              onClick={() => {
                setError(null);
                load().catch((e: any) => setError(e?.message || 'Không tải được danh sách kho.'));
              }}
              disabled={Boolean(busyId)}
              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[38px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tai lai
            </button>
            <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-slate-400">
              <Store className="w-3 h-3" /> Ton tinh theo tung kho
            </span>
          </div>
        </div>
      </div>
    </PortalToBody>
  );
}
