'use client';

import React, { useState, useEffect } from 'react';
import { ClipboardList, RefreshCw, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import Modal from '../ui/Modal';
import { matchesAnyVietnameseField } from '@/lib/vietnamese';

interface InventoryCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouses: { id: string; code: string; name: string }[];
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

export function InventoryCountModal({ isOpen, onClose, warehouses, onSuccess, existingCountId }: InventoryCountModalProps) {
  const [step, setStep] = useState<'select' | 'count' | 'review'>('select');
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [countId, setCountId] = useState<string | null>(null);
  const [items, setItems] = useState<CountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSearch('');
      if (existingCountId) {
        loadExistingCount(existingCountId);
      } else {
        setStep('select');
        setWarehouseId(warehouses[0]?.id || '');
        setCountId(null);
        setItems([]);
      }
    }
  }, [isOpen, warehouses, existingCountId]);

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
        body: JSON.stringify({ action: 'snapshot' }),
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
      size="xl"
    >
      {step === 'select' && (
        <div className="space-y-4 p-1">
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
