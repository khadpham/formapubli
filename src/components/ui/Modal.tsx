'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-lg',
  md: 'max-w-[92vw]',
  lg: 'max-w-[92vw]',
  xl: 'max-w-[92vw]',
  full: 'max-w-[96vw]',
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Cột thao tác bên phải trên desktop. Tự xếp dọc, không cuộn chung với nội dung. */
  actions?: React.ReactNode;
  size?: ModalSize;
  /** Ẩn nút X (dùng khi cần xác nhận bắt buộc) */
  hideClose?: boolean;
}

/**
 * Modal wrapper dùng chung cho toàn bộ ERP.
 *
 * Nguyên tắc desktop: khi màn hình đủ rộng, modal mở rộng theo chiều ngang
 * để nội dung + nút thao tác vừa trong 1 màn hình, KHÔNG cuộn dọc.
 * Nút thao tác xếp sang cột bên phải (prop `actions`).
 * Trên mobile: về 1 cột, cho phép cuộn dọc bình thường.
 */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  size = 'xl',
  hideClose = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center z-[100] p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl ${SIZE_CLASS[size]} w-full max-h-[94vh] flex flex-col shadow-[0_25px_60px_-15px_rgba(30,27,75,0.3)] border border-slate-200/60 overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - sang trọng với điểm nhấn gold */}
        {(title || !hideClose) && (
          <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4 shrink-0 bg-gradient-to-r from-slate-50/80 to-white">
            <div className="min-w-0">
              {title && <h3 className="text-xl font-bold text-navy-900 truncate tracking-tight">{title}</h3>}
              {subtitle && <div className="text-xs text-slate-500 mt-1 vn-text">{subtitle}</div>}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng"
                className="p-2 rounded-xl text-slate-400 hover:text-navy-900 hover:bg-slate-100 transition shrink-0 ml-4"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Body: desktop 2 cột (nội dung + thao tác), mobile 1 cột */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          <div className="flex-1 min-w-0 p-6 overflow-y-auto lg:overflow-visible space-y-5">
            {children}
          </div>
          {actions && (
            <div className="shrink-0 lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-100 p-6 bg-slate-50/60 space-y-3 overflow-y-auto">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
