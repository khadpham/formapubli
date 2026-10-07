'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

/** Sửa thông tin công ty Bên A (8 trường, seed sẵn Phạm Đam Ca / Giám đốc). */
export function CompanyProfileForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    tenCongTy: 'FORMApubli',
    daiDien: '',
    chucVu: 'Giám đốc',
    diaChi: '',
    mst: '',
    sdt: '',
    email: '',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/contracts/company-profile');
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        if (json.data) {
          setForm({
            tenCongTy: json.data.tenCongTy || 'FORMApubli',
            daiDien: json.data.daiDien || '',
            chucVu: json.data.chucVu || 'Giám đốc',
            diaChi: json.data.diaChi || '',
            mst: json.data.mst || '',
            sdt: json.data.sdt || '',
            email: json.data.email || '',
          });
        }
      } catch (e: any) {
        setErrorMessage(e.message);
      }
    })();
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.tenCongTy.trim()) {
      setErrorMessage('Tên công ty không được để trống.');
      return;
    }
    try {
      setIsSaving(true);
      setErrorMessage(null);
      const res = await fetch('/api/contracts/company-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSavedNote('Đã lưu thông tin công ty.');
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const fields: { key: keyof typeof form; label: string; span?: boolean }[] = [
    { key: 'tenCongTy', label: 'Tên công ty (Bên A)' },
    { key: 'daiDien', label: 'Người đại diện' },
    { key: 'chucVu', label: 'Chức vụ' },
    { key: 'diaChi', label: 'Địa chỉ trụ sở', span: true },
    { key: 'mst', label: 'Mã số thuế' },
    { key: 'sdt', label: 'Điện thoại' },
    { key: 'email', label: 'Email', span: true },
  ];

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-center justify-center p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-sm">Thông tin công ty (Bên A)</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Đóng thông tin công ty">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto text-xs">
          {errorMessage && <p className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold">{errorMessage}</p>}
          {savedNote && <p className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 font-semibold" role="status">{savedNote}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fields.map((f) => (
              <label key={f.key} className={`block ${f.span ? 'sm:col-span-2' : ''}`}>{f.label}
                <input value={form[f.key]} onChange={set(f.key)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none" />
              </label>
            ))}
          </div>
          <button type="button" onClick={save} disabled={isSaving} className="w-full py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-extrabold disabled:opacity-50">
            {isSaving ? 'Đang lưu...' : 'Lưu thông tin công ty'}
          </button>
        </div>
      </div>
    </div>
  );
}
