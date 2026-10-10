'use client';

import React, { useState, useEffect } from 'react';
import { X, Pencil } from 'lucide-react';
import { UserRole } from '@/lib/roles';

export interface PartnerDetailInfo {
  id: string;
  code: string;
  name: string;
  type: string;
  contactInfo: string | null;
  discountRate: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxCode: string | null;
  receiverName: string | null;
  shipNote: string | null;
  creditLimit: number | null;
  paymentDueDays: number | null;
}

interface PartnerDetailProps {
  partner: PartnerDetailInfo;
  onClose: () => void;
  onUpdated?: (p: PartnerDetailInfo) => void;
  currentRole?: UserRole;
}

const canEdit = (role?: UserRole) => role === 'ROLE_OWNER' || role === 'ROLE_MANAGER';

const vnd = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN') + ' đ';

/**
 * Hồ sơ đại lý: thông tin giao nhận + tồn quầy + kỳ đối soát + công nợ
 * bán đứt (view tính, không phải kho mới). Dữ liệu từ 3 API có sẵn:
 * partnerStock, consignments (kỳ), partner-debt.
 */
export function PartnerDetail({ partner, onClose, onUpdated, currentRole = 'ROLE_OWNER' }: PartnerDetailProps) {
  const [stock, setStock] = useState<any[]>([]);
  const [statements, setStatements] = useState<any[]>([]);
  const [debt, setDebt] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState({
    name: partner.name,
    type: partner.type,
    discountPct: String(Math.round((partner.discountRate || 0) * 100)),
    receiverName: partner.receiverName || '',
    phone: partner.phone || '',
    address: partner.address || '',
    taxCode: partner.taxCode || '',
    email: partner.email || '',
    creditLimit: String(partner.creditLimit ?? 0),
    paymentDueDays: String(partner.paymentDueDays ?? 30),
    shipNote: partner.shipNote || '',
  });

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const saveProfile = async () => {
    try {
      setIsSaving(true);
      setErrorMessage(null);
      const res = await fetch(`/api/partners/${encodeURIComponent(partner.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-formapubli-role': currentRole },
        body: JSON.stringify({
          name: draft.name.trim(),
          type: draft.type,
          discountRate: Number(draft.discountPct) / 100,
          receiverName: draft.receiverName.trim() || null,
          phone: draft.phone.trim() || null,
          address: draft.address.trim() || null,
          taxCode: draft.taxCode.trim() || null,
          email: draft.email.trim() || null,
          creditLimit: Number(draft.creditLimit),
          paymentDueDays: Number(draft.paymentDueDays),
          shipNote: draft.shipNote.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không lưu được hồ sơ');
      setIsEditing(false);
      if (onUpdated) onUpdated(json.data);
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        setErrorMessage(null);
        const headers = { 'x-formapubli-role': currentRole };
        const [stockRes, stmtRes, debtRes] = await Promise.all([
          fetch(`/api/consignments?partnerStock=${encodeURIComponent(partner.id)}`, { headers }),
          fetch(`/api/consignments?partnerId=${encodeURIComponent(partner.id)}`, { headers }),
          fetch(`/api/partner-debt?partnerId=${encodeURIComponent(partner.id)}`, { headers }),
        ]);
        const stockJson = await stockRes.json();
        const stmtJson = await stmtRes.json();
        const debtJson = await debtRes.json();
        if (!stockJson.success) throw new Error(stockJson.error || 'Không đọc được tồn quầy');
        setStock(stockJson.data.items || []);
        setStatements(stmtJson.success ? stmtJson.data || [] : []);
        setDebt(debtJson.success ? debtJson.data : null);
      } catch (e: any) {
        setErrorMessage(e.message);
      }
    })();
  }, [partner.id, currentRole]);

  const stockTotal = stock.reduce((s, r) => s + Number(r.quantity || 0), 0);

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/70 flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-extrabold text-sm text-slate-900">
              [{partner.code}] {partner.name}
            </h3>
            <p className="text-[11px] text-slate-500">
              {partner.type} • CK cố định {Math.round((partner.discountRate || 0) * 100)}%
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canEdit(currentRole) && !isEditing && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                title="Sửa toàn bộ hồ sơ đại lý"
                aria-label="Sửa toàn bộ hồ sơ đại lý"
                className="p-1.5 text-slate-400 hover:text-purple-700 hover:bg-purple-50 rounded-lg"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg" aria-label="Đóng hồ sơ đại lý">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-5 overflow-y-auto text-xs">
          {errorMessage && (
            <p className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold">{errorMessage}</p>
          )}
          <section>
            <h4 className="font-bold text-slate-800 mb-1.5">Thông tin giao nhận</h4>
            {isEditing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-xs text-slate-600">Tên đại lý
                  <input value={draft.name} onChange={set('name')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold outline-none" />
                </label>
                <label className="text-xs text-slate-600">Loại
                  <select value={draft.type} onChange={set('type')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold outline-none bg-white">
                    <option value="WHOLESALE">Bán đứt (WHOLESALE)</option>
                    <option value="CONSIGNMENT">Ký gửi (CONSIGNMENT)</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">CK cố định (%)
                  <input type="number" min={0} max={100} value={draft.discountPct} onChange={set('discountPct')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold outline-none" />
                </label>
                <label className="text-xs text-slate-600">Người nhận
                  <input value={draft.receiverName} onChange={set('receiverName')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none" />
                </label>
                <label className="text-xs text-slate-600">Điện thoại
                  <input value={draft.phone} onChange={set('phone')} inputMode="numeric" className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono outline-none" />
                </label>
                <label className="text-xs text-slate-600">Email
                  <input value={draft.email} onChange={set('email')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none" />
                </label>
                <label className="text-xs text-slate-600 sm:col-span-2">Địa chỉ gửi sách
                  <input value={draft.address} onChange={set('address')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none" />
                </label>
                <label className="text-xs text-slate-600">MST
                  <input value={draft.taxCode} onChange={set('taxCode')} inputMode="numeric" className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono outline-none" />
                </label>
                <label className="text-xs text-slate-600">Hạn mức nợ (đ)
                  <input type="number" min={0} value={draft.creditLimit} onChange={set('creditLimit')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono outline-none" />
                </label>
                <label className="text-xs text-slate-600">Hạn trả (ngày)
                  <input type="number" min={0} max={365} value={draft.paymentDueDays} onChange={set('paymentDueDays')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono outline-none" />
                </label>
                <label className="text-xs text-slate-600">Ghi chú giao hàng
                  <input value={draft.shipNote} onChange={set('shipNote')} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none" />
                </label>
                <div className="sm:col-span-2 flex gap-2 pt-1">
                  <button type="button" onClick={saveProfile} disabled={isSaving} className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                    {isSaving ? 'Đang lưu...' : 'Lưu hồ sơ'}
                  </button>
                  <button type="button" onClick={() => setIsEditing(false)} className="px-4 py-1.5 text-slate-500 text-xs font-bold">
                    Hủy
                  </button>
                </div>
              </div>
            ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-700">
              <div><dt className="inline text-slate-500">Người nhận: </dt><dd className="inline font-semibold">{partner.receiverName || partner.name}</dd></div>
              <div><dt className="inline text-slate-500">Điện thoại: </dt><dd className="inline font-semibold">{partner.phone || '-'}</dd></div>
              <div className="sm:col-span-2"><dt className="inline text-slate-500">Địa chỉ gửi sách: </dt><dd className="inline font-semibold">{partner.address || '-'}</dd></div>
              <div><dt className="inline text-slate-500">MST: </dt><dd className="inline font-mono">{partner.taxCode || '-'}</dd></div>
              <div><dt className="inline text-slate-500">Email: </dt><dd className="inline">{partner.email || '-'}</dd></div>
              <div><dt className="inline text-slate-500">Hạn mức nợ: </dt><dd className="inline font-semibold">{vnd(partner.creditLimit || 0)}</dd></div>
              <div><dt className="inline text-slate-500">Hạn trả: </dt><dd className="inline font-semibold">{partner.paymentDueDays ?? 30} ngày</dd></div>
              {partner.shipNote && <div className="sm:col-span-2"><dt className="inline text-slate-500">Ghi chú giao: </dt><dd className="inline">{partner.shipNote}</dd></div>}
            </dl>
            )}
          </section>
          <section>
            <h4 className="font-bold text-slate-800 mb-1.5">
              Tồn tại quầy đại lý ({stockTotal.toLocaleString('vi-VN')} cuốn / {stock.length} đầu sách)
            </h4>
            {stock.length === 0 ? (
              <p className="text-slate-400 italic">Quầy chưa có hàng nào từ chúng ta.</p>
            ) : (
              <table className="w-full text-xs border border-slate-200 rounded-xl overflow-hidden">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="p-2">Ấn bản</th>
                    <th className="p-2 text-right">Tồn quầy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stock.map((r: any) => (
                    <tr key={`${r.editionId}-${r.condition}`}>
                      <td className="p-2 font-semibold">{r.title} <span className="font-mono text-slate-400">[{r.code}]</span></td>
                      <td className="p-2 text-right font-mono font-bold">{Number(r.quantity || 0).toLocaleString('vi-VN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section>
            <h4 className="font-bold text-slate-800 mb-1.5">Công nợ bán đứt</h4>
            {!debt ? (
              <p className="text-slate-400 italic">Chưa có số liệu công nợ.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-700">
                <div><dt className="inline text-slate-500">Phải thu: </dt><dd className="inline font-mono font-bold">{vnd(debt.receivable)}</dd></div>
                <div><dt className="inline text-slate-500">Đã thu: </dt><dd className="inline font-mono font-bold text-emerald-700">{vnd(debt.received)}</dd></div>
                <div><dt className="inline text-slate-500">Còn nợ: </dt><dd className="inline font-mono font-bold">{vnd(debt.balance)}</dd></div>
                <div><dt className="inline text-slate-500">Quá hạn: </dt><dd className={`inline font-mono font-bold ${Number(debt.overdue) > 0 ? 'text-rose-600' : ''}`}>{vnd(debt.overdue)}{Number(debt.overdueCount) > 0 ? ` (${debt.overdueCount} phiếu)` : ''}</dd></div>
              </dl>
            )}
          </section>
          <section>
            <h4 className="font-bold text-slate-800 mb-1.5">Kỳ đối soát ký gửi ({statements.length})</h4>
            {statements.length === 0 ? (
              <p className="text-slate-400 italic">Chưa có kỳ nào.</p>
            ) : (
              <ul className="space-y-1">
                {statements.slice(0, 10).map((s: any) => (
                  <li key={s.id} className="flex justify-between bg-slate-50 rounded-lg px-3 py-1.5">
                    <span className="font-mono">{s.id} ({s.periodStart} → {s.periodEnd})</span>
                    <span className="font-bold">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
