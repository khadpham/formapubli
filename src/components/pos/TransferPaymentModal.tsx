'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Clock, X } from 'lucide-react';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import type { PaymentProofPhoto } from '@/lib/offline-db';

export interface TransferPaymentSession {
  mode: 'ONLINE' | 'OFFLINE';
  orderId?: string;
  orderCode: string;
  idempotencyKey: string;
  warehouseId: string;
  amount: number;
  paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
  createdAt: string;
  expiresAt?: string;
  qrSnapshot: { dataUrl: string; payload: string; accountNo: string; content: string };
  paymentProof?: PaymentProofPhoto | null;
}

export interface TransferPaymentModalProps {
  isOpen: boolean;
  session: TransferPaymentSession | null;
  busy: boolean;
  /** Nhãn nguồn tài khoản: mạng hay cache 24h (null khi dùng mạng). */
  cacheLabel?: string | null;
  onCapture: () => void;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
}

/**
 * Modal thanh toán chuyển khoản/QR: mã đơn, số tiền, QR, đếm ngược hạn và
 * bước chụp ảnh xác nhận. Không có ảnh thì không thể xác nhận đơn.
 */
export function TransferPaymentModal({
  isOpen,
  session,
  busy,
  cacheLabel,
  onCapture,
  onConfirm,
  onCancel,
  onClose,
  errorMessage,
}: TransferPaymentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Đếm ngược thuần client, không ghi hạn lên server. `setInterval` bị throttle
  // khi tab chạy nền (điện thoại bị khoá màn hình, cashier đổi app), nên phải
  // tính lại khi tab quay lại foreground — nếu không cashier thấy đồng hồ đứng
  // ở "còn 20 phút" trên một đơn đã hết hạn từ lâu và bấm Xác nhận.
  useEffect(() => {
    if (!session?.expiresAt) return;
    const update = () => setRemainingMs(Math.max(0, new Date(session.expiresAt!).getTime() - Date.now()));
    update();
    const timer = setInterval(update, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') update();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [session?.expiresAt]);

  const modalRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted && !busy, onClose);

  if (!isOpen || !mounted || !session) return null;
  const expired = Boolean(session.expiresAt) && remainingMs === 0;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const countdown = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;


  return createPortal(
    <div className="fixed inset-0 z-[70] bg-slate-950/80 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Thanh toán chuyển khoản"
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-slate-900">Thanh toán chuyển khoản</p>
            <p className="text-[10px] text-slate-500 font-mono truncate">{session.orderCode}</p>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Số tiền</span>
            <span className="text-base font-black text-emerald-700 font-mono">
              {session.amount.toLocaleString('vi-VN')} đ
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Số tài khoản</span>
            <span className="font-mono font-bold text-slate-800">{session.qrSnapshot.accountNo}</span>
          </div>
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-slate-500 font-medium">Nội dung</span>
            <span className="font-mono font-bold text-slate-800 break-all text-right">{session.qrSnapshot.content}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Trạng thái</span>
            <span className="font-bold text-slate-700">
              {session.mode === 'ONLINE' ? 'Đã tạo đơn trên máy chủ' : 'Đơn ngoại tuyến (chờ đồng bộ)'}
            </span>
          </div>
          {session.expiresAt ? (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Còn hiệu lực
              </span>
              <span className={`font-mono font-bold ${expired ? 'text-rose-600' : 'text-emerald-600'}`}>
                {expired ? 'Đã hết hạn' : countdown}
              </span>
            </div>
          ) : null}
          {cacheLabel ? <p className="text-[10px] text-amber-600 font-medium">{cacheLabel}</p> : null}

          <div className="flex justify-center py-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session.qrSnapshot.dataUrl}
              alt="QR chuyển khoản"
              className="w-[200px] h-[200px] rounded-xl border border-slate-200 bg-white"
            />
          </div>

          {errorMessage ? <p className="text-[11px] text-rose-600 font-medium">{errorMessage}</p> : null}
          {session.paymentProof ? (
            <p className="text-[11px] text-emerald-700 font-medium">
              Đã lưu ảnh xác nhận lúc {new Date(session.paymentProof.capturedAt).toLocaleString('vi-VN')}.
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 font-medium">Cần chụp ảnh màn hình khách chuyển trước khi xác nhận.</p>
          )}

          <button
            type="button"
            onClick={onCapture}
            disabled={expired || busy}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" />
            Chụp màn hình xác nhận
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={expired || busy || !session?.paymentProof}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs transition disabled:opacity-50"
          >
            {busy ? 'Đang xử lý...' : 'Xác nhận đã nhận tiền'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition disabled:opacity-50"
            >
              Khách chuyển sau
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs transition disabled:opacity-50"
            >
              Hủy đơn
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
