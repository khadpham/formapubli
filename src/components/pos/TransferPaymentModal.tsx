'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Clock, Eye, X } from 'lucide-react';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';
import { createPhotoWriteGate } from '@/lib/photo-write-gate';
import { generateUUIDv7 } from '@/lib/uuidv7';
import type { PaymentProofPhoto } from '@/lib/offline-db';

/** Cạnh dài tối đa của ảnh chụp — giữ file nhẹ để lưu IndexedDB trên máy thu ngân. */
const MAX_CAPTURE_EDGE = 1280;
const CAPTURE_MIME = 'image/jpeg';
const CAPTURE_QUALITY = 0.8;

/**
 * Ảnh mà máy này không xử lý được (thiếu createImageBitmap, sai địa dạng).
 * Thử chụp lại cũng không được nên thông báo phải khác lỗi lưu tạm thời.
 */
export class CaptureError extends Error {}

/** Trần chờ lưu ảnh: IndexedDB kẹt (iOS dồn bộ nhớ, ITP) thì modal phải tự thoát. */
export const CAPTURE_SAVE_TIMEOUT_MS = 20_000;

export const normalizeCapture = async (file: File): Promise<Blob> => {
  if (!file.type.startsWith('image/')) {
    throw new CaptureError('Máy không đọc được ảnh này. Chụp bằng Camera, hoặc đổi ảnh sang JPG rồi thử lại.');
  }
  // Safari 15+ mới có createImageBitmap. Máy cũ không giải mã được thì giữ nguyên
  // file gốc (ảnh camera native vẫn lưu, xem lại và đối soát được) thay vì chết.
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC từ thư viện ảnh: không giải mã được thì vẫn lưu file gốc.
    return file;
  }
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

/**
 * Bộ thông tin chuyển khoản ĐÓNG BĂNG của đơn.
 *
 * Một nguồn duy nhất cho modal: số tài khoản, nội dung và ảnh QR đều đọc từ
 * đây, nên chúng không thể mâu thuẫn nhau. `orderQuantity` là số lượng CHÍNH
 * THỨC của đơn (server trả về lúc tạo) — {SL} trên QR dựng từ số này, không
 * phải từ giỏ hàng.
 */
export interface TransferQrSnapshot {
  dataUrl: string;
  payload: string;
  accountNo: string;
  content: string;
  orderQuantity?: number;
}

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
  qrSnapshot: TransferQrSnapshot;
  paymentProof?: PaymentProofPhoto | null;
  /**
   * Danh sách mặc hàng ĐÃ ĐÓNG BĂNG kèm phiên.
   *
   * Phiếu thu in ra từ `completedOrder`, mà `finalAmount`/`totalQuantity` lấy từ
   * phiên này nhưng `items`/`subtotal`/`discountAmount` lại lấy từ GIỎ ĐANG SỐNG.
   * Nên sau khi F5 giữa chừng lúc chờ chuyển khoản, giỏ là rỗng trong khi phiên
   * còn nguyên ⇒ phiếu in TỔNG TIỀN đúng nhưng bảng dòng sách rỗng và mất dòng
   * "Tạm tính". Đóng băng danh sách vào chính phiên thì phiếu luôn khớp với đơn
   * đã tạo, dù thu ngân có sửa giỏ sau đó hay không.
   *
   * Tuỳ chọn vì phiên cũ lưu trong cache từ trước khi có trường này.
   */
  items?: Array<{ editionId: string; code: string; title: string; quantity: number; price: number }>;
  subtotal?: number;
  discountAmount?: number;
}

export interface TransferPaymentModalProps {
  isOpen: boolean;
  session: TransferPaymentSession | null;
  busy: boolean;
  /** Nhãn nguồn tài khoản: mạng hay cache 24h (null khi dùng mạng). */
  cacheLabel?: string | null;
  /**
   * VietQrPay chưa tải xong danh sách tài khoản. Phải phân biệt với "không có
   * tài khoản" (nguồn NONE) — nếu không, mọi đơn chuyển khoản bình thường đều báo
   * "chưa có tài khoản nhận" trong lúc tài khoản đang tải.
   */
  bankInfoLoading?: boolean;
  cashierId: string;
  /** Ô Ghi chú dùng chung state với panel quầy — không phải state riêng. */
  note: string;
  setNote: (value: string) => void;
  onUsePhoto: (photo: PaymentProofPhoto) => Promise<void>;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
  errorMessage: string | null;
}

/**
 * Bước XÁC NHẬN của luồng chuyển khoản/QR: mã đơn, số tiền, tài khoản, nội
 * dung và QR — tất cả đọc từ MỘT bộ thông tin đã đóng băng của đơn, nên không
 * thể lệch nhau. Camera đã mở ngay từ nút ở quầy; ảnh chụp trước khi modal này
 * hiện, nút ở đây chỉ để chụp lại. Đơn PENDING đang giữ ATP nên chỉ có hai lối
 * thoát: Xác nhận hoặc Huỷ đơn (kể cả ESC và nút X).
 */
export function TransferPaymentModal({
  isOpen,
  session,
  busy,
  cacheLabel,
  bankInfoLoading = false,
  cashierId,
  note,
  setNote,
  onUsePhoto,
  onConfirm,
  onCancel,
  errorMessage,
}: TransferPaymentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  /** Bật xem lại ảnh đã lưu: cashier phải tự thấy được mình vừa chụp gì. */
  const [isProofVisible, setIsProofVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Chặn hai lần lưu trong cùng tick: state bất đồng bộ chưa kịp set. */
  const savingRef = useRef(false);
  /** Cổng thứ tự ghi ảnh: lần ghi kẹt không được đè ảnh của lần ghi mới hơn. */
  const writeGateRef = useRef(createPhotoWriteGate());

  useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * Object URL của ảnh đã lưu. Thu hồi mỗi khi blob đổi (chụp lại) và khi
   * unmount — không thì mỗi lần bấm "Xem ảnh" rò một URL trong RAM.
   */
  const proofBlob = session?.paymentProof?.blob ?? null;
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!proofBlob) {
      setProofUrl(null);
      return;
    }
    const url = URL.createObjectURL(proofBlob);
    setProofUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofBlob]);

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

  // ESC / focus trap: KHÔNG có đường đóng tạm. Đơn PENDING đang giữ ATP nên
  // chỉ có hai lối thoát hợp lệ — Xác nhận hoặc Huỷ đơn. ESC = Huỷ đơn.
  const modalRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted && !busy, onCancel);

  const handlePickPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !session || savingRef.current) return;
    // Mỗi lần chụp là một thế hệ: lần chụp sau làm lần đang chạy mất hiệu lực.
    const gen = writeGateRef.current.begin();
    savingRef.current = true;
    setIsSaving(true);
    setCaptureError(null);
    // Chốn treo: nếu ghi xuống IndexedDB kẹt (iOS dồn bộ nhớ, ITP), modal không
    // được đứng "Đang lưu ảnh..." mãi. Mở khoá + báo lỗi; lần ghi vẫn chạy nền
    // và nếu nó xong sau đó thì ảnh vẫn được gắn vào phiên như bình thường.
    // NHƯNG nếu cashier đã chụp lại (thế hệ mới) thì lần cũ chỉ được bỏ, tuyệt
    // đối không ghi đè ảnh mới — xem createPhotoWriteGate.
    const watchdog = setTimeout(() => {
      if (!writeGateRef.current.isCurrent(gen)) return;
      savingRef.current = false;
      setIsSaving(false);
      setCaptureError('Lưu ảnh quá lâu. Đơn chưa được xác nhận. Hãy thử lại.');
    }, CAPTURE_SAVE_TIMEOUT_MS);
    try {
      await writeGateRef.current.run(gen, async () => {
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
      });
    } catch (err) {
      // Lần đã bị thay thế: im lặng, lần mới đang lo UI.
      if (!writeGateRef.current.isCurrent(gen)) return;
      if (err instanceof CaptureError) setCaptureError(err.message);
      else setCaptureError('Lưu ảnh thất bại, đơn chưa được xác nhận. Hãy thử lại.');
    } finally {
      clearTimeout(watchdog);
      if (writeGateRef.current.isCurrent(gen)) {
        savingRef.current = false;
        setIsSaving(false);
      }
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
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-slate-900">Thanh toán chuyển khoản</p>
            <p className="text-[10px] text-slate-500 font-mono truncate">{session.orderCode}</p>
          </div>
          <button
            type="button"
            aria-label="Huỷ đơn, trả lại tồn kho"
            title="Huỷ đơn — trả lại tồn kho đang giữ chỗ"
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 30/09: thân modal CUỘN ĐƯỢC. Trước đây khối này cao tự do nên ảnh xác
            nhận dài làm nội dung tràn ra ngoài, nút "Xác nhận đã nhận tiền" ở
            dưới bị đẩy khỏi màn hình mà KHÔNG kéo xuống được ⇒ buộc phải ẩn ảnh
            mới bấm được. Nay vùng giữa cuộn, nút Xác nhận luôn ở đáy. */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0 overscroll-contain">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Số tiền</span>
            <span className="text-base font-black text-emerald-700 font-mono">
              {session.amount.toLocaleString('vi-VN')} đ
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Số tài khoản</span>
            <span className="font-mono font-bold text-slate-800">
              {session.qrSnapshot.accountNo ||
                (bankInfoLoading ? 'Đang tải...' : 'Chưa có tài khoản nhận')}
            </span>
          </div>
          {typeof session.qrSnapshot.orderQuantity === 'number' ? (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Số lượng đơn</span>
              <span className="font-mono font-bold text-slate-800">
                {session.qrSnapshot.orderQuantity.toLocaleString('vi-VN')} cuốn
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-slate-500 font-medium">Nội dung</span>
            <span className="font-mono font-bold text-slate-800 break-all text-right">
              {session.qrSnapshot.content || 'Chưa có nội dung chuyển khoản'}
            </span>
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

          {/* 30/09: BỎ MÃ QR Ở MÀN NÀY. Khách đã quét QR và chuyển khoản ở bước
              trước rồi; tới đây chỉ còn đối chiếu ẢNH CHỤP XÁC NHẬN. Hiện lại QR
              chỉ làm màn hình dài ra, đẩy nút Xác nhận ra khỏi tầm nhìn. */}
          {shownError ? <p className="text-[11px] text-rose-600 font-medium">{shownError}</p> : null}
          <p className="text-[11px] font-bold text-slate-700">Chụp ảnh xác nhận</p>
          {session.paymentProof ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsProofVisible((v) => !v)}
                  aria-expanded={isProofVisible}
                  aria-label={isProofVisible ? 'Ẩn ảnh xác nhận' : 'Xem ảnh xác nhận đã chụp'}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isProofVisible ? 'Ẩn ảnh' : 'Xem ảnh'}
                </button>
                <p className="text-[11px] text-emerald-700 font-medium">
                  Đã lưu ảnh xác nhận lúc {new Date(session.paymentProof.capturedAt).toLocaleString('vi-VN')}.
                </p>
              </div>
              {isProofVisible && proofUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={proofUrl}
                  alt="Ảnh xác nhận đã chụp"
                  className="w-full max-h-[40vh] object-contain rounded-xl border border-slate-200 bg-slate-50"
                />
              ) : null}
            </div>
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
          {/* Camera đã mở ngay từ nút ở quầy (một chạm). Nút ở đây chỉ để chụp
              lại khi ảnh bị mờ — không phải bước phải qua để tới camera. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={expired || busy || isSaving}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" />
            {isSaving ? 'Đang lưu ảnh...' : session.paymentProof ? 'Chụp lại ảnh' : 'Chụp ảnh xác nhận'}
          </button>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú đơn (không bắt buộc)…"
            aria-label="Ghi chú đơn hàng"
            className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={onConfirm}
            disabled={expired || busy || !session?.paymentProof}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs transition disabled:opacity-50"
          >
            {busy ? 'Đang xử lý...' : 'Xác nhận đã nhận tiền'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold text-xs transition disabled:opacity-50"
          >
            {busy ? 'Đang huỷ đơn...' : 'Huỷ đơn'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
