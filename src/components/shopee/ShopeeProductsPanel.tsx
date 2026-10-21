'use client';

import React, { useEffect, useState } from 'react';
import { Package, RefreshCw, CheckCircle2, AlertTriangle, Upload, Link2, X, Plus, Search } from 'lucide-react';

interface ShopProduct {
  itemId: number;
  name: string;
  sku: string;
  price: number;
  stock: number;
  status: string;
  image: string;
  erpMapped: boolean;
  erpTitle: string | null;
}

interface Edition {
  id: string;
  code: string;
  title: string;
}

interface MapComponent {
  editionId: string;
  title: string;
  quantity: number;
}

function SkuMapDialog({
  product,
  onClose,
  onSaved,
  onToast,
}: {
  product: ShopProduct;
  onClose: () => void;
  onSaved: () => void;
  onToast: (m: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [editions, setEditions] = useState<Edition[]>([]);
  const [searching, setSearching] = useState(false);
  const [components, setComponents] = useState<MapComponent[]>([]);
  const [saving, setSaving] = useState(false);

  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setEditions([]);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(`/api/editions/search?q=${encodeURIComponent(q.trim())}&limit=10`).then((x) => x.json());
      setEditions(r?.data || r?.editions || []);
    } catch {
      setEditions([]);
    } finally {
      setSearching(false);
    }
  };

  const addComponent = (e: Edition) => {
    if (components.some((c) => c.editionId === e.id)) return;
    setComponents([...components, { editionId: e.id, title: e.title, quantity: 1 }]);
    setQuery('');
    setEditions([]);
  };

  const save = async () => {
    if (components.length === 0) {
      onToast('Chưa chọn sản phẩm ERP nào.');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/shopee/sku-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopeeSku: product.sku, components }),
      }).then((x) => x.json());
      if (r?.success) {
        onToast(`Đã đối chiếu "${product.sku}" với ${components.length} sản phẩm ERP.`);
        onSaved();
        onClose();
      } else onToast(r?.error || 'Lưu đối chiếu thất bại.');
    } catch {
      onToast('Lưu đối chiếu thất bại.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-label={`Đối chiếu ${product.sku}`}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="text-base font-extrabold text-slate-900">Đối chiếu SKU: {product.sku}</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className="p-2 rounded-xl hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-600 truncate">{product.name}</p>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Gõ tên sách hoặc mã để tìm trong ERP…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              aria-label="Tìm sản phẩm ERP"
            />
          </div>
          {searching && <p className="text-xs text-slate-400">Đang tìm…</p>}
          {editions.length > 0 && (
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {editions.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => addComponent(e)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="text-xs font-bold text-slate-800 truncate">{e.title}</span>
                  <span className="text-[11px] text-slate-400 ml-auto shrink-0">{e.code}</span>
                </button>
              ))}
            </div>
          )}
          {components.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-700">Thành phần đã chọn ({components.length}):</p>
              {components.map((c) => (
                <div key={c.editionId} className="flex items-center gap-2 p-2 rounded-xl bg-indigo-50 border border-indigo-100">
                  <span className="text-xs font-bold text-slate-800 flex-1 truncate">{c.title}</span>
                  <label className="text-[11px] text-slate-500">SL:
                    <input
                      type="number"
                      min={1}
                      value={c.quantity}
                      onChange={(e) =>
                        setComponents(components.map((x) => x.editionId === c.editionId ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))
                      }
                      className="w-14 ml-1 px-1.5 py-1 rounded-lg border border-slate-200 text-xs text-center"
                      aria-label={`Số lượng ${c.title}`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setComponents(components.filter((x) => x.editionId !== c.editionId))}
                    aria-label={`Bỏ ${c.title}`}
                    className="p-1.5 rounded-lg hover:bg-red-100"
                  >
                    <X className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold min-h-[44px]">
            Hủy
          </button>
          <button
            type="button"
            disabled={saving || components.length === 0}
            onClick={save}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold min-h-[44px] disabled:opacity-50"
          >
            {saving ? 'Đang lưu…' : 'Lưu đối chiếu'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShopeeProductsPanel({ onToast }: { onToast: (m: string) => void }) {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pushingId, setPushingId] = useState<number | null>(null);
  const [mappingProduct, setMappingProduct] = useState<ShopProduct | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/shopee/products').then((x) => x.json());
      if (r?.success) {
        setProducts(r.data.products || []);
        setLoaded(true);
      } else onToast(r?.error || 'Không tải được sản phẩm Shopee.');
    } catch {
      onToast('Không tải được sản phẩm Shopee.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushStock = async (p: ShopProduct) => {
    if (!p.erpMapped) {
      onToast('Sản phẩm chưa đối chiếu với ERP - không đẩy được tồn kho.');
      return;
    }
    setPushingId(p.itemId);
    try {
      const r = await fetch('/api/shopee/stock-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: p.itemId, sku: p.sku }),
      }).then((x) => x.json());
      if (r?.success) onToast(`Đã đẩy tồn kho cho "${p.name}".`);
      else onToast(r?.error || 'Đẩy tồn kho thất bại.');
    } catch {
      onToast('Đẩy tồn kho thất bại.');
    } finally {
      setPushingId(null);
    }
  };

  const mapped = products.filter((p) => p.erpMapped).length;

  return (
    <section aria-label="Sản phẩm Shopee" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <Package className="w-5 h-5 text-orange-600" />
          Sản phẩm trên shop
          {loaded && (
            <span className="text-xs font-bold text-slate-500">
              ({products.length} SP · {mapped} đã đối chiếu)
            </span>
          )}
        </h2>
        <button
          type="button"
          disabled={loading}
          onClick={load}
          aria-label="Tải lại sản phẩm Shopee"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold min-h-[40px] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Tải lại
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Đối chiếu SKU Shopee với mã sách trong ERP. Nền cho tính năng đăng sản phẩm tự động sau này.
      </p>

      {loading && !loaded && <p className="text-xs text-slate-400">Đang tải từ Shopee…</p>}
      {loaded && products.length === 0 && (
        <p className="text-xs text-slate-400">Shop chưa có sản phẩm nào đang bán.</p>
      )}
      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.itemId} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
            {p.image ? (
              <img src={p.image} alt={p.name} className="w-12 h-12 rounded-lg object-cover shrink-0" loading="lazy" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-slate-200 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-slate-800 truncate">{p.name}</p>
              <p className="text-[11px] text-slate-500">
                SKU: {p.sku || '-'} · {Number(p.price || 0).toLocaleString('vi-VN')}đ · Tồn Shopee: {p.stock}
              </p>
              {p.erpMapped ? (
                <p className="text-[11px] text-emerald-700 flex items-center gap-1 mt-0.5">
                  <CheckCircle2 className="w-3 h-3" />
                  Đã đối chiếu: {p.erpTitle}
                </p>
              ) : (
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[11px] text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Chưa đối chiếu với ERP
                  </p>
                  <button
                    type="button"
                    onClick={() => setMappingProduct(p)}
                    aria-label={`Đối chiếu ${p.sku} với ERP`}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-[11px] font-bold min-h-[32px]"
                  >
                    <Link2 className="w-3 h-3" />
                    Đối chiếu
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={pushingId === p.itemId}
              onClick={() => pushStock(p)}
              aria-label={`Đẩy tồn kho ${p.name}`}
              title="Đẩy tồn kho ERP lên Shopee"
              className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold min-h-[40px] disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {pushingId === p.itemId ? 'Đang đẩy…' : 'Đẩy tồn'}
            </button>
          </div>
        ))}
      </div>
      {mappingProduct && (
        <SkuMapDialog
          product={mappingProduct}
          onClose={() => setMappingProduct(null)}
          onSaved={load}
          onToast={onToast}
        />
      )}
    </section>
  );
}
