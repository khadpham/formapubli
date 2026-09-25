'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Search, Share2, Trash2, X } from 'lucide-react';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import { deletePaymentProofPhoto, listPaymentProofPhotos, type PaymentProofPhoto } from '@/lib/offline-db';

export interface PaymentPhotoGalleryProps {
  isOpen: boolean;
  warehouseId: string;
  cashierId: string;
  canViewAllCashiers: boolean;
  onClose: () => void;
}

/**
 * Thư viện ảnh xác nhận thanh toán trên máy thu ngân.
 * Ảnh chỉ lưu cục bộ: chia sẻ qua Web Share hoặc tải xuống, không upload.
 */
export function PaymentPhotoGallery({
  isOpen,
  warehouseId,
  cashierId,
  canViewAllCashiers,
  onClose,
}: PaymentPhotoGalleryProps) {
  const [mounted, setMounted] = useState(false);
  const [photos, setPhotos] = useState<PaymentProofPhoto[]>([]);
  const [query, setQuery] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    try {
      setPhotos(
        await listPaymentProofPhotos({ warehouseId, cashierId, includeAllCashiers: canViewAllCashiers })
      );
      setErrorMessage(null);
    } catch {
      setErrorMessage('Không đọc được thư viện ảnh trên máy này.');
    }
  }, [warehouseId, cashierId, canViewAllCashiers]);

  useEffect(() => {
    if (!isOpen) return;
    load();
  }, [isOpen, load]);

  // Object URL cần thu hồi khi modal đóng để không rò bộ nhớ.
  useEffect(() => {
    if (isOpen) return;
    setPreviewUrls({});
    setExpandedId(null);
  }, [isOpen]);

  useEffect(() => () => {
    Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
  }, [previewUrls]);

  const modalRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, onClose);
  if (!isOpen || !mounted) return null;

  const visible = photos
    .filter((photo) => photo.orderCode.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  const thumbOf = (photo: PaymentProofPhoto) => {
    if (!previewUrls[photo.id]) {
      setPreviewUrls((current) => ({ ...current, [photo.id]: URL.createObjectURL(photo.blob) }));
    }
    return previewUrls[photo.id];
  };

  const sharePhoto = async (photo: PaymentProofPhoto) => {
    const file = new File([photo.blob], `payment-${photo.orderCode}-${photo.capturedAt}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Thanh toán ${photo.orderCode}` });
      return;
    }
    const url = URL.createObjectURL(photo.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const removePhoto = async (photo: PaymentProofPhoto) => {
    if (photo.syncState === 'NEEDS_RECONCILIATION') return;
    if (!window.confirm(`Xóa ảnh xác nhận của đơn ${photo.orderCode}?`)) return;
    await deletePaymentProofPhoto(photo.id);
    await load();
  };


  return createPortal(
    <div className="fixed inset-0 z-[75] bg-slate-950/80 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ảnh thanh toán"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-extrabold text-slate-900">Ảnh thanh toán ({photos.length})</p>
          <button
            type="button"
            aria-label="Đóng thư viện ảnh"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b border-slate-100">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo mã đơn"
              aria-label="Tìm ảnh theo mã đơn"
              className="flex-1 bg-transparent text-xs font-medium outline-none"
            />
          </div>
          {errorMessage ? <p className="mt-2 text-[11px] text-rose-600 font-medium">{errorMessage}</p> : null}
        </div>

        <div className="p-3 space-y-2 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="text-[11px] text-slate-500 text-center py-6">Chưa có ảnh xác nhận nào.</p>
          ) : (
            visible.map((photo) => (
              <div key={photo.id} className="flex items-center gap-3 p-2 rounded-xl border border-slate-200">
                <button
                  type="button"
                  aria-label={`Xem ảnh đơn ${photo.orderCode}`}
                  onClick={() => setExpandedId((current) => (current === photo.id ? null : photo.id))}
                  className="w-14 h-14 rounded-lg overflow-hidden bg-slate-100 shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbOf(photo)} alt="" className="w-full h-full object-cover" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-mono font-bold text-slate-800 truncate">{photo.orderCode}</p>
                  <p className="text-[10px] text-slate-500">{new Date(photo.capturedAt).toLocaleString('vi-VN')}</p>
                  {photo.syncState === 'NEEDS_RECONCILIATION' ? (
                    <p className="text-[10px] text-amber-600 font-bold">Cần đối soát — không tự xóa</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label="Chia sẻ ảnh"
                    onClick={() => { sharePhoto(photo); }}
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Tải ảnh xuống"
                    onClick={() => { sharePhoto(photo); }}
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  {photo.syncState === 'NEEDS_RECONCILIATION' ? null : (
                    <button
                      type="button"
                      aria-label="Xóa ảnh"
                      onClick={() => { removePhoto(photo); }}
                      className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {expandedId ? (
          <div className="p-3 border-t border-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrls[expandedId] || ''}
              alt="Ảnh xác nhận đầy đủ"
              className="w-full rounded-xl border border-slate-200"
            />
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
