'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Package,
  Plus,
  Pencil,
  Save,
  X,
  Search,
  Ban,
  PlayCircle,
  AlertTriangle,
  Gift,
} from 'lucide-react';

const GOODS_CODE_PREFIX = 'SP-';

interface GoodsRow {
  id: string;
  code: string | null;
  name: string;
  sellingPrice: number;
  barcode: string | null;
  description: string | null;
  isGiftItem: boolean;
  isActive: boolean;
}

interface FormState {
  codeSuffix: string;
  name: string;
  sellingPrice: string;
  barcode: string;
  description: string;
  isGiftItem: boolean;
}

const EMPTY_FORM: FormState = {
  codeSuffix: '',
  name: '',
  sellingPrice: '',
  barcode: '',
  description: '',
  isGiftItem: false,
};

/** Hiển thị giá có dấu chấm phân cách nghìn, KHÔNG kèm đơn vị: `89000` → `89.000`. */
function formatPriceNumber(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('vi-VN');
}

/** Bản có đơn vị, dùng cho cột bảng. */
function formatPrice(value: number): string {
  return `${Number(value || 0).toLocaleString('vi-VN')} đ`;
}

/**
 * LỖI 5: `await res.json()` ném `SyntaxError` khi server trả HTML hoặc body rỗng
 * (lỗi 500 từ Cloudflare/proxy). Bọc riêng để lỗi đó KHÔNG làm sập handler và
 * không lộ message tiếng Anh của trình duyệt cho người dùng.
 */
/**
 * Chuẩn hoá giá tiền kiểu Việt Nam.
 *
 * Người Việt gõ `8.900` / `89.000` (dấu chấm = phân cách nghìn) hoặc `89,000`
 * (dấu phẩy = phân cách nghìn theo thói quen gõ phím). Ô nhập là `type="text"`
 * vì `type="number"` sẽ đọc `8.900` thành 8.9 và lưu 9đ - hỏng tiền âm thầm,
 * không báo lỗi nào, chỉ phát hiện khi đối chiếu cuối ngày.
 *
 * Có CẢ dấu chấm và dấu phẩy ⇒ dấu CUỐI cùng mới là dấu thập phân.
 */
export function normalizePrice(raw: string): number {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let norm: string;
  if (lastComma > -1 && lastDot > -1) {
    norm = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    norm = s.replace(/,/g, '');
  } else if (lastDot > -1) {
    // Chỉ có dấu chấm: coi là phân cách nghìn theo thói quen gõ phím VN, TRỪ KHI
    // dấu chấm ở cuối và chỉ 1–2 chữ số sau - đó mới là thập phân (89.900,50).
    norm = /^\d{1,3}\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, '');
  } else {
    norm = s;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Định dạng giá cho Ô NHẬP, không kèm đơn vị: `89000` → `89.000`.
 *
 * Phải đi qua `normalizePrice`, KHÔNG dùng `Number()`: `Number('89.000')` = 89
 * (dấu chấm là phân cách nghìn kiểu VN) ⇒ làm sạch xong lại mất 2 chữ số.
 * Đó chính là cái bẫy ta đang chống, không được tự dính vào.
 */
export function formatPriceInput(raw: string | number): string {
  const n = typeof raw === 'number' ? raw : normalizePrice(raw);
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('vi-VN');
}

async function readJsonSafe(res: Response): Promise<any> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** Thông báo thay cho `json.error` khi không đọc được body JSON. */
const SERVER_BAD_RESPONSE = 'Máy chủ không phản hồi đúng. Bạn thử lại sau giây lát.';

interface GoodsFormModalProps {
  isOpen: boolean;
  row: GoodsRow | null;
  onClose: () => void;
  onSaved: (message: string, wasCreated: boolean) => void;
}

function GoodsFormModal({ isOpen, row, onClose, onSaved }: GoodsFormModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isEditing = !!row;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setForm(
      row
        ? {
            codeSuffix: row.code || '',
            name: row.name,
            sellingPrice: String(row.sellingPrice ?? 0),
            barcode: row.barcode || '',
            description: row.description || '',
            isGiftItem: row.isGiftItem,
          }
        : EMPTY_FORM
    );
  }, [isOpen, row]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // LỖI 3: nút bị disable nhưng `disabled` không chặn được lần submit thứ hai
    // (Enter lặp nhanh trong khi state chưa kịp commit). API không có
    // idempotency key và `assertCodeFree` là check-then-insert không transaction,
    // nên lần hai lọt qua check rồi chết ở UNIQUE ⇒ người dùng thấy
    // "Lỗi hệ thống" thay vì "Mã đã có".
    if (isSubmitting) return;
    setError(null);

    const name = form.name.trim();
    if (!name) {
      setError('Cần tên sản phẩm.');
      return;
    }

    // Ô nhập là TEXT kiểu Việt Nam (`8.900` = tám nghìn chín trăm). Dùng
    // `Number()` trực tiếp sẽ đọc "8.900" thành 8.9 ⇒ lưu 9đ. Phải qua
    // `normalizePrice` đã bỏ dấu phân cách nghìn.
    const price = normalizePrice(form.sellingPrice);
    if (!Number.isFinite(price)) {
      setError('Cần nhập giá bán.');
      return;
    }
    if (price < 0) {
      setError('Giá bán không hợp lệ.');
      return;
    }

    const codeSuffix = form.codeSuffix.trim().toUpperCase();
    if (!isEditing && !/^[A-Z0-9-]{1,20}$/.test(codeSuffix)) {
      setError('Mã sản phẩm phải có phần sau tiền tố SP-.');
      return;
    }

    const barcode = form.barcode.trim();
    if (barcode && !/^\d{13}$/.test(barcode)) {
      setError('Mã vạch phải đúng 13 chữ số.');
      return;
    }

    const shared = {
      name,
      sellingPrice: price,
      barcode: barcode || null,
      description: form.description.trim() || null,
      isGiftItem: form.isGiftItem,
    };
    const payload = isEditing
      ? shared
      : { ...shared, code: `${GOODS_CODE_PREFIX}${codeSuffix}` };

    setIsSubmitting(true);
    try {
      const res = await fetch(
        isEditing ? `/api/products/${encodeURIComponent(row!.id)}` : '/api/products',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const json = await readJsonSafe(res);
      if (!res.ok || !json.success) {
        setError(json.error || SERVER_BAD_RESPONSE);
        return;
      }
      onSaved(`Đã lưu: ${name}`, !isEditing);
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
      <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 my-8">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-base text-slate-900">
              {isEditing ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}
            </h3>
          </div>
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
          <div
            role="alert"
            className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2 text-rose-700 text-xs font-semibold"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="goods-code" className="text-xs font-bold text-slate-700 block mb-1">
              Mã sản phẩm <span className="text-rose-500">*</span>
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl">
                <span className="font-mono font-bold text-sm text-slate-700">{row!.code}</span>
                <span className="text-[10px] text-slate-500">Mã không đổi sau khi đã nhập.</span>
              </div>
            ) : (
              <>
                <div className="flex items-stretch">
                  <span className="px-3 py-2.5 bg-slate-200 text-slate-700 font-mono font-bold text-xs rounded-l-xl border border-r-0 border-slate-300 flex items-center">
                    {GOODS_CODE_PREFIX}
                  </span>
                  <input
                    id="goods-code"
                    type="text"
                    required
                    value={form.codeSuffix}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        codeSuffix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20),
                      })
                    }
                    placeholder="TUI"
                    aria-label="Mã sản phẩm, phần sau tiền tố SP-"
                    className="flex-1 min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-r-xl text-xs font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Mã đầy đủ:{' '}
                  <span className="font-mono font-bold text-slate-700">
                    {GOODS_CODE_PREFIX}
                    {form.codeSuffix || '…'}
                  </span>
                </p>
              </>
            )}
          </div>

          <div>
            <label htmlFor="goods-name" className="text-xs font-bold text-slate-700 block mb-1">
              Tên sản phẩm <span className="text-rose-500">*</span>
            </label>
            <input
              id="goods-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Túi vải FORMA"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          <div>
            <label htmlFor="goods-price" className="text-xs font-bold text-slate-700 block mb-1">
              Giá bán <span className="text-rose-500">*</span>
            </label>
            <div className="flex items-stretch">
              <input
                id="goods-price"
                /* KHÔNG dùng type="number".
                 *
                 * `type="number"` theo locale `en-US` của trình duyệt: người Việt
                 * gõ `8.900` (nghĩa là 8.900đ) thì bị đọc thành `8.9` ⇒ lưu 9đ.
                 * Hỏng tiền âm thầm, không báo lỗi nào, chỉ phát hiện khi đối chiếu
                 * cuối ngày. Ô nhập chỉ nhận CHỮ SỐ, dấu chấm và dấu phẩy làm dấu
                 * phân cách nghìn; `normalizePrice` bỏ chúng trước khi gửi API. */
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.sellingPrice}
                onChange={(e) =>
                  setForm({ ...form, sellingPrice: e.target.value.replace(/[^\d.,]/g, '') })
                }
                onBlur={() =>
                  setForm({ ...form, sellingPrice: formatPriceInput(form.sellingPrice) })
                }
                placeholder="0"
                className="flex-1 min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-l-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
              <span className="px-3 py-2.5 bg-slate-100 border border-l-0 border-slate-300 rounded-r-xl text-xs font-bold text-slate-600 flex items-center">
                đ
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="goods-barcode" className="text-xs font-bold text-slate-700 block mb-1">
              Mã vạch
            </label>
            <input
              id="goods-barcode"
              type="text"
              inputMode="numeric"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value.replace(/\D/g, '').slice(0, 13) })}
              placeholder="13 chữ số"
              aria-label="Mã vạch EAN-13, 13 chữ số"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          <div>
            <label htmlFor="goods-description" className="text-xs font-bold text-slate-700 block mb-1">
              Mô tả
            </label>
            <textarea
              id="goods-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white resize-y"
            />
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Gift className="w-4 h-4 text-amber-600 shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-bold text-amber-950 block">Gợi ý quà tặng</span>
                <span className="text-[10px] text-amber-700 block">Hiện đầu tiên khi chọn quà</span>
              </div>
            </div>
            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-white">
              <input
                type="checkbox"
                aria-label="Đánh dấu là quà tặng"
                checked={form.isGiftItem}
                onChange={(e) => setForm({ ...form, isGiftItem: e.target.checked })}
                className="w-5 h-5 rounded text-amber-600 focus:ring-amber-500"
              />
            </label>
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
              aria-label="Lưu sản phẩm"
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

export function GoodsCatalogManager() {
  const [rows, setRows] = useState<GoodsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<GoodsRow | null>(null);
  /**
   * LỖI 2: chống trả về trễ. Gõ "a" (request A) rồi "ab" (request B); nếu B về
   * trước A thì A ghi đè `setRows` ⇒ bảng hiện kết quả của "a" trong khi ô đang
   * gõ "ab". Mỗi lần `load()` tăng token; lời gọi cũ bị bỏ qua khi token không
   * còn khớp token hiện tại.
   */
  const loadTokenRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ search, includeInactive: String(showInactive) });
      const res = await fetch(`/api/products?${query.toString()}`, { cache: 'no-store' });
      const json = await readJsonSafe(res);
      if (token !== loadTokenRef.current) return;
      if (!res.ok || !json.success) {
        setError(json.error || SERVER_BAD_RESPONSE);
        setRows([]);
        return;
      }
      setRows(Array.isArray(json.products) ? json.products : []);
    } catch (err: any) {
      if (token !== loadTokenRef.current) return;
      setError(err?.message || 'Lỗi kết nối.');
      setRows([]);
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [search, showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (row: GoodsRow, isActive: boolean) => {
    const actionLabel = isActive ? 'Kích hoạt' : 'Ngưng hoạt động';
    if (!window.confirm(`${actionLabel}: ${row.name}?`)) return;
    setError(null);
    setNotice(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(row.id)}`, {
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

  const openCreate = () => {
    setEditing(null);
    setIsFormOpen(true);
  };

  const openEdit = (row: GoodsRow) => {
    setEditing(row);
    setIsFormOpen(true);
  };

  const handleSaved = async (message: string, wasCreated: boolean) => {
    setNotice(message);
    if (wasCreated) {
      // LỖI 4: sản phẩm mới có thể KHÔNG khớp ô tìm kiếm / bộ lọc đang bật ⇒
      // bảng không hiện dòng mà notice vẫn báo "Đã lưu", người dùng tưởng mất
      // dữ liệu. Xoá lọc trước khi tải lại. Lời gọi `load()` bên dưới chạy
      // với `search`/`showInactive` cũ; nó bị bỏ qua bởi token (LỖI 2) vì đổi
      // state kích hoạt `useEffect` tạo một lời gọi mới, token cao hơn.
      setSearchInput('');
      setSearch('');
      setShowInactive(false);
    }
    await load();
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-600" />
            Hàng Hóa
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Mã bắt đầu bằng SP-. Hàng đã bán không xoá được - dùng Ngưng hoạt động.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          aria-label="Thêm sản phẩm"
          className="flex min-h-11 items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Thêm sản phẩm</span>
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên, mã hoặc mã vạch"
            aria-label="Tìm hàng hóa"
            className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            aria-label="Hiện hàng đã ngưng"
            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
          />
          <span>Hiện hàng đã ngưng</span>
        </label>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500 text-center py-6">Đang tải...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6 font-semibold">Không tìm thấy</p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
              <tr>
                <th className="px-3 py-2">Mã</th>
                <th className="px-3 py-2">Tên</th>
                <th className="px-3 py-2 text-right">Giá bán</th>
                <th className="px-3 py-2">Mã vạch</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 font-mono font-bold text-slate-800 whitespace-nowrap">{row.code}</td>
                  <td className="px-3 py-2 text-slate-700">
                    <span className="font-semibold">{row.name}</span>
                    {row.isGiftItem && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                        <Gift className="w-3 h-3" />
                        Quà
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                    {formatPrice(row.sellingPrice)}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-500">{row.barcode || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.isActive ? (
                      <span className="text-emerald-700 font-bold">Đang bán</span>
                    ) : (
                      <span className="text-slate-500 font-bold">Đã ngưng</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        disabled={busyId === row.id}
                        title="Sửa"
                        aria-label={`Sửa: ${row.name}`}
                        className="min-h-11 min-w-11 p-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-700 cursor-pointer disabled:opacity-50 flex items-center justify-center"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {row.isActive ? (
                        <button
                          type="button"
                          onClick={() => setActive(row, false)}
                          disabled={busyId === row.id}
                          title="Ngưng hoạt động"
                          aria-label={`Ngưng hoạt động: ${row.name}`}
                          className="min-h-11 px-3 py-2 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl text-amber-800 text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <Ban className="w-4 h-4" />
                          <span className="hidden sm:inline">Ngưng hoạt động</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActive(row, true)}
                          disabled={busyId === row.id}
                          title="Kích hoạt"
                          aria-label={`Kích hoạt: ${row.name}`}
                          className="min-h-11 px-3 py-2 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-xl text-emerald-800 text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <PlayCircle className="w-4 h-4" />
                          <span className="hidden sm:inline">Kích hoạt</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GoodsFormModal
        isOpen={isFormOpen}
        row={editing}
        onClose={() => {
          setIsFormOpen(false);
          setEditing(null);
        }}
        onSaved={handleSaved}
      />
    </div>
  );
}
