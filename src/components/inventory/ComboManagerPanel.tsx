'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface WarehouseOpt {
  id: string;
  name: string;
}

interface ComboComponent {
  productId: string;
  productName: string;
  stock: number;
  required: number;
}

interface ComboItem {
  id: string;
  code: string;
  name: string;
  sellingPrice: number;
  stock: number | null;
  components: ComboComponent[];
}

interface BookOpt {
  id: string;
  code: string | null;
  name: string;
  sellingPrice: number;
  stock?: number;
}

interface PickedComponent {
  productId: string;
  productName: string;
  stock: number;
  quantity: number;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Lỗi ${res.status}.`);
  return data;
}

function previewStock(picks: PickedComponent[]): number | null {
  if (picks.length === 0) return null;
  let m = Infinity;
  for (const p of picks) {
    m = Math.min(m, Math.floor((p.stock || 0) / Math.max(1, p.quantity)));
  }
  return m === Infinity ? 0 : m;
}

export function ComboManagerPanel({
  warehouses,
  currentRole = 'ROLE_OWNER',
}: {
  warehouses: WarehouseOpt[];
  currentRole?: string;
}) {
  const canEdit = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || '');
  const [combos, setCombos] = useState<ComboItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form tao/sua
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [search, setSearch] = useState('');
  const [bookOpts, setBookOpts] = useState<BookOpt[]>([]);
  const [picks, setPicks] = useState<PickedComponent[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api(`/api/combos?warehouseId=${encodeURIComponent(warehouseId)}`);
      setCombos(Array.isArray(data?.combos) ? data.combos : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách combo.');
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!modalOpen || !warehouseId) return;
    const t = setTimeout(async () => {
      try {
        const data = await api(
          `/api/combos/books?search=${encodeURIComponent(search)}&warehouseId=${encodeURIComponent(warehouseId)}`
        );
        setBookOpts(Array.isArray(data?.books) ? data.books : []);
      } catch {
        setBookOpts([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, modalOpen, warehouseId]);

  function openCreate() {
    setEditingId(null);
    setCode('');
    setName('');
    setPrice('');
    setSearch('');
    setPicks([]);
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(combo: ComboItem) {
    setEditingId(combo.id);
    setCode(combo.code);
    setName(combo.name);
    setPrice(String(combo.sellingPrice));
    setSearch('');
    setPicks(
      combo.components.map((c) => ({
        productId: c.productId,
        productName: c.productName,
        stock: c.stock,
        quantity: c.required,
      }))
    );
    setFormError('');
    setModalOpen(true);
  }

  function addPick(b: BookOpt) {
    if (picks.some((p) => p.productId === b.id)) return;
    setPicks([...picks, { productId: b.id, productName: b.name, stock: b.stock || 0, quantity: 1 }]);
  }

  async function save() {
    setFormError('');
    if (picks.length === 0) {
      setFormError('Combo phải có ít nhất 1 sách thành phần.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api(`/api/combos/${editingId}/components`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ components: picks.map((p) => ({ productId: p.productId, quantity: p.quantity })) }),
        });
      } else {
        await api('/api/combos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: code.trim(),
            name: name.trim(),
            sellingPrice: Number(price),
            components: picks.map((p) => ({ productId: p.productId, quantity: p.quantity })),
          }),
        });
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Lưu thất bại.');
    } finally {
      setSaving(false);
    }
  }

  const preview = previewStock(picks);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h3 className="text-base font-extrabold text-slate-900">Combo / Box Set</h3>
        <span className="text-xs text-slate-500">Tồn combo = min tồn thành phần, tính động theo kho.</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            aria-label="Kho tính tồn combo"
            className="text-sm border border-slate-300 rounded-lg px-2 py-1.5"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {canEdit && (
            <button
              type="button"
              onClick={openCreate}
              className="text-sm font-bold bg-violet-600 text-white rounded-lg px-3 py-1.5 hover:bg-violet-700"
            >
              Tạo combo mới
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      {loading && <div className="text-sm text-slate-500">Đang tải combo...</div>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
            <tr>
              <th className="px-3 py-2">Mã</th>
              <th className="px-3 py-2">Tên</th>
              <th className="px-3 py-2 text-right">Giá bán</th>
              <th className="px-3 py-2 text-right">Tồn bán được</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => (
              <React.Fragment key={c.id}>
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.code}{' '}
                    <span className="ml-1 text-[10px] font-bold bg-violet-100 text-violet-700 rounded px-1.5 py-0.5">
                      Combo
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold">{c.name}</td>
                  <td className="px-3 py-2 text-right">{Number(c.sellingPrice || 0).toLocaleString('vi-VN')}đ</td>
                  <td className="px-3 py-2 text-right font-bold text-violet-700">
                    {c.stock === null ? '-' : `${c.stock} bộ`}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className="text-xs text-indigo-600 hover:underline mr-2"
                    >
                      {expandedId === c.id ? 'Ẩn' : 'Chi tiết'}
                    </button>
                    {canEdit && (
                      <button type="button" onClick={() => openEdit(c)} className="text-xs text-indigo-600 hover:underline">
                        Sửa
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === c.id && (
                  <tr className="bg-violet-50/50">
                    <td colSpan={5} className="px-3 py-2 text-xs text-slate-600">
                      {c.components.length === 0 && 'Chưa có thành phần.'}
                      {c.components.map((comp) => (
                        <div key={comp.productId} className="flex justify-between gap-2 py-0.5">
                          <span>
                            {comp.productName} <span className="text-slate-400">x{comp.required}</span>
                          </span>
                          <span>
                            tồn {comp.stock} → bán được {Math.floor(comp.stock / Math.max(1, comp.required))} bộ
                          </span>
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {combos.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-500">
                  Chưa có combo nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={editingId ? 'Sửa combo' : 'Tạo combo mới'}
          >
            <h4 className="text-base font-extrabold mb-3">{editingId ? 'Sửa thành phần combo' : 'Tạo combo mới'}</h4>
            {!editingId && (
              <>
                <label className="block text-sm font-semibold mb-1">Mã combo</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="VD: COMBO10"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mb-2"
                />
                <label className="block text-sm font-semibold mb-1">Tên combo</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Combo mùa thu"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mb-2"
                />
                <label className="block text-sm font-semibold mb-1">Giá bán (đ)</label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="numeric"
                  placeholder="VD: 250000"
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mb-2"
                />
              </>
            )}
            <label className="block text-sm font-semibold mb-1">Thêm sách thành phần</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Gõ tên sách để tìm..."
              className="w-full text-sm border border-slate-300 rounded-lg px-2 py-1.5 mb-1"
            />
            {bookOpts.length > 0 && (
              <ul className="border border-slate-200 rounded-lg max-h-36 overflow-y-auto mb-2 text-sm">
                {bookOpts
                  .filter((b) => !picks.some((p) => p.productId === b.id))
                  .slice(0, 8)
                  .map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => addPick(b)}
                        className="w-full text-left px-2 py-1.5 hover:bg-violet-50 flex justify-between gap-2"
                      >
                        <span>{b.name}</span>
                        <span className="text-slate-500 whitespace-nowrap">tồn {b.stock ?? '-'}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {picks.map((p) => (
              <div key={p.productId} className="flex items-center gap-2 text-sm py-1">
                <span className="flex-1">
                  {p.productName} <span className="text-slate-400">(tồn {p.stock})</span>
                </span>
                <label className="text-xs text-slate-500">
                  SL
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={p.quantity}
                    onChange={(e) =>
                      setPicks(picks.map((x) => (x.productId === p.productId ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))
                    }
                    className="w-14 ml-1 text-sm border border-slate-300 rounded px-1 py-0.5"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setPicks(picks.filter((x) => x.productId !== p.productId))}
                  className="text-xs text-red-600 hover:underline"
                >
                  Gỡ
                </button>
              </div>
            ))}
            <p className="text-sm mt-2">
              Tồn combo dự kiến:{' '}
              <strong className="text-violet-700">{preview === null ? '-' : `${preview} bộ`}</strong>
            </p>
            {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex-1 text-sm font-bold bg-violet-600 text-white rounded-lg px-3 py-2 hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? 'Đang lưu...' : editingId ? 'Lưu thành phần' : 'Tạo combo'}
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-2"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
