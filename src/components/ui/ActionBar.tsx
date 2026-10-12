'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export interface ActionItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'gold' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  disabled?: boolean;
  /** Độ ưu tiên cao = luôn hiện, thấp = vào dropdown trước khi hết chỗ */
  priority?: number;
}

interface ActionBarProps {
  actions: ActionItem[];
  className?: string;
  /** Số nút tối đa hiện trực tiếp (mặc định tự đo theo chiều rộng) */
  maxVisible?: number;
}

/**
 * ActionBar thông minh: tự động gom nút tràn vào dropdown "Thêm".
 *
 * Giải quyết triệt để vấn đề "lẻ tẻ 1-2 nút ở dòng dưới":
 * - Đo chiều rộng thực tế của thanh
 * - Chỉ hiện số nút vừa vặn, còn lại vào menu dropdown
 * - Không bao giờ có nút trơ trọi một mình ở dòng 2
 * - Ưu tiên: nút quan trọng (priority cao) luôn hiện
 */
export default function ActionBar({ actions, className, maxVisible }: ActionBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(actions.length);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sắp xếp theo priority (cao trước)
  const sorted = [...actions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const measure = useCallback(() => {
    if (maxVisible !== undefined) {
      setVisibleCount(Math.min(maxVisible, sorted.length));
      return;
    }
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const containerWidth = container.clientWidth;
    const buttons = measure.children;
    // Trừ chỗ cho nút "Thêm" (khoảng 48px) nếu cần dropdown
    const moreBtnWidth = 48;
    let used = 0;
    let count = 0;

    for (let i = 0; i < buttons.length; i++) {
      const w = (buttons[i] as HTMLElement).offsetWidth + 8; // + gap
      const needMore = i < buttons.length - 1; // còn nút phía sau?
      if (used + w + (needMore ? moreBtnWidth : 0) <= containerWidth) {
        used += w;
        count++;
      } else {
        break;
      }
    }

    // Đảm bảo ít nhất 1 nút hiện (không để trống trơn)
    // Nếu chỉ vừa đúng 1 nút + dropdown thì hiện 1 nút đó
    setVisibleCount(Math.max(1, count));
  }, [sorted.length, maxVisible]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const visible = sorted.slice(0, visibleCount);
  const hidden = sorted.slice(visibleCount);

  return (
    <div ref={containerRef} className={cn('flex items-center gap-2', className)}>
      {/* Vùng đo kích thước (ẩn) */}
      <div ref={measureRef} className="absolute invisible flex gap-2 pointer-events-none" aria-hidden>
        {sorted.map((a) => (
          <Button key={a.key} variant={a.variant || 'default'} size="sm" className="btn-nowrap">
            {a.icon}
            {a.label}
          </Button>
        ))}
      </div>

      {visible.map((a) => (
        <Button
          key={a.key}
          variant={a.variant || 'default'}
          size="sm"
          onClick={a.onClick}
          disabled={a.disabled}
          className="btn-nowrap"
        >
          {a.icon}
          {a.label}
        </Button>
      ))}

      {hidden.length > 0 && (
        <div ref={dropdownRef} className="relative shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-label={`Thêm ${hidden.length} thao tác`}
            className="btn-nowrap"
          >
            <MoreHorizontal className="w-4 h-4" />
            <span className="text-xs font-bold bg-slate-100 rounded-full px-1.5">
              {hidden.length}
            </span>
          </Button>
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl border border-slate-200 shadow-xl z-50 py-1.5 animate-slide-up">
              {hidden.map((a) => (
                <button
                  key={a.key}
                  onClick={() => {
                    setDropdownOpen(false);
                    a.onClick();
                  }}
                  disabled={a.disabled}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 text-left"
                >
                  {a.icon && <span className="text-slate-400">{a.icon}</span>}
                  <span className="truncate">{a.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
