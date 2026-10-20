'use client';

import React from 'react';
import { ShieldCheck } from 'lucide-react';

export interface LedgerEntry {
  id: string;
  eventType: string;
  quantityDelta: number;
  condition: string | null;
  documentRef: string;
  note: string | null;
  actorId: string;
  recordedAt: string | null;
  bookCode: string;
  bookTitle: string | null;
  isbnLast4: string;
  warehouseCode: string;
  warehouseName: string;
}

interface StockLedgerTabProps {
  entries: LedgerEntry[];
}

// Format gio VN: YYYY-MM-DD HH:mm:ss
function formatVNTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(iso)) return iso.slice(0, 19);
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return vn.getUTCFullYear() + '-' + pad(vn.getUTCMonth() + 1) + '-' + pad(vn.getUTCDate()) + ' ' +
           pad(vn.getUTCHours()) + ':' + pad(vn.getUTCMinutes()) + ':' + pad(vn.getUTCSeconds());
  } catch {
    return iso;
  }
}

function EventBadge({ type }: { type: string }) {
  if (type === 'RECEIPT') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
        NHẬP KHO
      </span>
    );
  }
  if (type === 'TRANSFER_OUT') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
        XUẤT CHUYỂN
      </span>
    );
  }
  if (type === 'TRANSFER_IN') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
        NHẬP CHUYỂN
      </span>
    );
  }
  if (type === 'DISPATCH_SALE') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
        XUẤT BÁN
      </span>
    );
  }
  if (type === 'ADJUSTMENT') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
        ĐIỀU CHỈNH
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
      {type}
    </span>
  );
}

export function StockLedgerTab({ entries }: StockLedgerTabProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Sổ Cái Kho Bất Biến - Nghiêm Cấm Sửa/Xóa Lịch Sử
        </div>
        <span className="text-xs text-slate-400">Thời gian thực</span>
      </div>
      <div className="overflow-x-auto pb-24 lg:pb-2" data-kho-ui="fab-gutter">
        <table className="w-full min-w-[720px] text-left text-xs text-slate-600">
          <thead className="bg-slate-100/70 uppercase text-slate-500 font-semibold border-b border-slate-200">
            <tr>
              <th className="px-3 py-2.5 w-36">Thời gian</th>
              <th className="px-3 py-2.5 w-32">Số Chứng Từ</th>
              <th className="px-3 py-2.5 w-32">Nghiệp vụ</th>
              <th className="px-3 py-2.5">Tên sách</th>
              <th className="px-3 py-2.5 w-28">Kho</th>
              <th className="px-3 py-2.5 text-right w-28">Biến động</th>
              <th className="px-3 py-2.5 w-36">Người tạo</th>
              <th className="px-3 py-2.5">Ghi chú</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400 font-sans">
                  Chưa có bút toán nào trong sổ cái.
                </td>
              </tr>
            ) : (
              entries.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-3 py-2 text-slate-500 text-[11px]">{formatVNTime(item.recordedAt)}</td>
                  <td className="px-3 py-2 font-bold text-slate-800">{item.documentRef}</td>
                  <td className="px-3 py-2">
                    <EventBadge type={item.eventType} />
                  </td>
                  <td className="px-3 py-2 font-sans font-medium text-slate-900">
                    [{item.bookCode}] {item.bookTitle}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{item.warehouseCode}</td>
                  <td className="px-3 py-2 text-right font-bold">
                    {item.quantityDelta > 0 ? (
                      <span className="text-emerald-600">+{item.quantityDelta}</span>
                    ) : (
                      <span className="text-rose-600">{item.quantityDelta}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-sans text-slate-600 text-[11px]">{item.actorId}</td>
                  <td className="px-3 py-2 font-sans text-slate-400 text-[11px]">{item.note || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div aria-hidden="true" className="h-0 w-20 shrink-0" />
      </div>
    </div>
  );
}
