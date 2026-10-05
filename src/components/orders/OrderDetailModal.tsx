'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Receipt,
  X,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { UserRole } from '@/lib/roles';
import {
  channelLabel,
  fiscalScopeLabel,
  paymentLabel,
  vnHour,
} from '@/lib/sales-view';

export interface OrderDetailModalProps {
  orderId: string | null;
  isOpen: boolean;
  onClose: () => void;
  currentRole?: UserRole;
  onOrderVoided?: (orderId: string) => void;
}

export function OrderDetailModal({
  orderId,
  isOpen,
  onClose,
  currentRole,
  onOrderVoided,
}: OrderDetailModalProps) {
  const [orderDetail, setOrderDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Trạng thái hủy đơn hàng an toàn
  const [showVoidConfirm, setShowVoidConfirm] = useState<boolean>(false);
  const [voidReason, setVoidReason] = useState<string>('');
  const [voidForce, setVoidForce] = useState<boolean>(false);
  const [voidLoading, setVoidLoading] = useState<boolean>(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccess, setVoidSuccess] = useState<string | null>(null);

  // Thế hệ request: đóng/mở đơn khác nhanh không để phản hồi cũ ghi đè.
  const seqRef = useRef(0);

  const fetchOrderDetail = useCallback(async (id: string) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    setOrderDetail(null);
    setShowVoidConfirm(false);
    setVoidReason('');
    setVoidForce(false);
    setVoidError(null);
    setVoidSuccess(null);

    try {
      const res = await fetch(`/api/orders/${id}`);
      const json = await res.json();
      if (seq !== seqRef.current) return; // phản hồi cũ — bỏ, không ghi đè
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Không thể tải chi tiết đơn.');
      }
      setOrderDetail(json);
    } catch (err: any) {
      if (seq !== seqRef.current) return;
      setError(err?.message || 'Lỗi kết nối khi tải chi tiết đơn.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && orderId) {
      fetchOrderDetail(orderId);
    } else {
      seqRef.current++; // huỷ hiệu lực phản hồi đang bay khi đóng/đổi đơn
      setOrderDetail(null);
      setError(null);
      setShowVoidConfirm(false);
    }
  }, [isOpen, orderId, fetchOrderDetail]);

  const handleVoidOrder = async () => {
    if (!orderId) return;
    if (!voidReason || voidReason.trim().length < 5) {
      setVoidError('Vui lòng nhập lý do hủy đơn cụ thể (tối thiểu 5 ký tự).');
      return;
    }

    setVoidLoading(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: voidReason.trim(),
          force: voidForce,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể hủy đơn.');
      }

      setVoidSuccess('Đã hủy đơn thành công! Toàn bộ tồn kho đã được hoàn trả.');
      setShowVoidConfirm(false);

      // Cập nhật trạng thái đơn hàng hiện tại trên modal
      if (orderDetail?.order) {
        setOrderDetail({
          ...orderDetail,
          order: {
            ...orderDetail.order,
            status: 'CANCELLED',
          },
        });
      }

      // Thông báo cho component cha (nếu có)
      if (onOrderVoided) {
        onOrderVoided(orderId);
      }
    } catch (err: any) {
      setVoidError(err?.message || 'Lỗi xử lý hủy đơn.');
    } finally {
      setVoidLoading(false);
    }
  };

  if (!isOpen || !orderId) return null;

  const canVoid =
    (currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') &&
    orderDetail?.order?.status === 'COMPLETED';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 id="order-detail-title" className="text-[13px] sm:text-base font-extrabold text-slate-900 truncate">
                Chi Tiết Đơn {orderDetail?.order?.orderCode ? `· ${orderDetail.order.orderCode}` : ''}
              </h3>
              <p className="text-[11px] text-slate-500 truncate">
                Thông tin chứng từ bán hàng, phân loại sổ và danh mục ấn phẩm
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200/60 transition cursor-pointer shrink-0"
            title="Đóng cửa sổ"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-2" />
              <p className="text-sm font-medium">Đang tải chi tiết đơn…</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-800 font-medium flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          ) : orderDetail?.order ? (
            <>
              {voidSuccess && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-bold text-emerald-800 flex items-center gap-2 animate-in fade-in">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{voidSuccess}</span>
                </div>
              )}

              {/* Order Meta Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 p-3.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200/70 text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Trạng thái:</span>
                  {orderDetail.order.status === 'COMPLETED' ? (
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 text-[11px]">
                      Hoàn tất
                    </span>
                  ) : orderDetail.order.status === 'CANCELLED' ? (
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full font-bold bg-rose-100 text-rose-800 text-[11px]">
                      Đã hủy
                    </span>
                  ) : (
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 text-[11px]">
                      {orderDetail.order.status}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Thời gian:</span>
                  <span className="font-bold text-slate-800">{vnHour(orderDetail.order.createdAt)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Kho xuất:</span>
                  <span className="font-bold text-slate-800">{orderDetail.order.warehouseName || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Thu ngân:</span>
                  <span className="font-bold text-slate-800">{orderDetail.order.cashierName || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Kênh bán:</span>
                  <span className="font-bold text-slate-800">{channelLabel(orderDetail.order.channel)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Thanh toán:</span>
                  <span className="font-bold text-slate-800">{paymentLabel(orderDetail.order.paymentMethod)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Phân loại sổ:</span>
                  <span className="font-bold text-slate-800">{fiscalScopeLabel(orderDetail.order.fiscalScope)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Khách hàng:</span>
                  <span className="font-bold text-slate-800 truncate block">{orderDetail.order.customerName || 'Khách lẻ'}</span>
                </div>
              </div>

              {/* Ghi chú đơn — LUÔN hiện (trống thì gạch ngang) để phân biệt
                  "đơn không có ghi chú" với "mất trường ghi chú". */}
              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900">
                <strong>Ghi chú:</strong>{' '}
                {orderDetail.order.note && `${orderDetail.order.note}`.trim() ? (
                  orderDetail.order.note
                ) : (
                  <span className="text-amber-400 italic">—</span>
                )}
              </div>

              {/* Items Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Danh mục ấn phẩm & quà tặng ({orderDetail.items?.length || 0})
                </h4>
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <table className="w-full text-left text-xs min-w-[500px]">
                      <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                        <tr>
                          <th className="p-3">Sản phẩm</th>
                          <th className="p-3 text-center">Số lượng</th>
                          <th className="p-3 text-right">Giá bìa</th>
                          <th className="p-3 text-right">Chiết khấu</th>
                          <th className="p-3 text-right">Đơn giá</th>
                          <th className="p-3 text-right">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(orderDetail.items || []).map((it: any) => (
                          <tr key={it.id} className="hover:bg-slate-50/50">
                            <td className="p-3">
                              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                <span>{it.productName || it.productId}</span>
                                {it.isGiftLine && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-pink-100 text-pink-700">
                                    Quà tặng
                                  </span>
                                )}
                                {it.isGiftShortfall && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                    Hết tồn
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono">{it.productCode || it.productId}</span>
                            </td>
                            <td className="p-3 text-center font-bold font-mono">{it.quantity}</td>
                            <td className="p-3 text-right font-mono text-slate-500">
                              {Number(it.unitCoverPrice || 0).toLocaleString('vi-VN')} đ
                            </td>
                            <td className="p-3 text-right font-mono text-amber-600">
                              {it.unitDiscountRate ? `${Math.round(it.unitDiscountRate * 100)}%` : '0%'}
                            </td>
                            <td className="p-3 text-right font-mono text-slate-700">
                              {Number(it.unitSellingPrice || 0).toLocaleString('vi-VN')} đ
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-slate-900">
                              {Number(it.totalAmount || 0).toLocaleString('vi-VN')} đ
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Financial Summary Breakdown */}
              <div className="flex justify-end">
                <div className="w-full sm:w-72 space-y-1.5 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="flex justify-between text-slate-500">
                    <span>Tổng tiền niêm yết:</span>
                    <span className="font-mono">{Number(orderDetail.order.subtotal || 0).toLocaleString('vi-VN')} đ</span>
                  </div>
                  <div className="flex justify-between text-amber-600">
                    <span>Chiết khấu:</span>
                    <span className="font-mono">-{Number(orderDetail.order.discountAmount || 0).toLocaleString('vi-VN')} đ</span>
                  </div>
                  <div className="border-t border-slate-200 pt-1.5 flex justify-between font-extrabold text-sm text-emerald-700">
                    <span>Thực thu:</span>
                    <span className="font-mono">{Number(orderDetail.order.finalAmount || 0).toLocaleString('vi-VN')} đ</span>
                  </div>
                </div>
              </div>

              {/* Section Hủy Đơn Hàng cho Quản lý / Chủ */}
              {canVoid && (
                <div className="border-t border-slate-200 pt-4">
                  {!showVoidConfirm ? (
                    <div className="flex justify-between items-center bg-rose-50/50 border border-rose-200/60 p-3.5 rounded-2xl">
                      <div>
                        <h5 className="text-xs font-bold text-rose-900">Thao tác Quản trị</h5>
                        <p className="text-[11px] text-rose-600">
                          Hủy đơn quét nhầm / sai lệch để hoàn tồn kho và điều chỉnh doanh thu
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowVoidConfirm(true);
                          setVoidError(null);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hủy đơn</span>
                      </button>
                    </div>
                  ) : (
                    <div className="bg-rose-50 border border-rose-300 p-4 rounded-2xl space-y-3">
                      <div className="flex items-start gap-2 text-rose-900">
                        <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <h5 className="text-xs font-extrabold">Xác nhận Hủy Đơn Hoàn Tất</h5>
                          <p className="text-[11px] text-rose-700 mt-0.5">
                            Hành động này sẽ: (1) Trả 100% sách & quà về kho xuất qua bút toán Thẻ kho RETURN_INBOUND; (2) Trừ khỏi doanh số ca đang mở; (3) Lưu nhật ký kiểm toán.
                          </p>
                        </div>
                      </div>

                      {voidError && (
                        <div className="p-2.5 bg-rose-100 border border-rose-300 rounded-xl text-xs text-rose-900 font-bold">
                          {voidError}
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Lý do hủy đơn (bắt buộc):
                        </label>
                        <input
                          type="text"
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder="Ví dụ: Quét nhầm phương thức thanh toán, khách đổi ý..."
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500 font-medium"
                        />
                      </div>

                      {currentRole === 'ROLE_OWNER' && (
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-rose-800">
                          <input
                            type="checkbox"
                            checked={voidForce}
                            onChange={(e) => setVoidForce(e.target.checked)}
                            className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
                          />
                          <span>Xác nhận cưỡng chế nếu ca két đã đóng (Chủ doanh nghiệp phê duyệt)</span>
                        </label>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={voidLoading}
                          onClick={() => {
                            setShowVoidConfirm(false);
                            setVoidError(null);
                          }}
                          className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                          Đóng
                        </button>
                        <button
                          type="button"
                          disabled={voidLoading}
                          onClick={handleVoidOrder}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50 cursor-pointer"
                        >
                          {voidLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                          <span>Xác nhận hủy đơn</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-slate-50/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
