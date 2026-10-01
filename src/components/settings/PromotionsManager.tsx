'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, Save, X, AlertTriangle, ToggleRight, ToggleLeft, Gift } from 'lucide-react';
import { giftValueWarning } from '@/lib/promotion-engine';
import { normalizePrice, formatPriceInput } from '@/components/products/GoodsCatalogManager';

interface GiftRow {
  minSubtotal: number;
  productId: string;
  giftQuantity: number;
}

interface Campaign {
  id: string;
  name: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  gifts: GiftRow[];
}

interface ProductOption {
  id: string;
  name: string;
  code: string | null;
  sellingPrice: number;
}

async function readJsonSafe(res: Response): Promise<any> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

const SERVER_BAD_RESPONSE = 'Máy chủ không phản hồi đúng. Bạn thử lại sau giây lát.';

interface PromoFormModalProps {
  isOpen: boolean;
  row: Campaign | null;
  products: ProductOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function PromoFormModal({ isOpen, row, products, onClose, onSaved }: PromoFormModalProps) {
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [gifts, setGifts] = useState<Array<{ minSubtotal: string; productId: string; giftQuantity: string }>>([
    { minSubtotal: '', productId: '', giftQuantity: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setName(row?.name ?? '');
    setStartsAt(row?.startsAt ?? '');
    setEndsAt(row?.endsAt ?? '');
    setGifts(
      row?.gifts?.length
        ? row.gifts.map((g) => ({
            minSubtotal: String(g.minSubtotal),
            productId: g.productId,
            giftQuantity: String(g.giftQuantity),
          }))
        : [{ minSubtotal: '', productId: '', giftQuantity: '' }]
    );
  }, [isOpen, row]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !mounted) return null;

  const addRow = () => setGifts([...gifts, { minSubtotal: '', productId: '', giftQuantity: '' }]);
  const removeRow = (i: number) => setGifts(gifts.filter((_, idx) => idx !== i));

  // Cảnh báo giá trị quà theo TỪNG bậc: tổng giá quà trong bậc so với mốc bậc đó.
  const warnings: string[] = [];
  const byTier = new Map<number, { value: number; base: number }>();
  for (const g of gifts) {
    const min = normalizePrice(g.minSubtotal);
    const p = products.find((x) => x.id === g.productId);
    const qty = Number(g.giftQuantity);
    if (!Number.isFinite(min) || min <= 0 || !p || !Number.isInteger(qty) || qty <= 0) continue;
    const cur = byTier.get(min) ?? { value: 0, base: min };
    cur.value += (p.sellingPrice || 0) * qty;
    byTier.set(min, cur);
  }
  Array.from(byTier.values()).forEach(({ value, base }) => {
    const w = giftValueWarning(value, base);
    if (w) warnings.push(w);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    const cleanGifts: GiftRow[] = [];
    for (const g of gifts) {
      const min = normalizePrice(g.minSubtotal);
      const qty = Number(g.giftQuantity);
      if (!g.productId) {
        setError('Chọn sản phẩm quà cho mọi dòng.');
        return;
      }
      if (!Number.isFinite(min) || min <= 0) {
        setError('Mốc tiền phải lớn hơn 0.');
        return;
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        setError('Số lượng quà phải là số nguyên dương.');
        return;
      }
      cleanGifts.push({ minSubtotal: min, productId: g.productId, giftQuantity: qty });
    }
    if (!name.trim()) {
      setError('Cần tên chương trình.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(row ? `/api/promotions/${encodeURIComponent(row.id)}` : '/api/promotions', {
        method: row ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          gifts: cleanGifts,
        }),
      });
      const json = await readJsonSafe(res);
      if (!res.ok || !json.success) {
        setError(json.error || SERVER_BAD_RESPONSE);
        return;
      }
      onSaved(`Đã lưu: ${name.trim()}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Lỗi kết nối.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 my-8">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <h3 className="font-extrabold text-base text-slate-900">
            {row ? 'Sửa chương trình' : 'Thêm chương trình khuyến mại'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Đóng"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2 text-rose-700 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {warnings.map((w, i) => (
          <div key={i} role="status" className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-2 text-amber-800 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{w}</span>
          </div>
        ))}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="promo-name" className="text-xs font-bold text-slate-700 block mb-1">
              Tên chương trình <span className="text-rose-500">*</span>
            </label>
            <input
              id="promo-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mua sách hội chợ — tặng quà"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Bắt đầu</label>
              <input
                type="datetime-local"
                value={startsAt ? startsAt.slice(0, 16) : ''}
                onChange={(e) => setStartsAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Kết thúc</label>
              <input
                type="datetime-local"
                value={endsAt ? endsAt.slice(0, 16) : ''}
                onChange={(e) => setEndsAt(e.target.value ? new Date(e.target.value).toISOString() : '')}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-700">Bậc quà (đơn càng cao càng nhiều quà)</p>
            {gifts.map((g, i) => (
              <div key={i} className="flex items-stretch gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={g.minSubtotal}
                  onChange={(e) => {
                    const next = [...gifts];
                    next[i] = { ...next[i], minSubtotal: e.target.value.replace(/[^\d.,]/g, '') };
                    setGifts(next);
                  }}
                  onBlur={() => {
                    const next = [...gifts];
                    next[i] = { ...next[i], minSubtotal: formatPriceInput(next[i].minSubtotal) };
                    setGifts(next);
                  }}
                  placeholder="Từ 500.000"
                  aria-label={`Mốc tiền dòng ${i + 1}`}
                  className="w-28 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                />
                <select
                  value={g.productId}
                  onChange={(e) => {
                    const next = [...gifts];
                    next[i] = { ...next[i], productId: e.target.value };
                    setGifts(next);
                  }}
                  aria-label={`Sản phẩm quà dòng ${i + 1}`}
                  className="flex-1 min-w-0 px-2 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                >
                  <option value="">Chọn quà…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {(p.sellingPrice || 0).toLocaleString('vi-VN')} đ
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  inputMode="numeric"
                  value={g.giftQuantity}
                  onChange={(e) => {
                    const next = [...gifts];
                    next[i] = { ...next[i], giftQuantity: e.target.value.replace(/\D/g, '') };
                    setGifts(next);
                  }}
                  placeholder="SL"
                  aria-label={`Số lượng dòng ${i + 1}`}
                  className="w-14 px-2 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-center outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                />
                {gifts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label={`Xoá dòng ${i + 1}`}
                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-500"
            >
              <Plus className="w-4 h-4" /> Thêm bậc
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 min-h-11 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              aria-label="Lưu chương trình"
              className="flex-1 min-h-11 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-md shadow-indigo-600/20 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              {isSubmitting ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export function PromotionsManager() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const loadTokenRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const [promoRes, prodRes] = await Promise.all([
        fetch('/api/promotions', { cache: 'no-store' }),
        fetch('/api/products?includeInactive=false&limit=500', { cache: 'no-store' }),
      ]);
      const promoJson = await readJsonSafe(promoRes);
      const prodJson = await readJsonSafe(prodRes);
      if (token !== loadTokenRef.current) return;
      if (!promoRes.ok || !promoJson.success) {
        setError(promoJson.error || SERVER_BAD_RESPONSE);
        setRows([]);
        return;
      }
      setRows(Array.isArray(promoJson.promotions) ? promoJson.promotions : []);
      setProducts(Array.isArray(prodJson.products) ? prodJson.products : []);
    } catch (err: any) {
      if (token !== loadTokenRef.current) return;
      setError(err?.message || 'Lỗi kết nối.');
      setRows([]);
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (row: Campaign, isActive: boolean) => {
    const label = isActive ? 'Kích hoạt' : 'Ngưng hoạt động';
    if (!window.confirm(`${label}: ${row.name}?`)) return;
    setError(null);
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/promotions/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      const json = await readJsonSafe(res);
      if (!res.ok || !json.success) {
        setError(json.error || SERVER_BAD_RESPONSE);
        return;
      }
      setNotice(isActive ? `Đã kích hoạt: ${row.name}` : `Đã ngưng hoạt động: ${row.name}`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Lỗi kết nối.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <Gift className="w-4 h-4 text-indigo-600" />
            Khuyến Mãi
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Bậc thang: đơn cao tới đâu nhận quà tới đó, không cộng dồn.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsFormOpen(true);
          }}
          aria-label="Thêm chương trình"
          className="flex min-h-11 items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Thêm chương trình</span>
        </button>
      </div>

      {error && (
        <p role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-slate-500 text-center py-6">Đang tải...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6 font-semibold">Không tìm thấy</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">
                  {row.name}{' '}
                  {row.isActive ? (
                    <span className="text-emerald-700">· Đang chạy</span>
                  ) : (
                    <span className="text-slate-500">· Đã ngưng</span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500">
                  {row.gifts.length} bậc ·{' '}
                  {row.gifts
                    .map((g) => `từ ${g.minSubtotal.toLocaleString('vi-VN')}đ ×${g.giftQuantity}`)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(row);
                    setIsFormOpen(true);
                  }}
                  title="Sửa"
                  aria-label={`Sửa: ${row.name}`}
                  className="min-h-11 min-w-11 p-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-700 cursor-pointer flex items-center justify-center"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActive(row, !row.isActive)}
                  disabled={busyId === row.id}
                  aria-label={row.isActive ? `Ngưng hoạt động: ${row.name}` : `Kích hoạt: ${row.name}`}
                  className="min-h-11 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {row.isActive ? <ToggleRight className="w-4 h-4 text-emerald-600" /> : <ToggleLeft className="w-4 h-4" />}
                  <span className="hidden sm:inline">{row.isActive ? 'Ngưng' : 'Kích hoạt'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PromoFormModal
        isOpen={isFormOpen}
        row={editing}
        products={products}
        onClose={() => {
          setIsFormOpen(false);
          setEditing(null);
        }}
        onSaved={async (message) => {
          setNotice(message);
          await load();
        }}
      />
    </div>
  );
}
