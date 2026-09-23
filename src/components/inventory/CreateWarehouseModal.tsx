'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Building2, X, PlusCircle, CheckCircle2, AlertTriangle, Store } from 'lucide-react';

interface CreateWarehouseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (warehouse: any) => void;
}

export function CreateWarehouseModal({
  isOpen,
  onClose,
  onCreated,
}: CreateWarehouseModalProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [warehouseType, setWarehouseType] = useState<'FAIR_EVENT' | 'PHYSICAL_MAIN'>('FAIR_EVENT');
  const [isSellableOnPos, setIsSellableOnPos] = useState(true);
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; label: string; accountNo: string }>>([]);
  const [defaultBankAccountId, setDefaultBankAccountId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/bank-accounts')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (j?.success && Array.isArray(j.data?.list)) setBankAccounts(j.data.list); })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !mounted) return null;

  // Tự động sinh mã kho gợi ý từ tên kho
  const handleNameChange = (val: string) => {
    setName(val);
    const slug = val
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    if (slug) {
      setCode(slug.startsWith('KHO_') ? slug : `KHO_${slug}`);
    } else {
      setCode('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Vui lòng nhập tên kho hoặc gian hàng.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || undefined,
          address: address.trim() || undefined,
          warehouseType,
          isSellableOnPos,
          defaultBankAccountId: defaultBankAccountId || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || 'Lỗi khi tạo kho mới.');
      }

      onCreated(json.data);
      onClose();
      // Reset form
      setName('');
      setCode('');
      setAddress('');
      setWarehouseType('FAIR_EVENT');
      setIsSellableOnPos(true);
      setDefaultBankAccountId('');
    } catch (err: any) {
      setError(err.message || 'Lỗi hệ thống khi tạo kho.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900">
                Mở Kho / Gian Hàng Mới
              </h3>
              <p className="text-[11px] text-slate-400">
                Chỉ dành cho Quản lý • Mở nhiều hội chợ song song
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2 text-rose-700 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Tên kho */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Tên kho / Gian hàng sự kiện <span className="text-rose-500">*</span>:
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="VD: Kho Hội Chợ Giảng Võ, Gian Hàng Đà Nẵng..."
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
            />
          </div>

          {/* Mã kho */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Mã định danh kho (viết hoa không dấu):
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="VD: KHO_HOI_CHO_GIANG_VO"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Hệ thống tự động sinh ID: <span className="font-mono">{code ? `wh-${code.toLowerCase().replace(/_/g, '-')}` : '...'}</span>
            </p>
          </div>

          {/* Địa chỉ gian hàng */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Địa chỉ / Vị trí gian hàng:
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="VD: Gian B12, Trung tâm Triển lãm Giảng Võ..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
            />
          </div>

          {/* Loại kho */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Phân loại kho:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setWarehouseType('FAIR_EVENT');
                  setIsSellableOnPos(true);
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  warehouseType === 'FAIR_EVENT'
                    ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>Hội Chợ / Sự Kiện</span>
              </button>

              <button
                type="button"
                onClick={() => setWarehouseType('PHYSICAL_MAIN')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  warehouseType === 'PHYSICAL_MAIN'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-sm'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Kho Cố Định</span>
              </button>
            </div>
          </div>

          {/* Cờ Bật bán hàng trên máy POS */}
          <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-emerald-950 block">
                Bật Bán Hàng Trực Tiếp Trên POS
              </span>
              <span className="text-[10px] text-emerald-700 block mt-0.5">
                Cho phép thu ngân chọn kho này để mở quầy bán lẻ tại chỗ
              </span>
            </div>
            <input
              type="checkbox"
              checked={isSellableOnPos}
              onChange={(e) => setIsSellableOnPos(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
            />
          </div>

          {/* TK nhận VietQR mặc định */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              TK nhận VietQR mặc định:
            </label>
            <select
              value={defaultBankAccountId}
              onChange={(e) => setDefaultBankAccountId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
            >
              <option value="">— Dùng TK mặc định chung —</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>{b.label} — {b.accountNo}</option>
              ))}
            </select>
          </div>

          {/* Nút hành động */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-md shadow-amber-600/20 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? 'Đang tạo kho...' : 'Tạo Kho Ngay'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
