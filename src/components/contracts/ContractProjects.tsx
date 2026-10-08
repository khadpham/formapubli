'use client';
import { useState, useEffect } from 'react';
import { FolderKanban, X, Loader2, Plus, AlertTriangle, Clock, Wand2 } from 'lucide-react';

const CATEGORIES = [
  { value: 'THUE_DIA_DIEM_SK', label: 'Thuê địa điểm SK' },
  { value: 'DAT_HANG_HOA_SK', label: 'Đặt hàng hóa SK' },
  { value: 'TAC_QUYEN', label: 'Tác quyền' },
  { value: 'IN_AN', label: 'In ấn' },
  { value: 'DAI_LY_PHAN_PHOI', label: 'Đại lý' },
  { value: 'KHAC', label: 'Khác' },
];

const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  neededCategory: string;
  contractId: string | null;
  status: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  milestoneCount: number;
  doneCount: number;
}

interface SuggestItem extends Milestone {
  projectId: string;
  projectName: string;
}

export function ContractProjects({ onSmartDraft }: { onSmartDraft: (category: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<(Project & { milestones: Milestone[] }) | null>(null);
  const [suggest, setSuggest] = useState<{ overdue: SuggestItem[]; upcoming: SuggestItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [showMilestone, setShowMilestone] = useState(false);
  const [mTitle, setMTitle] = useState('');
  const [mDue, setMDue] = useState('');
  const [mCat, setMCat] = useState('THUE_DIA_DIEM_SK');
  const [error, setError] = useState('');

  async function load() {
    const [p, s] = await Promise.all([
      fetch('/api/ai/contracts/projects').then((r) => r.json()),
      fetch('/api/ai/contracts/suggest').then((r) => r.json()),
    ]);
    if (p.success) setProjects(p.data);
    if (s.success) setSuggest(s.data);
  }

  useEffect(() => { load().catch(() => {}); }, []);

  async function openProject(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/contracts/projects/${id}`);
      const json = await res.json();
      if (json.success) setSelected(json.data);
    } finally { setLoading(false); }
  }

  async function createProject() {
    if (!newName.trim()) { setError('Nhập tên dự án.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ai/contracts/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setNewName(''); setShowNew(false); await load();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function createMilestone() {
    if (!selected || !mTitle.trim() || !mDue) { setError('Nhập đủ tên và hạn cột mốc.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ai/contracts/milestones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selected.id, title: mTitle.trim(), dueDate: mDue, neededCategory: mCat }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setMTitle(''); setMDue(''); setShowMilestone(false);
      await openProject(selected.id); await load();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  if (selected) {
    return (
      <div>
        <button type="button" onClick={() => { setSelected(null); load(); }}
          className="text-xs font-bold text-violet-700 mb-3" aria-label="Về danh sách dự án">← Dự án</button>
        <h3 className="font-bold text-base mb-1">{selected.name}</h3>
        {selected.description && <p className="text-xs text-slate-500 mb-3">{selected.description}</p>}
        <button type="button" onClick={() => setShowMilestone(true)}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-bold mb-3"
          aria-label="Thêm cột mốc">
          <Plus className="w-3 h-3 inline mr-1" />Thêm Cột Mốc
        </button>
        {showMilestone && (
          <div className="border rounded-xl p-3 mb-3 bg-slate-50">
            <input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="Tên cột mốc (VD: Ký HĐ thuê địa điểm)"
              className="w-full border rounded-xl px-3 py-2 text-sm mb-2" aria-label="Tên cột mốc" />
            <div className="flex gap-2 mb-2">
              <input type="date" value={mDue} onChange={(e) => setMDue(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm" aria-label="Hạn cột mốc" />
              <select value={mCat} onChange={(e) => setMCat(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm" aria-label="Loại hợp đồng cần">
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <button type="button" disabled={loading} onClick={createMilestone}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-xl text-xs font-bold" aria-label="Lưu cột mốc">
              {loading ? <Loader2 className="w-3 h-3 inline animate-spin" /> : 'Lưu'}
            </button>
          </div>
        )}
        {selected.milestones.map((m) => (
          <div key={m.id} className="border rounded-xl p-3 mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold">{m.title}</p>
              <p className="text-xs text-slate-500">Hạn: {m.dueDate} · Cần: {CAT_LABEL[m.neededCategory] || m.neededCategory}</p>
            </div>
            <div className="flex items-center gap-2">
              {m.status === 'DONE'
                ? <span className="text-xs font-bold text-emerald-700">Đã có HĐ</span>
                : (
                  <button type="button" onClick={() => onSmartDraft(m.neededCategory)}
                    className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-bold"
                    aria-label={`Soạn hợp đồng cho ${m.title}`}>
                    <Wand2 className="w-3 h-3 inline mr-1" />Soạn
                  </button>
                )}
            </div>
          </div>
        ))}
        {selected.milestones.length === 0 && <p className="text-xs text-slate-500">Chưa có cột mốc nào.</p>}
        {error && <p className="text-rose-600 text-xs mt-2 font-bold">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {(suggest && (suggest.overdue.length > 0 || suggest.upcoming.length > 0)) && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 mb-4">
          <p className="text-xs font-bold mb-2 flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-amber-600" />Cần chú ý</p>
          {suggest.overdue.map((m) => (
            <p key={m.id} className="text-xs text-rose-700 mb-1">
              <b>Quá hạn:</b> {m.title} ({m.projectName}, hạn {m.dueDate})
            </p>
          ))}
          {suggest.upcoming.map((m) => (
            <p key={m.id} className="text-xs text-amber-700 mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /><b>Sắp tới:</b> {m.title} ({m.projectName}, hạn {m.dueDate})
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><FolderKanban className="w-4 h-4" />Dự Án / Sự Kiện</h3>
        <button type="button" onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-bold" aria-label="Tạo dự án mới">
          <Plus className="w-3 h-3 inline mr-1" />Tạo Dự Án
        </button>
      </div>

      {showNew && (
        <div className="border rounded-xl p-3 mb-3 bg-slate-50 flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Tên dự án/sự kiện (VD: Hội chợ sách 2026)"
            className="flex-1 border rounded-xl px-3 py-2 text-sm" aria-label="Tên dự án" />
          <button type="button" disabled={loading} onClick={createProject}
            className="px-3 py-1.5 bg-teal-600 text-white rounded-xl text-xs font-bold" aria-label="Lưu dự án">
            {loading ? <Loader2 className="w-3 h-3 inline animate-spin" /> : 'Lưu'}
          </button>
          <button type="button" onClick={() => setShowNew(false)} className="p-2" aria-label="Hủy"><X className="w-4 h-4" /></button>
        </div>
      )}

      {projects.map((p) => (
        <button key={p.id} type="button" onClick={() => openProject(p.id)}
          className="w-full text-left border rounded-xl p-3 mb-2 hover:bg-slate-50" aria-label={`Mở ${p.name}`}>
          <p className="text-sm font-bold">{p.name}</p>
          <p className="text-xs text-slate-500">{p.doneCount}/{p.milestoneCount} cột mốc có hợp đồng</p>
        </button>
      ))}
      {projects.length === 0 && <p className="text-xs text-slate-500">Chưa có dự án nào. Tạo dự án đầu tiên để theo dõi hợp đồng theo cột mốc.</p>}
      {error && <p className="text-rose-600 text-xs mt-2 font-bold">{error}</p>}
    </div>
  );
}
