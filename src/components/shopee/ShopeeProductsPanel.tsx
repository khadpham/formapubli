'use client';

import React, { useEffect, useState } from 'react';
import { Package, RefreshCw, CheckCircle2, AlertTriangle, Upload } from 'lucide-react';

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

export function ShopeeProductsPanel({ onToast }: { onToast: (m: string) => void }) {
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pushingId, setPushingId] = useState<number | null>(null);

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
                <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-0.5">
                  <AlertTriangle className="w-3 h-3" />
                  Chưa đối chiếu với ERP
                </p>
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
    </section>
  );
}
