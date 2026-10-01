'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Coins,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Clock,
  User,
  ArrowRight,
} from 'lucide-react';
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap';

export interface CashboxSessionItem {
  id: string;
  cashierId: string;
  openingCash: number;
  closingCashActual?: number | null;
  expectedCash?: number | null;
  expectedCashLive?: number | null;
  status: string;
  notes?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
}

interface CashboxAuditCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  sessions: CashboxSessionItem[];
  initialSessionId?: string | null;
}

export function CashboxAuditCountModal({
  isOpen,
  onClose,
  onSuccess,
  sessions,
  initialSessionId,
}: CashboxAuditCountModalProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [cashInput, setCashInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const containerRef = useModalFocusTrap<HTMLDivElement>(isOpen, onClose);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Xác định ca cần chọn khi mở modal hoặc thay đổi sessions/initialSessionId
  useEffect(() => {
    if (!isOpen) return;

    // Tìm ca chưa có tiền thực đếm đầu tiên, hoặc dùng initialSessionId
    const uncounted = sessions.find(
      (s) =>
        s.status === 'CLOSED' &&
        (s.closingCashActual === null || s.closingCashActual === undefined)
    );
    const targetId =
      initialSessionId && sessions.some((s) => s.id === initialSessionId)
        ? initialSessionId
        : uncounted?.id || sessions[0]?.id || '';

    setSelectedSessionId(targetId);

    const targetSession = sessions.find((s) => s.id === targetId);
    if (targetSession && targetSession.closingCashActual !== null && targetSession.closingCashActual !== undefined) {
      setCashInput(targetSession.closingCashActual.toLocaleString('vi-VN'));
    } else {
      setCashInput('');
    }
    setNotes('');
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [isOpen, initialSessionId, sessions]);

  // Cập nhật số tiền hiển thị khi đổi ca
  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setErrorMessage(null);
    setSuccessMessage(null);
    const targetSession = sessions.find((s) => s.id === sessionId);
    if (targetSession && targetSession.closingCashActual !== null && targetSession.closingCashActual !== undefined) {
      setCashInput(targetSession.closingCashActual.toLocaleString('vi-VN'));
    } else {
      setCashInput('');
    }
  };

  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  const expectedAmount =
    currentSession?.expectedCashLive ?? currentSession?.expectedCash ?? 0;
  const parsedCash = parseInt(cashInput.replace(/\D/g, ''), 10) || 0;
  const discrepancy = parsedCash - expectedAmount;
  const hasInput = cashInput.trim() !== '';

  const handleCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      setCashInput('');
      return;
    }
    const num = parseInt(raw, 10);
    setCashInput(num.toLocaleString('vi-VN'));
    setErrorMessage(null);
  };

  const handleSetExactExpected = () => {
    setCashInput(Math.max(0, expectedAmount).toLocaleString('vi-VN'));
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSession) {
      setErrorMessage('Chưa chọn ca cần bổ sung tiền thực đếm.');
      return;
    }
    if (!hasInput) {
      setErrorMessage('Vui lòng nhập số tiền thực đếm.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/cashbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'AUDIT_COUNT',
          sessionId: currentSession.id,
          closingCashActual: parsedCash,
          notes: notes.trim() || undefined,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setErrorMessage(json?.error || 'Có lỗi xảy ra khi lưu tiền thực đếm.');
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage('Đã cập nhật tiền thực đếm thành công!');
      setTimeout(() => {
        setIsSubmitting(false);
        onSuccess?.();
        onClose();
      }, 600);
    } catch (err: any) {
      setErrorMessage('Lỗi kết nối khi gửi yêu cầu cập nhật.');
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-count-modal-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        ref={containerRef}
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center justify-center shadow-sm">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="audit-count-modal-title"
                className="text-base font-extrabold text-slate-900 leading-tight"
              >
                Nhập Tiền Thực Đếm Ca Két
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Bổ sung tiền thực tế để hoàn tất đối soát két cuối ngày
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Đóng cửa sổ"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Chọn ca nếu có nhiều ca */}
          {sessions.length > 1 && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Chọn ca két cần bổ sung:
              </label>
              <select
                value={selectedSessionId}
                onChange={(e) => handleSelectSession(e.target.value)}
                disabled={isSubmitting}
                className="w-full text-xs font-medium border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {sessions.map((s) => {
                  const unrec =
                    s.status === 'CLOSED' &&
                    (s.closingCashActual === null || s.closingCashActual === undefined);
                  return (
                    <option key={s.id} value={s.id}>
                      Thu ngân: {s.cashierId} — {unrec ? '⚠️ Chưa nhập thực đếm' : 'Đã có số đếm'} (Mở: {s.openedAt?.slice(11, 16) || '—'})
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Chi tiết ca được chọn */}
          {currentSession && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5 text-xs">
              <div className="flex justify-between items-center text-slate-600">
                <span className="flex items-center gap-1.5 font-medium">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  Thu ngân phụ trách:
                </span>
                <span className="font-bold text-slate-900">{currentSession.cashierId}</span>
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span className="flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Thời gian ca:
                </span>
                <span className="font-mono text-slate-800">
                  {currentSession.openedAt ? new Date(currentSession.openedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  {' → '}
                  {currentSession.closedAt ? new Date(currentSession.closedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Đang mở'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 pt-1 border-t border-slate-200">
                <span>Tiền bàn giao đầu ca:</span>
                <span className="font-mono font-semibold text-slate-800">
                  {currentSession.openingCash.toLocaleString('vi-VN')} đ
                </span>
              </div>
              <div className="flex justify-between items-center font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>Tiền mặt kỳ vọng trong két:</span>
                <span className="font-mono text-indigo-700 text-sm">
                  {expectedAmount.toLocaleString('vi-VN')} đ
                </span>
              </div>
            </div>
          )}

          {/* Ô nhập tiền thực đếm */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="audit-closing-cash" className="text-xs font-bold text-slate-700">
                Tiền mặt thực đếm trong két (VNĐ):
              </label>
              <button
                type="button"
                onClick={handleSetExactExpected}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
              >
                Khớp kỳ vọng ({expectedAmount.toLocaleString('vi-VN')} đ)
              </button>
            </div>
            <div className="relative">
              <input
                id="audit-closing-cash"
                type="text"
                inputMode="numeric"
                value={cashInput}
                onChange={handleCashChange}
                disabled={isSubmitting}
                placeholder="Nhập số tiền thực đếm..."
                className="w-full text-base font-mono font-bold px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 pr-12"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                đ
              </span>
            </div>
          </div>

          {/* Chênh lệch thời gian thực */}
          {hasInput && (
            <div className="p-3 rounded-xl border text-xs flex justify-between items-center transition-all duration-150">
              <span className="font-bold text-slate-700">Chênh lệch két dự kiến:</span>
              {discrepancy === 0 ? (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Khớp tuyệt đối 100% (±0 đ)
                </span>
              ) : discrepancy > 0 ? (
                <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-extrabold">
                  Thừa két: +{discrepancy.toLocaleString('vi-VN')} đ
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 font-extrabold">
                  Thiếu két: {discrepancy.toLocaleString('vi-VN')} đ
                </span>
              )}
            </div>
          )}

          {/* Ghi chú */}
          <div>
            <label htmlFor="audit-notes" className="block text-xs font-bold text-slate-700 mb-1.5">
              Ghi chú đối soát (tùy chọn):
            </label>
            <input
              id="audit-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              placeholder="Ví dụ: Đếm lại vào sáng hôm sau do nhân viên quên chốt"
              className="w-full text-xs px-3.5 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !hasInput}
              className="px-5 py-2 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Xác Nhận Lưu
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
