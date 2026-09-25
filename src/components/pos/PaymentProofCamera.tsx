'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, RotateCw, X } from 'lucide-react';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import { generateUUIDv7 } from '@/lib/uuidv7';
import type { PaymentProofPhoto } from '@/lib/offline-db';

export interface PaymentProofCameraProps {
  isOpen: boolean;
  orderCode: string;
  warehouseId: string;
  cashierId: string;
  amount: number;
  paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
  onClose: () => void;
  onUsePhoto: (photo: PaymentProofPhoto) => Promise<void>;
}

interface CapturedPhoto {
  blob: Blob;
  dataUrl: string;
  capturedAt: string;
}

/** Cạnh dài tối đa của ảnh chụp — giữ file nhẹ để lưu IndexedDB trên máy thu ngân. */
const MAX_CAPTURE_EDGE = 1280;
const CAPTURE_MIME = 'image/jpeg';
const CAPTURE_QUALITY = 0.8;

/**
 * Camera chụp màn hình xác nhận của khách.
 *
 * Ảnh chỉ lưu cục bộ, không upload, không đọc nội dung ảnh. Camera bị từ chối hoặc
 * thiếu thiết bị chỉ đóng modal — không bao giờ tự xác nhận đơn.
 */
export function PaymentProofCamera({
  isOpen,
  orderCode,
  warehouseId,
  cashierId,
  amount,
  paymentMethod,
  onClose,
  onUsePhoto,
}: PaymentProofCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Tăng mỗi lần mở/đóng: quyền cấp trễ về không được gắn vào phiên đã đóng. */
  const generationRef = useRef(0);

  const [mounted, setMounted] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [preview, setPreview] = useState<CapturedPhoto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const modalRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, () => {
    if (!isSaving) onClose();
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };


  useEffect(() => {
    if (!isOpen) return;
    // Mở lại modal thì bỏ preview cũ: ảnh trước thuộc phiên trước.
    setPreview(null);
    setErrorMessage(null);
    const generation = ++generationRef.current;
    let alive = true;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode }, audio: false })
      .then((stream) => {
        // Quyền cấp tới trễ sau khi modal đã đóng/đổi phiên → bỏ luôn stream.
        if (!alive || generation !== generationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopStream();
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.play?.().catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (!alive || generation !== generationRef.current) return;
        const name = (err as { name?: string })?.name;
        if (name === 'NotAllowedError' || name === 'NotFoundError') {
          // Review Focus 1: không camera / bị từ chối → đóng modal, KHÔNG gọi onUsePhoto.
          setErrorMessage(
            name === 'NotAllowedError'
              ? 'Quyền camera bị từ chối. Hãy cấp quyền trong trình duyệt rồi chụp lại, hoặc nhờ quản lý hỗ trợ.'
              : 'Không tìm thấy camera trên thiết bị này. Hãy dùng thiết bị khác hoặc thu tiền mặt.'
          );
          onClose();
          return;
        }
        setErrorMessage('Không mở được camera. Hãy thử lại hoặc dùng thiết bị khác.');
      });

    return () => {
      alive = false;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, facingMode]);


  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setErrorMessage('Camera chưa sẵn sàng, vui lòng chụp lại.');
      return;
    }
    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      setErrorMessage('Thiết bị không hỗ trợ xử lý ảnh, hãy dùng thiết bị khác.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setErrorMessage('Không tạo được ảnh, hãy chụp lại.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setPreview({ blob, dataUrl: String(reader.result || ''), capturedAt: new Date().toISOString() });
      reader.onerror = () => setErrorMessage('Không đọc được ảnh vừa chụp, hãy chụp lại.');
      reader.readAsDataURL(blob);
    }, CAPTURE_MIME, CAPTURE_QUALITY);
  };

  const usePhoto = async () => {
    if (!preview || isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onUsePhoto({
        id: `proof-${generateUUIDv7()}`,
        orderCode,
        warehouseId,
        cashierId,
        amount,
        paymentMethod,
        capturedAt: preview.capturedAt,
        blob: preview.blob,
        syncState: 'LOCAL_ONLY',
      });
      onClose();
    } catch {
      // Review Focus 2: lưu ảnh hỏng → giữ preview mở để thu ngân thử lại.
      setErrorMessage('Lưu ảnh thất bại, đơn chưa được xác nhận. Hãy thử lại.');
    } finally {
      setIsSaving(false);
    }
  };


  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-slate-950/80 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chụp màn hình xác nhận thanh toán"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-slate-900 truncate">Chụp màn hình xác nhận</p>
            <p className="text-[10px] text-slate-500 font-mono truncate">{orderCode}</p>
          </div>
          <button
            type="button"
            aria-label="Đóng camera"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {preview ? (
          <div className="p-4 space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.dataUrl} alt="Ảnh xác nhận vừa chụp" className="w-full rounded-xl border border-slate-200" />
            {errorMessage ? <p className="text-[11px] text-rose-600 font-medium">{errorMessage}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setErrorMessage(null); setPreview(null); }}
                disabled={isSaving}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition disabled:opacity-50"
              >
                Chụp lại
              </button>
              <button
                type="button"
                onClick={usePhoto}
                disabled={isSaving}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition disabled:opacity-50"
              >
                {isSaving ? 'Đang lưu ảnh...' : 'Dùng ảnh này'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="rounded-xl bg-slate-900 aspect-video flex items-center justify-center overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
            {errorMessage ? <p className="text-[11px] text-rose-600 font-medium">{errorMessage}</p> : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Đổi camera trước sau"
                onClick={() => setFacingMode((mode) => (mode === 'environment' ? 'user' : 'environment'))}
                className="p-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={capture}
                className="flex-1 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs transition flex items-center justify-center gap-2"
              >
                <Camera className="w-5 h-5" />
                Chụp màn hình
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
