'use client';

import React, { useEffect, useState } from 'react';
import { Download, CheckCircle, X } from 'lucide-react';

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // 1. Đăng ký Service Worker. Nếu gắn listener 'load' trong useEffect mà sự
    // kiện load đã xảy ra trước đó (phần lớn lần tải sau) thì listener không
    // bao giờ chạy → SW không bao giờ cài → bản cũ của SW kéo dài mãi.
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
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

    // 2. Bắt sự kiện cài đặt PWA (beforeinstallprompt)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 3. Lắng nghe khi app đã được cài đặt thành công
    const handleAppInstalled = () => {
      setIsInstalled(true);
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

  if (!showBanner || !installPrompt) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-2xl shadow-2xl border border-indigo-500/30 flex items-center justify-between gap-3 animate-slide-up">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/30">
          <Download className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h4 className="text-xs font-bold text-white truncate">Cài Đặt formapubli OS</h4>
          <p className="text-[11px] text-slate-300 truncate">Mở app toàn màn hình & chạy mượt mà</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={handleInstallClick}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow transition-all"
        >
          Cài đặt
        </button>
        <button
          onClick={() => setShowBanner(false)}
          className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          title="Đóng"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
