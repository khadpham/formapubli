'use client';

/**
 * Panel "Kho" — danh sách kho + Sửa tên / Đổi thứ tự / Ngưng hoạt động / Mở lại / Xoá.
 *
 * Tiêu chuẩn:
 * - 100% tiếng Việt có dấu.
 * - Sửa tên kho inline.
 * - Đổi thứ tự hiển thị kho bằng nút Lên (▲) / Xuống (▼).
 * - Không tràn ngang ở màn hình 320px-426px, vùng bấm >= 38px.
 */
import { useEffect, useState } from 'react';
import { X, Store, Power, PowerOff, Trash2, RefreshCw, AlertTriangle, Edit3, ArrowUp, ArrowDown, Check } from 'lucide-react';
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
  sortOrder?: number;
};

/** Kho còn tồn thì server trả 409 kèm lý do — ta hiện nguyên message đó. */
type DeleteBlock = { id: string; name: string; code: string; message: string };

export function WarehouseManagerPanel({
  isOpen,
  onClose,
  onChanged,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Báo lên cha để nạp lại số liệu kho đang hiện ở chip row. */
  onChanged?: () => void;
  /** Báo kho vừa tạo (cha hiện banner + CTA chuyển hàng vào). */
  onCreated?: (w: any) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Warehouse | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<DeleteBlock | null>(null);

  // Sửa tên kho inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  // Form "Mở kho mới" gấp gọn NGAY TRONG panel — luật 1 modal: không mở
  // modal con đè lên panel (nguyên nhân 2 lớp modal chồng nhau).
  const [showCreate, setShowCreate] = useState(false);
  const [cName, setCName] = useState('');
  const [cCode, setCCode] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cType, setCType] = useState<'FAIR_EVENT' | 'PHYSICAL_MAIN'>('FAIR_EVENT');
  const [cSellable, setCSellable] = useState(true);
  const [cBankId, setCBankId] = useState('');
  const [cBanks, setCBanks] = useState<Array<{ id: string; label: string; accountNo: string }>>([]);
  const [cBusy, setCBusy] = useState(false);

  const toggleCreate = () => {
    const next = !showCreate;
    setShowCreate(next);
    setError(null);
    if (next && cBanks.length === 0) {
      fetch('/api/bank-accounts')
        .then((r) => r.json())
        .then((j) => {
          if (j?.success && Array.isArray(j.data?.list)) setCBanks(j.data.list);
        })
        .catch(() => {});
    }
  };

  const handleCName = (val: string) => {
    setCName(val);
    const slug = val
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    setCCode(slug ? (slug.startsWith('KHO_') ? slug : `KHO_${slug}`) : '');
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cName.trim()) {
      setError('Vui lòng nhập tên kho hoặc gian hàng.');
      return;
    }
    setCBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cName.trim(),
          code: cCode.trim() || undefined,
          address: cAddress.trim() || undefined,
          warehouseType: cType,
          isSellableOnPos: cSellable,
          defaultBankAccountId: cBankId || undefined,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || j?.message || 'Mở kho thất bại.');
      setShowCreate(false);
      setCName('');
      setCCode('');
      setCAddress('');
      setCType('FAIR_EVENT');
      setCSellable(true);
      setCBankId('');
      await afterChange(`Đã mở kho [${j.data?.name || cName.trim()}].`);
      onCreated?.(j.data);
    } catch (err: any) {
      setError(err?.message || 'Mở kho thất bại.');
    } finally {
      setCBusy(false);
    }
  };

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
    setEditingId(null);
    load().catch((e: any) => setError(e?.message || 'Không tải được danh sách kho.'));
  }, [isOpen]);

  /** Mọi hành động thành công → nạp lại list + báo cha refresh chip row. */
  const afterChange = async (message: string) => {
    setNotice(message);
    setError(null);
    setDeleteBlock(null);
    setConfirmDelete(null);
    setEditingId(null);
    await load();
    onChanged?.();
  };

  const saveName = async (w: Warehouse) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setError('Tên kho không được để trống.');
      return;
    }
    setBusyId(w.id);
    setError(null);
    try {
      const res = await fetch(`/api/warehouses/${encodeURIComponent(w.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || 'Đổi tên kho thất bại.');
      setEditingId(null);
      await afterChange(`Đã đổi tên kho thành [${trimmed}].`);
    } catch (e: any) {
      setError(e?.message || 'Đổi tên kho thất bại.');
    } finally {
      setBusyId(null);
    }
  };

  const moveWarehouse = async (index: number, direction: 'UP' | 'DOWN') => {
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= warehouses.length) return;
    const current = warehouses[index];
    if (!current) return;

    // 1. Tạo mảng mới theo thứ tự đã đổi
    const newList = [...warehouses];
    const [moved] = newList.splice(index, 1);
    newList.splice(targetIndex, 0, moved);

    // 2. Cập nhật giao diện tức thì (Optimistic UI)
    setWarehouses(newList);
    setBusyId(current.id);
    setError(null);

    try {
      // 3. Chuẩn hóa và lưu sortOrder tuần tự 0, 1, 2, ... cho toàn bộ danh sách để loại bỏ hoàn toàn va chạm mốc 0 cũ.
      //
      // PHẢI kiểm `res.ok`: `fetch` KHÔNG throw khi HTTP 500, nên không kiểm thì
      // một kho bị từ chối vẫn bị báo "Đã đổi vị trí", UI giữ thứ tự tối ưu
      // trong khi server không lưu ⇒ refresh là thứ tự tự nhảy về cũ, không báo lỗi.
      // Dùng `allSettled` để mọi PATCH hoàn tất trước khi kết luận, tránh `load()`
      // trong catch chạy đè lên PATCH còn đang bay.
      const results = await Promise.allSettled(
        newList.map(async (wh, idx) => {
          wh.sortOrder = idx;
          const res = await fetch(`/api/warehouses/${encodeURIComponent(wh.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortOrder: idx }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body?.success) {
            throw new Error(body?.error || `Không lưu được thứ tự kho [${wh.name}].`);
          }
        })
      );

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        // Nói rõ đã lưu được mấy kho: lỗi một kho làm cả danh sách lệch.
        throw new Error(
          failed.length === results.length
            ? 'Đổi vị trí kho thất bại.'
            : `Chỉ lưu được ${results.length - failed.length}/${results.length} kho — thứ tự chưa chắc đúng.`
        );
      }

      await afterChange(`Đã đổi vị trí kho [${current.name}].`);
    } catch (e: any) {
      setError(e?.message || 'Đổi vị trí kho thất bại.');
      await load();
    } finally {
      setBusyId(null);
    }
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

  const setSellable = async (w: Warehouse, isSellableOnPos: boolean) => {
    setBusyId(w.id);
    setError(null);
    setDeleteBlock(null);
    try {
      const res = await fetch(`/api/warehouses/${encodeURIComponent(w.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSellableOnPos }),
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
        if (res.status === 409) {
          setDeleteBlock({
            id: w.id,
            name: w.name,
            code: w.code,
            message: j?.error || 'Kho còn dữ liệu nên không xoá được.',
          });
          return;
        }
        throw new Error(j?.error || 'Xoá kho thất bại.');
      }
      await afterChange(j.message || `Đã xoá kho [${w.name}].`);
    } catch (e: any) {
      setError(e?.message || 'Xoá kho thất bại.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <PortalToBody
      className="fixed inset-0 z-[90] bg-slate-950/70 flex items-start sm:items-center justify-center p-3 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busyId) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Danh sách kho"
        className="w-full max-w-[min(34rem,calc(100vw-1.5rem))] min-w-0 my-auto rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-slate-900 truncate">Quản Lý Kho Hàng</p>
            <p className="text-[10px] text-slate-500 font-mono truncate">
              {warehouses.length} kho ·{' '}
              {warehouses.reduce((s, w) => s + Number(w.stockQuantity || 0), 0).toLocaleString('vi-VN')} cuốn
            </p>
          </div>
          {(
            <button
              type="button"
              onClick={toggleCreate}
              aria-expanded={showCreate}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/40 rounded-lg text-xs font-bold transition-colors"
            >
              <Store className="w-3.5 h-3.5" /> Mở kho mới
            </button>
          )}
          <button
            type="button"
            aria-label="Đóng panel kho"
            onClick={onClose}
            disabled={Boolean(busyId)}
            className="shrink-0 min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition disabled:opacity-50 cursor-pointer"
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

        <div className="p-3 space-y-2 max-h-[min(30rem,65vh)] overflow-y-auto">
          {showCreate && (
            <form
              onSubmit={submitCreate}
              className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 space-y-2.5"
              aria-label="Mở kho mới"
            >
              <p className="text-xs font-extrabold text-slate-900">Mở Kho / Gian Hàng Mới</p>
              <input
                type="text"
                required
                value={cName}
                onChange={(e) => handleCName(e.target.value)}
                placeholder="Tên kho / gian hàng *"
                aria-label="Tên kho mới"
                className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={cCode}
                  onChange={(e) => setCCode(e.target.value.toUpperCase())}
                  placeholder="Mã kho (tự sinh)"
                  aria-label="Mã kho mới"
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-amber-500"
                />
                <input
                  type="text"
                  value={cAddress}
                  onChange={(e) => setCAddress(e.target.value)}
                  placeholder="Địa chỉ / vị trí"
                  aria-label="Địa chỉ kho mới"
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={cType}
                  onChange={(e) => setCType(e.target.value as 'FAIR_EVENT' | 'PHYSICAL_MAIN')}
                  aria-label="Phân loại kho mới"
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold outline-none"
                >
                  <option value="FAIR_EVENT">Hội Chợ / Sự Kiện</option>
                  <option value="PHYSICAL_MAIN">Kho Cố Định</option>
                </select>
                <select
                  value={cBankId}
                  onChange={(e) => setCBankId(e.target.value)}
                  aria-label="TK nhận VietQR kho mới"
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs outline-none"
                >
                  <option value="">— TK mặc định chung —</option>
                  {cBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} — {b.accountNo}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={cSellable}
                  onChange={(e) => setCSellable(e.target.checked)}
                  className="w-4 h-4"
                />
                Bán POS tại kho này
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={cBusy || !cName.trim()}
                  className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs disabled:opacity-50 cursor-pointer"
                >
                  {cBusy ? 'Đang tạo...' : 'Tạo Kho Ngay'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  disabled={cBusy}
                  className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-600 cursor-pointer"
                >
                  Huỷ
                </button>
              </div>
            </form>
          )}
          {warehouses.length === 0 && <p className="text-[11px] text-slate-500">Chưa có kho nào.</p>}

          {warehouses.map((w, idx) => {
            const busy = busyId === w.id;
            const confirming = confirmDelete?.id === w.id;
            const isEditing = editingId === w.id;

            return (
              <div key={w.id} className="min-w-0 rounded-xl border border-slate-200 p-3 space-y-2.5 bg-white hover:border-slate-300 transition">
                {/* Thông tin đầu dòng kho */}
                <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 min-w-0 w-full sm:w-auto">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="px-2.5 py-1 text-xs font-bold border border-indigo-400 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-60"
                          placeholder="Tên kho..."
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => saveName(w)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                        >
                          <Check className="w-3 h-3" /> Lưu
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                          className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-1 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                        >
                          Huỷ
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="min-w-0 text-xs font-extrabold text-slate-900 break-words">{w.name}</span>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                          {w.code}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            w.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {w.isActive ? 'Đang mở' : 'Đã khoá'}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            w.isSellableOnPos ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {w.isSellableOnPos ? 'Đang bán' : 'Đã ẩn'}
                        </span>
                        <span className="shrink-0 text-[11px] font-mono font-bold text-slate-700">
                          {Number(w.stockQuantity || 0).toLocaleString('vi-VN')} cuốn
                        </span>
                      </>
                    )}
                  </div>

                  {/* Nút di chuyển vị trí kho Lên / Xuống */}
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveWarehouse(idx, 'UP')}
                        disabled={busy || idx === 0}
                        title="Di chuyển kho lên trên"
                        className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveWarehouse(idx, 'DOWN')}
                        disabled={busy || idx === warehouses.length - 1}
                        title="Di chuyển kho xuống dưới"
                        className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {confirming && (
                  <p className="text-[11px] font-bold text-rose-700 bg-rose-50 rounded-lg px-2.5 py-1.5 break-words">
                    Xoá kho [{w.name}]? Chỉ xoá được kho rỗng và chưa có đơn/phiếu.
                  </p>
                )}

                {/* Các nút thao tác */}
                <div className="flex flex-wrap items-center gap-2 min-w-0 pt-1 border-t border-slate-100">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => remove(w)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xoá
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        disabled={busy}
                        className="inline-flex items-center whitespace-nowrap shrink-0 min-h-[36px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        Huỷ
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(w.id);
                          setEditingName(w.name);
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-indigo-600" /> Sửa
                      </button>

                      {w.isActive ? (
                        <button
                          type="button"
                          onClick={() => setActive(w, false)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                        >
                          <PowerOff className="w-3.5 h-3.5 text-amber-600" /> Ngưng hoạt động
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActive(w, true)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                        >
                          <Power className="w-3.5 h-3.5" /> Mở lại
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setSellable(w, !w.isSellableOnPos)}
                        disabled={busy}
                        title={w.isSellableOnPos ? 'Ẩn kho khỏi POS' : 'Cho kho bán trên POS'}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        <Store className="w-3.5 h-3.5 text-indigo-600" /> {w.isSellableOnPos ? 'Ẩn khỏi POS' : 'Bán POS'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDeleteBlock(null);
                          setError(null);
                          setConfirmDelete(w);
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-2.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xoá
                      </button>
                    </>
                  )}
                </div>

                {deleteBlock?.id === w.id && (
                  <div className="min-w-0 rounded-lg bg-amber-50 border border-amber-200 p-2.5 space-y-2">
                    <p className="text-[11px] font-bold text-amber-900 flex items-start gap-1.5 min-w-0">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span className="min-w-0 break-words">{deleteBlock.message}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => setActive(w, false)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        <PowerOff className="w-3.5 h-3.5" /> Ngưng hoạt động
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteBlock(null)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" /> Huỷ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-2 min-w-0 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setError(null);
                load().catch((e: any) => setError(e?.message || 'Không tải được danh sách kho.'));
              }}
              disabled={Boolean(busyId)}
              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 min-h-[36px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tải lại
            </button>
            <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-slate-400">
              <Store className="w-3 h-3" /> Tồn tính theo từng kho
            </span>
          </div>
        </div>
      </div>
    </PortalToBody>
  );
}
