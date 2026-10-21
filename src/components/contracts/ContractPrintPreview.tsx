'use client';

import React, { RefObject } from 'react';

/** Khung A4 xem trước + in: docx-preview render vào đây. CSS in nằm ở
    src/app/globals.css (khối IN HỢP ĐỒNG — KHỔ A4), @page margin 0. */
export function ContractPrintPreview({ previewRef }: { previewRef: RefObject<HTMLDivElement | null> }) {
  return (
    <>
      <style>{`
        #contract-print-area .docx-wrapper { background: #e5e7eb !important; padding: 12px !important; }
        #contract-print-area .docx-wrapper > section.docx {
          font-family: 'Times New Roman', Times, serif !important; font-size: 13pt !important;
        }
      `}</style>
      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
          aria-label="In hoặc lưu PDF bản hợp đồng để dùng ngay"
        >
          In / Lưu PDF (dùng ngay)
        </button>
      </div>
      <div id="contract-print-area" ref={previewRef} className="min-h-[400px] bg-white rounded-xl border border-slate-200" />
    </>
  );
}
