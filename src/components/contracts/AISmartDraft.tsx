'use client';
import { useState, useEffect, useRef } from 'react';
import Modal from '@/components/ui/Modal';
import { Wand2, Loader2, Check, Ban } from 'lucide-react';

interface Template {
  id: string;
  code: string;
  title: string;
  category: string;
  schemaFields: string;
  legalReviewed: boolean;
}

interface Adjustment {
  id: string;
  clauseRef: string;
  original: string;
  proposed: string;
  reason: string;
}

export function AISmartDraft({ onClose, initialCategory, milestoneId }: {
  onClose: () => void;
  initialCategory?: string;
  milestoneId?: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [filledText, setFilledText] = useState('');
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [contractNumber, setContractNumber] = useState('');
  const [linkFailed, setLinkFailed] = useState(false);
  const [error, setError] = useState('');
  const preselectDone = useRef(false);

  useEffect(() => {
    fetch('/api/contracts/templates?activeOnly=1').then((r) => r.json()).then((j) => {
      if (j.success) setTemplates(j.data);
    }).catch(() => {});
  }, []);

  // Mở từ cột mốc dự án: chọn sẵn mẫu đầu tiên thuộc giai đoạn của cột mốc,
  // chỉ chọn một lần lúc mẫu vừa tải xong - không giành quyền chọn của người dùng.
  useEffect(() => {
    if (!initialCategory || preselectDone.current || templates.length === 0) return;
    preselectDone.current = true;
    const match = templates.find((t) => t.category === initialCategory);
    if (match) setTemplateId(match.id);
  }, [templates, initialCategory]);

  useEffect(() => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) { setFieldKeys([]); return; }
    try {
      const schema = JSON.parse(tpl.schemaFields || '[]');
      const keys: string[] = schema.map((f: any) => f.key).filter(Boolean);
      setFieldKeys(keys);
      setFields(Object.fromEntries(keys.map((k) => [k, ''])));
      if (!title) setTitle(tpl.title);
    } catch { setFieldKeys([]); }
  }, [templateId, templates]);

  async function doDraft() {
    if (!templateId) { setError('Chọn mẫu hợp đồng trước.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ai/contracts/smart-draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, fieldValues: fields, notes }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Có lỗi xảy ra');
      setFilledText(json.data.filledText);
      setAdjustments(json.data.adjustments || []);
      setAccepted(new Set((json.data.adjustments || []).map((a: Adjustment) => a.id)));
      setStep(2);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  function toggleAccept(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function doFinalize() {
    if (!title.trim()) { setError('Nhập tiêu đề hợp đồng.'); return; }
    setLoading(true); setError('');
    try {
      const tpl = templates.find((t) => t.id === templateId);
      const res = await fetch('/api/ai/contracts/smart-finalize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId, title: title.trim(), category: tpl?.category || 'KHAC',
          finalText: filledText,
          acceptedAdjustments: adjustments.filter((a) => accepted.has(a.id)).map((a) => ({ original: a.original, proposed: a.proposed })),
          fieldValues: fields,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Có lỗi xảy ra');
      setContractNumber(json.data.contractNumber);
      // Mở từ cột mốc dự án thì gắn luôn hợp đồng vừa tạo vào cột mốc đó:
      // PATCH milestones với contractId sẽ tự chuyển cột mốc sang DONE.
      if (milestoneId && json.data.documentId) {
        try {
          const linkRes = await fetch('/api/ai/contracts/milestones', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: milestoneId, contractId: json.data.documentId }),
          });
          const linkJson = await linkRes.json().catch(() => null);
          if (!linkRes.ok || !linkJson?.success) setLinkFailed(true);
        } catch { setLinkFailed(true); }
      }
      setStep(3);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={<span className="flex items-center gap-2"><Wand2 className="w-5 h-5 text-violet-600" />Soạn Thông Minh</span>}
      subtitle={step === 1 ? 'Bước 1/3: Nhập thông tin' : step === 2 ? 'Bước 2/3: Duyệt đề xuất AI' : 'Bước 3/3: Hoàn tất'}
      actions={
        <>
          <div className="text-xs font-black uppercase text-slate-400 mb-1">Thao tác</div>
          {step === 1 && (
            <button type="button" disabled={loading || !templateId} onClick={doDraft}
              className="w-full px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
              aria-label="AI soạn thảo">
              {loading ? <Loader2 className="w-4 h-4 inline animate-spin" /> : 'AI Soạn Thảo'}
            </button>
          )}
          {step === 2 && (
            <>
              <button type="button" disabled={loading} onClick={doFinalize}
                className="w-full px-4 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold"
                aria-label="Chốt thành hợp đồng">
                {loading ? <Loader2 className="w-4 h-4 inline animate-spin" /> : 'Chốt Thành Hợp Đồng'}
              </button>
              <button type="button" onClick={() => setStep(1)}
                className="w-full px-4 py-2 bg-slate-100 rounded-xl text-xs font-bold" aria-label="Quay lại">Quay Lại</button>
            </>
          )}
          {step === 3 && (
            <button type="button" onClick={onClose}
              className="w-full px-4 py-2.5 bg-violet-600 text-white rounded-xl text-xs font-bold" aria-label="Xong">Xong</button>
          )}
        </>
      }
    >
        {step === 1 && (
          <>
            <label className="block text-xs font-bold mb-1">Chọn mẫu</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm mb-3" aria-label="Chọn mẫu hợp đồng">
              <option value="">- Chọn mẫu -</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.code} - {t.title}{t.legalReviewed ? ' ✓ đã duyệt' : ''}</option>
              ))}
            </select>
            {fieldKeys.map((k) => (
              <div key={k} className="mb-2">
                <label className="block text-xs font-bold mb-1">{k}</label>
                <input value={fields[k] || ''} onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
                  className="w-full border rounded-xl px-3 py-2 text-sm" aria-label={`Giá trị ${k}`} />
              </div>
            ))}
            <label className="block text-xs font-bold mb-1 mt-3">Ghi chú tình huống (VD: chiết khấu 10%, giao 2 đợt…)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="w-full border rounded-xl px-3 py-2 text-sm" aria-label="Ghi chú tình huống" />
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-xs font-bold text-amber-600 mb-2">⚠️ AI đã điền dữ liệu - điều khoản gốc được giữ nguyên. Duyệt từng đề xuất điều chỉnh bên dưới.</p>
            <label className="block text-xs font-bold mb-1">Văn bản đã điền</label>
            <textarea value={filledText} readOnly rows={10}
              className="w-full border rounded-xl px-3 py-2 text-sm font-mono bg-slate-50 mb-3" aria-label="Văn bản đã điền" />
            {adjustments.length > 0 ? adjustments.map((a) => (
              <div key={a.id} className="border rounded-xl p-3 mb-2">
                <p className="text-xs font-bold">{a.clauseRef}</p>
                <p className="text-xs mt-1 text-slate-500 line-through">{a.original}</p>
                <p className="text-xs mt-1 text-teal-700">{a.proposed}</p>
                <p className="text-xs mt-1 italic">Lý do: {a.reason}</p>
                <button type="button" onClick={() => toggleAccept(a.id)}
                  className={`mt-2 px-3 py-1 rounded-lg text-xs font-bold ${accepted.has(a.id) ? 'bg-teal-600 text-white' : 'bg-slate-100'}`}
                  aria-label={accepted.has(a.id) ? `Bỏ đề xuất ${a.clauseRef}` : `Chấp nhận ${a.clauseRef}`}>
                  {accepted.has(a.id) ? <><Check className="w-3 h-3 inline mr-1" />Đã chấp nhận</> : <><Ban className="w-3 h-3 inline mr-1" />Từ chối</>}
                </button>
              </div>
            )) : <p className="text-xs text-slate-500 mb-3">AI không đề xuất điều chỉnh nào.</p>}
            <label className="block text-xs font-bold mb-1">Tiêu đề hợp đồng</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm" aria-label="Tiêu đề hợp đồng" />
          </>
        )}

        {step === 3 && (
          <div className="text-center py-8">
            <p className="text-lg font-bold text-teal-700">Đã tạo hợp đồng {contractNumber}</p>
            <p className="text-xs text-slate-500 mt-2">Xem và ký trong danh sách hợp đồng.</p>
            {linkFailed && (
              <p className="text-xs text-amber-600 mt-2 font-bold">
                Đã tạo hợp đồng nhưng chưa gắn được vào cột mốc dự án - cột mốc chưa chuyển trạng thái "Đã có HĐ".
              </p>
            )}
          </div>
        )}

        {error && <p className="text-rose-600 text-xs mt-3 font-bold">{error}</p>}
    </Modal>
  );
}
