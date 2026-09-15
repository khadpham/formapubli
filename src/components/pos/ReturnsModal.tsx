'use client';

import React, { useEffect, useState } from 'react';
import { RotateCcw, Search, CheckCircle2, AlertTriangle, X, Plus, Trash2 } from 'lucide-react';

interface BookRef {
  id: string;
  code: string;
  title: string;
}

interface ReturnsModalProps {
  books: BookRef[];
  currentRole: string;
  warehouseId: string;
  cashierId: string;
  onClose: () => void;
  onCompleted?: () => void;
}

interface ReturnLine {
  editionId: string;
  quantity: number;
}

const REASONS = [
  { v: 'PRINTING_DEFECT', label: 'Lỗi in ấn / rách (30 ngày)' },
  { v: 'WRONG_ITEM', label: 'Giao nhầm / đổi ý (7 ngày)' },
  { v: 'CUSTOMER_CHANGE_MIND', label: 'Khách đổi ý (7 ngày)' },
  { v: 'DAMAGED_SHIPPING', label: 'Hư hại vận chuyển (30 ngày)' },
];

/**
 * 1.3 — Modal Đổi/Trả BV-06: lập phiếu REQUEST + duyệt/hoàn tất 1 chạm (Manager).
 * Mọi guard (tồn đã bán, két OPEN, hàng đổi) do server enforce; UI check trước để báo sớm.
 */
export function ReturnsModal({ books, currentRole, warehouseId, cashierId, onClose, onCompleted }: ReturnsModalProps) {
  const [orderCode, setOrderCode] = useState('');
  const [orderId, setOrderId] = useState('');
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [returnType, setReturnType] = useState<'REFUND' | 'EXCHANGE' | 'DAMAGED_REPLACE'>('REFUND');
  const [reason, setReason] = useState('CUSTOMER_CHANGE_MIND');
  const [disposition, setDisposition] = useState<'RESTOCK' | 'DEFECTIVE_HOLD'>('RESTOCK');
  const [lines, setLines] = useState<ReturnLine[]>([{ editionId: '', quantity: 1 }]);
  const [refundAmount, setRefundAmount] = useState('0');
  const [cashboxSessionId, setCashboxSessionId] = useState('');
  const [openSession, setOpenSession] = useState<any | null>(null);
  const [exchangeLines, setExchangeLines] = useState<ReturnLine[]>([{ editionId: '', quantity: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdReturn, setCreatedReturn] = useState<{ returnId: string; returnCode: string } | null>(null);

  const isPriv = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

  // Nạp két ca OPEN của thu ngân để chọn khi hoàn tiền mặt
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/cashbox?cashierId=${encodeURIComponent(cashierId)}`);
        const json = await res.json();
        if (json.success && json.data) {
          setOpenSession(json.data);
          setCashboxSessionId(json.data.id);
        }
      } catch {
        // không két thì server sẽ chặn khi refund > 0
      }
    })();
  }, [cashierId]);

  const bookLabel = (id: string) => {
    const b = books.find((x) => x.id === id);
    return b ? `[${b.code}] ${b.title}` : id || '— chọn sách —';
  };

  const lookupOrder = async () => {
    setLookupMsg(null);
    setError(null);
    const code = orderCode.trim();
    if (!code) {
      setLookupMsg('Nhập mã đơn (VD: ORD-20260915-XXXX).');
      return;
    }
    try {
      const res = await fetch('/api/orders?status=COMPLETED&limit=200', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Lỗi tra cứu');
      const found = (json.orders || []).find(
        (o: any) => o.orderCode === code || o.id === code
      );
      if (!found) {
        setLookupMsg(`Không thấy đơn COMPLETED mã ${code}.`);
        return;
      }
      setOrderId(found.id);
      setLookupMsg(`Đã gắn đơn ${found.orderCode} — ${found.customerName || ''} (${(found.finalAmount || 0).toLocaleString('vi-VN')}đ).`);
    } catch (e: any) {
      setLookupMsg(e.message || 'Lỗi tra cứu');
    }
  };

  const setLine = (idx: number, patch: Partial<ReturnLine>, ex = false) => {
    const setter = ex ? setExchangeLines : setLines;
    setter((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const submitRequest = async () => {
    setError(null);
    setSuccess(null);
    if (!orderId.trim()) {
      setError('Chưa gắn đơn gốc — tra cứu mã đơn trước.');
      return;
    }
    const cleanLines = lines.filter((l) => l.editionId && l.quantity > 0);
    if (cleanLines.length === 0) {
      setError('Chọn ít nhất 1 cuốn cần trả.');
      return;
    }
    // 1.3: check sớm hàng đổi còn đủ ATP trước khi gửi
    let cleanEx: ReturnLine[] = [];
    if (returnType === 'EXCHANGE') {
      cleanEx = exchangeLines.filter((l) => l.editionId && l.quantity > 0);
      if (cleanEx.length === 0) {
        setError('Đổi hàng bắt buộc chọn cuốn thay thế.');
        return;
      }
      try {
        for (const ex of cleanEx) {
          const r = await fetch(`/api/atp?editionId=${encodeURIComponent(ex.editionId)}&warehouseId=${encodeURIComponent(warehouseId)}`);
          const j = await r.json();
          if (j.success && ex.quantity > j.data.atp) {
            setError(`Cuốn thay thế ${bookLabel(ex.editionId)} chỉ còn khả dụng ${j.data.atp} cuốn.`);
            return;
          }
        }
      } catch {
        // mất mạng → để server guard
      }
    }
    setBusy(true);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'REQUEST',
          orderId: orderId.trim(),
          returnType,
          reason,
          targetWarehouseId: warehouseId,
          inventoryDisposition: disposition,
          items: cleanLines.map((l) => ({ editionId: l.editionId, quantity: Math.floor(l.quantity) })),
          refundAmount: parseFloat(refundAmount) || 0,
          cashboxSessionId: cashboxSessionId.trim() || undefined,
          note: `POS đổi/trả tại ${warehouseId}`,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Lỗi lập phiếu');
      setCreatedReturn({ returnId: json.data.returnId, returnCode: json.data.returnCode });
      setSuccess(`Đã lập phiếu ${json.data.returnCode} (chờ duyệt).`);
    } catch (e: any) {
      setError(e.message || 'Lỗi lập phiếu');
    } finally {
      setBusy(false);
    }
  };

  const finishNow = async () => {
    if (!createdReturn) return;
    setBusy(true);
    setError(null);
    try {
      for (const action of ['APPROVE', 'COMPLETE'] as const) {
        const res = await fetch('/api/returns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, returnId: createdReturn.returnId }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || `Lỗi ${action} (cần Manager/Owner).`);
      }
      setSuccess(`Hoàn tất phiếu ${createdReturn.returnCode} — kho đã hoàn, két đã trừ (nếu có).`);
      setCreatedReturn(null);
      if (onCompleted) onCompleted();
    } catch (e: any) {
      setError(e.message || 'Lỗi duyệt/hoàn tất');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-100 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-indigo-600" />
            Đổi / Trả Hàng (BV-06)
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tra cứu đơn gốc */}
        <div className="flex gap-2">
          <input
            value={orderCode}
            onChange={(e) => setOrderCode(e.target.value)}
            placeholder="Mã đơn gốc (ORD-...)"
            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={lookupOrder}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-1"
          >
            <Search className="w-3.5 h-3.5" /> Tra
          </button>
        </div>
        {lookupMsg && <p className="text-[11px] text-slate-600">{lookupMsg}</p>}

        {/* Loại + lý do + disposition */}
        <div className="grid grid-cols-3 gap-2">
          <select value={returnType} onChange={(e) => setReturnType(e.target.value as any)} className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none">
            <option value="REFUND">Trả hoàn tiền</option>
            <option value="EXCHANGE">Đổi cuốn khác</option>
            <option value="DAMAGED_REPLACE">Đổi bảo hành lỗi</option>
          </select>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none">
            {REASONS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          <select value={disposition} onChange={(e) => setDisposition(e.target.value as any)} className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none">
            <option value="RESTOCK">Nhập lại kho bán</option>
            <option value="DEFECTIVE_HOLD">Cách ly hàng lỗi</option>
          </select>
        </div>

        {/* Dòng sách trả */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-500">Sách khách trả:</p>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <select value={l.editionId} onChange={(e) => setLine(i, { editionId: e.target.value })} className="flex-1 px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none min-w-0">
                <option value="">— chọn sách —</option>
                {books.map((b) => <option key={b.id} value={b.id}>[{b.code}] {b.title}</option>)}
              </select>
              <input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} className="w-16 px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-center outline-none" />
              <button type="button" onClick={() => setLines((p) => p.filter((_, x) => x !== i))} className="p-2 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setLines((p) => [...p, { editionId: '', quantity: 1 }])} className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Thêm dòng
          </button>
        </div>

        {/* Cuốn thay thế khi EXCHANGE */}
        {returnType === 'EXCHANGE' && (
          <div className="space-y-2 p-3 bg-indigo-50/60 border border-indigo-200 rounded-xl">
            <p className="text-[11px] font-bold text-indigo-800">Cuốn thay thế (check ATP trước khi gửi):</p>
            {exchangeLines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <select value={l.editionId} onChange={(e) => setLine(i, { editionId: e.target.value }, true)} className="flex-1 px-2 py-2 bg-white border border-indigo-200 rounded-xl text-xs outline-none min-w-0">
                  <option value="">— chọn sách đổi —</option>
                  {books.map((b) => <option key={b.id} value={b.id}>[{b.code}] {b.title}</option>)}
                </select>
                <input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, parseInt(e.target.value) || 1) }, true)} className="w-16 px-2 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-mono text-center outline-none" />
              </div>
            ))}
          </div>
        )}

        {/* Hoàn tiền + két */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Hoàn tiền (đ):</label>
            <input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" placeholder="0" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Két chi (hoàn CASH bắt buộc):</label>
            <input value={cashboxSessionId} onChange={(e) => setCashboxSessionId(e.target.value)} placeholder={openSession ? openSession.id : 'Chưa có két OPEN'} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>

        {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</p>}
        {success && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{success}</p>}

        <div className="flex gap-2">
          {!createdReturn ? (
            <button type="button" onClick={submitRequest} disabled={busy} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs transition">
              {busy ? 'Đang lập phiếu...' : 'Lập Phiếu Trả'}
            </button>
          ) : (
            <button type="button" onClick={finishNow} disabled={busy || !isPriv} title={isPriv ? undefined : 'Cần Manager/Owner duyệt'} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs transition">
              {busy ? 'Đang duyệt...' : `Duyệt & Hoàn tất ${createdReturn.returnCode}`}
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs">Đóng</button>
        </div>
        {!isPriv && <p className="text-[11px] text-slate-400">Thu ngân lập phiếu, Manager/Owner bấm Duyệt & Hoàn tất.</p>}
      </div>
    </div>
  );
}
