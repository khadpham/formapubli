'use client';

import React, { useEffect, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';

/**
 * Cài PWA — 2 nhánh, vì iOS và Android về bản chất khác nhau:
 *
 * 1) Android/Desktop: Chrome/Edge bắn `beforeinstallprompt` → gọi được
 *    `prompt()` để hệ điều hành hỏi cài. Đây là cách cài ĐÚNG ĐẮN.
 *
 * 2) iOS/iPadOS: KHÔNG BAO GIỜ bắn `beforeinstallprompt` (WebKit cố ý không
 *    implement — bugs.webkit.org/show_bug.cgi?id=255716) và không có JS API nào
 *    mở được Share sheet. Đường cài DUY NHẤT là người dùng tự bấm:
 *    Chia sẻ → "Thêm vào màn hình chính". Nên ở đây ta không hiện nút "Cài đặt"
 *    giả (bấm sẽ không làm gì — đúng như tin nhắn "chạm vào mảng chữ" mà
 *    AGENTS.md cấm), mà hiện hướng dẫn đúng nhãn iOS dùng.
 */
const IOS_HINT_DISMISSED = 'pwa_ios_hint_dismissed';
const INSTALLED_FLAG = 'pwa_installed';
/** Đã được cấp quyền giữ dữ liệu cục bộ (storage.persist) — không xin lại. */
const PERSIST_GRANTED_FLAG = 'pwa_storage_persist_granted';

/** iPadOS 13+ báo UA là Macintosh — phải thêm maxTouchPoints mới nhận ra iPad. */
function detectIOS(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Đã cài rồi thì thôi hiện mọi hướng dẫn cài đặt. */
function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch {
    /* matchMedia không hỗ trợ → coi như chưa cài */
  }
  return (navigator as any).standalone === true;
}

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  // Chỉ dùng để định nghĩa text; iOS không có prompt để bấm nên không render nút.
  const [isIOSHint, setIsIOSHint] = useState(false);

  useEffect(() => {
    // 1. Đăng ký Service Worker. Nếu gắn listener 'load' trong useEffect mà sự
    // kiện load đã xảy ra trước đó (phần lớn lần tải sau) thì listener không
    // bao giờ chạy → SW không bao giờ cài → bản cũ của SW kéo dài mãi.
    if ('serviceWorker' in navigator) {
      const register = () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            registration.update().catch(() => {});
            console.log('formapubli OS: Service Worker đã kích hoạt với scope:', registration.scope);
          })
          .catch((error) => {
            console.error('formapubli OS: Lỗi đăng ký Service Worker:', error);
          });
      };
      if (document.readyState === 'complete') {
        register();
      } else {
        window.addEventListener('load', register, { once: true });
      }
    }

    // 2. XIN QUYỀN GIỮ DỮ LIỆU CỤC BỘ (ưu tiên cao — làm trước prompt cài app).
    // iOS ITP XOÁ TOÀN BỘ dữ liệu script-writable của site không dùng 7 ngày.
    // `formapubli_offline_db` chứa cả đơn offline CHƯA ĐỒNG BỘ lẫn ảnh xác nhận
    // chuyển khoản ⇒ bị xoá là mất đơn đã bán tiền thật, không có cảnh báo nào.
    // `navigator.storage.persist()` là cơ chế "bền" của Storage API. WebKit chỉ
    // cấp cho PWA đã cài từ Home Screen, nên gọi sớm ở đây (sau lần mở app đầu
    // tiên) là hợp lý — nếu bị từ chối thì thử lại ở lần mở sau.
    const requestPersistence = () => {
      if (!navigator.storage?.persist) return;
      navigator.storage
        .persist()
        .then((granted) => {
          if (granted && !localStorage.getItem(PERSIST_GRANTED_FLAG)) {
            localStorage.setItem(PERSIST_GRANTED_FLAG, '1');
            console.log('formapubli OS: Đã xin quyền giữ dữ liệu cục bộ (offline an toàn hơn).');
          }
        })
        .catch(() => {
          /* im lặng: không phải lỗi chặn nghiệp vụ */
        });
    };
    requestPersistence();
    // Thử lại khi app quay lại foreground — cơ hội cấp quyền tốt hơn sau
    // khi người dùng đã cài PWA từ Home Screen.
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !localStorage.getItem(PERSIST_GRANTED_FLAG)) {
        requestPersistence();
      }
    });

    // 3. Nhánh Android/Desktop: chờ `beforeinstallprompt`.
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      setIsIOSHint(false);
      setShowBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 3. Nhánh iOS: không có prompt nào cả → tự hiện hướng dẫn (1 lần).
    if (
      detectIOS() &&
      !isRunningStandalone() &&
      !localStorage.getItem(INSTALLED_FLAG) &&
      !localStorage.getItem(IOS_HINT_DISMISSED)
    ) {
      setIsIOSHint(true);
      setShowBanner(true);
    }

    const handleAppInstalled = () => {
      try {
        localStorage.setItem(INSTALLED_FLAG, '1');
      } catch {
        /* private mode: cứ hiện hướng dẫn, không sao */
      }
      setShowBanner(false);
      setInstallPrompt(null);
      console.log('formapubli OS: Đã cài đặt PWA thành công vào thiết bị!');
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('Người dùng đã đồng ý cài đặt formapubli OS');
      setShowBanner(false);
    }
    setInstallPrompt(null);
  };

  const handleClose = () => {
    if (isIOSHint) {
      try {
        localStorage.setItem(IOS_HINT_DISMISSED, '1');
      } catch {
        /* bỏ qua */
      }
    }
    setShowBanner(false);
  };

  if (!showBanner) return null;
  // Không có prompt (iOS) thì không được vẽ nút — nút bấm không làm gì là
  // trải nghiệm tệ nhất. Băng iOS chỉ có nút đóng.
  if (!isIOSHint && !installPrompt) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100%-2rem)] bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-2xl shadow-2xl border border-indigo-500/30 flex items-center justify-between gap-3 animate-slide-up"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/30">
          {isIOSHint ? <Share2 className="w-5 h-5 text-white" /> : <Download className="w-5 h-5 text-white" />}
        </div>
        <div className="min-w-0">
          <h4 className="text-xs font-bold text-white">
            {isIOSHint ? 'Thêm vào màn hình chính' : 'Cài Đặt formapubli OS'}
          </h4>
          {isIOSHint ? (
            <p className="text-[11px] text-slate-300 leading-snug">
              Chạm <span className="text-white font-semibold">Chia sẻ</span> (hộp mũi tên lên), rồi chọn{' '}
              <span className="text-white font-semibold">Thêm vào màn hình chính</span>.
            </p>
          ) : (
            <p className="text-[11px] text-slate-300 truncate">Mở app toàn màn hình & chạy mượt mà</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {!isIOSHint && (
          <button
            onClick={handleInstallClick}
            aria-label="Cài đặt formapubli OS lên thiết bị này"
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow transition-all"
          >
            Cài đặt
          </button>
        )}
        <button
          onClick={handleClose}
          aria-label="Đóng hướng dẫn cài đặt"
          className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          title="Đóng"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
