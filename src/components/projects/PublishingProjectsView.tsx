'use client';

import { useEffect, useState } from 'react';
import { Plus, BookOpen, AlertTriangle, CheckCircle2, Clock, ChevronRight } from 'lucide-react';

const STAGE_ORDER = ['THIET_KE_BIA', 'BIEN_DICH', 'BIEN_TAP', 'DAN_TRANG', 'DOC_MORAT'];
const STAGE_LABELS: Record<string, string> = {
  THIET_KE_BIA: 'Thiết kế bìa',
  BIEN_DICH: 'Biên dịch',
  BIEN_TAP: 'Biên tập',
  DAN_TRANG: 'Dàn trang',
  DOC_MORAT: 'Đọc morat',
};

interface Project {
  id: string;
  code: string;
  bookTitle: string;
  author?: string;
  translator?: string;
  status: string;
  currentStage?: string;
}

interface Stage {
  stage: string;
  stageOrder: number;
  status: string;
  contractDate?: string;
  acceptanceDate?: string;
  contractAmount?: number;
  netAmount?: number;
  assigneeName?: string;
  contractId?: string;
}

interface DocOption {
  id: string;
  contractNumber: string;
  title: string;
  status: string;
}

interface PublishingProjectsViewProps {
  /** Nhảy sang xem hợp đồng đã gắn (do tab gộp cung cấp). */
  onViewContract?: (contractId: string) => void;
  /** Có được gắn/gỡ hợp đồng không (API PATCH chỉ cho Owner/Manager). */
  canLinkContract?: boolean;
}

export default function PublishingProjectsView({ onViewContract, canLinkContract = false }: PublishingProjectsViewProps = {}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [violations, setViolations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ bookTitle: '', author: '', translator: '' });
  // Gắn hợp đồng vào giai đoạn
  const [linkStage, setLinkStage] = useState<string | null>(null);
  const [docOptions, setDocOptions] = useState<DocOption[]>([]);
  const [docSearch, setDocSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const [docMap, setDocMap] = useState<Record<string, string>>({});

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const res = await fetch('/api/publishing-projects');
      const json = await res.json();
      if (json.success) setProjects(json.data);
    } catch {}
    setLoading(false);
  }

  async function loadDetail(id: string) {
    setSelected(id);
    try {
      const res = await fetch(`/api/publishing-projects/${id}`);
      const json = await res.json();
      if (json.success) setStages(json.data.stages);
      const chk = await fetch(`/api/publishing-projects/${id}/check`);
      const chkJson = await chk.json();
      if (chkJson.success) setViolations(chkJson.data.violations);
      // Bản đồ id -> số HĐ để hiển thị liên kết
      const dr = await fetch('/api/contracts/documents');
      const dj = await dr.json();
      if (dj.success) {
        const m: Record<string, string> = {};
        for (const d of dj.data || []) m[d.id] = d.contractNumber || d.title || d.id;
        setDocMap(m);
      }
    } catch {}
  }

  async function openLinkModal(stageKey: string) {
    setLinkStage(stageKey);
    setDocSearch('');
    try {
      const res = await fetch('/api/contracts/documents');
      const json = await res.json();
      if (json.success) setDocOptions(json.data || []);
    } catch {}
  }

  async function linkContract(docId: string) {
    if (!selected || !linkStage || linking) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/publishing-projects/${selected}/stages/${linkStage}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: docId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không gắn được hợp đồng');
      setLinkStage(null);
      await loadDetail(selected);
    } catch {
      // Giữ modal mở để người dùng thử lại; lỗi đã log ở console.
    }
    setLinking(false);
  }

  async function unlinkContract(stageKey: string) {
    if (!selected) return;
    try {
      const res = await fetch(`/api/publishing-projects/${selected}/stages/${stageKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: null }),
      });
      const json = await res.json();
      if (json.success && selected) await loadDetail(selected);
    } catch {}
  }

  async function handleCreate() {
    if (!form.bookTitle.trim()) return;
    try {
      const res = await fetch('/api/publishing-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowCreate(false);
        setForm({ bookTitle: '', author: '', translator: '' });
        loadProjects();
      }
    } catch {}
  }

  const blocking = violations.filter((v: any) => v.severity === 'BLOCK');
  const warnings = violations.filter((v: any) => v.severity === 'WARN');

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-extrabold text-slate-900">Dự án xuất bản</h1>
          <p className="text-sm text-slate-500 mt-1">Theo dõi 5 giai đoạn: thiết kế bìa → biên dịch → biên tập → dàn trang → đọc morat</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 min-h-[44px]"
        >
          <Plus className="w-4 h-4" /> Dự án mới
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Danh sách dự án */}
        <div className="lg:col-span-1 space-y-2">
          {loading && <p className="text-slate-500 text-sm">Đang tải...</p>}
          {!loading && projects.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Chưa có dự án nào</p>
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => loadDetail(p.id)}
              className={`w-full text-left p-3 rounded-xl border transition min-h-[44px] ${
                selected === p.id
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-sm text-slate-900">{p.bookTitle}</p>
                  <p className="text-xs text-slate-500 font-mono">{p.code}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
              {p.currentStage && (
                <p className="text-xs text-slate-600 mt-1">
                  Đang ở: <span className="font-semibold">{STAGE_LABELS[p.currentStage] || p.currentStage}</span>
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Timeline chi tiết */}
        <div className="lg:col-span-2">
          {!selected && (
            <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200">
              <Clock className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Chọn một dự án để xem timeline</p>
            </div>
          )}
          {selected && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              {/* Cảnh báo rule */}
              {blocking.length > 0 && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm font-bold text-red-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> {blocking.length} vi phạm cần xử lý
                  </p>
                  {blocking.map((v: any, i: number) => (
                    <p key={i} className="text-xs text-red-700 mt-1">[{v.rule}] {v.message}</p>
                  ))}
                </div>
              )}
              {warnings.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-sm font-bold text-amber-800">{warnings.length} cảnh báo</p>
                  {warnings.map((v: any, i: number) => (
                    <p key={i} className="text-xs text-amber-700 mt-1">[{v.rule}] {v.message}</p>
                  ))}
                </div>
              )}

              {/* Timeline 5 giai đoạn */}
              <div className="space-y-3">
                {STAGE_ORDER.map((stageKey, idx) => {
                  const s = stages.find((x) => x.stage === stageKey);
                  const isDone = s?.status === 'DONE';
                  const isActive = s?.status === 'IN_PROGRESS';
                  return (
                    <div key={stageKey} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          isDone ? 'bg-green-500 text-white' :
                          isActive ? 'bg-amber-500 text-white' :
                          'bg-slate-200 text-slate-500'
                        }`}>
                          {isDone ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                        </div>
                        {idx < STAGE_ORDER.length - 1 && <div className="w-0.5 h-8 bg-slate-200" />}
                      </div>
                      <div className="flex-1 pb-4">
                        <p className="font-bold text-sm text-slate-900">{STAGE_LABELS[stageKey]}</p>
                        {s && (
                          <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                            {s.contractDate && <p>Ngày ký HĐ: {s.contractDate}</p>}
                            {s.acceptanceDate && <p>Ngày nghiệm thu: {s.acceptanceDate}</p>}
                            {s.assigneeName && <p>Người thực hiện: {s.assigneeName}</p>}
                            {s.contractAmount ? (
                              <p>Giá trị: {s.contractAmount.toLocaleString('vi-VN')}đ (thực nhận: {(s.netAmount || 0).toLocaleString('vi-VN')}đ)</p>
                            ) : null}
                            {!s.contractDate && !s.acceptanceDate && (
                              <p className="text-slate-400">Chưa có thông tin</p>
                            )}
                            {/* Liên kết hợp đồng của giai đoạn */}
                            {s.contractId ? (
                              <p className="pt-1 flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-teal-700">
                                  HĐ: {docMap[s.contractId] || 'đã gắn'}
                                </span>
                                {onViewContract && (
                                  <button
                                    type="button"
                                    onClick={() => onViewContract(s.contractId!)}
                                    className="px-2 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-[11px] font-bold min-h-[32px]"
                                    aria-label="Xem hợp đồng đã gắn"
                                  >
                                    Xem HĐ
                                  </button>
                                )}
                                {canLinkContract && (
                                  <button
                                    type="button"
                                    onClick={() => unlinkContract(stageKey)}
                                    className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-lg text-[11px] font-bold min-h-[32px]"
                                    aria-label="Gỡ liên kết hợp đồng"
                                  >
                                    Gỡ
                                  </button>
                                )}
                              </p>
                            ) : (
                              canLinkContract && (
                                <p className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => openLinkModal(stageKey)}
                                    className="px-2 py-1 border border-dashed border-slate-300 hover:border-teal-500 hover:text-teal-700 rounded-lg text-[11px] font-bold min-h-[32px]"
                                    aria-label={`Gắn hợp đồng cho giai đoạn ${STAGE_LABELS[stageKey]}`}
                                  >
                                    + Gắn hợp đồng
                                  </button>
                                </p>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal tạo dự án */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-extrabold text-lg mb-4">Dự án xuất bản mới</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600">Tên sách *</label>
                <input
                  value={form.bookTitle}
                  onChange={(e) => setForm({ ...form, bookTitle: e.target.value })}
                  className="w-full mt-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm min-h-[44px]"
                  placeholder="VD: Cách tồn tại riêng"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">Tác giả</label>
                <input
                  value={form.author}
                  onChange={(e) => setForm({ ...form, author: e.target.value })}
                  className="w-full mt-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm min-h-[44px]"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">Dịch giả</label>
                <input
                  value={form.translator}
                  onChange={(e) => setForm({ ...form, translator: e.target.value })}
                  className="w-full mt-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm min-h-[44px]"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-bold min-h-[44px]"
              >
                Hủy
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.bookTitle.trim()}
                className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50 min-h-[44px]"
              >
                Tạo dự án
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-3">Hệ thống tự tạo 5 giai đoạn theo đúng thứ tự.</p>
          </div>
        </div>
      )}

      {/* Modal gắn hợp đồng vào giai đoạn */}
      {linkStage && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4" onClick={() => setLinkStage(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-extrabold text-lg mb-1">Gắn hợp đồng</h2>
            <p className="text-xs text-slate-500 mb-3">Giai đoạn: <span className="font-bold">{STAGE_LABELS[linkStage]}</span> - chọn một hợp đồng đã có trong hệ thống.</p>
            <input
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              placeholder="Tìm số HĐ, tiêu đề..."
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm mb-3 min-h-[44px]"
            />
            <div className="flex-1 overflow-y-auto space-y-2">
              {docOptions
                .filter((d) => {
                  const q = docSearch.trim().toLowerCase();
                  if (!q) return true;
                  return `${d.contractNumber} ${d.title}`.toLowerCase().includes(q);
                })
                .slice(0, 30)
                .map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    disabled={linking}
                    onClick={() => linkContract(d.id)}
                    className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-teal-500 hover:bg-teal-50 transition disabled:opacity-50 min-h-[44px]"
                  >
                    <p className="font-bold text-sm font-mono">{d.contractNumber}</p>
                    <p className="text-xs text-slate-600">{d.title}</p>
                  </button>
                ))}
              {docOptions.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">Chưa có hợp đồng nào trong hệ thống.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLinkStage(null)}
              className="mt-4 px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-bold min-h-[44px]"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
