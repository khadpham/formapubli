'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Clock, X } from 'lucide-react';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import { generateUUIDv7 } from '@/lib/uuidv7';
import type { PaymentProofPhoto } from '@/lib/offline-db';

/** Cạnh dài tối đa của ảnh chụp — giữ file nhẹ để lưu IndexedDB trên máy thu ngân. */
const MAX_CAPTURE_EDGE = 1280;
const CAPTURE_MIME = 'image/jpeg';
const CAPTURE_QUALITY = 0.8;

const normalizeCapture = async (file: File): Promise<Blob> => {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không tạo được canvas xử lý ảnh');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, CAPTURE_MIME, CAPTURE_QUALITY)
    );
    if (!blob) throw new Error('Không xuất được ảnh JPEG');
    return blob;
  } finally {
    bitmap.close();
  }
};

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
  cashierId: string;
  onUsePhoto: (photo: PaymentProofPhoto) => Promise<void>;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
}

/**
 * Modal thanh toán chuyển khoản/QR: mã đơn, số tiền, QR, đếm ngược hạn và
 * bước chụp ảnh xác nhận. Camera là app Camera native của máy (file input
 * `capture`), không phải ô cửa sổ nhỏ trong web. Không có ảnh thì không
 * thể xác nhận đơn.
 */
export function TransferPaymentModal({
  isOpen,
  session,
  busy,
  cacheLabel,
  cashierId,
  onUsePhoto,
  onConfirm,
  onCancel,
  onClose,
  errorMessage,
}: TransferPaymentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Chặn hai lần lưu trong cùng tick: state bất đồng bộ chưa kịp set. */
  const savingRef = useRef(false);

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

  const handlePickPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !session || savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setCaptureError(null);
    try {
      await onUsePhoto({
        id: `proof-${generateUUIDv7()}`,
        orderCode: session.orderCode,
        warehouseId: session.warehouseId,
        cashierId,
        amount: session.amount,
        paymentMethod: session.paymentMethod,
        capturedAt: new Date().toISOString(),
        blob: await normalizeCapture(file),
        syncState: 'LOCAL_ONLY',
      });
    } catch {
      setCaptureError('Lưu ảnh thất bại, đơn chưa được xác nhận. Hãy chụp lại.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  if (!isOpen || !mounted || !session) return null;
  const expired = Boolean(session.expiresAt) && remainingMs === 0;
  const shownError = captureError || errorMessage;
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

          {shownError ? <p className="text-[11px] text-rose-600 font-medium">{shownError}</p> : null}
          {session.paymentProof ? (
            <p className="text-[11px] text-emerald-700 font-medium">
              Đã lưu ảnh xác nhận lúc {new Date(session.paymentProof.capturedAt).toLocaleString('vi-VN')}.
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 font-medium">Cần chụp ảnh màn hình khách chuyển trước khi xác nhận.</p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handlePickPhoto}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={expired || busy || isSaving}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" />
            {isSaving ? 'Đang lưu ảnh...' : 'Chụp ảnh receipt'}
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
