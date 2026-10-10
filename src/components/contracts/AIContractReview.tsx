'use client';
import { useState } from 'react';
import { ScanSearch, X, Loader2, Upload, ClipboardPaste } from 'lucide-react';

const CATEGORIES = [
  { value: 'THUE_DIA_DIEM_SK', label: 'Thuê địa điểm sự kiện' },
  { value: 'DAT_HANG_HOA_SK', label: 'Đặt hàng hóa/dịch vụ sự kiện' },
  { value: 'TAC_QUYEN', label: 'Tác quyền' },
  { value: 'IN_AN', label: 'In ấn' },
  { value: 'DAI_LY_PHAN_PHOI', label: 'Đại lý phân phối' },
  { value: 'KHAC', label: 'Khác' },
];

const LEVEL_STYLE: Record<string, { label: string; cls: string }> = {
  DAT: { label: 'Ổn', cls: 'bg-emerald-100 text-emerald-700' },
  THIEU: { label: 'Thiếu', cls: 'bg-rose-100 text-rose-700' },
  MO_HO: { label: 'Mơ hồ', cls: 'bg-amber-100 text-amber-700' },
  RUI_RO: { label: 'Rủi ro', cls: 'bg-orange-100 text-orange-700' },
};

interface Analysis {
  contractType: string;
  parties: string[];
  valueText: string | null;
  keyDates: string[];
  obligations: string[];
  summary: string;
}

interface Issue {
  checklistId: string;
  level: keyof typeof LEVEL_STYLE;
  finding: string;
  suggestion: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`${reader.result}`.split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AIContractReview({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [fileName, setFileName] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('THUE_DIA_DIEM_SK');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [disclaimer, setDisclaimer] = useState('');
  const [error, setError] = useState('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError('File quá lớn (tối đa 5MB).'); return; }
    setFileName(f.name);
    setFileBase64(await fileToBase64(f));
    setAnalysis(null); setIssues(null); setError('');
  }

  function payload() {
    return mode === 'file' ? { fileBase64, fileName } : { text };
  }

  async function doAnalyze() {
    setLoading(true); setError(''); setIssues(null);
    try {
      const res = await fetch('/api/ai/contracts/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Có lỗi xảy ra');
      setAnalysis(json.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function doReview() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ai/contracts/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload(), category }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Có lỗi xảy ra');
      setIssues(json.data.issues);
      setDisclaimer(json.data.disclaimer || '');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  const canRun = mode === 'file' ? !!fileBase64 : text.trim().length > 20;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-label="AI đọc và phản biện hợp đồng">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ScanSearch className="w-5 h-5 text-violet-600" />AI Đọc & Phản Biện
          </h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Đóng">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => setMode('file')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${mode === 'file' ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}
            aria-label="Tải file lên">
            <Upload className="w-4 h-4 inline mr-1" />Tải File (.docx/.txt)
          </button>
          <button type="button" onClick={() => setMode('text')}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${mode === 'text' ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}
            aria-label="Dán văn bản">
            <ClipboardPaste className="w-4 h-4 inline mr-1" />Dán Văn Bản
          </button>
        </div>

        {mode === 'file' ? (
          <label className="block border-2 border-dashed rounded-xl p-4 text-center text-sm cursor-pointer hover:bg-slate-50">
            {fileName || 'Chọn file hợp đồng (.docx hoặc .txt, tối đa 5MB)'}
            <input type="file" accept=".docx,.txt" className="hidden" onChange={onFile} aria-label="Chọn file hợp đồng" />
          </label>
        ) : (
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
            placeholder="Dán toàn văn hợp đồng vào đây…"
            className="w-full border rounded-xl px-3 py-2 text-sm" aria-label="Văn bản hợp đồng" />
        )}

        <div className="flex gap-2 mt-3">
          <button type="button" disabled={loading || !canRun} onClick={doAnalyze}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
            aria-label="AI tóm tắt hợp đồng">
            {loading ? <Loader2 className="w-4 h-4 inline animate-spin" /> : 'Tóm Tắt'}
          </button>
        </div>

        {error && <p className="text-rose-600 text-xs mt-3 font-bold">{error}</p>}

        {analysis && (
          <div className="mt-4 border rounded-xl p-4 bg-slate-50">
            <p className="font-bold text-sm mb-2">📋 {analysis.contractType}</p>
            <p className="text-xs mb-1"><b>Các bên:</b> {analysis.parties.join(' - ')}</p>
            {analysis.valueText && <p className="text-xs mb-1"><b>Giá trị:</b> {analysis.valueText}</p>}
            {analysis.keyDates.length > 0 && <p className="text-xs mb-1"><b>Ngày quan trọng:</b> {analysis.keyDates.join(', ')}</p>}
            {analysis.obligations.length > 0 && (
              <div className="text-xs mb-1"><b>Nghĩa vụ chính:</b>
                <ul className="list-disc ml-4">{analysis.obligations.map((o, i) => <li key={i}>{o}</li>)}</ul>
              </div>
            )}
            <p className="text-xs mt-2">{analysis.summary}</p>

            <div className="mt-3 pt-3 border-t">
              <label className="block text-xs font-bold mb-1">Loại hợp đồng để phản biện</label>
              <div className="flex gap-2">
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="flex-1 border rounded-xl px-3 py-2 text-sm" aria-label="Loại hợp đồng">
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <button type="button" disabled={loading} onClick={doReview}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
                  aria-label="AI phản biện hợp đồng">
                  {loading ? <Loader2 className="w-4 h-4 inline animate-spin" /> : 'Phản Biện'}
                </button>
              </div>
            </div>
          </div>
        )}

        {issues && (
          <div className="mt-4">
            <p className="text-xs text-amber-700 font-bold mb-2">⚠️ {disclaimer}</p>
            {issues.map((issue, i) => (
              <div key={i} className="border rounded-xl p-3 mb-2">
                <span className={`inline-block px-2 py-0.5 rounded-lg text-[11px] font-bold ${LEVEL_STYLE[issue.level]?.cls || ''}`}>
                  {LEVEL_STYLE[issue.level]?.label || issue.level}
                </span>
                <p className="text-xs mt-1">{issue.finding}</p>
                {issue.suggestion && <p className="text-xs mt-1 text-violet-700"><b>Đề xuất:</b> {issue.suggestion}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
