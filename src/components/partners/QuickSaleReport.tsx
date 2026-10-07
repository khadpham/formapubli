'use client';

import React, { useState, useEffect } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { parsePastedBookList } from '@/lib/batch-paste-parser';
import { UserRole } from '@/lib/roles';

interface QuickSaleReportProps {
  partners: { id: string; code: string; name: string }[];
  currentRole?: UserRole;
}

interface StockRow {
  editionId: string;
  code: string;
  title: string;
  quantity: number;
}

interface StatementRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

/**
 * Báo bán nhanh ký gửi: chọn đại lý → chọn kỳ DRAFT → dán Tên + SL đã bán.
 * Mỗi dòng matched gọi `record-sale` với key riêng (bấm đúp không ghi trùng);
 * dòng chưa chắc/không thấy giữ lại cho user chốt tay, không tự đoán.
 */
export function QuickSaleReport({ partners, currentRole = 'ROLE_OWNER' }: QuickSaleReportProps) {
  const [partnerId, setPartnerId] = useState('');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [statementId, setStatementId] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!partnerId) {
      setStock([]);
      setStatements([]);
      setStatementId('');
      return;
    }
    (async () => {
      try {
        setErrorMessage(null);
        const [stockRes, stmtRes] = await Promise.all([
          fetch(`/api/consignments?partnerStock=${encodeURIComponent(partnerId)}`, {
            headers: { 'x-formapubli-role': currentRole },
          }),
          fetch(`/api/consignments?partnerId=${encodeURIComponent(partnerId)}&status=DRAFT`, {
            headers: { 'x-formapubli-role': currentRole },
          }),
        ]);
        const stockJson = await stockRes.json();
        const stmtJson = await stmtRes.json();
        if (!stockJson.success) throw new Error(stockJson.error || 'Không đọc được tồn quầy');
        if (!stmtJson.success) throw new Error(stmtJson.error || 'Không đọc được kỳ đối soát');
        setStock(stockJson.data.items || []);
        const drafts = (stmtJson.data || []).filter((s: StatementRow) => s.status === 'DRAFT');
        setStatements(drafts);
        setStatementId(drafts.length > 0 ? drafts[0].id : '');
      } catch (e: any) {
        setErrorMessage(e.message);
      }
    })();
  }, [partnerId, currentRole]);

  const applyReport = async () => {
    if (!statementId) {
      setErrorMessage('Chưa có kỳ đối soát DRAFT — hãy mở kỳ trong panel đối soát trước.');
      return;
    }
    const { rows, summary } = parsePastedBookList(
      pasteText,
      stock.map((s) => ({ id: s.editionId, title: s.title, code: s.code })),
      { defaultQuantity: 1 }
    );
    const lines: string[] = [];
    setIsWorking(true);
    setErrorMessage(null);
    try {
      let ok = 0;
      for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        if (r.status !== 'matched') {
          lines.push(r.status === 'needs_confirm' ? `Chưa chắc (bỏ qua): ${r.line}` : `Không thấy (bỏ qua): ${r.line}`);
          continue;
        }
        const res = await fetch('/api/consignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-formapubli-role': currentRole },
          body: JSON.stringify({
            action: 'record-sale',
            statementId,
            editionId: r.editionId,
            quantity: r.quantity,
            idempotencyKey: `${statementId}-${r.editionId}-${Date.now()}-${idx}`,
          }),
        });
        const json = await res.json();
        if (!json.success) {
          lines.push(`Lỗi [${r.title} × ${r.quantity}]: ${json.error}`);
          continue;
        }
        ok++;
        lines.push(`Đã ghi: ${r.title} × ${r.quantity}`);
      }
      lines.unshift(`Xong: ${ok}/${summary.matched} dòng khớp${summary.notFound > 0 ? `, ${summary.notFound} dòng không thấy` : ''}${summary.needsConfirm > 0 ? `, ${summary.needsConfirm} dòng chưa chắc` : ''}.`);
      setPasteText('');
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setIsWorking(false);
      setResults(lines);
    }
  };

  return (
    <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-extrabold text-slate-900">Báo bán nhanh ký gửi</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Dán tên sản phẩm + số lượng đại lý báo đã bán (thiếu số lượng = 1 cuốn). Chỉ ghi vào kỳ DRAFT.
        </p>
      </div>
      {errorMessage && (
        <p className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">
          {errorMessage}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">Đại lý:</label>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none"
          >
            <option value="">-- Chọn đại lý ký gửi --</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.code}] {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1">Kỳ đối soát (DRAFT):</label>
          <select
            value={statementId}
            onChange={(e) => setStatementId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold outline-none"
          >
            <option value="">-- {statements.length === 0 ? 'Chưa có kỳ DRAFT' : 'Chọn kỳ'} --</option>
            {statements.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} ({s.periodStart} → {s.periodEnd})
              </option>
            ))}
          </select>
        </div>
      </div>
      {partnerId && (
        <p className="text-xs text-slate-500">
          Tồn quầy hiện tại: <b className="font-mono">{stock.reduce((s, r) => s + r.quantity, 0)} cuốn</b> /{' '}
          {stock.length} đầu sách
        </p>
      )}
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        rows={5}
        placeholder={'Bốn tình yêu\t3\nMay\t2'}
        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-purple-500"
      />
      <button
        type="button"
        onClick={applyReport}
        disabled={isWorking || !pasteText.trim() || !statementId}
        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5"
      >
        <ClipboardPaste className="w-4 h-4" />
        {isWorking ? 'Đang ghi...' : 'Ghi nhận báo bán'}
      </button>
      {results.length > 0 && (
        <ul className="text-xs space-y-1 bg-slate-50 border border-slate-200 rounded-xl p-3">
          {results.map((l, i) => (
            <li key={i} className="text-slate-700">{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
