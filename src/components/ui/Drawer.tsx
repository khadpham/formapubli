'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Chiều rộng drawer: sm=384px, md=480px, lg=640px */
  size?: 'sm' | 'md' | 'lg';
  hideClose?: boolean;
}

const WIDTH_CLASS = {
  sm: 'w-full sm:w-[384px]',
  md: 'w-full sm:w-[480px]',
  lg: 'w-full sm:w-[640px]',
};

/**
 * Drawer wrapper dùng chung - panel trượt từ phải sang.
 * Thống nhất: backdrop, z-index, bo góc, nút đóng, animation.
 */
export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = 'md',
  hideClose = false,
}: DrawerProps) {
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
      className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        className={`${WIDTH_CLASS[size]} h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || !hideClose) && (
          <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4 shrink-0">
            <div className="min-w-0">
              {title && <h3 className="text-lg font-black text-slate-900 truncate">{title}</h3>}
              {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0 ml-4"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          {children}
        </div>
      </div>
    </div>
  );
}
