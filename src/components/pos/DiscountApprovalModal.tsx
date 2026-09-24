'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldAlert,
  QrCode,
  KeyRound,
  CheckCircle2,
  XCircle,
  Clock,
  WifiOff,
  AlertTriangle,
  X,
  RefreshCw,
} from 'lucide-react';
import { BrowserQRCodeSvgWriter } from '@zxing/library';

export interface CartItemSnapshot {
  editionId: string;
  quantity: number;
  unitPrice: number;
}

interface DiscountApprovalModalProps {
  isOpen: boolean;
  orderCode: string;
  warehouseId: string;
  requestedDiscountRate: number;
  originalAmount: number;
  items: CartItemSnapshot[];
  /** F1: báo requestId ngay khi tạo yêu cầu để POS gọi được API CANCEL khi hủy. */
  onRequestCreated?: (requestId: string) => void;
  onApproved: (data: { requestId: string; rate: number; method: string }) => void;
  onClose: () => void;
}

export function DiscountApprovalModal({
  isOpen,
  orderCode,
  warehouseId,
  requestedDiscountRate,
  originalAmount,
  items,
  onRequestCreated,
  onApproved,
  onClose,
}: DiscountApprovalModalProps) {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string>('');
  const [qrToken, setQrToken] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'LOADING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'ERROR'>('LOADING');
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(300);

  // Tab: Online (QR/ShortCode) vs Offline Emergency
  const [activeTab, setActiveTab] = useState<'ONLINE' | 'OFFLINE'>('ONLINE');
  const [managerOtpInput, setManagerOtpInput] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [emergencyCodeInput, setEmergencyCodeInput] = useState('');
  const [isSubmittingEmergency, setIsSubmittingEmergency] = useState(false);
  const [emergencyError, setEmergencyError] = useState<string | null>(null);

  const qrContainerRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const discountAmount = Math.round(originalAmount * requestedDiscountRate);
  const finalAmount = originalAmount - discountAmount;
  const isGift = requestedDiscountRate === 1.0;

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'LOADING') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, status, onClose]);

  // 1. Tạo yêu cầu duyệt khi mở modal
  useEffect(() => {
    if (!isOpen) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }

    let isMounted = true;
    setStatus('LOADING');
    setErrorMessage(null);
    setRejectedReason(null);
    setManagerOtpInput('');
    setOtpError(null);
    setEmergencyCodeInput('');
    setEmergencyError(null);

    async function initRequest() {
      try {
        const res = await fetch('/api/pos/discount-approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderCode,
            warehouseId,
            items,
            requestedDiscountRate,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || 'Không thể tạo yêu cầu duyệt chiết khấu');
        }

        if (isMounted) {
          const req = json.data;
          setRequestId(req.id);
          onRequestCreated?.(req.id);
          setShortCode(req.shortCode || orderCode.slice(-4).toUpperCase());
          setQrToken(req.qrToken || '');
          setExpiresAt(req.expiresAt);
          setStatus('PENDING');

          const diffSec = Math.max(
            0,
            Math.floor((new Date(req.expiresAt).getTime() - Date.now()) / 1000)
          );
          setSecondsRemaining(diffSec);
        }
      } catch (err: any) {
        if (isMounted) {
          setStatus('ERROR');
          setErrorMessage(err.message || 'Lỗi kết nối máy chủ');
        }
      }
    }

    initRequest();

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, orderCode, warehouseId, requestedDiscountRate, items, onRequestCreated]);

  // 2. Render mã QR bằng BrowserQRCodeSvgWriter khi có qrToken
  useEffect(() => {
    if (!qrToken || !qrContainerRef.current || activeTab !== 'ONLINE') return;
    try {
      const writer = new BrowserQRCodeSvgWriter();
      const svg = writer.write(qrToken, 160, 160);
      svg.setAttribute('class', 'w-full h-full rounded-xl');
      qrContainerRef.current.innerHTML = '';
      qrContainerRef.current.appendChild(svg);
    } catch {
      // Fallback nếu không render được SVG
      if (qrContainerRef.current) {
        qrContainerRef.current.innerHTML = `<div class="p-4 text-xs text-slate-400 text-center font-mono break-all">${qrToken.slice(0, 32)}...</div>`;
      }
    }
  }, [qrToken, activeTab]);

  // 3. Đếm lùi thời gian TTL (5 phút)
  useEffect(() => {
    if (!expiresAt || status !== 'PENDING') return;

    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        setStatus('EXPIRED');
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, status]);

  // 4. Polling trạng thái mỗi 2.5s
  useEffect(() => {
    if (!requestId || status !== 'PENDING') {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/pos/discount-approvals/${requestId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.success && json.data) {
          const req = json.data;
          if (req.status === 'APPROVED') {
            setStatus('APPROVED');
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setTimeout(() => {
              onApproved({
                requestId: req.id,
                rate: req.requestedDiscountRate,
                method: req.approvalMethod || 'ONE_TOUCH',
              });
              onClose();
            }, 1200);
          } else if (req.status === 'REJECTED') {
            setStatus('REJECTED');
            setRejectedReason(req.rejectedReason || 'Quản lý từ chối chiết khấu');
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          } else if (req.status === 'EXPIRED') {
            setStatus('EXPIRED');
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          }
        }
      } catch {
        // Lỗi mạng tạm thời không ngắt polling
      }
    }, 2500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [requestId, status, onApproved, onClose]);

  // 5. Xử lý nhập mã cấp phép / OTP từ Quản lý (Đảo chiều luồng OTP)
  const handleVerifyManagerOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!requestId) return;
    const code = managerOtpInput.trim().toUpperCase();
    if (!code) {
      setOtpError('Vui lòng nhập mã cấp phép / OTP từ Quản lý.');
      return;
    }

    setIsVerifyingOtp(true);
    setOtpError(null);
    try {
      const res = await fetch(`/api/pos/discount-approvals/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE',
          method: 'SHORTCODE_BOUND',
          shortCode: code,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Mã cấp phép không chính xác hoặc đã hết hạn.');
      }

      setStatus('APPROVED');
      setTimeout(() => {
        onApproved({
          requestId,
          rate: requestedDiscountRate,
          method: 'SHORTCODE_BOUND',
        });
        onClose();
      }, 1000);
    } catch (err: any) {
      setOtpError(err.message || 'Mã cấp phép không hợp lệ.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // 6. Xử lý nhập mã khẩn cấp (Offline Emergency)
  const handleApplyEmergencyCode = async () => {
    if (!requestId) return;
    const code = emergencyCodeInput.trim();
    if (!code) {
      setEmergencyError('Vui lòng nhập mã khẩn cấp từ Quản lý');
      return;
    }
    if (requestedDiscountRate > 0.25) {
      setEmergencyError('Mã khẩn cấp chỉ duyệt tối đa chiết khấu 25%. Mức chiết khấu này bắt buộc quản lý duyệt trực tiếp.');
      return;
    }

    setIsSubmittingEmergency(true);
    setEmergencyError(null);
    try {
      const res = await fetch(`/api/pos/discount-approvals/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE',
          method: 'OFFLINE_EMERGENCY',
          emergencyCode: code,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Mã khẩn cấp không hợp lệ');
      }
      setStatus('APPROVED');
      setTimeout(() => {
        onApproved({
          requestId,
          rate: requestedDiscountRate,
          method: 'OFFLINE_EMERGENCY',
        });
        onClose();
      }, 1000);
    } catch (err: any) {
      setEmergencyError(err.message || 'Không thể xác thực mã khẩn cấp');
    } finally {
      setIsSubmittingEmergency(false);
    }
  };

  if (!isOpen || !mounted) return null;

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const timeFormatted = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== 'LOADING') onClose();
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
              <h3 className="font-extrabold text-base text-slate-900">
                {isGift ? 'Duyệt Tặng Sách 100%' : 'Duyệt Chiết Khấu Quản Lý'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Vượt trần thu ngân (&ge;20%) • Bảo mật State Machine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thông tin đơn hàng & Chiết khấu */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Mã đơn hàng:</span>
            <span className="font-mono font-bold text-slate-800">{orderCode}</span>
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
              onClick={onClose}
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
              onClick={onClose}
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
              onClick={onClose}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition"
            >
              Đóng & Gửi lại nếu cần
            </button>
          </div>
        )}

        {/* Trạng thái PENDING: Tab Online vs Offline */}
        {status === 'PENDING' && (
          <div className="space-y-4">
            {/* Tabs chọn cách duyệt */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('ONLINE')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  activeTab === 'ONLINE'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Mã OTP / 1-Chạm (Online)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('OFFLINE')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  activeTab === 'OFFLINE'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Mã Khẩn Cấp (Offline)
              </button>
            </div>

            {/* TAB 1: ONLINE (Nhập mã Quản lý cấp / Chờ Duyệt 1-chạm) */}
            {activeTab === 'ONLINE' && (
              <div className="space-y-3.5 text-center">
                {/* Form nhập mã cấp phép từ Quản lý */}
                <form
                  onSubmit={handleVerifyManagerOtp}
                  className="bg-amber-500/10 border-2 border-amber-400/80 rounded-2xl p-3.5 text-left space-y-2.5 shadow-sm"
                >
                  <div>
                    <label className="text-xs font-black uppercase tracking-wider text-amber-900 block">
                      Nhập mã cấp phép / OTP từ Quản lý:
                    </label>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Xin mã phê duyệt từ Quản lý trực tiếp tại gian hàng hoặc qua điện thoại
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <input
                      id="pos-approval-otp-input"
                      type="text"
                      maxLength={8}
                      autoFocus
                      value={managerOtpInput}
                      onChange={(e) => {
                        setManagerOtpInput(e.target.value.toUpperCase());
                        setOtpError(null);
                      }}
                      placeholder="Mã 4 số (VD: 4821)..."
                      className="flex-1 px-3 py-2 bg-white border border-amber-300 rounded-xl font-mono text-center text-base font-black tracking-widest text-slate-900 outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <button
                      type="submit"
                      disabled={isVerifyingOtp || !managerOtpInput.trim()}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-md transition flex items-center gap-1.5 shrink-0"
                    >
                      {isVerifyingOtp ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang kiểm tra...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mở Khóa Đơn
                        </>
                      )}
                    </button>
                  </div>

                  {otpError && (
                    <div className="text-xs text-rose-600 font-bold flex items-center gap-1 pt-0.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{otpError}</span>
                    </div>
                  )}
                </form>

                {/* Hoặc chờ duyệt 1-chạm từ xa */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-slate-600 text-left">
                    <RefreshCw className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
                    <div>
                      <span className="font-bold block text-slate-800">Hoặc chờ Duyệt 1-chạm từ xa</span>
                      <span className="text-[10px] text-slate-400 block">Quản lý bấm duyệt trên máy, quầy sẽ tự động mở</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-slate-500 font-bold text-[11px] shrink-0 bg-white px-2 py-1 rounded-lg border border-slate-200">
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span>{timeFormatted}</span>
                  </div>
                </div>

                {/* Quét mã QR nếu Quản lý đứng gần quầy */}
                <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-left">
                  <div className="text-[11px] text-slate-500 pl-1">
                    <span className="font-bold text-slate-700 block">Quét QR duyệt nhanh:</span>
                    <span>Quản lý dùng camera quét mã bên cạnh</span>
                  </div>
                  <div ref={qrContainerRef} className="w-14 h-14 bg-white p-1 rounded-xl shadow-sm border border-slate-200 shrink-0 flex items-center justify-center" />
                </div>
              </div>
            )}

            {/* TAB 2: OFFLINE EMERGENCY (Mã khẩn cấp 25%) */}
            {activeTab === 'OFFLINE' && (
              <div className="p-4 bg-amber-50/70 border border-amber-200/80 rounded-2xl space-y-3">
                <div className="flex items-start gap-2 text-amber-900">
                  <WifiOff className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <p className="font-bold">Chế độ Ngoại Tuyến (Khi Mất Mạng)</p>
                    <p className="text-amber-700 text-[11px] mt-0.5">
                      Quản lý đọc 1 trong 5 mã khẩn cấp trong ngày (<span className="font-mono">EMG-...</span>).
                      Trần chiết khấu tối đa: <strong className="text-amber-900">25%</strong>.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 block">
                    Nhập mã khẩn cấp Quản lý cung cấp:
                  </label>
                  <input
                    type="text"
                    value={emergencyCodeInput}
                    onChange={(e) => {
                      setEmergencyCodeInput(e.target.value);
                      setEmergencyError(null);
                    }}
                    placeholder="Ví dụ: EMG-20260923-1"
                    className="w-full text-center font-mono font-bold text-sm px-3 py-2 bg-white border border-amber-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {emergencyError && (
                    <p className="text-[11px] text-rose-600 font-bold text-center">{emergencyError}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleApplyEmergencyCode}
                  disabled={isSubmittingEmergency}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow transition flex items-center justify-center gap-1.5"
                >
                  {isSubmittingEmergency ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang xác thực...
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-3.5 h-3.5" /> Áp Dụng Mã Khẩn Cấp
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="pt-1 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                Hủy Yêu Cầu &amp; Đóng
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
