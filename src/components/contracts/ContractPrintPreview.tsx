'use client';

import React, { RefObject } from 'react';

/** Khung A4 xem trước + in: docx-preview render vào đây, print CSS khổ A4 ND30. */
export function ContractPrintPreview({ previewRef }: { previewRef: RefObject<HTMLDivElement | null> }) {
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #contract-print-area, #contract-print-area * { visibility: visible; }
          #contract-print-area {
            position: absolute; left: 0; top: 0; width: 100%; margin: 0;
            padding: 0; background: white !important; box-shadow: none !important;
          }
          #contract-print-area .docx-wrapper { padding: 0 !important; background: white !important; }
          #contract-print-area .docx-wrapper > section.docx {
            box-shadow: none !important; margin: 0 auto !important;
          }
          @page { size: A4 portrait; margin: 20mm 15mm 20mm 30mm; }
        }
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
          aria-label="In hoặc xuất PDF khung xem trước"
        >
          In / Xuất PDF (xấp xỉ)
        </button>
      </div>
      <div id="contract-print-area" ref={previewRef} className="min-h-[400px] bg-white rounded-xl border border-slate-200" />
    </>
  );
}
