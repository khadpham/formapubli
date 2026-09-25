'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X, RefreshCw } from 'lucide-react';

type NotifyItem = {
  id: string;
  kind: string;
  severity: 'info' | 'warn' | 'danger';
  title: string;
  body: string;
  at: string;
  href?: string;
};

const POLL_MS = 5000;

/**
 * Chuông thông báo thời gian thực (5s) — hai chiều:
 * thu ngân thấy trạng thái việc của mình, quản lý thấy toàn bộ việc cần xử lý.
 * Lịch sử đầy đủ xem ở "Nhật ký hoạt động" (giữ lâu, không mất khi đóng app).
 */
export function NotificationBell({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [items, setItems] = useState<NotifyItem[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<NotifyItem[]>([]);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) throw new Error('http');
      const json = await res.json();
      const list: NotifyItem[] = json?.data?.items || [];
      setItems(list);
      setError(false);
      if (firstLoad.current) {
        // Lần đầu: đánh dấu quen, không spam toast cho những việc tồn tại sẵn.
        list.forEach((i) => seenIds.current.add(i.id));
        firstLoad.current = false;
      } else {
        const fresh = list.filter((i) => !seenIds.current.has(i.id));
        if (fresh.length) {
          seenIds.current = new Set(list.map((i) => i.id));
          setToasts((prev) => [...fresh, ...prev].slice(0, 3));
        }
      }
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const needAttention = items.filter((i) => i.severity !== 'info').length;
  const unread = lastSeen ? items.filter((i) => `${i.at}` > lastSeen).length : 0;

  return (
    <>
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`fixed top-4 right-4 z-[80] w-80 max-w-[92vw] rounded-2xl border p-3 shadow-xl bg-white ${
            t.severity === 'danger'
              ? 'border-rose-300'
              : t.severity === 'warn'
              ? 'border-amber-300'
              : 'border-emerald-300'
          }`}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-extrabold text-slate-900">{t.title}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 break-words">{t.body}</p>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
              aria-label="Đóng thông báo"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setLastSeen(new Date().toISOString()); }}
          className="relative p-2 rounded-xl hover:bg-slate-100 text-slate-600"
          title={`Thông báo${error ? ' (mất kết nối)' : ''}`}
          aria-label="Thông báo"
        >
          <Bell className="w-5 h-5" />
          {needAttention > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
              {needAttention > 99 ? '99+' : needAttention}
            </span>
          )}
          {error && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500" />}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <div className="absolute right-0 top-full mt-2 z-50 w-[22rem] max-w-[94vw] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                <span className="text-xs font-extrabold text-slate-800">
                  Thông báo {items.length ? `(${items.length})` : ''}
                </span>
                <button onClick={() => void load()} className="p-1.5 rounded-lg hover:bg-white text-slate-400" title="Tải lại">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">Không có việc nào đang chờ.</p>
                ) : (
                  items.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => {
                        setOpen(false);
                        if (i.href && onNavigate) onNavigate(i.href);
                      }}
                      className="w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                            i.severity === 'danger' ? 'bg-rose-500' : i.severity === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-900 break-words">{i.title}</p>
                          <p className="text-[10px] text-slate-500 break-words">{i.body}</p>
                          {i.at && <p className="text-[9px] text-slate-300 mt-0.5">{String(i.at).replace('T', ' ').slice(0, 16)}</p>}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="px-3 py-2 text-[10px] text-slate-400 bg-slate-50">
                Cập nhật mỗi 5 giây · Lịch sử đầy đủ xem ở Cài đặt → Nhật ký hoạt động
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
