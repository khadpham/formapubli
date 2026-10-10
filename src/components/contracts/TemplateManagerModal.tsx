'use client';

import React, { useState, useEffect } from 'react';
import { Upload, X } from 'lucide-react';

/** Quản lý mẫu: upload .docx → validate → đặt nhãn biến → lưu; version tự tăng khi thay file. */
export function TemplateManagerModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [labelsFor, setLabelsFor] = useState<any | null>(null);
  const [labelMap, setLabelMap] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const load = async () => {
    const res = await fetch('/api/contracts/templates?activeOnly=0');
    const json = await res.json();
    if (json.success) setTemplates(json.data || []);
    else setErrorMessage(json.error);
  };

  useEffect(() => {
    load();
  }, []);

  const openLabels = (t: any) => {
    setLabelsFor(t);
    try {
      const fields = JSON.parse(t.schemaFields || '[]');
      const m: Record<string, string> = {};
      for (const f of fields) m[f.key] = f.label || f.key;
      setLabelMap(m);
    } catch {
      setLabelMap({});
    }
  };

  const saveLabels = async () => {
    if (!labelsFor) return;
    try {
      setIsWorking(true);
      const fields = Object.entries(labelMap).map(([key, label]) => ({ key, label: `${label}`.trim() || key, type: 'text', required: false }));
      const res = await fetch(`/api/contracts/templates/${encodeURIComponent(labelsFor.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaFields: JSON.stringify(fields) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setLabelsFor(null);
      await load();
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setIsWorking(false);
    }
  };

  const readBase64 = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(`${r.result}`.split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(f);
    });

  const save = async () => {
    if (!file) {
      setErrorMessage('Hãy chọn file Word (.docx) làm mẫu.');
      return;
    }
    if (!code.trim() || !title.trim()) {
      setErrorMessage('Thiếu mã mẫu hoặc tiêu đề.');
      return;
    }
    try {
      setIsWorking(true);
      setErrorMessage(null);
      const base64 = await readBase64(file);
      // Nhãn biến đặt SAU khi lưu (nút "Nhãn biến" ở từng mẫu) - server tự
      // sinh schema_fields tạm từ placeholder khi tạo.
      const res = await fetch('/api/contracts/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          title: title.trim(),
          templateFilename: file.name,
          templateData: base64,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.code === 'INVALID_TEMPLATE') {
          setErrorMessage(`File Word lỗi placeholder: ${(json.details || []).join('; ')}`);
        } else throw new Error(json.error);
        return;
      }
      setFile(null);
      setCode('');
      setTitle('');
      await load();
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-center justify-center p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3 border-b flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-sm">Quản lý mẫu hợp đồng</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Đóng quản lý mẫu">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto text-xs">
          {errorMessage && <p className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold">{errorMessage}</p>}
          <div className="grid grid-cols-2 gap-2 bg-slate-50 border rounded-2xl p-3">
            <label className="block col-span-2">File Word mẫu (.docx)
              <input
                type="file"
                accept=".docx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-0.5 w-full text-xs"
              />
            </label>
            <label className="block">Mã mẫu
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="HD_XUAT_BAN" className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white font-mono" />
            </label>
            <label className="block">Tiêu đề
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white" />
            </label>
            <div className="col-span-2">
              <button type="button" onClick={save} disabled={isWorking} className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold disabled:opacity-50">
                <Upload className="w-3.5 h-3.5 inline mr-1" />{isWorking ? 'Đang lưu...' : 'Tải mẫu lên'}
              </button>
              <p className="text-[11px] text-slate-500 mt-1">Hệ thống tự đọc placeholder trong file khi lưu.</p>
            </div>
            {labelsFor && (
              <div className="col-span-2 space-y-1 border border-teal-200 bg-teal-50/50 rounded-xl p-2.5">
                <p className="font-bold">Nhãn tiếng Việt cho biến của “{labelsFor.title}”:</p>
                {Object.keys(labelMap).map((k) => (
                  <label key={k} className="grid grid-cols-2 gap-2 items-center">
                    <code className="font-mono bg-white border rounded-lg px-2 py-1">{k}</code>
                    <input
                      value={labelMap[k] || ''}
                      onChange={(e) => setLabelMap((m) => ({ ...m, [k]: e.target.value }))}
                      placeholder="Nhãn tiếng Việt"
                      className="px-2 py-1 border rounded-lg outline-none bg-white"
                    />
                  </label>
                ))}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={saveLabels} disabled={isWorking} className="px-3 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-bold disabled:opacity-50">
                    Lưu nhãn
                  </button>
                  <button type="button" onClick={() => setLabelsFor(null)} className="px-3 py-1 text-slate-500 font-bold">Đóng</button>
                </div>
              </div>
            )}
          </div>
          <ul className="space-y-1.5">
            {templates.map((t: any) => (
              <li key={t.id} className="flex items-center gap-2 border rounded-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{t.title} <span className="font-mono text-slate-400">[{t.code}] v{t.version}</span></p>
                  <p className="text-[11px] text-slate-500">{t.category} • {t.isActive ? 'Đang dùng' : 'Ngưng dùng'}</p>
                </div>
                <button type="button" onClick={() => openLabels(t)} className="px-2 py-1 text-teal-700 hover:bg-teal-50 rounded-lg font-bold">
                  Nhãn biến
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
