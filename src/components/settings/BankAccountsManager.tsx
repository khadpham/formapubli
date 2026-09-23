'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Landmark,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Building2,
  RefreshCw,
  X,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';

export const POPULAR_BANKS = [
  { bin: '970436', code: 'VCB', name: 'Vietcombank' },
  { bin: '970422', code: 'MB', name: 'MBBank' },
  { bin: '970407', code: 'TCB', name: 'Techcombank' },
  { bin: '970415', code: 'CTG', name: 'VietinBank' },
  { bin: '970418', code: 'BIDV', name: 'BIDV' },
  { bin: '970416', code: 'ACB', name: 'ACB' },
  { bin: '970432', code: 'VPB', name: 'VPBank' },
  { bin: '970423', code: 'TPB', name: 'TPBank' },
  { bin: '970403', code: 'STB', name: 'Sacombank' },
  { bin: '970437', code: 'HDB', name: 'HDBank' },
  { bin: '970405', code: 'VBA', name: 'Agribank' },
  { bin: '970448', code: 'OCB', name: 'OCB' },
  { bin: '970441', code: 'VIB', name: 'VIB' },
];

export interface BankAccountItem {
  id: string;
  label: string;
  bankBin: string;
  accountNo: string;
  accountName?: string | null;
  isActive: boolean;
  createdAt?: string;
}

export interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  defaultBankAccountId?: string | null;
}

interface BankAccountsManagerProps {
  sessionRole?: UserRole;
}

export function BankAccountsManager({ sessionRole }: BankAccountsManagerProps) {
  const isOwnerOrManager = sessionRole === 'ROLE_OWNER' || sessionRole === 'ROLE_MANAGER';

  const [banks, setBanks] = useState<BankAccountItem[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccountItem | null>(null);
  const [formData, setFormData] = useState({
    label: '',
    bankBin: '970436',
    accountNo: '',
    accountName: '',
    isActive: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) setIsModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isSubmitting]);

  // Warehouse Default Assign State
  const [savingWarehouseId, setSavingWarehouseId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [whRes, bankRes] = await Promise.all([
        fetch('/api/warehouses?all=true').then((r) => r.json()),
        fetch('/api/bank-accounts').then((r) => r.json()),
      ]);

      if (whRes?.success && Array.isArray(whRes.data)) {
        setWarehouses(whRes.data);
      }
      if (bankRes?.success && Array.isArray(bankRes.data?.list)) {
        setBanks(bankRes.data.list);
      }
    } catch (err: any) {
      setError(err.message || 'Không tải được danh sách tài khoản ngân hàng.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingAccount(null);
    setFormData({
      label: '',
      bankBin: '970436',
      accountNo: '',
      accountName: '',
      isActive: true,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (acc: BankAccountItem) => {
    setEditingAccount(acc);
    setFormData({
      label: acc.label,
      bankBin: acc.bankBin,
      accountNo: acc.accountNo,
      accountName: acc.accountName || '',
      isActive: acc.isActive,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCopyAccountNo = (acc: BankAccountItem) => {
    navigator.clipboard.writeText(acc.accountNo);
    setCopiedId(acc.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanAccountNo = formData.accountNo.replace(/[\s-]/g, '').trim();
    if (!formData.label.trim()) {
      setFormError('Vui lòng nhập tên gợi nhớ cho tài khoản.');
      return;
    }
    if (!/^\d{6}$/.test(formData.bankBin.trim())) {
      setFormError('Mã BIN ngân hàng phải gồm đúng 6 chữ số.');
      return;
    }
    if (!/^\d{6,19}$/.test(cleanAccountNo)) {
      setFormError('Số tài khoản phải gồm từ 6 đến 19 chữ số.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isEdit = !!editingAccount;
      const url = '/api/bank-accounts';
      const method = isEdit ? 'PUT' : 'POST';
      const payload = isEdit
        ? { id: editingAccount.id, ...formData, accountNo: cleanAccountNo }
        : { ...formData, accountNo: cleanAccountNo };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lưu tài khoản thất bại.');
      }

      setIsModalOpen(false);
      showToast(isEdit ? 'Đã cập nhật thông tin tài khoản!' : 'Đã thêm tài khoản nhận tiền mới!');
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Có lỗi xảy ra.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (acc: BankAccountItem) => {
    try {
      const res = await fetch('/api/bank-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...acc,
          isActive: !acc.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Cập nhật trạng thái thất bại.');
      }
      showToast(`Đã ${!acc.isActive ? 'kích hoạt' : 'tạm ngưng'} tài khoản ${acc.label}!`);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteAccount = async (acc: BankAccountItem) => {
    const isLinked = warehouses.some((w) => w.defaultBankAccountId === acc.id);
    if (isLinked) {
      alert(`Tài khoản "${acc.label}" đang được đặt làm mặc định cho một số kho. Vui lòng chuyển kho sang tài khoản khác trước khi xóa.`);
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${acc.label}" (${acc.accountNo}) không?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/bank-accounts?id=${encodeURIComponent(acc.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Xóa tài khoản thất bại.');
      }
      showToast('Đã xóa tài khoản nhận tiền thành công!');
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSetWarehouseDefault = async (warehouseId: string, bankAccountId: string) => {
    setSavingWarehouseId(warehouseId);
    try {
      const res = await fetch('/api/bank-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, bankAccountId: bankAccountId || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gán tài khoản cho kho thất bại.');
      }
      showToast('Đã cập nhật tài khoản nhận tiền mặc định cho kho!');
      await loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingWarehouseId(null);
    }
  };

  const getBankName = (bin: string) => {
    const b = POPULAR_BANKS.find((p) => p.bin === bin);
    return b ? `${b.name} (${b.code})` : `BIN: ${bin}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
            <Landmark className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
              Tài Khoản Ngân Hàng & VietQR
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Quản lý danh sách tài khoản thụ hưởng, cấu hình mã BIN chuẩn Napas và gán mặc định cho từng kho.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
            title="Tải lại dữ liệu"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {isOwnerOrManager && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm Tài Khoản</span>
            </button>
          )}
        </div>
      </div>

      {toastMsg && (
        <div className="p-3.5 bg-slate-900 text-white rounded-xl text-xs font-semibold shadow-lg flex items-center gap-2 animate-slide-up">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* DANH SÁCH TÀI KHOẢN NGÂN HÀNG */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
            Danh Sách Tài Khoản Nhận Tiền ({banks.length})
          </h3>
          <span className="text-[11px] text-slate-400">
            Tự động sinh mã VietQR theo chuẩn Napas 247
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 bg-white rounded-2xl border border-slate-200 text-center text-slate-400 text-xs font-medium">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
            Đang tải dữ liệu tài khoản ngân hàng...
          </div>
        ) : banks.length === 0 ? (
          <div className="py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-center p-6 space-y-3">
            <Landmark className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-xs font-bold text-slate-600">Chưa có tài khoản nhận tiền nào</p>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
              Thêm tài khoản ngân hàng để hệ thống tự động sinh mã VietQR khi nhân viên thu ngân bán sách tại POS.
            </p>
            {isOwnerOrManager && (
              <button
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm tài khoản đầu tiên
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {banks.map((acc) => {
              const linkedWhs = warehouses.filter((w) => w.defaultBankAccountId === acc.id);
              const isCopied = copiedId === acc.id;

              return (
                <div
                  key={acc.id}
                  className={`bg-white rounded-2xl p-4 border transition-all shadow-xs flex flex-col justify-between ${
                    acc.isActive ? 'border-slate-200 hover:border-indigo-300' : 'border-slate-200/60 opacity-60 bg-slate-50/50'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Top Row: Label & Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-extrabold text-sm text-slate-900 truncate" title={acc.label}>
                          {acc.label}
                        </h4>
                        <p className="text-[11px] text-indigo-700 font-semibold truncate">
                          {getBankName(acc.bankBin)}
                        </p>
                      </div>

                      <button
                        onClick={() => isOwnerOrManager && handleToggleActive(acc)}
                        disabled={!isOwnerOrManager}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 transition ${
                          acc.isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
                        }`}
                        title={acc.isActive ? 'Bấm để tạm ngưng' : 'Bấm để kích hoạt lại'}
                      >
                        {acc.isActive ? 'Hoạt động' : 'Tạm ngưng'}
                      </button>
                    </div>

                    {/* Account Info Box */}
                    <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 font-mono">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 font-sans text-[11px]">Số TK:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-slate-900 tracking-wider">{acc.accountNo}</span>
                          <button
                            onClick={() => handleCopyAccountNo(acc)}
                            className="p-1 hover:bg-white rounded text-slate-400 hover:text-slate-700 transition"
                            title="Sao chép số tài khoản"
                          >
                            {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>

                      {acc.accountName && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 font-sans text-[11px]">Chủ TK:</span>
                          <span className="font-bold text-slate-700 uppercase tracking-tight">{acc.accountName}</span>
                        </div>
                      )}
                    </div>

                    {/* Linked Warehouses Badge */}
                    <div className="text-[11px] flex items-center gap-1.5 flex-wrap">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {linkedWhs.length > 0 ? (
                        linkedWhs.map((w) => (
                          <span key={w.id} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-medium text-[10px]">
                            {w.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 italic text-[10px]">Chưa gán mặc định cho kho nào</span>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  {isOwnerOrManager && (
                    <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openEditModal(acc)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Sửa</span>
                      </button>
                      <button
                        onClick={() => handleDeleteAccount(acc)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* GÁN TÀI KHOẢN MẶC ĐỊNH CHO TỪNG KHO */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-600" />
              Thiết Lập Tài Khoản Mặc Định Cho Từng Kho
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Khi thu ngân chọn kho tại quầy POS, mã VietQR sẽ tự động trỏ về tài khoản được gán ở đây.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {warehouses.map((w) => {
            const isSaving = savingWarehouseId === w.id;
            return (
              <div key={w.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-900 truncate" title={w.name}>
                    {w.name}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                    {w.code}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={w.defaultBankAccountId || ''}
                    disabled={isSaving || !isOwnerOrManager}
                    onChange={(e) => handleSetWarehouseDefault(w.id, e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:opacity-60"
                  >
                    <option value="">— Mặc định chung —</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label} ({b.accountNo})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL THÊM / SỬA TÀI KHOẢN */}
      {isModalOpen && mounted && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) setIsModalOpen(false);
          }}
        >
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold">
                  <Landmark className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    {editingAccount ? 'Chỉnh Sửa Tài Khoản' : 'Thêm Tài Khoản Nhận Tiền'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {editingAccount ? 'Cập nhật thông tin thụ hưởng' : 'Tạo mới tài khoản VietQR'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveAccount} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Tên gợi nhớ <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="Ví dụ: VCB Gian Hàng Hội Chợ"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Chọn Ngân hàng (hoặc nhập BIN 6 số) <span className="text-rose-500">*</span>
                </label>
                <div className="space-y-2">
                  <select
                    value={POPULAR_BANKS.some((b) => b.bin === formData.bankBin) ? formData.bankBin : 'CUSTOM'}
                    onChange={(e) => {
                      if (e.target.value !== 'CUSTOM') {
                        setFormData({ ...formData, bankBin: e.target.value });
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    {POPULAR_BANKS.map((b) => (
                      <option key={b.bin} value={b.bin}>
                        {b.name} ({b.code}) — BIN: {b.bin}
                      </option>
                    ))}
                    <option value="CUSTOM">Khác (Tự nhập mã BIN 6 số)</option>
                  </select>

                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={formData.bankBin}
                    onChange={(e) => setFormData({ ...formData, bankBin: e.target.value.replace(/\D/g, '') })}
                    placeholder="Mã BIN 6 số (VD: 970436)"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Số tài khoản nhận tiền <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.accountNo}
                  onChange={(e) => setFormData({ ...formData, accountNo: e.target.value })}
                  placeholder="Ví dụ: 19036888666..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Tên chủ tài khoản (In hoa không dấu)
                </label>
                <input
                  type="text"
                  value={formData.accountName}
                  onChange={(e) => setFormData({ ...formData, accountName: e.target.value.toUpperCase() })}
                  placeholder="Ví dụ: NGUYEN VAN A"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-md transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Đang lưu...' : editingAccount ? 'Lưu Thay Đổi' : 'Thêm Mới'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
