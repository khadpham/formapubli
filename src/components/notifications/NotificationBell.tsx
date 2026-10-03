'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X, RefreshCw, Trash2, CheckCheck } from 'lucide-react';

export type NotifyItem = {
  id: string;
  kind: string;
  severity: 'info' | 'warn' | 'danger';
  title: string;
  body: string;
  at: string;
  href?: string;
  /** Khu vực nguồn sinh thông báo — hiển thị để biết việc này từ đâu. */
  area?: string;
};

const POLL_MS = 5000;
const MAX_BADGE = 99;
/** Set rỗng dùng chung — `items` đã lọc sẵn mục bị ẩn nên badge không cần lọc lần hai. */
const HIDDEN_NONE: Set<string> = new Set();

/** Nhãn khu vực khi server chưa gửi `area` (fallback theo `kind`). */
const AREA_BY_KIND: Record<string, string> = {
  approval: 'Duyệt chiết khấu',
  'approval-result': 'Duyệt chiết khấu',
  order: 'Đơn',
  shift: 'Ca làm',
  staff: 'Nhân sự',
  pos: 'POS',
};

/** Gộp nhiều nguồn thông báo, mới nhất trước, mỗi mục luôn có nhãn khu vực. */
export function mergeNotifyItems(...sources: NotifyItem[][]): NotifyItem[] {
  const seen = new Set<string>();
  const out: NotifyItem[] = [];
  for (const list of sources) {
    for (const raw of list || []) {
      if (!raw || seen.has(raw.id)) continue;
      seen.add(raw.id);
      out.push({ ...raw, area: raw.area || AREA_BY_KIND[raw.kind] || 'Khác' });
    }
  }
  out.sort((a, b) => `${b.at || ''}`.localeCompare(`${a.at || ''}`));
  return out;
}

/**
 * Badge chưa đọc: chỉ đếm mục mới hơn mốc đã đọc, bỏ qua mục đã ẩn, và chặn trần 99.
 * Nhờ vậy badge không bao giờ phình vô hạn khi thông báo tích tụ.
 */
export function computeUnreadBadge(items: NotifyItem[], lastSeen: string | null, hidden: Set<string>): number {
  if (!lastSeen) return 0;
  let n = 0;
  for (const i of items) {
    if (hidden.has(i.id)) continue;
    if (`${i.at || ''}` > lastSeen) n += 1;
  }
  return Math.min(n, MAX_BADGE);
}

/**
 * MỘT chuông thông báo duy nhất trong header — gộp mọi nguồn (POS + nghiệp vụ),
 * mới nhất trước, có nhãn khu vực, xóa được từng mục hoặc xóa tất cả.
 * Panel render qua portal + z-index cao nên không bị nội dung trang (POS, kho) che.
 */
export function NotificationBell({
  onNavigate,
  extraItems = [],
}: {
  onNavigate?: (tab: string) => void;
  /** Nguồn thứ hai (POS) do MasterAppShell đưa vào để gộp vào cùng chuông. */
  extraItems?: NotifyItem[];
}) {
  const [apiItems, setApiItems] = useState<NotifyItem[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<NotifyItem[]>([]);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  useEffect(() => setMounted(true), []);

  // Mục đã ẩn trong phiên này. Mục từ server đã bị lọc sẵn; mục POS là dữ liệu
  // client nên phải ẩn ở đây để "Xóa tất cả" xóa trọn vẹn mọi nguồn.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const items = useMemo(
    () => mergeNotifyItems(apiItems, extraItems).filter((i) => !hiddenIds.has(i.id)),
    [apiItems, extraItems, hiddenIds],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) throw new Error('http');
      const json = await res.json();
      const list: NotifyItem[] = json?.data?.items || [];
      setApiItems(list);
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

  /** Ẩn (xóa) thông báo: cập nhật UI ngay + ghi server để không quay lại sau khi tải lại. */
  const dismiss = useCallback(async (action: 'dismiss' | 'clear', itemIds: string[]) => {
    const ids = itemIds.filter(Boolean);
    if (ids.length === 0) return;
    setHiddenIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    if (action === 'clear') setLastSeen(new Date().toISOString());
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, itemIds: ids }),
      });
    } catch {
      // Mất mạng: vẫn ẩn trên máy này, server sẽ đồng bộ lại ở lần tải kế tiếp.
    }
  }, []);

  const dismissItem = useCallback((id: string) => void dismiss('dismiss', [id]), [dismiss]);
  const clearAll = useCallback(() => void dismiss('clear', items.map((i) => i.id)), [dismiss, items]);
  const markAllRead = useCallback(() => setLastSeen(new Date().toISOString()), []);

  // items đã loại mục ẩn rồi; badge chỉ cần mốc đã đọc + trần 99.
  const badge = computeUnreadBadge(items, lastSeen, HIDDEN_NONE);

  return (
    <>
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`fixed top-4 right-4 z-[110] w-80 max-w-[92vw] rounded-2xl border p-3 shadow-xl bg-white ${
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

      <button
        type="button"
        onClick={() => { setOpen((v) => !v); markAllRead(); }}
        className="relative p-2 rounded-xl hover:bg-slate-100 text-slate-600"
        title={`Thông báo${error ? ' (mất kết nối)' : ''}`}
        aria-label="Thông báo"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className="w-5 h-5" />
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
            {badge > MAX_BADGE ? '99+' : badge}
          </span>
        )}
        {error && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500" />}
      </button>

      {/* Panel render qua createPortal: thoát khỏi stacking context của header
          (header z-30 có backdrop-blur) nên không bị ảnh POS / bảng kho (z-[70]) che. */}
      {open && mounted && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Danh sách thông báo"
            className="fixed z-[105] left-3 right-3 top-[4.5rem] sm:left-auto sm:right-6 sm:w-[22rem] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-7rem)] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
              <span className="text-xs font-extrabold text-slate-800 flex-1 min-w-0 truncate">
                Thông báo{items.length ? ` (${items.length})` : ''}
              </span>
              <button
                onClick={markAllRead}
                disabled={items.length === 0}
                title="Đánh dấu đã đọc"
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span className="sr-only">Đánh dấu đã đọc</span>
              </button>
              <button
                onClick={clearAll}
                disabled={items.length === 0}
                title="Xóa tất cả"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-600 text-[11px] font-bold hover:bg-rose-50 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa tất cả
              </button>
              <button
                onClick={() => void load()}
                title="Tải lại"
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-100"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400">Bạn chưa có thông báo nào</p>
              ) : (
                items.map((i) => (
                  <div key={i.id} className="flex items-start border-b border-slate-50 hover:bg-slate-50">
                    <button
                      onClick={() => {
                        setOpen(false);
                        if (i.href && onNavigate) onNavigate(i.href);
                      }}
                      className="flex-1 min-w-0 text-left px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                            i.severity === 'danger' ? 'bg-rose-500' : i.severity === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold text-indigo-600 break-words">{i.area}</p>
                          <p className="text-[11px] font-bold text-slate-900 break-words">{i.title}</p>
                          <p className="text-[10px] text-slate-500 break-words">{i.body}</p>
                          {i.at && <p className="text-[9px] text-slate-300 mt-0.5">{String(i.at).replace('T', ' ').slice(0, 16)}</p>}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => dismissItem(i.id)}
                      title="Ẩn thông báo này"
                      className="m-2 p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span className="sr-only">Ẩn thông báo này: {i.title}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="px-3 py-2 text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100">
              Cập nhật mỗi 5 giây · Lịch sử đầy đủ xem ở Cài đặt → Nhật ký hoạt động
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
