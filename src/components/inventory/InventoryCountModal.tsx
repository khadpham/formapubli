'use client';

import React, { useState, useEffect } from 'react';
import { ClipboardList, RefreshCw, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import Modal from '../ui/Modal';
import { matchesAnyVietnameseField } from '@/lib/vietnamese';

interface InventoryCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouses: { id: string; code: string; name: string }[];
  books?: { id: string; name: string }[];
  onSuccess?: () => void;
  existingCountId?: string | null;
}

interface CountItem {
  id: string;
  productId: string;
  productName: string;
  systemQty: number;
  countedQty: number | null;
  note?: string;
}

export function InventoryCountModal({ isOpen, onClose, warehouses, books = [], onSuccess, existingCountId }: InventoryCountModalProps) {
  const [step, setStep] = useState<'select' | 'count' | 'review'>('select');
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [countId, setCountId] = useState<string | null>(null);
  const [items, setItems] = useState<CountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [countMode, setCountMode] = useState<'full' | 'partial'>('full');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [productSearch, setProductSearch] = useState('');
  const [mainTab, setMainTab] = useState<'create' | 'list'>('create');
  const [countList, setCountList] = useState<any[]>([]);
  const [listLoading, setListLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSearch('');
      if (existingCountId) {
        loadExistingCount(existingCountId);
        setMainTab('create');
      } else {
        setMainTab('create');
        setStep('select');
        setWarehouseId(warehouses[0]?.id || '');
        setCountId(null);
        setItems([]);
        setSelectedProductIds(new Set());
        setProductSearch('');
        setCountMode('full');
      }
    }
  }, [isOpen, warehouses, existingCountId]);

  const loadCountList = async () => {
    setListLoading(true);
    try {
      const res = await fetch('/api/inventory/counts');
      const data = await res.json();
      if (data.ok) setCountList(data.data || []);
    } catch {} finally {
      setListLoading(false);
    }
  };

  const handleApprove = async (cid: string) => {
    if (!confirm('Duyệt đợt kiểm kê này? Tồn kho sẽ được điều chỉnh.')) return;
    setListLoading(true);
    try {
      const res = await fetch(`/api/inventory/counts/${cid}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Duyệt thất bại');
      await loadCountList();
      onSuccess?.();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    } finally {
      setListLoading(false);
    }
  };

  const handleCancelCount = async (cid: string) => {
    if (!confirm('Hủy đợt kiểm kê này?')) return;
    setListLoading(true);
    try {
      const res = await fetch(`/api/inventory/counts/${cid}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Hủy thất bại');
      await loadCountList();
      onSuccess?.();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    } finally {
      setListLoading(false);
    }
  };

  const loadExistingCount = async (cid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/counts/${cid}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Không tải được');
      const c = data.data;
      setCountId(c.id);
      setWarehouseId(c.warehouseId);
      setNote(c.note || '');
      setItems((c.items || []).map((it: any) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName || it.productId,
        systemQty: it.systemQty,
        countedQty: it.countedQty,
        note: it.note,
      })));
      setStep('count');
    } catch (e: any) {
      setError(e.message);
      setStep('select');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!warehouseId) { setError('Chọn kho'); return; }
    if (countMode === 'partial' && selectedProductIds.size === 0) { setError('Chọn ít nhất 1 sản phẩm cần kiểm kê'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/inventory/counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, note }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setCountId(data.id);
      // Snapshot
      const snapRes = await fetch(`/api/inventory/counts/${data.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snapshot', ...(countMode === 'partial' && selectedProductIds.size > 0 ? { productIds: Array.from(selectedProductIds) } : {}) }),
      });
      const snapData = await snapRes.json();
      if (!snapData.ok) throw new Error(snapData.error);
      // Load items
      await loadItems(data.id);
      setStep('count');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async (id: string) => {
    const res = await fetch(`/api/inventory/counts/${id}`);
    const data = await res.json();
    if (data.ok) setItems(data.data.items || []);
  };

  const handleSaveCounts = async () => {
    if (!countId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/inventory/counts/${countId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(it => ({ itemId: it.id, countedQty: it.countedQty, note: it.note })),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setStep('review');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!countId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/inventory/counts/${countId}/submit`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      onSuccess?.();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (id: string, field: 'countedQty' | 'note', value: any) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it));
  };

  const filtered = items.filter(it =>
    !search || matchesAnyVietnameseField(search, [it.productName])
  );
  const counted = items.filter(it => it.countedQty != null).length;
  const diffs = items.filter(it => it.countedQty != null && it.countedQty !== it.systemQty).length;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Kiểm kê kho"
      subtitle="Đếm thực tế, so với sổ, tạo điều chỉnh"
      size={step === "count" || mainTab === "list" ? "xl" : "md"}
    >
      {step === 'select' && !existingCountId && (
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4">
          <button
            type="button"
            onClick={() => setMainTab('create')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition ${mainTab === 'create' ? 'bg-white shadow text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Tạo đợt mới
          </button>
          <button
            type="button"
            onClick={() => { setMainTab('list'); loadCountList(); }}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-bold transition ${mainTab === 'list' ? 'bg-white shadow text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Đợt kiểm kê {countList.length > 0 && `(${countList.length})`}
          </button>
        </div>
      )}
      {step === 'select' && mainTab === 'list' && !existingCountId && (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {listLoading && <p className="text-sm text-slate-500 text-center py-4">Đang tải...</p>}
          {!listLoading && countList.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">Chưa có đợt kiểm kê nào</p>
          )}
          {countList.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between gap-2 p-3 bg-white border border-slate-200 rounded-xl">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 truncate">{c.note || `Đợt ${c.id.slice(0, 8)}`}</p>
                <p className="text-xs text-slate-500">
                  {c.warehouseName || ''} - {new Date(c.createdAt).toLocaleDateString('vi-VN')}
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${
                    c.status === 'DRAFT' ? 'bg-slate-100 text-slate-600' :
                    c.status === 'COUNTING' ? 'bg-blue-100 text-blue-700' :
                    c.status === 'PENDING_APPROVAL' ? 'bg-amber-100 text-amber-700' :
                    'bg-emerald-100 text-emerald-700'
                  }`}>
                    {c.status === 'DRAFT' ? 'Nháp' : c.status === 'COUNTING' ? 'Đang đếm' : c.status === 'PENDING_APPROVAL' ? 'Chờ duyệt' : 'Hoàn tất'}
                  </span>
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {(c.status === 'DRAFT' || c.status === 'COUNTING') && (
                  <button
                    type="button"
                    onClick={() => loadExistingCount(c.id)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold"
                  >
                    {c.status === 'COUNTING' ? 'Tiếp tục' : 'Xem'}
                  </button>
                )}
                {c.status === 'PENDING_APPROVAL' && (
                  <button
                    type="button"
                    onClick={() => handleApprove(c.id)}
                    disabled={listLoading}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                  >
                    Duyệt
                  </button>
                )}
                {(c.status === 'DRAFT' || c.status === 'COUNTING') && (
                  <button
                    type="button"
                    onClick={() => handleCancelCount(c.id)}
                    disabled={listLoading}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold disabled:opacity-50"
                  >
                    Hủy
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {step === 'select' && mainTab === 'create' && (
        <div className="space-y-4 p-1">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-2">Phạm vi kiểm kê</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCountMode('full')}
                className={`flex-1 py-2 px-3 rounded-xl text-sm font-bold border-2 transition ${countMode === 'full' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
              >
                Toàn kho
              </button>
              <button
                type="button"
                onClick={() => setCountMode('partial')}
                className={`flex-1 py-2 px-3 rounded-xl text-sm font-bold border-2 transition ${countMode === 'partial' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
              >
                Chọn sản phẩm {selectedProductIds.size > 0 && `(${selectedProductIds.size})`}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {countMode === 'full' ? 'Đếm toàn bộ sản phẩm trong kho' : 'Chỉ kiểm kê các sản phẩm đã chọn (1 hoặc nhiều)'}
            </p>
          </div>
          {countMode === 'partial' && (
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">
                Sản phẩm đã chọn: <span className="text-emerald-600">{selectedProductIds.size}</span>
              </label>
              {selectedProductIds.size > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2 max-h-20 overflow-y-auto p-2 bg-emerald-50 rounded-xl border border-emerald-200">
                  {books.filter(b => selectedProductIds.has(b.id)).map(b => (
                    <span key={b.id} className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-emerald-300 rounded-lg text-xs font-medium">
                      {b.name.length > 30 ? b.name.slice(0, 30) + '...' : b.name}
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(selectedProductIds);
                          next.delete(b.id);
                          setSelectedProductIds(next);
                        }}
                        className="text-rose-500 hover:text-rose-700 font-bold"
                      >×</button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelectedProductIds(new Set())}
                    className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2"
                  >
                    Xóa hết
                  </button>
                </div>
              )}
              <input
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                placeholder="Tìm tên sách (gõ không dấu hoặc viết tắt đều được)..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm mb-1"
              />
              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {books
                  .filter(b => !productSearch || matchesAnyVietnameseField(productSearch, [b.name]))
                  .slice(0, 100)
                  .map(b => {
                    const checked = selectedProductIds.has(b.id);
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm hover:bg-slate-50 ${checked ? 'bg-emerald-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(selectedProductIds);
                            if (checked) next.delete(b.id);
                            else next.add(b.id);
                            setSelectedProductIds(next);
                          }}
                          className="w-4 h-4 accent-emerald-600 shrink-0"
                        />
                        <span className={checked ? 'font-semibold text-emerald-800' : 'text-slate-700'}>{b.name}</span>
                      </label>
                    );
                  })}
                {books.filter(b => !productSearch || matchesAnyVietnameseField(productSearch, [b.name])).length === 0 && (
                  <p className="px-3 py-4 text-sm text-slate-400 text-center">Không tìm thấy sản phẩm</p>
                )}
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">Kho kiểm kê</label>
            <select
              value={warehouseId}
              onChange={e => setWarehouseId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
            >
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">Ghi chú</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="VD: Kiểm kê cuối tháng 10"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
            />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
            Tạo đợt và chụp tồn kho
          </button>
        </div>
      )}

      {step === 'count' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm sản phẩm..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-sm"
            />
            <span className="text-xs text-slate-500 whitespace-nowrap">
              Đã đếm {counted}/{items.length} · Chênh lệch {diffs}
            </span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
            {filtered.map(it => {
              const diff = it.countedQty != null ? it.countedQty - it.systemQty : null;
              return (
                <div key={it.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{it.productName}</p>
                    <p className="text-xs text-slate-500">Sổ: <b>{it.systemQty}</b></p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={it.countedQty ?? ''}
                    onChange={e => updateItem(it.id, 'countedQty', e.target.value === '' ? null : Number(e.target.value))}
                    placeholder="Thực tế"
                    className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center font-mono"
                  />
                  {diff != null && diff !== 0 && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${diff > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  )}
                  {diff === 0 && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  )}
                </div>
              );
            })}
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button
            onClick={handleSaveCounts}
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
            Lưu và xem tổng hợp
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-3">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
            <p className="font-bold text-amber-900">Tổng hợp chênh lệch: {diffs} mặt hàng</p>
            <p className="text-xs text-amber-700 mt-1">
              Gửi duyệt sẽ tạo phiếu chờ manager/owner phê duyệt. Sau khi duyệt, hệ thống tự tạo bút toán điều chỉnh.
            </p>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setStep('count')}
              className="flex-1 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold"
            >
              Quay lại sửa
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
              Gửi duyệt
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
