'use client';

import React, { useState } from 'react';
import { Camera, ChevronDown, ChevronUp, Plus } from 'lucide-react';

/**
 * Mobile portrait scan-first bar cho POS (thứ tự: quét > lướt > gõ).
 *
 * ĐIỂM HẸN MOUNT (đợt B, sau khi keyboard batch merge — cần 3 dòng trong
 * PosCheckoutTerminal, đặt ngay trên "Book Catalog Grid", cột trái):
 *
 *   <PosMobileQuickAdd
 *     items={filteredBooks.map((b) => ({
 *       id: b.id, code: b.code, title: b.title, author: b.author,
 *       price: b.coverPrice, stock: getBookStock(b),
 *     }))}
 *     onAdd={(id) => { const b = filteredBooks.find((x) => x.id === id); if (b) handleAddToCart(b); }}
 *     onScan={() => setIsScannerOpen(true)}
 *   />
 *
 * Component tự `md:hidden` nên desktop không đổi gì.
 */

export interface PosQuickItem {
  id: string;
  code: string;
  title: string;
  author?: string | null;
  price: number;
  stock: number;
}

interface PosMobileQuickAddProps {
  items: PosQuickItem[];
  onAdd: (id: string) => void;
  onScan: () => void;
  /** Số món hiện khi thu gọn. Mặc định 5. */
  previewCount?: number;
}

export const POS_QUICK_ADD_PREVIEW_COUNT = 5;

export function PosMobileQuickAdd({ items, onAdd, onScan, previewCount = POS_QUICK_ADD_PREVIEW_COUNT }: PosMobileQuickAddProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, previewCount);

  return (
    <div className="md:hidden space-y-3">
      {/* 1. Quét trước: nút to bằng ngón tay cái */}
      <button
        type="button"
        onClick={onScan}
        className="w-full min-h-[48px] px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-extrabold shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
      >
        <Camera className="w-5 h-5" />
        Quét mã thêm vào giỏ
      </button>

      {/* 2. Lướt nhanh: thu gọn mặc định */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-3.5 pt-3 pb-1 flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-800">Chọn nhanh ({items.length})</span>
          {items.length > previewCount && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 min-h-[32px] px-1"
            >
              {expanded ? (
                <>Thu gọn <ChevronUp className="w-4 h-4" /></>
              ) : (
                <>Xem tất cả <ChevronDown className="w-4 h-4" /></>
              )}
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="px-3.5 pb-3.5 text-xs text-slate-400">Kho này chưa có sách khả dụng — thử quét mã hoặc đổi kho.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((b) => {
              const out = b.stock <= 0;
              return (
                <li key={b.id} className="px-3.5 py-2.5 flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-px rounded bg-indigo-50 text-indigo-700 text-[10px] font-mono font-black shrink-0">
                        {b.code}
                      </span>
                      <span className={`text-[10px] font-mono font-bold shrink-0 ${out ? 'text-rose-600' : 'text-emerald-700'}`}>
                        Tồn: {b.stock}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-900 truncate mt-0.5">{b.title}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {b.author || ''} • <span className="font-mono font-bold text-emerald-700">{b.price.toLocaleString('vi-VN')} đ</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={out}
                    onClick={() => onAdd(b.id)}
                    className="shrink-0 w-11 h-11 rounded-xl text-base font-black bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white active:scale-95 transition-colors disabled:opacity-40 flex items-center justify-center"
                    title={out ? 'Hết hàng' : `Thêm ${b.title} vào giỏ`}
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
