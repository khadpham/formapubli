'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Search, X, Eye, EyeOff, Star } from 'lucide-react';
import type { UserRole } from '@/lib/roles';

interface PortalProduct {
  id: string;
  slug: string;
  sku: string | null;
  name: string;
  author: string | null;
  translator: string | null;
  description: string | null;
  coverPrice: number;
  salePrice: number | null;
  productType: string;
  category: string | null;
  isbn: string | null;
  coverImage: string | null;
  isVisible: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

const TYPE_LABEL: Record<string, string> = {
  SINGLE: 'Sach le',
  COMBO: 'Combo',
  GIFT: 'Qua tang',
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return Number(n).toLocaleString('vi-VN') + 'd';
}

export function PortalProductsManager({ sessionRole }: { sessionRole: UserRole }) {
  const router = useRouter();
  const canEdit = sessionRole === 'ROLE_OWNER' || sessionRole === 'ROLE_MANAGER';
  const [items, setItems] = useState<PortalProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('');
  const [visF, setVisF] = useState('');
  const [editing, setEditing] = useState<PortalProduct | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: '100' });
      if (q.trim()) p.set('q', q.trim());
      if (typeF) p.set('type', typeF);
      if (visF) p.set('visible', visF);
      const r = await fetch('/api/portal-products/admin?' + p.toString()).then((x) => x.json());
      if (r?.success) {
        setItems(r.data || []);
        setTotal(r.pagination?.total ?? 0);
      }
    } catch {
      /* giu danh sach cu */
    } finally {
      setLoading(false);
    }
  }, [q, typeF, visF]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const openEdit = (p: PortalProduct) => {
    setForm({
      name: p.name || '',
      author: p.author || '',
      translator: p.translator || '',
      description: p.description || '',
      coverPrice: p.coverPrice ?? 0,
      salePrice: p.salePrice ?? '',
      category: p.category || '',
      isbn: p.isbn || '',
      sku: p.sku || '',
      coverImage: p.coverImage || '',
      isVisible: !!p.isVisible,
      isFeatured: !!p.isFeatured,
      sortOrder: p.sortOrder ?? 0,
    });
    setFormError('');
    setEditing(p);
  };

  const setF = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!editing) return;
    setFormError('');
    if (!String(form.name || '').trim()) {
      setFormError('Ten san pham khong duoc rong.');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/portal-products/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...form }),
      }).then((x) => x.json());
      if (r?.success) {
        setEditing(null);
        router.refresh();
        load();
      } else {
        setFormError(r?.error || 'Luu that bai.');
      }
    } catch {
      setFormError('Luu that bai, kiem tra ket noi.');
    } finally {
      setSaving(false);
    }
  };

  const toggleVisible = async (p: PortalProduct) => {
    try {
      const r = await fetch('/api/portal-products/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, isVisible: !p.isVisible }),
      }).then((x) => x.json());
      if (r?.success) {
        router.refresh();
        load();
      }
    } catch {
      /* giu nguyen */
    }
  };

  return (
    <section aria-label="Quan ly san pham portal" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
          <Package className="w-5 h-5 text-rose-600" />
          San pham Portal ({total})
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tim ten, tac gia, ISBN..."
              className="pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl w-56 focus:outline-none focus:ring-2 focus:ring-rose-200"
            />
          </div>
          <select
            value={typeF}
            onChange={(e) => setTypeF(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
          >
            <option value="">Tat ca loai</option>
            <option value="SINGLE">Sach le</option>
            <option value="COMBO">Combo</option>
            <option value="GIFT">Qua tang</option>
          </select>
          <select
            value={visF}
            onChange={(e) => setVisF(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
          >
            <option value="">Tat ca trang thai</option>
            <option value="1">Dang hien</option>
            <option value="0">Dang an</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400 py-8 text-center">Dang tai...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-400 py-8 text-center">Khong co san pham nao.</p>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-2 w-12">Anh</th>
                <th className="py-2 pr-2">Ten / Tac gia</th>
                <th className="py-2 pr-2 text-right">Gia bia</th>
                <th className="py-2 pr-2 text-right">Gia ban</th>
                <th className="py-2 pr-2">Loai</th>
                <th className="py-2 pr-2 text-center">Hien thi</th>
                <th className="py-2">Noi bat</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => canEdit && openEdit(p)}
                  className={'border-b border-slate-50 hover:bg-rose-50/50 ' + (canEdit ? 'cursor-pointer' : '') + (!p.isVisible ? ' opacity-50' : '')}
                >
                  <td className="py-2 pr-2">
                    {p.coverImage ? (
                      <img src={p.coverImage} alt="" className="w-10 h-14 object-cover rounded-md border border-slate-200" loading="lazy" />
                    ) : (
                      <div className="w-10 h-14 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-300">
                        <Package className="w-4 h-4" />
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <p className="font-bold text-slate-800 line-clamp-1">{p.name}</p>
                    <p className="text-slate-500 line-clamp-1">{p.author || '-'} {p.isbn ? '· ' + p.isbn : ''}</p>
                  </td>
                  <td className="py-2 pr-2 text-right text-slate-600">{fmt(p.coverPrice)}</td>
                  <td className="py-2 pr-2 text-right font-bold text-slate-800">{fmt(p.salePrice)}</td>
                  <td className="py-2 pr-2">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold">
                      {TYPE_LABEL[p.productType] || p.productType}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-center">
                    {canEdit ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleVisible(p); }}
                        title={p.isVisible ? 'An san pham' : 'Hien san pham'}
                        className={'p-1.5 rounded-lg ' + (p.isVisible ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100')}
                      >
                        {p.isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    ) : (
                      <span className={p.isVisible ? 'text-emerald-600' : 'text-slate-400'}>
                        {p.isVisible ? <Eye className="w-4 h-4 inline" /> : <EyeOff className="w-4 h-4 inline" />}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {p.isFeatured && <Star className="w-4 h-4 text-amber-500 fill-amber-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setEditing(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
              <h3 className="text-base font-extrabold text-slate-900">Sua san pham</h3>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-600">Ten san pham *</label>
                  <input value={form.name} onChange={(e) => setF('name', e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600">Tac gia</label>
                    <input value={form.author} onChange={(e) => setF('author', e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600">Dich gia</label>
                    <input value={form.translator} onChange={(e) => setF('translator', e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600">Mo ta</label>
                  <textarea value={form.description} onChange={(e) => setF('description', e.target.value)} rows={5}
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600">The loai</label>
                    <input value={form.category} onChange={(e) => setF('category', e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600">Thu tu sap xep</label>
                    <input type="number" value={form.sortOrder} onChange={(e) => setF('sortOrder', e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-600">URL anh bia</label>
                  <input value={form.coverImage} onChange={(e) => setF('coverImage', e.target.value)}
                    placeholder="https://..."
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  {form.coverImage ? (
                    <img src={form.coverImage} alt="Preview" className="mt-2 w-24 h-32 object-cover rounded-lg border border-slate-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">Chua co anh - san pham nay nen an khoi portal.</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600">Gia bia</label>
                    <input type="number" value={form.coverPrice} onChange={(e) => setF('coverPrice', e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600">Gia ban</label>
                    <input type="number" value={form.salePrice} onChange={(e) => setF('salePrice', e.target.value)}
                      placeholder="Trong = theo gia bia"
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600">ISBN</label>
                    <input value={form.isbn} onChange={(e) => setF('isbn', e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600">SKU</label>
                    <input value={form.sku} onChange={(e) => setF('sku', e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200" />
                  </div>
                </div>
                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!!form.isVisible} onChange={(e) => setF('isVisible', e.target.checked)}
                      className="w-4 h-4 accent-rose-600" />
                    Hien tren portal
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!!form.isFeatured} onChange={(e) => setF('isFeatured', e.target.checked)}
                      className="w-4 h-4 accent-amber-500" />
                    Noi bat
                  </label>
                </div>
              </div>
            </div>
            {formError && (
              <div className="mx-5 mb-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-bold">
                {formError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-2xl">
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Huy
              </button>
              <button onClick={save} disabled={saving}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl disabled:opacity-50">
                {saving ? 'Dang luu...' : 'Luu thay doi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
