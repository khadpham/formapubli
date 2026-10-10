'use client';
import { useState } from 'react';
import { Sparkles, X, Loader2, FileText, Link2 } from 'lucide-react';

const CATEGORIES = [
  { value: 'THUE_DIA_DIEM_SK', label: 'Thuê địa điểm sự kiện' },
  { value: 'DAT_HANG_HOA_SK', label: 'Đặt hàng hóa/dịch vụ sự kiện' },
  { value: 'TAC_QUYEN', label: 'Tác quyền' },
  { value: 'IN_AN', label: 'In ấn' },
  { value: 'DAI_LY_PHAN_PHOI', label: 'Đại lý phân phối' },
  { value: 'KHAC', label: 'Khác' },
];

interface Draft {
  title: string;
  bodyText: string;
  suggestedPlaceholders: (string | { placeholder: string; originalText: string })[];
  sourceUrl?: string;
}

export function AITemplateBuilder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'describe' | 'gdoc'>('describe');
  const [category, setCategory] = useState('THUE_DIA_DIEM_SK');
  const [description, setDescription] = useState('');
  const [gdocUrl, setGdocUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  async function callApi(url: string, payload: object) {
    setLoading(true); setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Có lỗi xảy ra');
      setDraft(json.data);
    } catch (e: any) {
      setError(e.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  }

  async function finalize() {
    if (!draft || !code.trim()) { setError('Nhập mã mẫu trước khi chốt.'); return; }
    const placeholders = draft.suggestedPlaceholders.map((p) => typeof p === 'string' ? p : p.placeholder);
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ai/contracts/finalize-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), title: draft.title, category, bodyText: draft.bodyText, placeholders, sourceUrl: draft.sourceUrl }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Có lỗi xảy ra');
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-label="Tạo mẫu hợp đồng bằng AI">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />Tạo Mẫu Bằng AI
          </h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Đóng">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => { setTab('describe'); setDraft(null); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${tab === 'describe' ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}
            aria-label="Soạn từ mô tả">
            <FileText className="w-4 h-4 inline mr-1" />Mô Tả → Soạn
          </button>
          <button type="button" onClick={() => { setTab('gdoc'); setDraft(null); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold ${tab === 'gdoc' ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}
            aria-label="Nhập từ Google Docs">
            <Link2 className="w-4 h-4 inline mr-1" />Nhập Từ Google Docs
          </button>
        </div>

        <label className="block text-xs font-bold mb-1">Loại hợp đồng</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="w-full border rounded-xl px-3 py-2 text-sm mb-3" aria-label="Loại hợp đồng">
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        {tab === 'describe' ? (
          <>
            <label className="block text-xs font-bold mb-1">Mô tả nhu cầu (viết tự nhiên)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
              placeholder="VD: thuê địa điểm hội chợ sách 3 ngày, đặt cọc 30%, bên thuê tự lo điện nước…"
              className="w-full border rounded-xl px-3 py-2 text-sm mb-3" aria-label="Mô tả nhu cầu" />
            <button type="button" disabled={loading || description.trim().length < 10}
              onClick={() => callApi('/api/ai/contracts/draft-template', { category, description })}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
              aria-label="Soạn nháp bằng AI">
              {loading ? <Loader2 className="w-4 h-4 inline animate-spin mr-1" /> : <Sparkles className="w-4 h-4 inline mr-1" />}
              {loading ? 'Đang soạn…' : 'Soạn Nháp'}
            </button>
          </>
        ) : (
          <>
            <label className="block text-xs font-bold mb-1">Link Google Docs (mẫu công ty đang dùng)</label>
            <input value={gdocUrl} onChange={(e) => setGdocUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/…"
              className="w-full border rounded-xl px-3 py-2 text-sm mb-3" aria-label="Link Google Docs" />
            <button type="button" disabled={loading || !gdocUrl.trim()}
              onClick={() => callApi('/api/ai/contracts/import-gdoc', { gdocUrl })}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
              aria-label="Nhập mẫu từ Google Docs">
              {loading ? <Loader2 className="w-4 h-4 inline animate-spin mr-1" /> : <Link2 className="w-4 h-4 inline mr-1" />}
              {loading ? 'Đang nhập…' : 'Nhập Mẫu'}
            </button>
          </>
        )}

        {error && <p className="text-rose-600 text-xs mt-3 font-bold">{error}</p>}

        {draft && (
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-bold text-amber-600 mb-2">⚠️ Bản nháp do AI soạn - CHƯA DUYỆT PHÁP LÝ. Hãy đọc kỹ và sửa trước khi chốt.</p>
            <label className="block text-xs font-bold mb-1">Tiêu đề mẫu</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full border rounded-xl px-3 py-2 text-sm mb-3" aria-label="Tiêu đề mẫu" />
            <label className="block text-xs font-bold mb-1">Nội dung (sửa trực tiếp)</label>
            <textarea value={draft.bodyText} onChange={(e) => setDraft({ ...draft, bodyText: e.target.value })} rows={14}
              className="w-full border rounded-xl px-3 py-2 text-sm font-mono mb-3" aria-label="Nội dung mẫu" />
            <label className="block text-xs font-bold mb-1">Mã mẫu (viết tắt, không dấu)</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
              placeholder="VD: THUE-DD-SK-01"
              className="w-full border rounded-xl px-3 py-2 text-sm mb-3" aria-label="Mã mẫu" />
            <button type="button" disabled={loading || !code.trim()}
              onClick={finalize}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
              aria-label="Chốt thành mẫu chính thức">
              {loading ? 'Đang lưu…' : 'Chốt Thành Mẫu'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
