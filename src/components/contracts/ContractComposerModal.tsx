'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { UserRole } from '@/lib/roles';
import { readVietnameseNumber } from '@/lib/vietnamese-number-reader';
import { ContractPrintPreview } from './ContractPrintPreview';
import { PresetManagerModal } from './PresetManagerModal';
import { TemplateManagerModal } from './TemplateManagerModal';
import { COLLAB_ROLES, templateCodeForRole } from '@/lib/collab-roles';

interface ComposerProps {
  currentRole?: UserRole;
  initialDoc?: any | null;
  onClose: () => void;
  onSaved: (contractNumber: string) => void;
}

const COMPOSER_CATEGORIES = ['TAC_QUYEN', 'DAI_LY', 'IN_AN', 'DICH_THUAT', 'KHAC'];

// So hop dong duoc cap theo loai chon luc tao (PREFIX_MAP ben contract.service)
// nen suy nguoc duoc loai goc tu tien to so. Tien to chung 'HD' nghia la loai
// ngoai 4 loai chinh luc tao -> gan nhat la 'KHAC'.
const PREFIX_TO_CATEGORY: Record<string, string> = {
  'HĐXB': 'TAC_QUYEN',
  'HĐĐL': 'DAI_LY',
  'HĐIN': 'IN_AN',
  'HĐDT': 'DICH_THUAT',
};

function categoryFromContractNumber(contractNumber?: string): string | null {
  if (!contractNumber) return null;
  const prefix = (contractNumber.split('/').pop() || '').split('-')[0];
  if (PREFIX_TO_CATEGORY[prefix]) return PREFIX_TO_CATEGORY[prefix];
  if (prefix === 'HĐ') return 'KHAC';
  return null;
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
  // Ban sua phai nap loai cua hop dong goc, khong reset ve mac dinh:
  // truoc day mo sua luon hien 'Tac quyen' du hop dong goc thuoc loai khac.
  const [category, setCategory] = useState(
    () => categoryFromContractNumber(initialDoc?.contractNumber) || 'TAC_QUYEN'
  );
  const [partnerId, setPartnerId] = useState(initialDoc?.partnerId || '');
  const [partners, setPartners] = useState<any[]>([]);
  const [signedDate, setSignedDate] = useState(initialDoc?.signedDate || '');
  const [totalAmount, setTotalAmount] = useState(initialDoc?.totalAmount ? String(initialDoc.totalAmount) : '');
  const [presets, setPresets] = useState<any[]>([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // Vai trò CTV -> chọn người -> tự điền thông tin vào form
  const [roleFilter, setRoleFilter] = useState('');
  const [rolePeople, setRolePeople] = useState<any[]>([]);
  const [rolePersonId, setRolePersonId] = useState('');
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
          // Dự phòng khi không suy được loại từ số hợp đồng: lấy loại của mẫu
          // mà hợp đồng gốc đang dùng (chỉ khi thuộc nhóm loại của ô chọn).
          if (initialDoc && !categoryFromContractNumber(initialDoc.contractNumber)) {
            const own = (tJson.data || []).find((t: any) => t.id === initialDoc.templateId);
            if (own && COMPOSER_CATEGORIES.includes(own.category)) setCategory(own.category);
          }
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

  // Chọn vai trò: tự chọn mẫu hợp đồng phù hợp + nạp danh sách người theo vai trò
  useEffect(() => {
    if (!roleFilter) {
      setRolePeople([]);
      setRolePersonId('');
      return;
    }
    // Tự chọn mẫu theo vai trò (nếu có mẫu tương ứng và đang soạn mới)
    if (!initialDoc) {
      const code = templateCodeForRole(roleFilter);
      if (code) {
        const tpl = templates.find((t: any) => t.code === code);
        if (tpl) setTemplateId(tpl.id);
      }
    }
    // Nạp danh sách cộng tác viên theo vai trò
    fetch(`/api/collaborators?type=${encodeURIComponent(roleFilter)}&active=1`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setRolePeople(j.data || []);
        else setRolePeople([]);
      })
      .catch(() => setRolePeople([]));
    setRolePersonId('');
  }, [roleFilter, templates, initialDoc]);

  // Chọn người: tự điền thông tin định danh vào form (chỉ điền ô còn trống)
  const applyRolePerson = (personId: string) => {
    setRolePersonId(personId);
    const p = rolePeople.find((x: any) => x.id === personId);
    if (!p) return;
    const mapping: Record<string, string> = {
      ben_b_ten: p.fullName || '',
      ben_b_but_danh: p.penName || '',
      ben_b_cccd: p.idNumber || '',
      ben_b_ngay_cap: p.idIssuedDate || '',
      ben_b_noi_cap: p.idIssuedPlace || '',
      ben_b_dia_chi: p.address || '',
      ben_b_dien_thoai: p.phone || '',
      ben_b_email: p.email || '',
      ben_b_mst: p.taxId || '',
      ben_b_tai_khoan: p.bankAccount || '',
      ben_b_ngan_hang: p.bankName || '',
      ben_b_chu_tk: p.bankOwner || '',
      ben_b_ngay_sinh: p.dob || '',
    };
    setForm((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(mapping)) {
        if (v && (next[k] ?? '') === '') next[k] = v;
      }
      return next;
    });
  };

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
  // Mẫu chưa có file Word thì không gọi API - hiển thị thông báo riêng.
  const currentTemplate = templates.find((t: any) => t.id === templateId);
  const templateHasFile = !!(currentTemplate && `${currentTemplate.templateData || ''}`.trim());
  useEffect(() => {
    if (!templateId) return;
    if (!templateHasFile) {
      setPreviewError(null);
      if (previewBox.current) previewBox.current.innerHTML = '';
      return;
    }
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
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error || `Xem trước thất bại (mã ${res.status}). Kiểm tra lại mẫu và dữ liệu.`);
        }
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
  }, [templateId, templateHasFile, form, amountNum, amountWords]);

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

  // Parse an toàn trong render: một dòng preset hỏng không được làm sập cả modal.
  const safePresetValues = (p: any): Record<string, any> => {
    try { return JSON.parse(p.valuesJson || '{}'); } catch { return {}; }
  };
  const repChips = presets.filter((p: any) => Object.keys(safePresetValues(p)).some((k) => k.startsWith('ben_a_')));
  const termChips = presets.filter((p: any) => Object.keys(safePresetValues(p)).some((k) => k.startsWith('dieu_khoan_')));

  const chipBtn = (p: any) => (
    <button
      key={p.id}
      type="button"
      onClick={() => applyPreset(safePresetValues(p))}
      title={`Áp preset: ${p.label}`}
      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-full text-[11px] font-bold text-amber-800 transition flex items-center gap-1"
    >
      <Zap className="w-3 h-3" />{p.label}
    </button>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="xl"
        title={initialDoc ? `Sửa hợp đồng ${initialDoc.contractNumber}` : 'Soạn hợp đồng mới'}
        subtitle="Soạn 2 cột: form biến + xem trước trực tiếp"
      >
        {errorMessage && (
          <p className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">{errorMessage}</p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3 text-xs lg:max-h-[62vh] lg:overflow-y-auto lg:pr-2">
            <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block font-bold text-indigo-900">Vai trò
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white font-normal"
                  >
                    <option value="">- Chọn vai trò -</option>
                    {COLLAB_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block font-bold text-indigo-900">Người thực hiện
                  <select
                    value={rolePersonId}
                    onChange={(e) => applyRolePerson(e.target.value)}
                    disabled={!roleFilter || rolePeople.length === 0}
                    className="mt-0.5 w-full px-2 py-1.5 border rounded-lg outline-none bg-white font-normal disabled:opacity-50"
                  >
                    <option value="">
                      {!roleFilter ? '- Chọn vai trò trước -' : rolePeople.length === 0 ? '- Không có ai -' : '- Chọn người -'}
                    </option>
                    {rolePeople.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName}{p.penName ? ` (${p.penName})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {rolePersonId && (
                <p className="text-[11px] text-indigo-700">Đã điền thông tin người được chọn vào các ô còn trống bên dưới.</p>
              )}
            </div>
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
                  <option value="">- Không chọn -</option>
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
          <div className="bg-slate-100 rounded-xl p-4 lg:max-h-[62vh] lg:overflow-y-auto">
            <p className="text-[11px] text-slate-500 mb-2">
              Xem trước trực tiếp (xấp xỉ). Tải file Word để chỉnh sửa thêm, hoặc bấm In / Lưu PDF để dùng ngay.
            </p>
            {previewError && <p className="text-[11px] text-rose-600 font-semibold mb-2">{previewError}</p>}
            {templateId && !templateHasFile ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
                <p className="font-bold mb-1">Mẫu &ldquo;{currentTemplate?.title || ''}&rdquo; chưa có file Word.</p>
                <p className="mb-3">Hãy tải file .docx lên trong Quản lý mẫu, rồi quay lại đây xem trước và in.</p>
                <button
                  type="button"
                  onClick={() => setTemplatesOpen(true)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold"
                  aria-label="Mở Quản lý mẫu để tải file Word"
                >
                  Mở Quản lý mẫu
                </button>
              </div>
            ) : (
              <ContractPrintPreview previewRef={previewBox} />
            )}
          </div>
        </div>
      </Modal>
      {presetOpen && <PresetManagerModal onClose={() => setPresetOpen(false)} onChanged={async () => {
        const res = await fetch('/api/contracts/presets');
        const json = await res.json();
        if (json.success) setPresets(json.data.active || []);
      }} />}
      {templatesOpen && <TemplateManagerModal onClose={async () => {
        // Người dùng có thể vừa tải file .docx lên - nạp lại danh sách mẫu
        // để khung xem trước nhận ra ngay, không cần đóng mở modal soạn.
        setTemplatesOpen(false);
        try {
          const res = await fetch('/api/contracts/templates');
          const json = await res.json();
          if (json.success) setTemplates((json.data || []).filter((t: any) => t.isActive));
        } catch { /* giữ danh sách cũ */ }
      }} />}
    </>
  );
}
