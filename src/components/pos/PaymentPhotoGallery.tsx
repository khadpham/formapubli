'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Search, Share2, Trash2, X } from 'lucide-react';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import {
  deletePaymentProofPhoto,
  isPhotoInScope,
  listPaymentProofPhotos,
  type PaymentProofPhoto,
  type PaymentProofScope,
} from '@/lib/offline-db';

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
  /** Bản sao object URL hiện tại để thu hồi được kể cả trong effect dọn dẹp. */
  const previewUrlsRef = useRef<Record<string, string>>({});
  previewUrlsRef.current = previewUrls;

  /** Phạm vi xem hiện tại: lọc ở nguồn (offline-db) và dùng lại để chặn thao tác. */
  const scope = useMemo<PaymentProofScope>(
    () => ({ warehouseId, cashierId, includeAllCashiers: canViewAllCashiers }),
    [warehouseId, cashierId, canViewAllCashiers]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    try {
      setPhotos(await listPaymentProofPhotos(scope));
      setErrorMessage(null);
    } catch {
      setErrorMessage('Không đọc được thư viện ảnh trên máy này.');
    }
  }, [scope]);

  const revokePreviews = useCallback((urls: Record<string, string>) => {
    Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  /** Xoá sạch ảnh + object URL của phạm vi cũ, trước khi tải phạm vi mới. */
  const resetGallery = useCallback(() => {
    revokePreviews(previewUrlsRef.current);
    setPhotos([]);
    setPreviewUrls({});
    setExpandedId(null);
    setErrorMessage(null);
  }, [revokePreviews]);

  // Mở modal, đổi kho, đổi thu ngân hay đổi vai trò: luôn dọn phạm vi cũ TRƯỚC
  // khi tải, để không ai kịp xem / chia sẻ / xoá ảnh ngoài phạm vi mới.
  useEffect(() => {
    if (!isOpen) {
      resetGallery();
      return;
    }
    resetGallery();
    load();
  }, [isOpen, load, resetGallery]);

  // Thu hồi object URL khi component unmount (đóng modal giữ nguyên ảnh đang xem).
  useEffect(() => () => {
    revokePreviews(previewUrlsRef.current);
  }, [revokePreviews]);

  const modalRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, onClose);
  if (!isOpen || !mounted) return null;

  const visible = photos
    .filter((photo) => isPhotoInScope(photo, scope))
    .filter((photo) => photo.orderCode.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  const thumbOf = (photo: PaymentProofPhoto) => {
    if (!previewUrls[photo.id]) {
      setPreviewUrls((current) => ({ ...current, [photo.id]: URL.createObjectURL(photo.blob) }));
    }
    return previewUrls[photo.id];
  };

  const sharePhoto = async (photo: PaymentProofPhoto) => {
    if (!isPhotoInScope(photo, scope)) return;
    const file = new File([photo.blob], `payment-${photo.orderCode}-${photo.capturedAt}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Thanh toán ${photo.orderCode}` });
      return;
    }
    // Revoke phải trễ: Safari/Firefox huỷ download nếu URL bị thu hồi ngay
    // sau click() trước khi trình duyệt đọc blob.
    const url = URL.createObjectURL(photo.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const removePhoto = async (photo: PaymentProofPhoto) => {
    if (!isPhotoInScope(photo, scope)) return;
    if (photo.syncState === 'NEEDS_RECONCILIATION') return;
    if (!window.confirm(`Xóa ảnh xác nhận của đơn ${photo.orderCode}?`)) return;
    await deletePaymentProofPhoto(photo.id, scope);
    // Thu hồi object URL của ảnh vừa xoá, nếu không blob của nó vẫn bị giữ
    // trong RAM tới khi đóng modal (mỗi lần xoá là một object URL rò rỉ).
    const staleUrl = previewUrlsRef.current[photo.id];
    if (staleUrl) {
      URL.revokeObjectURL(staleUrl);
      setPreviewUrls((current) => {
        if (!(photo.id in current)) return current;
        const next = { ...current };
        delete next[photo.id];
        return next;
      });
      setExpandedId((current) => (current === photo.id ? null : current));
    }
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
