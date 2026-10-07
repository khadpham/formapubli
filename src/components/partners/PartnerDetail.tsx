'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
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
  currentRole?: UserRole;
}

const vnd = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN') + ' đ';

/**
 * Hồ sơ đại lý: thông tin giao nhận + tồn quầy + kỳ đối soát + công nợ
 * bán đứt (view tính, không phải kho mới). Dữ liệu từ 3 API có sẵn:
 * partnerStock, consignments (kỳ), partner-debt.
 */
export function PartnerDetail({ partner, onClose, currentRole = 'ROLE_OWNER' }: PartnerDetailProps) {
  const [stock, setStock] = useState<any[]>([]);
  const [statements, setStatements] = useState<any[]>([]);
  const [debt, setDebt] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg" aria-label="Đóng hồ sơ đại lý">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-5 overflow-y-auto text-xs">
          {errorMessage && (
            <p className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold">{errorMessage}</p>
          )}
          <section>
            <h4 className="font-bold text-slate-800 mb-1.5">Thông tin giao nhận</h4>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-700">
              <div><dt className="inline text-slate-500">Người nhận: </dt><dd className="inline font-semibold">{partner.receiverName || partner.name}</dd></div>
              <div><dt className="inline text-slate-500">Điện thoại: </dt><dd className="inline font-semibold">{partner.phone || '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="inline text-slate-500">Địa chỉ gửi sách: </dt><dd className="inline font-semibold">{partner.address || '—'}</dd></div>
              <div><dt className="inline text-slate-500">MST: </dt><dd className="inline font-mono">{partner.taxCode || '—'}</dd></div>
              <div><dt className="inline text-slate-500">Email: </dt><dd className="inline">{partner.email || '—'}</dd></div>
              <div><dt className="inline text-slate-500">Hạn mức nợ: </dt><dd className="inline font-semibold">{vnd(partner.creditLimit || 0)}</dd></div>
              <div><dt className="inline text-slate-500">Hạn trả: </dt><dd className="inline font-semibold">{partner.paymentDueDays ?? 30} ngày</dd></div>
              {partner.shipNote && <div className="sm:col-span-2"><dt className="inline text-slate-500">Ghi chú giao: </dt><dd className="inline">{partner.shipNote}</dd></div>}
            </dl>
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
