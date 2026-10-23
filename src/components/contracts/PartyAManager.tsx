'use client';

import React, { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';

/** Quản lý danh sách bên A (nhiều đối tượng) cho hợp đồng. */
export function PartyAManager({ onClose }: { onClose: () => void }) {
  const [parties, setParties] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: '', representative: '', position: 'Giám đốc',
    address: '', tax_code: '', phone: '', email: '', is_default: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/contracts/party-a');
      const json = await res.json();
      if (json.success) setParties(json.data || []);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', representative: '', position: 'Giám đốc', address: '', tax_code: '', phone: '', email: '', is_default: false });
    setError(null);
  };

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({
      name: p.name || '', representative: p.representative || '', position: p.position || 'Giám đốc',
      address: p.address || '', tax_code: p.tax_code || '', phone: p.phone || '', email: p.email || '',
      is_default: !!p.is_default,
    });
    setError(null);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError('Tên bên A không được để trống.');
      return;
    }
    try {
      const url = editing ? `/api/contracts/party-a/${editing.id}` : '/api/contracts/party-a';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setEditing(null);
      setForm({ name: '', representative: '', position: 'Giám đốc', address: '', tax_code: '', phone: '', email: '', is_default: false });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await fetch(`/api/contracts/party-a/${confirmDelete.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setConfirmDelete(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Modal onClose={onClose}>
      <div className="p-6 w-full max-w-2xl">
        <h3 className="text-lg font-bold mb-4">Quản lý bên A</h3>
        {error && <p className="p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 mb-3">{error}</p>}

        <div className="space-y-2 mb-4 max-h-64 overflow-auto">
          {parties.map(p => (
            <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <div className="font-bold text-sm">{p.name} {p.is_default ? <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">Mặc định</span> : null}</div>
                <div className="text-xs text-slate-500">{p.representative} - {p.address}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(p)} className="px-2 py-1 text-xs font-bold text-teal-700 hover:bg-teal-50 rounded">Sửa</button>
                {!p.is_default && (
                  <button onClick={() => setConfirmDelete(p)} className="px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded">Xóa</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-bold mb-3">{editing ? 'Sửa bên A' : 'Thêm bên A mới'}</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold">Tên *</label>
              <input value={form.name} onChange={set('name')} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Công ty TNHH..." />
            </div>
            <div>
              <label className="text-xs font-bold">Người đại diện</label>
              <input value={form.representative} onChange={set('representative')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold">Chức vụ</label>
              <input value={form.position} onChange={set('position')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold">Mã số thuế</label>
              <input value={form.tax_code} onChange={set('tax_code')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-bold">Địa chỉ</label>
              <input value={form.address} onChange={set('address')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold">Điện thoại</label>
              <input value={form.phone} onChange={set('phone')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold">Email</label>
              <input value={form.email} onChange={set('email')} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
                Đặt làm bên A mặc định
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {editing && (
              <button onClick={openAdd} className="px-4 py-2 border rounded-lg text-sm font-bold">Hủy sửa</button>
            )}
            <button onClick={save} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-bold hover:bg-teal-700">
              {editing ? 'Lưu' : 'Thêm'}
            </button>
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm font-bold">Đóng</button>
        </div>

        {confirmDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setConfirmDelete(null)}>
            <div className="bg-white rounded-xl p-6 max-w-sm" onClick={e => e.stopPropagation()}>
              <h4 className="font-bold mb-2">Xóa bên A?</h4>
              <p className="text-sm text-slate-600 mb-4">Xóa "{confirmDelete.name}"? Không thể hoàn tác.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 px-4 py-2 border rounded-lg text-sm font-bold">Giữ lại</button>
                <button onClick={doDelete} className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-bold">Xóa</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
