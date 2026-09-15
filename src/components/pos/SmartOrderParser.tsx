'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, AlertTriangle, CheckCircle2, Minus, Plus, Trash2 } from 'lucide-react';
import { parseSmartOrder, buildFbNote, ParsedItem } from '@/lib/smart-order-parser';

interface SmartOrderParserProps {
  books: Array<{ id: string; code: string; title: string; author?: string | null }>;
  /** Team wire: POST /api/orders { channel:'RETAIL_ONLINE_SOCIAL', confirmImmediately:false, ... } */
  onCreateOrder: (payload: {
    customerName: string;
    phone?: string;
    address?: string;
    items: Array<{ editionId: string; quantity: number }>;
    note: string;
  }) => Promise<void>;
}

/**
 * Bước 1 — Trợ lý Lên đơn Nhanh: paste chat FB → preview → 1 click tạo đơn PENDING.
 * File độc lập, không đụng PosCheckoutTerminal (team gắn vào modal POS khi sẵn sàng).
 */
export function SmartOrderParser({ books, onCreateOrder }: SmartOrderParserProps) {
  const [chat, setChat] = useState('');
  const [debouncedChat, setDebouncedChat] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [removedIds, setRemovedIds] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedChat(chat), 300);
    return () => clearTimeout(t);
  }, [chat]);

  const catalog = useMemo(
    () => books.map((b) => ({ editionId: b.id, code: b.code, title: b.title, author: b.author ?? null })),
    [books]
  );
  const parsed = useMemo(() => parseSmartOrder(debouncedChat, catalog), [debouncedChat, catalog]);

  // Nạp gợi ý parser vào form khi chat đổi (không ghi đè thứ user đã sửa tay)
  useEffect(() => {
    if (parsed.phone && !phone) setPhone(parsed.phone);
    if (parsed.address && !address) setAddress(parsed.address);
    if (parsed.customerName && !customerName) setCustomerName(parsed.customerName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const items: ParsedItem[] = useMemo(
    () =>
      parsed.items
        .filter((it) => !removedIds[it.editionId])
        .map((it) => ({ ...it, quantity: qtyOverrides[it.editionId] ?? it.quantity })),
    [parsed, qtyOverrides, removedIds]
  );

  const canSubmit = items.length > 0 && items.every((it) => it.quantity > 0) && !isSubmitting;

  const handleSubmit = async () => {
    setError(null);
    setDoneMsg(null);
    if (!canSubmit) {
      setError('Cần ít nhất 1 sách với số lượng > 0.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreateOrder({
        customerName: customerName.trim() || 'Khách FB',
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        items: items.map((it) => ({ editionId: it.editionId, quantity: it.quantity })),
        note: buildFbNote(chat),
      });
      setDoneMsg('Đã tạo đơn PENDING — qua màn "Chờ xác nhận" để duyệt.');
      setChat('');
      setDebouncedChat('');
      setQtyOverrides({});
      setRemovedIds({});
    } catch (e: any) {
      setError(e.message || 'Lỗi tạo đơn.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div>
        <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
          <ClipboardPaste className="w-4 h-4 text-indigo-600" />
          Trợ lý Lên đơn Nhanh (FB Chat → Đơn PENDING)
        </h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Paste nguyên đoạn chat → hệ thống bóc SĐT / địa chỉ / sách → kiểm tra lại → 1 click tạo đơn giữ chỗ ATP.
        </p>
      </div>

      <textarea
        value={chat}
        onChange={(e) => setChat(e.target.value)}
        rows={4}
        placeholder={'VD: Gửi cho mình 2 cuốn Bệnh Tưởng đến 123 Cầu Giấy, HN. SĐT 0912345678, ship COD giờ hành chính nhé'}
        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 min-h-[96px]"
      />

      {parsed.warnings.length > 0 && debouncedChat.trim() && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
          {parsed.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-800 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.editionId} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
              <div className="truncate flex-1">
                <span className="font-mono text-[10px] font-bold text-indigo-700">[{it.code}] </span>
                <span className="text-xs font-bold text-slate-800">{it.title}</span>
              </div>
              <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shrink-0">
                <button
                  type="button"
                  onClick={() => setQtyOverrides((p) => ({ ...p, [it.editionId]: Math.max(1, (p[it.editionId] ?? it.quantity) - 1) }))}
                  className="p-1 hover:bg-slate-100 min-h-[28px] min-w-[28px] flex items-center justify-center"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="px-2 text-xs font-mono font-bold">{it.quantity}</span>
                <button
                  type="button"
                  onClick={() => setQtyOverrides((p) => ({ ...p, [it.editionId]: (p[it.editionId] ?? it.quantity) + 1 }))}
                  className="p-1 hover:bg-slate-100 min-h-[28px] min-w-[28px] flex items-center justify-center"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRemovedIds((p) => ({ ...p, [it.editionId]: true }))}
                className="p-1 text-slate-400 hover:text-rose-600 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Tên khách (VD: Lan Anh)"
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="SĐT (VD: 0912345678)"
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Địa chỉ giao hàng"
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {doneMsg && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> {doneMsg}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold rounded-2xl text-sm shadow-lg shadow-indigo-600/25 transition-all"
      >
        {isSubmitting ? 'Đang tạo đơn giữ chỗ...' : 'TẠO ĐƠN PENDING (giữ chỗ ATP)'}
      </button>
    </div>
  );
}
