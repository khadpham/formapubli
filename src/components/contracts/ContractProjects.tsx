'use client';
import { useState, useEffect } from 'react';
import { FolderKanban, X, Loader2, Plus, AlertTriangle, Clock, Wand2, ShieldAlert } from 'lucide-react';
import { STAGE_ORDER, STAGE_LABELS, type PublishingStage } from '@/services/publishing-rules.service';

const STAGE_CATEGORIES = STAGE_ORDER.map((s: PublishingStage) => ({ value: s, label: STAGE_LABELS[s] }));

const CAT_LABEL: Record<string, string> = Object.fromEntries(STAGE_CATEGORIES.map((c) => [c.value, c.label]));

interface RuleViolation {
  rule: string;
  severity: 'BLOCK' | 'WARN';
  stage: PublishingStage;
  message: string;
}

interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  neededCategory: string;
  contractId: string | null;
  contractDate: string | null;
  acceptanceDate: string | null;
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
  const [mCat, setMCat] = useState<string>(STAGE_ORDER[0]);
  const [error, setError] = useState('');
  const [violations, setViolations] = useState<RuleViolation[]>([]);
  const [editingDates, setEditingDates] = useState<Record<string, { contractDate: string; acceptanceDate: string }>>({});
  const [overrideReason, setOverrideReason] = useState<Record<string, string>>({});
  const [pendingOverride, setPendingOverride] = useState<string | null>(null);

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
      if (json.success) {
        setSelected(json.data);
        setViolations([]);
        setEditingDates({});
        setPendingOverride(null);
        await validateTimeline(id);
      }
    } finally { setLoading(false); }
  }

  async function validateTimeline(projectId: string) {
    try {
      const res = await fetch(`/api/ai/contracts/projects/${projectId}/validate`, { method: 'POST' });
      const json = await res.json();
      if (json.success) setViolations(json.data.violations || []);
    } catch {
      // Không chặn UI nếu validate lỗi.
    }
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

  /** Lưu ngày ký / nghiệm thu cho cột mốc, kèm kiểm tra R1-R5 (F5b). */
  async function saveDates(m: Milestone, override: boolean) {
    const ed = editingDates[m.id];
    if (!ed) return;
    setLoading(true); setError('');
    try {
      const body: Record<string, any> = {
        id: m.id,
        contractDate: ed.contractDate || null,
        acceptanceDate: ed.acceptanceDate || null,
      };
      if (override) {
        const reason = (overrideReason[m.id] || '').trim();
        if (!reason) { setError('Vượt quy tắc cần ghi rõ lý do.'); setLoading(false); return; }
        body.override = true;
        body.overrideReason = reason;
      }
      const res = await fetch('/api/ai/contracts/milestones', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        // Vi phạm BLOCK: hỏi manager có muốn vượt không.
        if (`${json.error || ''}`.includes('Vi phạm quy tắc timeline')) {
          setPendingOverride(m.id);
          throw new Error(json.error);
        }
        throw new Error(json.error);
      }
      setPendingOverride(null);
      const warns: RuleViolation[] = json.data?.warnings || [];
      if (warns.length > 0) setError(`Cảnh báo: ${warns.map((w) => `[${w.rule}] ${w.message}`).join(' ')}`);
      await openProject(selected!.id);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  function startEditDates(m: Milestone) {
    setEditingDates((prev) => ({
      ...prev,
      [m.id]: { contractDate: m.contractDate || '', acceptanceDate: m.acceptanceDate || '' },
    }));
  }

  if (selected) {
    const blocks = violations.filter((v) => v.severity === 'BLOCK');
    const warns = violations.filter((v) => v.severity === 'WARN');
    return (
      <div>
        <button type="button" onClick={() => { setSelected(null); load(); }}
          className="text-xs font-bold text-violet-700 mb-3" aria-label="Về danh sách dự án">← Dự án</button>
        <h3 className="font-bold text-base mb-1">{selected.name}</h3>
        {selected.description && <p className="text-xs text-slate-500 mb-3">{selected.description}</p>}

        {(blocks.length > 0 || warns.length > 0) && (
          <div className="rounded-xl p-3 mb-3 border border-amber-300 bg-amber-50">
            <p className="text-xs font-bold mb-2 flex items-center gap-1">
              <ShieldAlert className="w-4 h-4 text-amber-600" />Kiểm tra timeline (R1-R5)
            </p>
            {blocks.map((v, i) => (
              <p key={`b${i}`} className="text-xs text-rose-700 mb-1"><b>[{v.rule}] Chặn:</b> {v.message}</p>
            ))}
            {warns.map((v, i) => (
              <p key={`w${i}`} className="text-xs text-amber-700 mb-1"><b>[{v.rule}] Cảnh báo:</b> {v.message}</p>
            ))}
          </div>
        )}

        <button type="button" onClick={() => setShowMilestone(true)}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-bold mb-3"
          aria-label="Thêm cột mốc">
          <Plus className="w-3 h-3 inline mr-1" />Thêm Cột Mốc
        </button>
        {showMilestone && (
          <div className="border rounded-xl p-3 mb-3 bg-slate-50">
            <input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="Tên cột mốc (VD: Ký HĐ thiết kế bìa)"
              className="w-full border rounded-xl px-3 py-2 text-sm mb-2" aria-label="Tên cột mốc" />
            <div className="flex gap-2 mb-2">
              <input type="date" value={mDue} onChange={(e) => setMDue(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm" aria-label="Hạn cột mốc" />
              <select value={mCat} onChange={(e) => setMCat(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm" aria-label="Giai đoạn">
                {STAGE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <button type="button" disabled={loading} onClick={createMilestone}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-xl text-xs font-bold" aria-label="Lưu cột mốc">
              {loading ? <Loader2 className="w-3 h-3 inline animate-spin" /> : 'Lưu'}
            </button>
          </div>
        )}
        {selected.milestones.map((m) => {
          const ed = editingDates[m.id];
          const isOverriding = pendingOverride === m.id;
          return (
            <div key={m.id} className="border rounded-xl p-3 mb-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">{m.title}</p>
                  <p className="text-xs text-slate-500">
                    Hạn: {m.dueDate} · Giai đoạn: {CAT_LABEL[m.neededCategory] || m.neededCategory}
                    {m.contractDate && <> · Ký: {m.contractDate}</>}
                    {m.acceptanceDate && <> · Nghiệm thu: {m.acceptanceDate}</>}
                  </p>
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
                  {!ed && (
                    <button type="button" onClick={() => startEditDates(m)}
                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold"
                      aria-label={`Nhập ngày cho ${m.title}`}>
                      Nhập ngày
                    </button>
                  )}
                </div>
              </div>
              {ed && (
                <div className="mt-2 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap gap-2 items-end">
                    <label className="text-xs font-bold text-slate-600">Ngày ký HĐ
                      <input type="date" value={ed.contractDate}
                        onChange={(e) => setEditingDates((p) => ({ ...p, [m.id]: { ...p[m.id], contractDate: e.target.value } }))}
                        className="ml-1 border rounded-xl px-2 py-1.5 text-xs" />
                    </label>
                    <label className="text-xs font-bold text-slate-600">Ngày nghiệm thu
                      <input type="date" value={ed.acceptanceDate}
                        onChange={(e) => setEditingDates((p) => ({ ...p, [m.id]: { ...p[m.id], acceptanceDate: e.target.value } }))}
                        className="ml-1 border rounded-xl px-2 py-1.5 text-xs" />
                    </label>
                    <button type="button" disabled={loading} onClick={() => saveDates(m, false)}
                      className="px-3 py-1.5 bg-teal-600 text-white rounded-xl text-xs font-bold">
                      {loading ? <Loader2 className="w-3 h-3 inline animate-spin" /> : 'Lưu ngày'}
                    </button>
                    <button type="button" onClick={() => { setEditingDates((p) => { const n = { ...p }; delete n[m.id]; return n; }); setPendingOverride(null); }}
                      className="px-3 py-1.5 text-slate-500 text-xs font-bold">
                      Hủy
                    </button>
                  </div>
                  {isOverriding && (
                    <div className="mt-2 p-2 bg-rose-50 border border-rose-200 rounded-xl">
                      <p className="text-xs font-bold text-rose-700 mb-1">Vi phạm quy tắc BLOCK. Chỉ Owner/Manager được vượt, cần ghi lý do:</p>
                      <div className="flex gap-2">
                        <input value={overrideReason[m.id] || ''}
                          onChange={(e) => setOverrideReason((p) => ({ ...p, [m.id]: e.target.value }))}
                          placeholder="Lý do vượt quy tắc..."
                          className="flex-1 border rounded-xl px-2 py-1.5 text-xs" />
                        <button type="button" disabled={loading} onClick={() => saveDates(m, true)}
                          className="px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-bold">
                          Xác nhận vượt
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
        <h3 className="font-bold text-sm flex items-center gap-2"><FolderKanban className="w-4 h-4" />Dự Án Hợp Đồng</h3>
        <button type="button" onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-bold" aria-label="Tạo dự án mới">
          <Plus className="w-3 h-3 inline mr-1" />Tạo Dự Án
        </button>
      </div>

      {showNew && (
        <div className="border rounded-xl p-3 mb-3 bg-slate-50">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Tên đầu sách (VD: Đốt kho - Faulkner)"
            className="w-full border rounded-xl px-3 py-2 text-sm mb-2" aria-label="Tên dự án" />
          <p className="text-xs text-slate-500 mb-2">Tạo dự án sẽ tự sinh 5 cột mốc theo 5 giai đoạn chuẩn: Thiết kế bìa → Biên dịch → Biên tập → Dàn trang → Đọc morat.</p>
          <div className="flex gap-2">
            <button type="button" disabled={loading} onClick={createProject}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-xl text-xs font-bold" aria-label="Lưu dự án">
              {loading ? <Loader2 className="w-3 h-3 inline animate-spin" /> : 'Lưu'}
            </button>
            <button type="button" onClick={() => setShowNew(false)} className="p-2" aria-label="Hủy"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {projects.map((p) => (
        <button key={p.id} type="button" onClick={() => openProject(p.id)}
          className="w-full text-left border rounded-xl p-3 mb-2 hover:bg-slate-50" aria-label={`Mở ${p.name}`}>
          <p className="text-sm font-bold">{p.name}</p>
          <p className="text-xs text-slate-500">{p.doneCount}/{p.milestoneCount} cột mốc có hợp đồng</p>
        </button>
      ))}
      {projects.length === 0 && <p className="text-xs text-slate-500">Chưa có dự án nào. Tạo dự án đầu tiên để theo dõi hợp đồng theo 5 giai đoạn sản xuất.</p>}
      {error && <p className="text-rose-600 text-xs mt-2 font-bold">{error}</p>}
    </div>
  );
}
