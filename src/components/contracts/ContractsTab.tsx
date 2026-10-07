'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Upload, Building2 } from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { ContractComposerModal } from './ContractComposerModal';
import { TemplateManagerModal } from './TemplateManagerModal';
import { CompanyProfileForm } from './CompanyProfileForm';

interface ContractsTabProps {
  currentRole?: UserRole;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  FINALIZED: 'Đã chốt',
  SIGNED: 'Đã ký',
  CANCELLED: 'Đã hủy',
};

/** Tab Hợp Đồng: danh sách + lọc + soạn mới + mẫu + công ty. */
export function ContractsTab({ currentRole = 'ROLE_OWNER' }: ContractsTabProps) {
  const [docs, setDocs] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      setErrorMessage(null);
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const res = await fetch(`/api/contracts/documents${q}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không tải được danh sách');
      setDocs(json.data || []);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const downloadDocx = async (doc: any) => {
    try {
      const res = await fetch(`/api/contracts/documents/${encodeURIComponent(doc.id)}/export-docx`);
      if (!res.ok) throw new Error('Không tải được file Word');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = doc.finalFilename || `${doc.contractNumber}.docx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setToast(`Đã tải: ${doc.contractNumber}`);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const uploadFinal = async (doc: any, file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Ghép theo chunk 32KB: nối từng byte một với file 15MB sẽ treo UI.
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
      }
      const res = await fetch(`/api/contracts/documents/${encodeURIComponent(doc.id)}/final-docx`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: btoa(bin), filename: file.name }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Tải bản cuối thất bại');
      setToast(`Đã chốt bản cuối: ${doc.contractNumber}`);
      loadDocs();
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const deleteDoc = async (doc: any) => {
    if (!window.confirm(`Xóa hợp đồng nháp ${doc.contractNumber}?`)) return;
    try {
      const res = await fetch(`/api/contracts/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không xóa được');
      setToast(`Đã xóa: ${doc.contractNumber}`);
      loadDocs();
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <FileText className="w-5 h-5 text-teal-600" />
            Hợp Đồng
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Soạn từ mẫu Word, xem trước trực tiếp, chốt bản cuối sau khi sửa ngoài</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setEditingDoc(null); setComposerOpen(true); }}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold transition"
            aria-label="Soạn hợp đồng mới"
          >
            <Plus className="w-4 h-4 inline mr-1" />Soạn Hợp Đồng
          </button>
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-bold transition"
            aria-label="Quản lý mẫu hợp đồng"
          >
            Quản Lý Mẫu
          </button>
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-bold transition"
            aria-label="Thông tin công ty Bên A"
          >
            <Building2 className="w-4 h-4 inline mr-1" />Thông Tin Công Ty
          </button>
        </div>
      </div>

      {toast && (
        <p className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold" role="status">
          {toast}
        </p>
      )}
      {errorMessage && (
        <p className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">{errorMessage}</p>
      )}

      <div className="flex gap-2 items-center">
        <label className="text-xs font-bold text-slate-600">Trạng thái:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none"
        >
          <option value="">Tất cả</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="p-3">Số HĐ</th>
              <th className="p-3">Tiêu đề</th>
              <th className="p-3">Trạng thái</th>
              <th className="p-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docs.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-slate-400 italic">Chưa có hợp đồng nào. Bấm “Soạn Hợp Đồng”.</td></tr>
            ) : (
              docs.map((d: any) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold">{d.contractNumber}</td>
                  <td className="p-3 font-semibold">{d.title}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold">
                      {STATUS_LABEL[d.status] || d.status}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1">
                    {(d.status === 'DRAFT') && (
                      <button type="button" onClick={() => { setEditingDoc(d); setComposerOpen(true); }} className="px-2 py-1 text-teal-700 hover:bg-teal-50 rounded-lg text-[11px] font-bold" aria-label={`Sửa ${d.contractNumber}`}>Sửa</button>
                    )}
                    <button type="button" onClick={() => downloadDocx(d)} className="px-2 py-1 text-slate-700 hover:bg-slate-100 rounded-lg text-[11px] font-bold" aria-label={`Tải Word ${d.contractNumber}`}>Tải Word</button>
                    {(d.status === 'DRAFT' || d.status === 'FINALIZED') && (
                    <label className="px-2 py-1 text-slate-700 hover:bg-slate-100 rounded-lg text-[11px] font-bold cursor-pointer" aria-label={`Tải bản cuối ${d.contractNumber}`}>
                      Tải bản cuối lên
                      <input
                        type="file"
                        accept=".docx"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadFinal(d, f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    )}
                    {(d.status === 'DRAFT' || d.status === 'CANCELLED') && (
                      <button type="button" onClick={() => deleteDoc(d)} className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-lg text-[11px] font-bold" aria-label={`Xóa ${d.contractNumber}`}>Xóa</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {composerOpen && (
        <ContractComposerModal
          currentRole={currentRole}
          initialDoc={editingDoc}
          onClose={() => { setComposerOpen(false); setEditingDoc(null); }}
          onSaved={(num: string) => {
            setToast(`Đã lưu: ${num}`);
            setComposerOpen(false);
            setEditingDoc(null);
            loadDocs();
          }}
        />
      )}
      {templatesOpen && <TemplateManagerModal onClose={() => setTemplatesOpen(false)} />}
      {profileOpen && <CompanyProfileForm onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
