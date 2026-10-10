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
  /** NULL = mọi kho; có giá trị = chỉ kho đó (0034). */
  warehouseId: string | null;
  gifts: GiftRow[];
}

interface ProductOption {
  id: string;
  name: string;
  code: string | null;
  sellingPrice: number;
}

interface WarehouseOption {
  id: string;
  name: string;
}

/**
 * Giờ Việt Nam (UTC+7, không DST) - đơn vị duy nhất hệ thống dùng cho ngày
 * nghiệp vụ. `datetime-local` của trình duyệt KHÔNG kèm múi giờ nên phải gắn
 * `+07:00` tường minh: trước đây convert qua `toISOString()` (UTC) làm giờ
 * hiển thị lệch đúng 7 tiếng và chiến dịch rơi ngoài cửa sổ giờ đã đặt.
 */
const VN_OFFSET_MIN = 7 * 60;
/** ISO bất kỳ → giá trị cho ô `datetime-local` theo giờ VN. */
function vnInputValue(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + VN_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}
/** Giá trị ô `datetime-local` (giờ VN người dùng vừa chọn) → ISO kèm +07:00. */
function vnIsoFromInput(local: string): string {
  return `${local}:00+07:00`;
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
  warehouses: WarehouseOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Một bậc = một mốc tiền + NHIỀU món quà (cùng mốc là cùng bậc, không cộng dồn bậc). */
interface TierForm {
  minSubtotal: string;
  lines: Array<{ productId: string; giftQuantity: string }>;
}

const EMPTY_TIERS: TierForm[] = [{ minSubtotal: '', lines: [{ productId: '', giftQuantity: '' }] }];

function PromoFormModal({ isOpen, row, products, warehouses, onClose, onSaved }: PromoFormModalProps) {
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [tiers, setTiers] = useState<TierForm[]>(EMPTY_TIERS);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setName(row?.name ?? '');
    // State giữ giờ VN dạng ô nhập; convert 1 chiều lúc nạp và lúc gửi.
    setStartsAt(row?.startsAt ? vnInputValue(row.startsAt) : '');
    setEndsAt(row?.endsAt ? vnInputValue(row.endsAt) : '');
    setWarehouseId(row?.warehouseId ?? '');
    if (row?.gifts?.length) {
      // Gộp các dòng cùng mốc thành một bậc để hiện đúng "1 mốc - nhiều quà".
      const grouped = new Map<number, Array<{ productId: string; giftQuantity: string }>>();
      for (const g of row.gifts) {
        const list = grouped.get(g.minSubtotal) ?? [];
        list.push({ productId: g.productId, giftQuantity: String(g.giftQuantity) });
        grouped.set(g.minSubtotal, list);
      }
      setTiers(
        Array.from(grouped.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([min, lines]) => ({ minSubtotal: String(min), lines }))
      );
    } else {
      setTiers(EMPTY_TIERS);
    }
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

  const updateTier = (ti: number, patch: Partial<TierForm>) =>
    setTiers(tiers.map((t, idx) => (idx === ti ? { ...t, ...patch } : t)));
  const addTier = () =>
    setTiers([...tiers, { minSubtotal: '', lines: [{ productId: '', giftQuantity: '' }] }]);
  const removeTier = (ti: number) => setTiers(tiers.filter((_, idx) => idx !== ti));
  const addLine = (ti: number) =>
    setTiers(
      tiers.map((t, idx) =>
        idx === ti ? { ...t, lines: [...t.lines, { productId: '', giftQuantity: '' }] } : t
      )
    );
  const updateLine = (ti: number, li: number, patch: Partial<{ productId: string; giftQuantity: string }>) =>
    setTiers(
      tiers.map((t, idx) =>
        idx === ti ? { ...t, lines: t.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) } : t
      )
    );
  const removeLine = (ti: number, li: number) =>
    setTiers(
      tiers.map((t, idx) => (idx === ti ? { ...t, lines: t.lines.filter((_, j) => j !== li) } : t))
    );

  // Cảnh báo giá trị quà theo TỪNG bậc: tổng giá quà trong bậc so với mốc bậc đó.
  const warnings: string[] = [];
  const byTier = new Map<number, { value: number; base: number }>();
  for (const t of tiers) {
    const min = normalizePrice(t.minSubtotal);
    if (!Number.isFinite(min) || min < 0) continue;
    for (const l of t.lines) {
      const p = products.find((x) => x.id === l.productId);
      const qty = Number(l.giftQuantity);
      if (!p || !Number.isInteger(qty) || qty <= 0) continue;
      const cur = byTier.get(min) ?? { value: 0, base: min };
      cur.value += (p.sellingPrice || 0) * qty;
      byTier.set(min, cur);
    }
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
    const seenTiers = new Set<number>();
    for (const t of tiers) {
      const min = normalizePrice(t.minSubtotal);
      if (!Number.isFinite(min) || min < 0) {
        setError('Mốc tiền không được âm (0 = đơn bất kỳ cũng tặng).');
        return;
      }
      if (seenTiers.has(min)) {
        setError(`Trùng mốc ${min.toLocaleString('vi-VN')}đ ở hai bậc - gộp quà vào cùng một bậc.`);
        return;
      }
      seenTiers.add(min);
      if (!t.lines.length || t.lines.every((l) => !l.productId)) {
        setError(`Bậc ${min.toLocaleString('vi-VN')}đ chưa có món quà nào.`);
        return;
      }
      for (const l of t.lines) {
        if (!l.productId) {
          setError('Chọn sản phẩm quà cho mọi dòng.');
          return;
        }
        const qty = Number(l.giftQuantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          setError('Số lượng quà phải là số nguyên dương.');
          return;
        }
        cleanGifts.push({ minSubtotal: min, productId: l.productId, giftQuantity: qty });
      }
    }
    if (!name.trim()) {
      setError('Cần tên chương trình.');
      return;
    }
    if (startsAt && endsAt && new Date(vnIsoFromInput(endsAt)).getTime() <= new Date(vnIsoFromInput(startsAt)).getTime()) {
      setError('Ngày kết thúc phải sau ngày bắt đầu.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(row ? `/api/promotions/${encodeURIComponent(row.id)}` : '/api/promotions', {
        method: row ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          startsAt: startsAt ? vnIsoFromInput(startsAt) : null,
          endsAt: endsAt ? vnIsoFromInput(endsAt) : null,
          warehouseId: warehouseId || null,
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
              placeholder="Mua sách hội chợ - tặng quà"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Áp dụng tại kho</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              aria-label="Kho áp dụng khuyến mại"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            >
              <option value="">Mọi kho</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  Chỉ {w.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">
              POS kho khác không hiện quà của chương trình này; server cũng không duyệt quà sai kho.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Bắt đầu (giờ VN)</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                aria-label="Ngày giờ bắt đầu theo giờ Việt Nam"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Kết thúc (giờ VN)</label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                aria-label="Ngày giờ kết thúc theo giờ Việt Nam"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-700">
              Bậc quà - chỉ bậc CAO NHẤT đạt được chạy, không cộng dồn. Muốn mốc lớn tặng nhiều món thì thêm quà vào CÙNG bậc.
            </p>
            {tiers.map((t, ti) => (
              <div key={ti} className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-stretch gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={t.minSubtotal}
                    onChange={(e) =>
                      updateTier(ti, { minSubtotal: e.target.value.replace(/[^\d.,]/g, '') })
                    }
                    onBlur={() =>
                      updateTier(ti, { minSubtotal: formatPriceInput(t.minSubtotal) })
                    }
                    placeholder="0"
                    aria-label={`Mốc tiền bậc ${ti + 1} (0 = đơn bất kỳ)`}
                    className="w-28 px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="flex items-center text-[10px] text-slate-500">
                    {ti === 0 && !t.minSubtotal ? 'đơn bất kỳ' : 'đ trở lên'}
                  </span>
                  {tiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTier(ti)}
                      aria-label={`Xoá bậc ${ti + 1}`}
                      className="ml-auto p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {t.lines.map((l, li) => (
                  <div key={li} className="flex items-stretch gap-1.5">
                    <select
                      value={l.productId}
                      onChange={(e) => updateLine(ti, li, { productId: e.target.value })}
                      aria-label={`Quà ${li + 1} của bậc ${ti + 1}`}
                      className="flex-1 min-w-0 px-2 py-2.5 bg-white border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Chọn quà…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} - {(p.sellingPrice || 0).toLocaleString('vi-VN')} đ
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={l.giftQuantity}
                      onChange={(e) =>
                        updateLine(ti, li, { giftQuantity: e.target.value.replace(/\D/g, '') })
                      }
                      placeholder="SL"
                      aria-label={`Số lượng quà ${li + 1} bậc ${ti + 1}`}
                      className="w-14 px-2 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-center outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {t.lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(ti, li)}
                        aria-label={`Xoá quà ${li + 1} bậc ${ti + 1}`}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addLine(ti)}
                  className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-500"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm quà vào bậc này
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addTier}
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
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
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
      const [promoRes, prodRes, whRes] = await Promise.all([
        fetch('/api/promotions', { cache: 'no-store' }),
        fetch('/api/products?includeInactive=false&limit=500', { cache: 'no-store' }),
        fetch('/api/warehouses?all=true', { cache: 'no-store' }),
      ]);
      const promoJson = await readJsonSafe(promoRes);
      const prodJson = await readJsonSafe(prodRes);
      const whJson = await readJsonSafe(whRes);
      if (token !== loadTokenRef.current) return;
      if (!promoRes.ok || !promoJson.success) {
        setError(promoJson.error || SERVER_BAD_RESPONSE);
        setRows([]);
        return;
      }
      setRows(Array.isArray(promoJson.promotions) ? promoJson.promotions : []);
      setProducts(Array.isArray(prodJson.products) ? prodJson.products : []);
      const whList = Array.isArray(whJson.warehouses)
        ? whJson.warehouses
        : Array.isArray(whJson.data)
          ? whJson.data
          : [];
      setWarehouses(
        whList.map((w: any) => ({ id: String(w.id), name: String(w.name || w.id) }))
      );
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
                  {row.warehouseId
                    ? `Chỉ ${warehouses.find((w) => w.id === row.warehouseId)?.name || row.warehouseId} · `
                    : 'Mọi kho · '}
                  {(() => {
                    const byMin = new Map<number, number>();
                    for (const g of row.gifts) byMin.set(g.minSubtotal, (byMin.get(g.minSubtotal) || 0) + 1);
                    return Array.from(byMin.entries())
                      .sort((a, b) => a[0] - b[0])
                      .map(([min, n]) => `từ ${min.toLocaleString('vi-VN')}đ: ${n} món`)
                      .join(' · ');
                  })()}
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
        warehouses={warehouses}
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
