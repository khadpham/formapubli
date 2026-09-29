'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
import type { CartItemSnapshot } from './DiscountApprovalModal';

/** F4: giỏ đã khóa lúc xin duyệt — parse an toàn, dữ liệu hỏng coi như rỗng. */
function parseCartSnapshot(raw?: string | null): CartItemSnapshot[] {
  try {
    const parsed = JSON.parse(`${raw ?? '[]'}`);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface PendingApprovalItem {
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
  cartSnapshot?: string | null;
}

interface ManagerApprovalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  warehouseId?: string;
  warehouseName?: string;
  onActionCompleted?: () => void;
}

/**
 * Khoá theo từng thẻ. Một ô busy dùng chung sẽ bị thẻ nào xong trước xoá mất
 * trạng thái của thẻ đang bay còn lại (spinner biến mất, nút sáng lại, bấm trùng).
 */
export function addBusyId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

export function removeBusyId(ids: string[], id: string): string[] {
  return ids.filter((current) => current !== id);
}

export type QuickApproveDecision =
  | { kind: 'none'; code: string }
  | { kind: 'single'; code: string; item: PendingApprovalItem }
  | { kind: 'ambiguous'; code: string; items: PendingApprovalItem[] };

/**
 * Ô duyệt nhanh: shortCode là 4 ký tự cuối của 16 hex ngẫu nhiên
 * (order.service.ts:559 → extractShortCode, discount-approval.service.ts:128)
 * ⇒ chỉ 65.536 giá trị, trùng chắc chắn xảy ra trong một hội chợ. Server so
 * shortCode với CHÍNH request client chọn (discount-approval.service.ts:434)
 * nên không chặn được — quản lý đọc mã A có thể duyệt đơn B của thu ngân khác.
 * Vì vậy trả về MỌI đơn khớp: 1 thì duyệt, nhiều thì bắt quản lý chọn.
 */
export function decideQuickApprove(
  items: PendingApprovalItem[],
  rawCode: string
): QuickApproveDecision {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { kind: 'none', code };
  const matches = items.filter((i) => i.shortCode === code || i.orderCode.endsWith(code));
  if (matches.length === 0) return { kind: 'none', code };
  if (matches.length === 1) return { kind: 'single', code, item: matches[0] };
  return { kind: 'ambiguous', code, items: matches };
}

export function ManagerApprovalDrawer({
  isOpen,
  onClose,
  warehouseId,
  warehouseName,
  onActionCompleted,
}: ManagerApprovalDrawerProps) {
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /** Lỗi tải danh sách — phải nhìn ra khác hẳn "không có yêu cầu nào". */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** true = xem mọi kho, false = chỉ kho đang chọn. */
  const [showAllWarehouses, setShowAllWarehouses] = useState(false);
  /** Số yêu cầu đang chờ ở kho KHÁC (chỉ tính khi đang lọc 1 kho và danh sách rỗng). */
  const [otherWarehouseCount, setOtherWarehouseCount] = useState(0);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [quickShortCode, setQuickShortCode] = useState('');
  /** id các thẻ đang bay — khoá từng thẻ, xong thẻ nào bỏ thẻ nó. */
  const [busyIds, setBusyIds] = useState<string[]>([]);
  /** Mã 4 số bị trùng: bắt quản lý chọn đúng đơn thay vì duyệt bừa. */
  const [ambiguous, setAmbiguous] = useState<{ code: string; items: PendingApprovalItem[] } | null>(null);
  const [rejectPromptId, setRejectPromptId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const fetchPending = async () => {
    setIsLoading(true);
    try {
      const scoped = Boolean(warehouseId) && !showAllWarehouses;
      const url = scoped
        ? `/api/pos/discount-approvals?warehouseId=${encodeURIComponent(warehouseId as string)}`
        : `/api/pos/discount-approvals`;
      // no-store: nút "Làm mới" và poll 4s phải luôn đọc server, không được phục vụ
      // từ HTTP cache của trình duyệt (nếu không thì bấm refresh vẫn ra kết quả cũ).
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !Array.isArray(json.data)) {
        throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
      }
      setItems(json.data);
      setLoadError(null);
      setLastLoadedAt(new Date());

      // Rỗng ở kho này: hỏi thêm toàn bộ để phân biệt "không có gì" với "có ở kho khác".
      if (scoped && json.data.length === 0) {
        try {
          const allRes = await fetch('/api/pos/discount-approvals', { cache: 'no-store' });
          const allJson = await allRes.json().catch(() => null);
          setOtherWarehouseCount(
            allRes.ok && allJson?.success && Array.isArray(allJson.data) ? allJson.data.length : 0
          );
        } catch {
          setOtherWarehouseCount(0);
        }
      } else {
        setOtherWarehouseCount(0);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Không kết nối được máy chủ');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setOtherWarehouseCount(0);
    fetchPending();
    const timer = setInterval(fetchPending, 4000);
    return () => clearInterval(timer);
  }, [isOpen, warehouseId, showAllWarehouses]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const markBusy = (id: string) => setBusyIds((prev) => addBusyId(prev, id));
  /** Chỉ bỏ khoá đúng thẻ vừa xong — không đụng trạng thái của thẻ khác. */
  const clearBusy = (id: string) => setBusyIds((prev) => removeBusyId(prev, id));

  // 1-Chạm duyệt
  const handleApprove = async (id: string, shortCode?: string) => {
    try {
      markBusy(id);
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
      setAmbiguous(null);
      fetchPending();
      if (onActionCompleted) onActionCompleted();
    } catch (err: any) {
      showToast(`❌ ${err.message || 'Không thể phê duyệt'}`);
    } finally {
      clearBusy(id);
    }
  };

  // Từ chối kèm lý do
  const handleReject = async (id: string) => {
    try {
      markBusy(id);
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
      clearBusy(id);
    }
  };

  // Duyệt nhanh bằng ô ShortCode 4 số
  const handleQuickApproveByShortCode = () => {
    const decision = decideQuickApprove(items, quickShortCode);
    setQuickShortCode('');
    if (decision.kind === 'none') {
      showToast(`⚠️ Không tìm thấy đơn nào có mã '${decision.code}' đang chờ duyệt`);
      return;
    }
    if (decision.kind === 'single') {
      setAmbiguous(null);
      handleApprove(decision.item.id, decision.code);
      return;
    }
    // Trùng mã: không tự chọn đơn — đưa danh sách để quản lý chọn đúng thẻ.
    setAmbiguous({ code: decision.code, items: decision.items });
  };

  if (!isOpen || !mounted) return null;

  const isScoped = Boolean(warehouseId) && !showAllWarehouses;
  const scopeLabel = !warehouseId
    ? 'Mọi kho'
    : isScoped
      ? (warehouseName || warehouseId)
      : 'Mọi kho';

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-150"
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
                Duyệt Chiết Khấu POS
              </h3>
              <p className="text-[11px] text-slate-400">
                {items.length} yêu cầu chờ • Phạm vi: {scopeLabel}
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

        {/* Chọn phạm vi: đúng kho đang mở, hay mọi kho (khớp với chuông báo) */}
        {Boolean(warehouseId) && (
          <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-slate-300 flex items-center gap-1 min-w-0 truncate">
              <Building2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{isScoped ? `Đang lọc: ${scopeLabel}` : 'Đang xem: Mọi kho'}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowAllWarehouses((v) => !v)}
              disabled={isLoading}
              className="shrink-0 ml-2 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 text-amber-300 text-[11px] font-bold border border-amber-500/40 transition"
            >
              {isScoped ? 'Xem mọi kho' : 'Chỉ kho này'}
            </button>
          </div>
        )}

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

          {/* Trùng mã 4 số: KHÔNG duyệt bừa — bắt quản lý chọn đúng đơn */}
          {ambiguous && ambiguous.items.length > 1 && (
            <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-2.5 space-y-2">
              <p className="text-[11px] font-extrabold text-rose-800">
                ⚠️ Trùng mã {ambiguous.code}: {ambiguous.items.length} đơn cùng mã. Chọn đúng đơn:
              </p>
              {ambiguous.items.map((row) => {
                const rowBusy = busyIds.includes(row.id);
                return (
                  <div
                    key={`amb-${row.id}`}
                    className="bg-white border border-rose-200 rounded-xl p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-extrabold text-xs text-slate-900">
                        {row.orderCode}
                      </span>
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-black text-[10px] rounded-lg border border-amber-300">
                        Mã {row.shortCode}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1 min-w-0 truncate">
                        <Building2 className="w-3 h-3 shrink-0" /> {row.warehouseId}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 min-w-0 truncate">
                        <User className="w-3 h-3 shrink-0" /> {row.cashierId}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3" />{' '}
                        {new Date(row.createdAt).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAmbiguous(null)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg text-[11px] transition"
                      >
                        Huỷ chọn
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(row.id, row.shortCode)}
                        disabled={rowBusy}
                        className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-[11px] transition flex items-center justify-center gap-1"
                      >
                        {rowBusy ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" /> Đang xử lý...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3" /> Duyệt đơn này
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Danh sách yêu cầu chờ duyệt */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && items.length === 0 && (
            <div className="py-12 text-center space-y-2 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
              <p className="text-xs">Đang nạp danh sách yêu cầu...</p>
            </div>
          )}

          {!isLoading && loadError && (
            <div className="py-12 text-center space-y-2">
              <AlertCircle className="w-10 h-10 mx-auto text-rose-500" />
              <p className="text-xs font-semibold text-rose-700">Không tải được danh sách</p>
              <p className="text-[11px] text-slate-500 break-words">{loadError}</p>
              <p className="text-[11px] text-slate-400">Bấm “Làm mới” để thử lại.</p>
            </div>
          )}

          {!isLoading && !loadError && items.length === 0 && (
            <div className="py-12 text-center space-y-2 text-slate-400">
              <CheckCircle2 className="w-10 h-10 mx-auto text-slate-300" />
              {isScoped && otherWarehouseCount > 0 ? (
                <>
                  <p className="text-xs font-semibold text-slate-600">
                    {scopeLabel} không có yêu cầu nào
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Đang có {otherWarehouseCount} yêu cầu ở kho khác.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAllWarehouses(true)}
                    className="mx-auto mt-1 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[11px] font-bold hover:bg-amber-600 transition"
                  >
                    Xem mọi kho
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-slate-600">
                    {isScoped ? `${scopeLabel}: không có yêu cầu nào` : 'Không có yêu cầu nào ở mọi kho'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Khi thu ngân xin chiết khấu &ge;20%, đơn sẽ lập tức xuất hiện tại đây.
                  </p>
                </>
              )}
            </div>
          )}

          {items.map((item) => {
            const isGift = item.requestedDiscountRate === 1;
            const isBusy = busyIds.includes(item.id);
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

                {/* Hộp Mã cấp phép / OTP cấp cho Thu ngân */}
                <div className="bg-amber-500/10 border border-amber-300/80 rounded-xl p-2.5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block">
                      Mã Cấp Phép / OTP (4 Số):
                    </span>
                    <span className="text-[11px] text-amber-700 block">
                      Đọc mã này cho Thu ngân gõ tại quầy
                    </span>
                  </div>
                  <div className="px-3 py-1 bg-amber-500 text-white font-mono font-black text-base rounded-lg shadow-sm tracking-widest">
                    {item.shortCode}
                  </div>
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

                {/* F4: giỏ đã khóa tại thời điểm xin duyệt — Quản lý đối chiếu TRƯỚC khi duyệt */}
                {parseCartSnapshot(item.cartSnapshot).length > 0 && (
                  <button
                    type="button"
                    id={`btn-view-cart-${item.id}`}
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition"
                  >
                    {expandedId === item.id ? 'Ẩn giỏ đã khóa' : 'Xem giỏ đã khóa'}
                  </button>
                )}
                {expandedId === item.id && (
                  <div
                    id={`drawer-cart-snapshot-${item.id}`}
                    className="p-2.5 bg-white border border-slate-200 rounded-xl space-y-1 text-[11px] font-mono"
                  >
                    {parseCartSnapshot(item.cartSnapshot).map((line) => (
                      <div key={line.editionId} className="flex items-center justify-between">
                        <span className="text-slate-900 font-bold">
                          {line.editionId} × {line.quantity} — {line.unitPrice.toLocaleString('vi-VN')} đ
                        </span>
                      </div>
                    ))}
                  </div>
                )}

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
          <span className="truncate">
            {isLoading
              ? 'Đang nạp...'
              : lastLoadedAt
                ? `Cập nhật lúc ${lastLoadedAt.toLocaleTimeString('vi-VN')}`
                : 'Tự động cập nhật mỗi 4 giây'}
          </span>
          <button
            type="button"
            onClick={fetchPending}
            disabled={isLoading}
            className="shrink-0 ml-2 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-bold disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Đang nạp' : 'Làm mới'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
