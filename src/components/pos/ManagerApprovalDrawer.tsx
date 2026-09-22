'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  RefreshCw,
  X,
  AlertCircle,
  Building2,
  User,
} from 'lucide-react';

interface PendingApprovalItem {
  id: string;
  orderCode: string;
  warehouseId: string;
  cashierId: string;
  shortCode: string;
  requestedDiscountRate: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface ManagerApprovalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  warehouseId?: string;
  onActionCompleted?: () => void;
}

export function ManagerApprovalDrawer({
  isOpen,
  onClose,
  warehouseId,
  onActionCompleted,
}: ManagerApprovalDrawerProps) {
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [quickShortCode, setQuickShortCode] = useState('');
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [rejectPromptId, setRejectPromptId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchPending = async () => {
    try {
      setIsLoading(true);
      const url = warehouseId
        ? `/api/pos/discount-approvals?warehouseId=${warehouseId}`
        : `/api/pos/discount-approvals`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setItems(json.data);
      }
    } catch {
      // Ignore network errors on polling
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchPending();
    const timer = setInterval(fetchPending, 4000);
    return () => clearInterval(timer);
  }, [isOpen, warehouseId]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 1-Chạm duyệt
  const handleApprove = async (id: string, shortCode?: string) => {
    try {
      setActionInProgressId(id);
      const res = await fetch(`/api/pos/discount-approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE',
          method: shortCode ? 'SHORTCODE_BOUND' : 'ONE_TOUCH',
          shortCode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Lỗi khi phê duyệt');
      }
      showToast('✅ Đã phê duyệt chiết khấu thành công!');
      fetchPending();
      if (onActionCompleted) onActionCompleted();
    } catch (err: any) {
      showToast(`❌ ${err.message || 'Không thể phê duyệt'}`);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Từ chối kèm lý do
  const handleReject = async (id: string) => {
    try {
      setActionInProgressId(id);
      const res = await fetch(`/api/pos/discount-approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'REJECT',
          rejectedReason: rejectReasonInput.trim() || 'Quản lý từ chối chiết khấu',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Lỗi khi từ chối');
      }
      showToast('🚫 Đã từ chối yêu cầu chiết khấu');
      setRejectPromptId(null);
      setRejectReasonInput('');
      fetchPending();
      if (onActionCompleted) onActionCompleted();
    } catch (err: any) {
      showToast(`❌ ${err.message || 'Không thể từ chối'}`);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Duyệt nhanh bằng ô ShortCode 4 số
  const handleQuickApproveByShortCode = () => {
    const code = quickShortCode.trim().toUpperCase();
    if (!code) return;
    const match = items.find((i) => i.shortCode === code || i.orderCode.endsWith(code));
    if (!match) {
      showToast(`⚠️ Không tìm thấy đơn nào có mã '${code}' đang chờ duyệt`);
      return;
    }
    handleApprove(match.id, code);
    setQuickShortCode('');
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-white">
                Duyệt Chiết Khấu POS (Quản Lý)
              </h3>
              <p className="text-[11px] text-slate-400">
                {items.length} yêu cầu đang chờ xử lý
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toast thông báo nhanh */}
        {toastMessage && (
          <div className="bg-amber-600 text-white text-xs font-bold px-4 py-2 text-center animate-in fade-in">
            {toastMessage}
          </div>
        )}

        {/* Ô duyệt nhanh bằng 4 số ShortCode */}
        <div className="p-4 bg-amber-500/10 border-b border-amber-200/60 space-y-2">
          <label className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">
            ⚡ Duyệt nhanh bằng đuôi 4 số (ShortCode):
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={6}
              value={quickShortCode}
              onChange={(e) => setQuickShortCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuickApproveByShortCode();
              }}
              placeholder="Gõ 4 số (ví dụ: 4821)..."
              className="flex-1 font-mono font-bold text-sm tracking-widest uppercase px-3 py-2 bg-white border border-amber-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              type="button"
              onClick={handleQuickApproveByShortCode}
              disabled={!quickShortCode.trim()}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-bold rounded-xl text-xs shadow transition shrink-0"
            >
              Duyệt Ngay
            </button>
          </div>
        </div>

        {/* Danh sách yêu cầu chờ duyệt */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && items.length === 0 && (
            <div className="py-12 text-center space-y-2 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
              <p className="text-xs">Đang nạp danh sách yêu cầu...</p>
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <div className="py-16 text-center space-y-2 text-slate-400">
              <CheckCircle2 className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-xs font-semibold text-slate-600">Hiện không có yêu cầu nào chờ duyệt</p>
              <p className="text-[11px] text-slate-400">
                Khi thu ngân xin chiết khấu &gt;20%, đơn sẽ lập tức xuất hiện tại đây.
              </p>
            </div>
          )}

          {items.map((item) => {
            const isGift = item.requestedDiscountRate === 1;
            const isBusy = actionInProgressId === item.id;
            const isRejecting = rejectPromptId === item.id;

            return (
              <div
                key={item.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-amber-400 transition space-y-3"
              >
                {/* Thông tin đơn */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-extrabold text-sm text-slate-900">
                        {item.orderCode}
                      </span>
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-mono font-bold text-xs rounded-md">
                        #{item.shortCode}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {item.warehouseId}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {item.cashierId}
                      </span>
                    </div>
                  </div>

                  <span className="px-2.5 py-1 bg-rose-50 text-rose-700 font-black text-sm rounded-xl border border-rose-200/60">
                    {isGift ? 'TẶNG 100%' : `${Math.round(item.requestedDiscountRate * 100)}%`}
                  </span>
                </div>

                {/* Tiền hàng */}
                <div className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-xl">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Giá gốc:</span>
                    <span className="font-mono text-slate-600 line-through">
                      {item.originalAmount.toLocaleString('vi-VN')} đ
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 text-[10px] block">Sau giảm:</span>
                    <span className="font-mono font-bold text-emerald-600 text-sm">
                      {item.finalAmount.toLocaleString('vi-VN')} đ
                    </span>
                  </div>
                </div>

                {/* Khung nhập lý do từ chối nếu đang mở */}
                {isRejecting ? (
                  <div className="p-2.5 bg-rose-50 rounded-xl space-y-2 border border-rose-200">
                    <label className="text-[11px] font-bold text-rose-800 block">
                      Lý do từ chối:
                    </label>
                    <input
                      type="text"
                      value={rejectReasonInput}
                      onChange={(e) => setRejectReasonInput(e.target.value)}
                      placeholder="Chiết khấu quá cao, sách mới phát hành..."
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg outline-none focus:ring-1 focus:ring-rose-500"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setRejectPromptId(null)}
                        className="flex-1 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg text-xs"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(item.id)}
                        disabled={isBusy}
                        className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs"
                      >
                        Xác Nhận Từ Chối
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Nút thao tác 1-chạm */
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setRejectPromptId(item.id)}
                      disabled={isBusy}
                      className="px-3 py-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 font-bold rounded-xl text-xs transition"
                    >
                      Từ chối
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprove(item.id)}
                      disabled={isBusy}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition flex items-center justify-center gap-1.5"
                    >
                      {isBusy ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Đang xử lý...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Duyệt Ngay (1-Chạm)
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Tự động cập nhật mỗi 4 giây</span>
          <button
            onClick={fetchPending}
            className="flex items-center gap-1 text-slate-700 hover:text-slate-900 font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Làm mới
          </button>
        </div>
      </div>
    </div>
  );
}
