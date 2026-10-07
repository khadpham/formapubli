'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap } from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { readVietnameseNumber } from '@/lib/vietnamese-number-reader';
import { ContractPrintPreview } from './ContractPrintPreview';
import { PresetManagerModal } from './PresetManagerModal';

interface ComposerProps {
  currentRole?: UserRole;
  initialDoc?: any | null;
  onClose: () => void;
  onSaved: (contractNumber: string) => void;
}

/** Soạn 2 cột: form biến + Live Preview; chip preset; lưu/tải/in. */
export function ContractComposerModal({ currentRole = 'ROLE_OWNER', initialDoc, onClose, onSaved }: ComposerProps) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState(initialDoc?.templateId || '');
  const [schemaFields, setSchemaFields] = useState<any[]>([]);
  const [form, setForm] = useState<Record<string, string>>(
    initialDoc ? JSON.parse(initialDoc.payloadData || '{}') : {}
  );
  const [title, setTitle] = useState(initialDoc?.title || '');
  const [category, setCategory] = useState('TAC_QUYEN');
  const [partnerId, setPartnerId] = useState(initialDoc?.partnerId || '');
  const [partners, setPartners] = useState<any[]>([]);
  const [signedDate, setSignedDate] = useState(initialDoc?.signedDate || '');
  const [totalAmount, setTotalAmount] = useState(initialDoc?.totalAmount ? String(initialDoc.totalAmount) : '');
  const [presets, setPresets] = useState<any[]>([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const previewBox = useRef<HTMLDivElement>(null);
  const debounce = useRef<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const [tRes, pRes, prRes] = await Promise.all([
          fetch('/api/contracts/templates'),
          fetch('/api/partners/list'),
          fetch('/api/contracts/presets'),
        ]);
        const tJson = await tRes.json();
        if (tJson.success) {
          setTemplates((tJson.data || []).filter((t: any) => t.isActive));
          if (!initialDoc && tJson.data?.[0]) setTemplateId(tJson.data[0].id);
        }
        const pJson = await pRes.json().catch(() => ({ success: false }));
        if (pJson.success) setPartners(pJson.data || []);
        const prJson = await prRes.json();
        if (prJson.success) setPresets(prJson.data.active || []);
      } catch (e: any) {
        setErrorMessage(e.message);
      }
    })();
  }, [initialDoc]);

  useEffect(() => {
    const tpl = templates.find((t: any) => t.id === templateId);
    if (!tpl) return;
    try {
      const fields = JSON.parse(tpl.schemaFields || '[]');
      setSchemaFields(Array.isArray(fields) ? fields : []);
    } catch {
      setSchemaFields([]);
    }
  }, [templateId, templates]);

  const applyAutofill = async () => {
    if (!partnerId) return;
    try {
      const res = await fetch(`/api/contracts/autofill?partnerId=${encodeURIComponent(partnerId)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setForm((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(json.data || {})) {
          if ((next[k] ?? '') === '' && v !== '') next[k] = `${v}`;
        }
        return next;
      });
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const applyPreset = (values: Record<string, string>) => {
    setForm((prev) => ({ ...prev, ...values }));
  };

  const amountNum = Number(totalAmount) || 0;
  const amountWords = amountNum > 0
    ? readVietnameseNumber(Math.round(amountNum)).replace(/\s*đồng chẵn\s*$/i, '').trim()
    : '';

  // Live Preview: merge trên server, render bằng docx-preview (xấp xỉ).
  useEffect(() => {
    if (!templateId) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        setPreviewError(null);
        const payload = { ...form };
        if (amountNum > 0) {
          payload.gia_tri_hd_so = String(Math.round(amountNum));
          payload.gia_tri_hd_chu = amountWords;
        }
        const res = await fetch('/api/contracts/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId, data: payload }),
        });
        if (!res.ok) throw new Error('Preview thất bại, kiểm tra lại mẫu và dữ liệu');
        const buf = await res.arrayBuffer();
        if (previewBox.current) {
          previewBox.current.innerHTML = '';
          const { renderAsync } = await import('docx-preview');
          await renderAsync(buf, previewBox.current, undefined, { breakPages: true });
        }
      } catch (e: any) {
        setPreviewError(e.message || 'Không xem trước được');
      }
    }, 400);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [templateId, form, amountNum, amountWords]);

  const save = async () => {
    if (!templateId) {
      setErrorMessage('Hãy chọn mẫu hợp đồng.');
      return;
    }
    if (!title.trim()) {
      setErrorMessage('Hãy nhập tiêu đề hợp đồng.');
      return;
    }
    try {
      setIsSaving(true);
      setErrorMessage(null);
      const payload = { ...form };
      if (amountNum > 0) {
        payload.gia_tri_hd_so = String(Math.round(amountNum));
        payload.gia_tri_hd_chu = amountWords;
      }
      const isEdit = !!initialDoc;
      const url = isEdit ? `/api/contracts/documents/${encodeURIComponent(initialDoc.id)}` : '/api/contracts/documents';
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          title: title.trim(),
          category,
          payloadData: payload,
          partnerId: partnerId || undefined,
          signedDate: signedDate || undefined,
          totalAmount: Math.round(amountNum),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không lưu được');
      onSaved(json.data.contractNumber);
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const repChips = presets.filter((p: any) => Object.keys(JSON.parse(p.valuesJson || '{}')).some((k) => k.startsWith('ben_a_')));
  const termChips = presets.filter((p: any) => Object.keys(JSON.parse(p.valuesJson || '{}')).some((k) => k.startsWith('dieu_khoan_')));

  const chipBtn = (p: any) => (
    <button
      key={p.id}
      type="button"
      onClick={() => applyPreset(JSON.parse(p.valuesJson || '{}'))}
      title={`Áp preset: ${p.label}`}
      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-full text-[11px] font-bold text-amber-800 transition flex items-center gap-1"
    >
      <Zap className="w-3 h-3" />{p.label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/70 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-6xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h3 className="font-extrabold text-sm">
            {initialDoc ? `Sửa hợp đồng ${initialDoc.contractNumber}` : 'Soạn hợp đồng mới'}
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Đóng soạn hợp đồng">
            <X className="w-5 h-5" />
          </button>
        </div>
        {errorMessage && (
          <p className="mx-5 mt-3 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">{errorMessage}</p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 flex-1 overflow-hidden">
          <div className="p-5 space-y-3 overflow-y-auto text-xs border-r border-slate-200">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">Mẫu
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white">
                  {templates.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.title} (v{t.version})</option>
                  ))}
                </select>
              </label>
              <label className="block">Loại
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white">
                  <option value="TAC_QUYEN">Tác quyền</option>
                  <option value="DAI_LY">Đại lý</option>
                  <option value="IN_AN">In ấn</option>
                  <option value="DICH_THUAT">Dịch thuật</option>
                  <option value="KHAC">Khác</option>
                </select>
              </label>
            </div>
            <label className="block">Tiêu đề
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none" />
            </label>
            <div className="flex gap-2 items-end">
              <label className="block flex-1">Đối tác (tự điền)
                <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white">
                  <option value="">— Không chọn —</option>
                  {partners.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={applyAutofill} disabled={!partnerId} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold disabled:opacity-50" aria-label="Điền tự động từ đối tác">
                Tự điền
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">Số tiền (VNĐ)
                <input type="number" min={0} value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none font-mono" />
              </label>
              <label className="block">Ngày ký (do bạn nhập)
                <input type="date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none" />
              </label>
            </div>
            {amountWords && (
              <p className="text-[11px] text-slate-600 italic">Bằng chữ (tự sinh): <b className="not-italic">{amountWords}</b></p>
            )}
            {(repChips.length > 0 || termChips.length > 0) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700">Chọn nhanh</span>
                  <button type="button" onClick={() => setPresetOpen(true)} className="text-[11px] text-teal-700 hover:underline font-bold">Quản lý preset</button>
                </div>
                {repChips.length > 0 && (
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">Người đại diện:</p>
                    <div className="flex flex-wrap gap-1.5">{repChips.map(chipBtn)}</div>
                  </div>
                )}
                {termChips.length > 0 && (
                  <div>
                    <p className="text-[11px] text-slate-500 mb-1">Điều khoản:</p>
                    <div className="flex flex-wrap gap-1.5">{termChips.map(chipBtn)}</div>
                  </div>
                )}
              </div>
            )}
            {schemaFields.map((f: any) => (
              <label key={f.key} className="block">{f.label || f.key}
                {f.type === 'textarea' ? (
                  <textarea value={form[f.key] || ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} rows={3} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none" />
                ) : (
                  <input value={form[f.key] || ''} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none" />
                )}
              </label>
            ))}
            <button
              type="button"
              onClick={save}
              disabled={isSaving}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-extrabold disabled:opacity-50"
              aria-label={initialDoc ? 'Lưu thay đổi hợp đồng' : 'Lưu hợp đồng nháp'}
            >
              {isSaving ? 'Đang lưu...' : initialDoc ? 'Lưu thay đổi' : 'Lưu nháp'}
            </button>
          </div>
          <div className="p-5 overflow-y-auto bg-slate-100">
            <p className="text-[11px] text-slate-500 mb-2">Xem trước trực tiếp (xấp xỉ — bản in chuẩn là file Word tải về)</p>
            {previewError && <p className="text-[11px] text-rose-600 font-semibold mb-2">{previewError}</p>}
            <ContractPrintPreview previewRef={previewBox} />
          </div>
        </div>
      </div>
      {presetOpen && <PresetManagerModal onClose={() => setPresetOpen(false)} onChanged={async () => {
        const res = await fetch('/api/contracts/presets');
        const json = await res.json();
        if (json.success) setPresets(json.data.active || []);
      }} />}
    </div>
  );
}
