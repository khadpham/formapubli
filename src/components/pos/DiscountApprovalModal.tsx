'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  X,
  RefreshCw,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';

export interface CartItemSnapshot {
  editionId: string;
  quantity: number;
  unitPrice: number;
  // Quà TAY ("Tặng thêm"): thu ngân tự thêm, quản lý duyệt trong cùng yêu cầu
  // này. Server ép về 0đ và chỉ công nhận khi có đúng yêu cầu đã duyệt.
  unitDiscountRate?: number;
  isGiftLine?: boolean;
  isManual?: boolean;
}

interface DiscountApprovalModalProps {
  isOpen: boolean;
  currentRole: UserRole;
  orderCode: string;
  warehouseId: string;
  requestedDiscountRate: number;
  originalAmount: number;
  discountAmount?: number;
  finalAmount?: number;
  items: CartItemSnapshot[];
  /** F1: báo requestId ngay khi tạo yêu cầu để POS gọi được API CANCEL khi hủy. */
  onRequestCreated?: (requestId: string, orderCode?: string) => void;
  onApproved: (data: { requestId: string; rate: number; method: string; orderCode?: string }) => void;
  onTerminal?: (status: 'REJECTED' | 'EXPIRED', requestId: string | null) => void;
  onClose: () => void;
  onCancel?: () => void;
  cancelError?: string | null;
}

export function DiscountApprovalModal({
  isOpen,
  currentRole,
  orderCode,
  warehouseId,
  requestedDiscountRate,
  originalAmount,
  discountAmount: providedDiscountAmount,
  finalAmount: providedFinalAmount,
  items,
  onRequestCreated,
  onApproved,
  onTerminal,
  onClose,
  onCancel,
  cancelError,
}: DiscountApprovalModalProps) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'LOADING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'ERROR'>('LOADING');
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(300);
  /**
   * Mã đơn THẬT do server cấp lúc tạo yêu cầu (`data.orderCode`).
   *
   * VÌ SAO cần riêng: prop `orderCode` là mã MÁY THU NGÂN tự sinh
   * (`createOrderCode()`), chỉ dùng làm khoá tạm cho endpoint. Từ 29/09 server đã
   * không dùng mã đó nữa mà tự cấp mã 13 ký tự trong DB ⇒ hiện prop cho thu
   * ngân là MỘT MÃ KHÔNG TỒN TẠI, quản lý đọc mã khác trên phiếu. Mọi chỗ hiện
   * mã cho người phải lấy từ đây; chỉ khi server chưa trả (offline/mock cũ) mới
   * rơi về prop.
   */
  const [serverOrderCode, setServerOrderCode] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const approvalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);

  const discountAmount = providedDiscountAmount ?? Math.round(originalAmount * requestedDiscountRate);
  const finalAmount = providedFinalAmount ?? (originalAmount - discountAmount);
  const isGift = requestedDiscountRate === 1.0;

  const [mounted, setMounted] = useState(false);
  const itemsKey = JSON.stringify(items);
  const onRequestCreatedRef = useRef(onRequestCreated);
  const onApprovedRef = useRef(onApproved);
  const onTerminalRef = useRef(onTerminal);
  const onCloseRef = useRef(onClose);
  const onCancelRef = useRef(onCancel);
  const dismiss = () => {
    if (status === 'LOADING' || status === 'APPROVED') return;
    (onCancelRef.current ?? onCloseRef.current)();
  };
  const modalRef = useModalFocusTrap<HTMLDivElement>(isOpen && mounted, dismiss);

  useEffect(() => {
    onRequestCreatedRef.current = onRequestCreated;
    onApprovedRef.current = onApproved;
    onTerminalRef.current = onTerminal;
    onCloseRef.current = onClose;
    onCancelRef.current = onCancel;
  }, [onRequestCreated, onApproved, onTerminal, onClose, onCancel]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'LOADING' && status !== 'APPROVED') dismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, status, dismiss]);

  // 1. Tạo yêu cầu duyệt khi mở modal
  useEffect(() => {
     if (!isOpen) {
       requestAbortRef.current?.abort();
       requestAbortRef.current = null;
       if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (approvalTimerRef.current) clearTimeout(approvalTimerRef.current);
      return;
    }

     let isMounted = true;
     const generation = ++requestGenerationRef.current;
     setStatus('LOADING');
    setErrorMessage(null);
    setRejectedReason(null);
     // Mỗi lần mở modal là một yêu cầu MỚI, mỗi yêu cầu có mã đơn riêng do
     // server cấp ⇒ xoá mã cũ, không được hiện mã của yêu cầu trước.
     setServerOrderCode(null);
    const requestController = new AbortController();
     requestAbortRef.current = requestController;
     const requestTimeout = window.setTimeout(() => requestController.abort(), 15000);

     async function initRequest() {
      try {
        const res = await fetch('/api/pos/discount-approvals', {
          method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           signal: requestController.signal,
           body: JSON.stringify({
            orderCode,
            warehouseId,
            items,
            requestedDiscountRate,
          }),
        });
       const json = await res.json();
       if (generation !== requestGenerationRef.current) return;
       if (!res.ok || !json.success) {
          throw new Error(json.message || 'Không thể tạo yêu cầu duyệt chiết khấu');
        }

          if (isMounted && generation === requestGenerationRef.current) {
      const req = json.data;
      // Mỗi lần poll lại đọc mã từ server: đây là mã sẽ khớp với
      // `orders.order_code` lúc chốt đơn, không phải mã máy tự sinh.
      if (req.orderCode) setServerOrderCode(req.orderCode);

          setRequestId(req.id);
          onRequestCreatedRef.current?.(req.id, req.orderCode);
          setServerOrderCode(req.orderCode || null);
          setExpiresAt(req.expiresAt);
          setStatus('PENDING');

          const diffSec = Math.max(
            0,
            Math.floor((new Date(req.expiresAt).getTime() - Date.now()) / 1000)
          );
          setSecondsRemaining(diffSec);
        }
       } catch (err: any) {
         if (isMounted && generation === requestGenerationRef.current) {
           setStatus('ERROR');
           setErrorMessage(err.message || 'Lỗi kết nối máy chủ');
         }
       } finally {
         window.clearTimeout(requestTimeout);
         if (requestAbortRef.current === requestController) requestAbortRef.current = null;
       }
     }

    initRequest();

     return () => {
       isMounted = false;
       if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
       requestController.abort();
       window.clearTimeout(requestTimeout);
       if (requestAbortRef.current === requestController) requestAbortRef.current = null;
       if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (approvalTimerRef.current) clearTimeout(approvalTimerRef.current);
    };
  }, [isOpen, orderCode, warehouseId, requestedDiscountRate, itemsKey]);

  // 2. Hỏi server một lần rồi mới tin. Tách riêng vì cả ĐẾM LÙI và POLLING đều
  //    cần, và P5 (2026-09-29) chính là do chúng tách rời: đồng hồ về 0 thì
  //    client tự khai EXPIRED mà không hỏi lại, nên một yêu cầu được Quản lý
  //    duyệt đúng trong ~2.5 giây cuối bị rơi dù server đã APPROVED.
  const syncFromServer = useCallback(async () => {
    if (!requestId) return false;
    const generation = requestGenerationRef.current;
    try {
      const res = await fetch(`/api/pos/discount-approvals/${requestId}`, { cache: 'no-store' });
      if (generation !== requestGenerationRef.current) return false;
      if (!res.ok) return false;
      const json = await res.json();
      if (generation !== requestGenerationRef.current) return false;
      if (!(json.success && json.data)) return false;
      const req = json.data;

      if (req.status === 'APPROVED') {
        setStatus('APPROVED');
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (approvalTimerRef.current) clearTimeout(approvalTimerRef.current);
        approvalTimerRef.current = setTimeout(() => {
          if (generation !== requestGenerationRef.current) return;
          onApprovedRef.current({
            requestId: req.id,
            rate: req.requestedDiscountRate,
            method: req.approvalMethod || 'ONE_TOUCH',
            orderCode: req.orderCode,
          });
          onCloseRef.current();
        }, 1200);
        return true;
      }
      if (req.status === 'REJECTED' || req.status === 'SUPERSEDED' || req.status === 'CONSUMED') {
        setStatus('REJECTED');
        setRejectedReason(req.rejectedReason || (req.status === 'CONSUMED' ? 'Yêu cầu đã được sử dụng cho đơn khác.' : 'Yêu cầu đã bị thay thế.'));
        onTerminalRef.current?.('REJECTED', req.id);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        return true;
      }
      if (req.status === 'EXPIRED') {
        setStatus('EXPIRED');
        onTerminalRef.current?.('EXPIRED', req.id);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        return true;
      }
      return false;
    } catch {
      return false; // Lỗi mạng tạm thời không ngắt polling
    }
  }, [requestId]);
  const syncRef = useRef(syncFromServer);
  useEffect(() => { syncRef.current = syncFromServer; }, [syncFromServer]);

  // 3b. Đếm lùi TTL (5 phút). Về 0 thì HỎI SERVER MỘT LẦN trước khi khai
  //     EXPIRED - nếu không hỏi thì duyệt hợp lệ trong 2.5s cuối bị bỏ rơi.
  //     Hỏi lỗi/offline thì vẫn khai EXPIRED như cũ: an toàn cho thu ngân.
  useEffect(() => {
    if (!expiresAt || status !== 'PENDING') return;

    const timer = setInterval(async () => {
      const generation = requestGenerationRef.current;
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        const settled = await syncRef.current();
        // Server đã trả lời (APPROVED/REJECTED/EXPIRED) → không đụng nữa.
        if (settled) return;
        if (generation === requestGenerationRef.current) {
          setStatus('EXPIRED');
          onTerminalRef.current?.('EXPIRED', requestId);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, status, requestId]);

  // 4. Polling trạng thái mỗi 2.5s
  useEffect(() => {
     if (!requestId || status !== 'PENDING') {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
       return;
     }
    const timer = setInterval(() => { void syncRef.current(); }, 2500);
    void syncRef.current(); // hỏi ngay khi mở, không chờ 2.5s

    return () => clearInterval(timer);
  }, [requestId, status]);


  // 6. Xử lý nhập mã khẩn cấp ngoại tuyến - ĐÃ GỠ 2026-09-29.
  // Lý do: không có bảng mã nào tồn tại, service từ chối phương thức này nên mọi
  // nút gửi mã đều trả lỗi. Xoá hẳn thay vì để lại một nút luôn hỏng.

  if (!isOpen || !mounted) return null;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const timeFormatted = `${minutes}:${String(seconds).padStart(2, '0')}`;
  // Mã hiện cho thu ngân/đối chiếu: mã server trước, prop (mã máy) chỉ là
  // chốt chặn cuối cho lúc chưa có phản hồi nào - tránh hiện `undefined`.
  const displayOrderCode = serverOrderCode || orderCode;

  return createPortal(
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="discount-approval-title"
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 overflow-y-auto"
      onClick={(e) => {
         if (e.target === e.currentTarget && status !== 'LOADING' && status !== 'APPROVED') (onCancel ?? onClose)();
      }}
    >
      <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 id="discount-approval-title" className="font-extrabold text-base text-slate-900">
                {isGift ? 'Duyệt Tặng Sách 100%' : 'Duyệt Chiết Khấu Quản Lý'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Vượt trần thu ngân (&ge;20%) • Bảo mật State Machine
              </p>
            </div>
          </div>
           <button
              type="button"
              aria-label="Đóng yêu cầu duyệt"
               disabled={status === 'LOADING' || status === 'APPROVED'}
              onClick={dismiss}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thông tin đơn sách & Chiết khấu */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Mã đơn:</span>
            <span className="font-mono font-bold text-slate-800">{displayOrderCode}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Mức chiết khấu xin duyệt:</span>
            <span className="font-mono font-extrabold text-amber-600 text-sm">
              {isGift ? 'TẶNG 100%' : `${Math.round(requestedDiscountRate * 100)}%`}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200">
            <span className="text-slate-500">Tiền giảm:</span>
            <span className="font-mono font-bold text-rose-600">
              -{discountAmount.toLocaleString('vi-VN')} đ
            </span>
          </div>
          <div className="flex items-center justify-between text-xs font-bold text-slate-900">
            <span>Khách thanh toán:</span>
            <span className="font-mono text-emerald-600 text-sm">
              {finalAmount.toLocaleString('vi-VN')} đ
            </span>
          </div>
        </div>

        {cancelError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {cancelError}
          </div>
        )}

        {/* Trạng thái LOADING */}
        {status === 'LOADING' && (
          <div className="py-8 flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-xs text-slate-600 font-medium">Đang khởi tạo phiên duyệt bảo mật...</p>
          </div>
        )}

        {/* Trạng thái ERROR */}
        {status === 'ERROR' && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-2">
            <XCircle className="w-8 h-8 text-rose-500 mx-auto" />
            <p className="text-xs text-rose-700 font-semibold">{errorMessage}</p>
            <button
              onClick={dismiss}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Trạng thái REJECTED */}
        {status === 'REJECTED' && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-2 animate-in zoom-in-95">
            <XCircle className="w-10 h-10 text-rose-500 mx-auto" />
            <h4 className="font-extrabold text-sm text-rose-800">Quản lý Đã Từ Chối</h4>
            <p className="text-xs text-rose-700 font-medium">Lý do: &ldquo;{rejectedReason}&rdquo;</p>
            <button
              onClick={dismiss}
              className="mt-2 w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition"
            >
              Đã hiểu & Quay lại quầy
            </button>
          </div>
        )}

        {/* Trạng thái APPROVED */}
        {status === 'APPROVED' && (
          <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-3 animate-in zoom-in-95">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto animate-bounce" />
            <h4 className="font-extrabold text-base text-emerald-900">Chiết Khấu Đã Được Duyệt!</h4>
            <p className="text-xs text-emerald-700 font-medium">
              Áp dụng thành công mức {Math.round(requestedDiscountRate * 100)}%. Đang cập nhật giỏ hàng...
            </p>
          </div>
        )}

        {/* Trạng thái EXPIRED */}
        {status === 'EXPIRED' && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-2">
            <Clock className="w-8 h-8 text-amber-600 mx-auto" />
            <h4 className="font-bold text-sm text-amber-900">Yêu Cầu Đã Hết Hạn (5 phút)</h4>
            <p className="text-xs text-amber-700">
              Quản lý chưa kịp duyệt trước khi hết hạn. Bạn có thể gửi lại yêu cầu.
            </p>
            <button
              onClick={dismiss}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition"
            >
              Đóng & Gửi lại nếu cần
            </button>
          </div>
        )}

        {/* Trạng thái PENDING: thu ngân chỉ được chờ.
            Trước đây đây là `currentRole === 'ROLE_CASHIER' ? (chờ) : (form QR/OTP)`.
            Nhánh QR/OTP KHÔNG BAO GIỜ chạy: `status` chỉ thành PENDING sau khi POST
            thành công, mà endpoint đó chỉ nhận ROLE_CASHIER
            (api/pos/discount-approvals/route.ts:58) - nên CASHIER ⟹ đúng nhánh
            "chờ". `currentRole` lấy từ phiên đăng nhập, không có bộ chuyển vai trò
            ở client. Giao diện duyệt thật nằm ở ManagerApprovalDrawer.
            Nhánh chết đã gỡ cùng state/effect/handler của nó. */}
        {status === 'PENDING' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center text-amber-900">
              <Clock className="mx-auto h-8 w-8 text-amber-600" />
              <p className="mt-2 text-sm font-extrabold">Đang chờ Quản lý phê duyệt</p>
              <p className="mt-1 text-xs">Chỉ Quản lý hoặc Chủ quầy mới có thể duyệt yêu cầu này.</p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
