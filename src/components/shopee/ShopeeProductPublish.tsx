'use client';

import React, { useEffect, useState } from 'react';
import { X, Plus, Search, Eye, UploadCloud, CheckCircle2, AlertTriangle } from 'lucide-react';

interface EditionBrief {
  id: string;
  code: string;
  title: string;
}

interface EditionDetail extends EditionBrief {
  isbn: string;
  coverPrice: number;
  pages: number | null;
  publisher: string | null;
}

function fmtVnd(n: number): string {
  return `${Number(n || 0).toLocaleString('vi-VN')}đ`;
}

/** Mô tả mẫu tự sinh từ danh sách sách đã chọn. Người dùng sửa lại trước khi đăng. */
function buildDescription(details: EditionDetail[]): string {
  const lines: string[] = ['GIỚI THIỆU SẢN PHẨM', ''];
  details.forEach((d, i) => {
    lines.push(`${i + 1}. ${d.title || d.code}`);
    const meta: string[] = [];
    if (d.isbn) meta.push(`ISBN: ${d.isbn}`);
    if (d.pages) meta.push(`${d.pages} trang`);
    if (d.publisher) meta.push(d.publisher);
    if (meta.length > 0) lines.push(`   - ${meta.join(' | ')}`);
  });
  lines.push('', 'Đơn vị phát hành: FORMApubli');
  return lines.join('\n');
}

export function ShopeeProductPublishDialog({
  onClose,
  onPublished,
  onToast,
}: {
  onClose: () => void;
  onPublished: () => void;
  onToast: (m: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EditionBrief[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [details, setDetails] = useState<EditionDetail[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('100');
  const [sku, setSku] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [weight, setWeight] = useState('0.5');

  const [showPreview, setShowPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [doneItemId, setDoneItemId] = useState<number | null>(null);

  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(`/api/editions/search?q=${encodeURIComponent(q.trim())}&limit=10`).then((x) => x.json());
      setResults(r?.data || r?.editions || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Tải chi tiết + tự điền form mỗi khi danh sách chọn đổi.
  useEffect(() => {
    if (selectedIds.length === 0) {
      setDetails([]);
      return;
    }
    setLoadingDetails(true);
    fetch(`/api/shopee/products/publish?ids=${encodeURIComponent(selectedIds.join(','))}`)
      .then((x) => x.json())
      .then((r) => {
        const ds: EditionDetail[] = r?.data || [];
        setDetails(ds);
        if (ds.length === 1) {
          setName(`[Sách] ${ds[0].title || ds[0].code}`);
        } else if (ds.length > 1) {
          const titles = ds.map((d) => d.title || d.code).join(' & ');
          setName(`[Combo] ${titles}`.slice(0, 120));
        }
        setDescription(buildDescription(ds));
        setPrice(String(ds.reduce((s, d) => s + Number(d.coverPrice || 0), 0)));
      })
      .catch(() => setDetails([]))
      .finally(() => setLoadingDetails(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(',')]);

  const toggleSelect = (e: EditionBrief) => {
    setSelectedIds((prev) => (prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id]));
    setQuery('');
    setResults([]);
  };

  const publish = async () => {
    setError('');
    if (name.trim().length < 10 || name.trim().length > 120) {
      setError('Tên sản phẩm phải từ 10 đến 120 ký tự.');
      return;
    }
    if (description.trim().length < 20) {
      setError('Mô tả phải tối thiểu 20 ký tự.');
      return;
    }
    if (!sku.trim()) {
      setError('Nhập mã SKU (ví dụ COMBO16).');
      return;
    }
    if (!imageUrl.trim()) {
      setError('Dán link ảnh bìa sản phẩm.');
      return;
    }
    setPublishing(true);
    try {
      const r = await fetch('/api/shopee/products/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editionIds: selectedIds,
          name: name.trim(),
          description: description.trim(),
          price: Number(price) || 0,
          stock: Number(stock) || 0,
          sku: sku.trim(),
          imageUrl: imageUrl.trim(),
          weight: Number(weight) || 0.5,
        }),
      }).then((x) => x.json());
      if (r?.success) {
        setDoneItemId(Number(r.data.itemId));
        onToast(`Đã đăng "${sku.trim()}" lên Shopee (item ${r.data.itemId}).`);
        onPublished();
      } else {
        setError(r?.error || 'Đăng sản phẩm thất bại.');
      }
    } catch {
      setError('Đăng sản phẩm thất bại. Kiểm tra kết nối rồi thử lại.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-label="Đăng sản phẩm lên Shopee">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="text-base font-extrabold text-slate-900">Đăng sản phẩm lên Shopee</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className="p-2 rounded-xl hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {error && (
            <p role="alert" className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}
          {doneItemId !== null && (
            <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Đăng thành công! Mã sản phẩm Shopee: {doneItemId}
            </p>
          )}

          {/* Bước 1: chọn sản phẩm ERP */}
          <section aria-label="Chọn sản phẩm ERP">
            <p className="text-xs font-extrabold text-slate-800 mb-2">1. Chọn sách trong ERP {details.length > 0 && `(${details.length} đã chọn)`}</p>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder="Gõ tên sách hoặc mã để tìm…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                aria-label="Tìm sách trong ERP"
              />
            </div>
            {searching && <p className="text-xs text-slate-400 mt-1">Đang tìm…</p>}
            {results.length > 0 && (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-40 overflow-y-auto mt-2">
                {results.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggleSelect(e)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-800 truncate">{e.title}</span>
                    <span className="text-[11px] text-slate-400 ml-auto shrink-0">{e.code}</span>
                    {selectedIds.includes(e.id) && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
            {details.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {details.map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-1 text-[11px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-100 rounded-full pl-2.5 pr-1.5 py-1">
                    {d.code}
                    <button type="button" onClick={() => toggleSelect(d)} aria-label={`Bỏ ${d.code}`} className="p-0.5 rounded-full hover:bg-indigo-100">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {loadingDetails && <p className="text-xs text-slate-400 mt-1">Đang tải thông tin sách…</p>}
          </section>

          {/* Bước 2: thông tin đăng bán */}
          <section aria-label="Thông tin đăng bán" className="space-y-3">
            <p className="text-xs font-extrabold text-slate-800">2. Thông tin đăng bán</p>
            <div>
              <label className="text-[11px] font-bold text-slate-600" htmlFor="pub-name">Tên sản phẩm</label>
              <input
                id="pub-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="[Combo] Tên bộ sách…"
                maxLength={120}
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-0.5">{name.length}/120 ký tự</p>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600" htmlFor="pub-desc">Mô tả</label>
              <textarea
                id="pub-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600" htmlFor="pub-sku">Mã SKU</label>
                <input
                  id="pub-sku"
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  placeholder="COMBO16"
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600" htmlFor="pub-price">Giá bán (đ)</label>
                <input
                  id="pub-price"
                  type="number"
                  min={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600" htmlFor="pub-stock">Tồn kho</label>
                <input
                  id="pub-stock"
                  type="number"
                  min={0}
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600" htmlFor="pub-weight">Cân nặng (kg)</label>
                <input
                  id="pub-weight"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600" htmlFor="pub-img">Link ảnh bìa</label>
              <input
                id="pub-img"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…/anh-bia.jpg"
                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-0.5">Hệ thống tự tải ảnh về và upload lên Shopee.</p>
            </div>
          </section>

          {/* Bước 3: xem trước */}
          {showPreview && (
            <section aria-label="Xem trước" className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
              <p className="text-xs font-extrabold text-slate-800 mb-2 flex items-center gap-1.5">
                <Eye className="w-4 h-4" /> Xem trước
              </p>
              <div className="flex gap-3">
                {imageUrl ? (
                  <img src={imageUrl} alt={name} className="w-20 h-20 rounded-xl object-cover shrink-0 bg-white" />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-slate-200 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-900">{name || '(chưa có tên)'}</p>
                  <p className="text-sm font-extrabold text-orange-600 mt-1">{price ? fmtVnd(Number(price)) : '(chưa có giá)'}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">SKU: {sku || '-'} · Kho: {stock || '0'}</p>
                </div>
              </div>
              <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-3">
                <AlertTriangle className="w-3 h-3" />
                Đăng lên gian hàng thật. Kiểm tra kỹ trước khi bấm Đăng.
              </p>
            </section>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-2 flex-wrap">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold min-h-[44px]">
            Đóng
          </button>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold min-h-[44px] inline-flex items-center gap-1.5"
          >
            <Eye className="w-4 h-4" />
            {showPreview ? 'Ẩn xem trước' : 'Xem trước'}
          </button>
          <button
            type="button"
            disabled={publishing || doneItemId !== null}
            onClick={publish}
            className="px-4 py-2.5 rounded-xl bg-orange-600 text-white text-sm font-bold min-h-[44px] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <UploadCloud className="w-4 h-4" />
            {publishing ? 'Đang đăng…' : 'Đăng lên Shopee'}
          </button>
        </div>
      </div>
    </div>
  );
}
