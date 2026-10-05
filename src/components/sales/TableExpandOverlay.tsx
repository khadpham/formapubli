'use client';

import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { PortalToBody } from '@/components/PortalToBody';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';

/**
 * Bọc vùng cuộn của một bảng: nút "Mở rộng" + overlay fullscreen.
 *
 * Một DOM duy nhất: bật/tắt là portal di chuyển nút đi (không render 2 bản).
 * Vị trí cuộn reset về đầu khi chuyển chế độ — chấp nhận được vì trạng thái
 * sort/lọc nằm ở panel cha, không mất.
 */
export function TableExpandOverlay({
  title,
  children,
  buttonClassName = '',
}: {
  title: string;
  children: React.ReactNode;
  buttonClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useModalFocusTrap<HTMLDivElement>(expanded, () => setExpanded(false));

  // Khóa cuộn nền khi overlay mở (mobile Safari vẫn cuộn nền nếu thiếu).
  useEffect(() => {
    if (!expanded || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  const openButton = (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      title={`Mở rộng ${title} toàn màn hình`}
      aria-label={`Mở rộng ${title} toàn màn hình`}
      aria-expanded={expanded}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition ${buttonClassName}`}
    >
      <Maximize2 className="w-3.5 h-3.5" />
      <span>Mở rộng</span>
    </button>
  );

  if (!expanded) {
    return (
      <>
        {openButton}
        {children}
      </>
    );
  }

  return (
    <>
      {openButton}
      <PortalToBody>
        <div
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${title} (mở rộng)`}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-6xl w-full mx-auto p-4 sm:p-5 space-y-3 max-h-[92vh] flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 shrink-0">
              <h3 className="font-extrabold text-slate-900 text-sm truncate">{title} (mở rộng)</h3>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="Thu lại"
                aria-label="Thu lại bảng"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white transition shrink-0"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Thu lại</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>
        </div>
      </PortalToBody>
    </>
  );
}
