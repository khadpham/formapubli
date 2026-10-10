'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';

/** Quản lý preset lựa chọn nhanh (D11): CRUD + sắp xếp + bật/tắt. */
export function PresetManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [presets, setPresets] = useState<any[]>([]);
  const [label, setLabel] = useState('');
  const [valuesText, setValuesText] = useState('{}');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/contracts/presets');
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setPresets(json.data.all || []);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    await load();
    if (onChanged) onChanged();
  };

  const save = async () => {
    try {
      setErrorMessage(null);
      let parsed: any;
      try {
        parsed = JSON.parse(valuesText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad');
      } catch {
        setErrorMessage('Giá trị phải là object JSON, ví dụ {"ben_a_dai_dien":"Phạm Đam Ca"}.');
        return;
      }
      if (!label.trim()) {
        setErrorMessage('Thiếu nhãn preset.');
        return;
      }
      const res = await fetch('/api/contracts/presets', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId
          ? { id: editingId, label: label.trim(), valuesJson: JSON.stringify(parsed) }
          : { label: label.trim(), valuesJson: JSON.stringify(parsed), sortOrder: presets.length }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setLabel('');
      setValuesText('{}');
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Xóa preset "${name}"?`)) return;
    const res = await fetch(`/api/contracts/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) setErrorMessage(json.error);
    else await refresh();
  };

  const move = async (id: string, dir: -1 | 1) => {
    const idx = presets.findIndex((p) => p.id === id);
    const other = presets[idx + dir];
    if (!other) return;
    const a = presets[idx].sortOrder ?? idx;
    const b = other.sortOrder ?? (idx + dir);
    await fetch('/api/contracts/presets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, sortOrder: b }),
    });
    await fetch('/api/contracts/presets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: other.id, sortOrder: a }),
    });
    await refresh();
  };

  const toggleActive = async (p: any) => {
    await fetch('/api/contracts/presets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
    });
    await refresh();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-center justify-center p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-sm">Quản lý preset lựa chọn nhanh</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Đóng quản lý preset">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto text-xs">
          {errorMessage && <p className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold">{errorMessage}</p>}
          <div className="grid grid-cols-1 gap-2 bg-slate-50 border rounded-2xl p-3">
            <label className="block">Nhãn preset
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Giám đốc - Phạm Đam Ca" className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white" />
            </label>
            <label className="block">Giá trị (JSON: tên biến → nội dung)
              <textarea value={valuesText} onChange={(e) => setValuesText(e.target.value)} rows={3} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none font-mono bg-white" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={save} className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold">
                <Plus className="w-3.5 h-3.5 inline mr-1" />{editingId ? 'Lưu sửa' : 'Thêm preset'}
              </button>
              {editingId && (
                <button type="button" onClick={() => { setEditingId(null); setLabel(''); setValuesText('{}'); }} className="px-3 py-1.5 text-slate-500 font-bold">Hủy</button>
              )}
            </div>
          </div>
          <ul className="space-y-1.5">
            {presets.map((p: any) => (
              <li key={p.id} className={`flex items-center gap-2 border rounded-xl px-3 py-2 ${p.isActive ? 'bg-white' : 'bg-slate-100 opacity-70'}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{p.label}</p>
                  <p className="font-mono text-[10px] text-slate-500 truncate">{p.valuesJson}</p>
                </div>
                <button type="button" onClick={() => move(p.id, -1)} className="p-1 text-slate-400 hover:text-slate-700" aria-label={`Đưa ${p.label} lên trên`}><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => move(p.id, 1)} className="p-1 text-slate-400 hover:text-slate-700" aria-label={`Đưa ${p.label} xuống dưới`}><ArrowDown className="w-3.5 h-3.5" /></button>
                <button
                  type="button"
                  onClick={() => { setEditingId(p.id); setLabel(p.label); setValuesText(p.valuesJson); }}
                  className="px-2 py-1 text-teal-700 hover:bg-teal-50 rounded-lg font-bold"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(p)}
                  className="px-2 py-1 text-slate-600 hover:bg-slate-100 rounded-lg font-bold"
                >
                  {p.isActive ? 'Tắt' : 'Bật'}
                </button>
                <button type="button" onClick={() => remove(p.id, p.label)} className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg" aria-label={`Xóa preset ${p.label}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
