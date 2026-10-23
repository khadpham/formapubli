'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FileText, Plus, Upload, Building2, Sparkles, ScanSearch, Wand2, FolderKanban, Search, CheckCircle2, XCircle } from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { ContractComposerModal } from './ContractComposerModal';
import { TemplateManagerModal } from './TemplateManagerModal';
import { CompanyProfileForm } from './CompanyProfileForm';
import { AITemplateBuilder } from './AITemplateBuilder';
import { AIContractReview } from './AIContractReview';
import { AISmartDraft } from './AISmartDraft';
import { ContractProjects } from './ContractProjects';

interface ContractsTabProps {
  currentRole?: UserRole;
  /** Từ khóa tìm kiếm đặt trước (VD: nhảy từ giai đoạn dự án sang xem HĐ). */
  presetSearch?: string;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  FINALIZED: 'Đã chốt',
  SIGNED: 'Đã ký',
  CANCELLED: 'Đã hủy',
};

const PAGE_SIZE = 20;

function formatDate(v: any): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatMoney(v: any): string {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return `${n.toLocaleString('vi-VN')} đ`;
}

/** Tab Hợp Đồng: danh sách + lọc + soạn mới + mẫu + công ty. */
export function ContractsTab({ currentRole = 'ROLE_OWNER', presetSearch }: ContractsTabProps) {
  const [docs, setDocs] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState(presetSearch || '');
  const [page, setPage] = useState(1);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [aiDraftOpen, setAiDraftOpen] = useState(false);
  // Ngữ cảnh mở Soạn Thông Minh từ một cột mốc dự án: giai đoạn cần chọn sẵn
  // mẫu + id cột mốc để gắn hợp đồng sau khi chốt. Mở từ nút chung thì null.
  const [smartDraftInit, setSmartDraftInit] = useState<{ category: string; milestoneId?: string } | null>(null);
  const [view, setView] = useState<'docs' | 'projects'>('docs');
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<any | null>(null);
  const [sortBy, setSortBy] = useState<string>('newest');
  const [yearFilter, setYearFilter] = useState<string>('');
  const [partyAFilter, setPartyAFilter] = useState<string>('');
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const canManage = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

  const partnerMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of partners) m.set(p.id, p.name);
    return m;
  }, [partners]);

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

  const loadPartners = useCallback(async () => {
    try {
      const res = await fetch('/api/partners/list');
      const json = await res.json();
      if (json.success) setPartners(json.data || []);
    } catch {
      // Không chặn load hợp đồng nếu lỗi tải đối tác.
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  // Đồng bộ khi tab cha đặt từ khóa mới (nhảy từ dự án sang xem HĐ).
  useEffect(() => {
    if (presetSearch) {
      setSearch(presetSearch);
      setPage(1);
    }
  }, [presetSearch]);

  /** Xem trước hợp đồng trong modal. */
  const previewContract = async (doc: any) => {
    try {
      setErrorMessage(null);
      const res = await fetch(`/api/contracts/documents/${encodeURIComponent(doc.id)}/export-docx`);
      if (!res.ok) throw new Error('Không tải được file xem trước');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewDoc(doc);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewDoc(null);
  };

  /** Tên file tải về theo đúng định dạng gốc. */
  const getDownloadLabel = (doc: any): string => {
    const fn = doc.finalFilename || '';
    if (fn.endsWith('.xls') || fn.endsWith('.xlsx')) return 'Tải Excel';
    if (fn.endsWith('.pdf')) return 'Tải PDF';
    if (fn.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return 'Tải ảnh';
    return 'Tải Word';
  };

  const downloadDocx = async (doc: any) => {
    try {
      const res = await fetch(`/api/contracts/documents/${encodeURIComponent(doc.id)}/export-docx`);
      if (!res.ok) throw new Error('Không tải được file');
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
      setToast(`Đã chốt bản cuối và đánh dấu đã ký: ${doc.contractNumber}`);
      loadDocs();
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  /** Đánh dấu đã ký / đã hủy (F2). Hủy cần popup xác nhận hệ thống (F3). */
  const markStatus = async (doc: any, status: 'SIGNED' | 'CANCELLED') => {
    try {
      setErrorMessage(null);
      const res = await fetch(`/api/contracts/documents/${encodeURIComponent(doc.id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không cập nhật được trạng thái');
      setToast(`Đã đánh dấu ${status === 'SIGNED' ? 'đã ký' : 'đã hủy'}: ${doc.contractNumber}`);
      setConfirmCancel(null);
      loadDocs();
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const deleteDoc = async (doc: any) => {
    try {
      setErrorMessage(null);
      const res = await fetch(`/api/contracts/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không xóa được');
      setToast(`Đã xóa: ${doc.contractNumber}`);
      setConfirmDelete(null);
      loadDocs();
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = docs;
    // Lọc theo từ khóa
    if (q) {
      result = result.filter((d: any) => {
        const partnerName = partnerMap.get(d.partnerId) || '';
        return (
          `${d.contractNumber || ''}`.toLowerCase().includes(q) ||
          `${d.title || ''}`.toLowerCase().includes(q) ||
          partnerName.toLowerCase().includes(q)
        );
      });
    }
    // Lọc theo năm
    if (yearFilter) {
      result = result.filter((d: any) => {
        const dateStr = d.signedDate || d.createdAt;
        if (!dateStr) return false;
        return new Date(dateStr).getFullYear().toString() === yearFilter;
      });
    }
    // Sắp xếp
    const sorted = [...result];
    switch (sortBy) {
      case 'newest':
        sorted.sort((a: any, b: any) => new Date(b.signedDate || b.createdAt || 0).getTime() - new Date(a.signedDate || a.createdAt || 0).getTime());
        break;
      case 'oldest':
        sorted.sort((a: any, b: any) => new Date(a.signedDate || a.createdAt || 0).getTime() - new Date(b.signedDate || b.createdAt || 0).getTime());
        break;
      case 'name_asc':
        sorted.sort((a: any, b: any) => `${a.title || ''}`.localeCompare(`${b.title || ''}`, 'vi'));
        break;
      case 'name_desc':
        sorted.sort((a: any, b: any) => `${b.title || ''}`.localeCompare(`${a.title || ''}`, 'vi'));
        break;
      case 'value_desc':
        sorted.sort((a: any, b: any) => Number(b.totalAmount || 0) - Number(a.totalAmount || 0));
        break;
      case 'value_asc':
        sorted.sort((a: any, b: any) => Number(a.totalAmount || 0) - Number(b.totalAmount || 0));
        break;
    }
    return sorted;
  }, [docs, search, partnerMap, yearFilter, sortBy]);

  // Danh sách năm có hợp đồng để làm filter
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const d of docs) {
      const dateStr = d.signedDate || d.createdAt;
      if (dateStr) years.add(new Date(dateStr).getFullYear().toString());
    }
    return Array.from(years).sort().reverse();
  }, [docs]);

  const totalPages = Math.max(1, Math.ceil(filteredDocs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageDocs = filteredDocs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
            onClick={() => setAiBuilderOpen(true)}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-bold transition"
            aria-label="Tạo mẫu hợp đồng bằng AI"
          >
            <Sparkles className="w-4 h-4 inline mr-1" />Tạo Mẫu Bằng AI
          </button>
          <button
            type="button"
            onClick={() => setAiReviewOpen(true)}
            className="px-4 py-2 bg-white border border-violet-300 text-violet-700 hover:bg-violet-50 rounded-xl text-xs font-bold transition"
            aria-label="AI đọc và phản biện hợp đồng"
          >
            <ScanSearch className="w-4 h-4 inline mr-1" />AI Đọc & Phản Biện
          </button>
          <button
            type="button"
            onClick={() => { setSmartDraftInit(null); setAiDraftOpen(true); }}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-bold transition"
            aria-label="Soạn hợp đồng thông minh bằng AI"
          >
            <Wand2 className="w-4 h-4 inline mr-1" />Soạn Thông Minh
          </button>
          <button
            type="button"
            onClick={() => setView(view === 'docs' ? 'projects' : 'docs')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${view === 'projects' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300 hover:bg-slate-50'}`}
            aria-label="Xem dự án và cột mốc hợp đồng"
          >
            <FolderKanban className="w-4 h-4 inline mr-1" />{view === 'docs' ? 'Dự Án' : 'Hợp Đồng'}
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

      {view === 'projects' ? (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <ContractProjects onSmartDraft={(category, milestoneId) => { setSmartDraftInit({ category, milestoneId }); setView('docs'); setAiDraftOpen(true); }} />
        </div>
      ) : (
      <>
      <div className="flex flex-wrap gap-2 items-center">
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
        <label className="text-xs font-bold text-slate-600">Năm:</label>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none"
        >
          <option value="">Tất cả</option>
          {availableYears.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <label className="text-xs font-bold text-slate-600">Sắp xếp:</label>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none"
        >
          <option value="newest">Mới nhất</option>
          <option value="oldest">Cũ nhất</option>
          <option value="name_asc">Tên A-Z</option>
          <option value="name_desc">Tên Z-A</option>
          <option value="value_desc">Giá trị cao nhất</option>
          <option value="value_asc">Giá trị thấp nhất</option>
        </select>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm số HĐ, tiêu đề, đối tác..."
            className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs outline-none w-64"
          />
        </div>
        <span className="text-xs text-slate-500">{filteredDocs.length} hợp đồng</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="p-3">Số HĐ</th>
              <th className="p-3">Tiêu đề</th>
              <th className="p-3">Đối tác</th>
              <th className="p-3">Ngày ký</th>
              <th className="p-3 text-right">Giá trị</th>
              <th className="p-3">Trạng thái</th>
              <th className="p-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageDocs.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400 italic">Chưa có hợp đồng nào. Bấm “Soạn Hợp Đồng”.</td></tr>
            ) : (
              pageDocs.map((d: any) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold whitespace-nowrap">{d.contractNumber}</td>
                  <td className="p-3 font-semibold">{d.title}</td>
                  <td className="p-3">{partnerMap.get(d.partnerId) || '-'}</td>
                  <td className="p-3 whitespace-nowrap">{formatDate(d.signedDate)}</td>
                  <td className="p-3 text-right font-semibold whitespace-nowrap">{formatMoney(d.totalAmount)}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold whitespace-nowrap">
                      {STATUS_LABEL[d.status] || d.status}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap">
                    {(d.status === 'DRAFT') && (
                      <button type="button" onClick={() => { setEditingDoc(d); setComposerOpen(true); }} className="px-2 py-1 text-teal-700 hover:bg-teal-50 rounded-lg text-[11px] font-bold" aria-label={`Sửa ${d.contractNumber}`}>Sửa</button>
                    )}
                    <button type="button" onClick={() => previewContract(d)} className="px-2 py-1 text-blue-700 hover:bg-blue-50 rounded-lg text-[11px] font-bold" aria-label={`Xem trước ${d.contractNumber}`}>Xem trước</button>
                    <button type="button" onClick={() => downloadDocx(d)} className="px-2 py-1 text-slate-700 hover:bg-slate-100 rounded-lg text-[11px] font-bold" aria-label={`${getDownloadLabel(d)} ${d.contractNumber}`}>{getDownloadLabel(d)}</button>
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
                    {canManage && (d.status === 'DRAFT' || d.status === 'FINALIZED') && (
                      <button type="button" onClick={() => markStatus(d, 'SIGNED')} className="px-2 py-1 text-emerald-700 hover:bg-emerald-50 rounded-lg text-[11px] font-bold" aria-label={`Đánh dấu đã ký ${d.contractNumber}`}>
                        <CheckCircle2 className="w-3.5 h-3.5 inline mr-0.5" />Đã ký
                      </button>
                    )}
                    {canManage && (d.status === 'DRAFT' || d.status === 'FINALIZED') && (
                      <button type="button" onClick={() => setConfirmCancel(d)} className="px-2 py-1 text-amber-700 hover:bg-amber-50 rounded-lg text-[11px] font-bold" aria-label={`Đánh dấu đã hủy ${d.contractNumber}`}>
                        <XCircle className="w-3.5 h-3.5 inline mr-0.5" />Đã hủy
                      </button>
                    )}
                    {(d.status === 'DRAFT' || d.status === 'CANCELLED') && (
                      <button type="button" onClick={() => setConfirmDelete(d)} className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-lg text-[11px] font-bold" aria-label={`Xóa ${d.contractNumber}`}>Xóa</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 p-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
              className="px-3 py-1 border border-slate-300 rounded-lg text-xs font-bold disabled:opacity-40 hover:bg-slate-50"
            >
              Trước
            </button>
            <span className="text-xs font-bold text-slate-600">Trang {safePage} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage >= totalPages}
              className="px-3 py-1 border border-slate-300 rounded-lg text-xs font-bold disabled:opacity-40 hover:bg-slate-50"
            >
              Sau
            </button>
          </div>
        )}
      </div>
      </>
      )}

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
      {aiBuilderOpen && (
        <AITemplateBuilder
          onClose={() => setAiBuilderOpen(false)}
          onSaved={() => { setAiBuilderOpen(false); setToast('Đã lưu mẫu AI - nhớ duyệt pháp lý trước khi dùng.'); }}
        />
      )}
      {aiReviewOpen && <AIContractReview onClose={() => setAiReviewOpen(false)} />}
      {aiDraftOpen && (
        <AISmartDraft
          initialCategory={smartDraftInit?.category}
          milestoneId={smartDraftInit?.milestoneId}
          onClose={() => { setAiDraftOpen(false); setSmartDraftInit(null); }}
        />
      )}
      {profileOpen && <CompanyProfileForm onClose={() => setProfileOpen(false)} />}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Xóa hợp đồng?</h3>
            <p className="text-sm text-slate-600 mb-4">
              Xóa hợp đồng nháp "{confirmDelete.contractNumber}"? Hành động này không thể hoàn tác.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm font-bold"
              >
                Hủy
              </button>
              <button
                onClick={() => deleteDoc(confirmDelete)}
                className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-bold hover:bg-rose-700"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCancel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setConfirmCancel(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">Đánh dấu đã hủy?</h3>
            <p className="text-sm text-slate-600 mb-4">
              Đánh dấu hợp đồng "{confirmCancel.contractNumber}" là đã hủy? Hợp đồng đã hủy không thể chuyển trạng thái nữa.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmCancel(null)}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-sm font-bold"
              >
                Giữ lại
              </button>
              <button
                onClick={() => markStatus(confirmCancel, 'CANCELLED')}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700"
              >
                Đánh dấu hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xem trước hợp đồng */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closePreview}>
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">Xem trước: {previewDoc.contractNumber}</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => { downloadDocx(previewDoc); }}
                  className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-bold hover:bg-teal-700"
                >
                  {getDownloadLabel(previewDoc)}
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700"
                >
                  In / PDF
                </button>
                <button
                  onClick={closePreview}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold hover:bg-slate-50"
                >
                  Đóng
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {previewUrl ? (
                <iframe src={previewUrl} className="w-full h-[60vh] border rounded-lg" title="Xem trước hợp đồng" />
              ) : (
                <p className="text-center text-slate-500">Đang tải...</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
