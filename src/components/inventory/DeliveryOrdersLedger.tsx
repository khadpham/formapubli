'use client';

import React, { useState, useEffect } from 'react';
import {
  FileText,
  Printer,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Search,
  Filter,
  Eye,
  Building2,
  Clock,
  Lock,
} from 'lucide-react';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { DeliveryReceiptPrint, DeliveryOrderData } from './DeliveryReceiptPrint';

interface DeliveryOrdersLedgerProps {
  currentRole?: string;
  onOpenCreateModal?: () => void;
}

export function DeliveryOrdersLedger({
  currentRole = 'ROLE_WAREHOUSE',
  onOpenCreateModal,
}: DeliveryOrdersLedgerProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Xem chi tiết / In phiếu A4
  const [selectedOrderForPrint, setSelectedOrderForPrint] = useState<DeliveryOrderData | null>(null);

  // Đảo bút toán hủy (Reverse)
  const [reversalTargetOrder, setReversalTargetOrder] = useState<any | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Ký duyệt phiếu DRAFT
  const [isDispatchingId, setIsDispatchingId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const url = statusFilter !== 'ALL'
        ? `/api/delivery-orders?status=${statusFilter}`
        : `/api/delivery-orders`;
      const res = await fetch(url, {
        headers: { 'x-formapubli-role': currentRole },
      });
      const json = await res.json();
      if (json.success) {
        setOrders(json.data || []);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách phiếu xuất kho:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter, currentRole]);

  // Xem hoặc In phiếu
  const handleOpenReceipt = async (orderIdOrCode: string) => {
    try {
      const res = await fetch(`/api/delivery-orders/${orderIdOrCode}`, {
        headers: { 'x-formapubli-role': currentRole },
      });
      const json = await res.json();
      if (json.success) {
        setSelectedOrderForPrint(json.data);
      } else {
        alert(json.error || 'Không thể tải chi tiết phiếu');
      }
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  // Ký duyệt phiếu DRAFT
  const handleDispatchDraft = async (orderId: string) => {
    if (!confirm('Bạn có chắc chắn muốn KÝ DUYỆT và KHÓA SỔ phiếu xuất kho này? Sách sẽ được trừ khỏi kho vĩnh viễn.')) {
      return;
    }
    try {
      setIsDispatchingId(orderId);
      const res = await fetch(`/api/delivery-orders/${orderId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-formapubli-role': currentRole,
        },
        body: JSON.stringify({
          action: 'DISPATCH',
          idempotencyKey: generateUUIDv7(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        fetchOrders();
        handleOpenReceipt(json.data.id);
      } else {
        alert(json.error || 'Không thể ký xuất kho');
      }
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    } finally {
      setIsDispatchingId(null);
    }
  };

  // Xác nhận đảo bút toán hủy
  const handleConfirmReverse = async () => {
    if (!reversalTargetOrder) return;
    if (!reversalReason.trim()) {
      setReversalError('Vui lòng nhập lý do đảo bút toán hủy phiếu.');
      return;
    }

    try {
      setIsReversing(true);
      setReversalError(null);
      const res = await fetch(`/api/delivery-orders/${reversalTargetOrder.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-formapubli-role': currentRole,
        },
        body: JSON.stringify({
          action: 'REVERSE',
          reason: reversalReason.trim(),
          idempotencyKey: generateUUIDv7(),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Lỗi đảo bút toán hủy');
      }

      setReversalTargetOrder(null);
      setReversalReason('');
      fetchOrders();
      alert(`Đã đảo bút toán thành công! Sinh phiếu đối ứng: ${json.data.code}`);
      handleOpenReceipt(json.data.id);
    } catch (err: any) {
      setReversalError(err.message || 'Lỗi không xác định khi hủy phiếu');
    } finally {
      setIsReversing(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      o.code?.toLowerCase().includes(term) ||
      o.partnerName?.toLowerCase().includes(term) ||
      o.warehouseName?.toLowerCase().includes(term) ||
      o.note?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-4">
      {/* Thanh công cụ danh sách */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* Lọc trạng thái */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition ${
                statusFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => setStatusFilter('DISPATCHED_LOCKED')}
              className={`px-3 py-1.5 rounded-lg transition ${
                statusFilter === 'DISPATCHED_LOCKED'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Đã xuất kho
            </button>
            <button
              onClick={() => setStatusFilter('DRAFT')}
              className={`px-3 py-1.5 rounded-lg transition ${
                statusFilter === 'DRAFT'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bản nháp
            </button>
            <button
              onClick={() => setStatusFilter('VOIDED_REVERSED')}
              className={`px-3 py-1.5 rounded-lg transition ${
                statusFilter === 'VOIDED_REVERSED'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Đã hủy (PXK_R)
            </button>
          </div>

          <button
            onClick={fetchOrders}
            className="p-2 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
            title="Tải lại danh sách"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Ô tìm kiếm & Nút lập phiếu */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm mã PXK, đối tác, kho..."
              className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          {onOpenCreateModal && (
            <button
              onClick={onOpenCreateModal}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition shrink-0"
            >
              <FileText className="w-4 h-4" />
              Lập Phiếu Xuất Đối Tác
            </button>
          )}
        </div>
      </div>

      {/* Bảng sổ phiếu xuất kho */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase text-[11px] tracking-wider">
                <th className="p-3.5">Mã Phiếu</th>
                <th className="p-3.5">Ngày Xuất</th>
                <th className="p-3.5">Kho Nguồn</th>
                <th className="p-3.5">Đối Tác Nhận Hàng</th>
                <th className="p-3.5 text-right">Tổng Tiền Bìa</th>
                <th className="p-3.5 text-center">CK (%)</th>
                <th className="p-3.5 text-right">Thực Thu (VNĐ)</th>
                <th className="p-3.5 text-center">Trạng Thái</th>
                <th className="p-3.5 text-center w-28">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-slate-300" />
                    Đang tải sổ phiếu xuất kho...
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400 italic">
                    Không tìm thấy phiếu xuất kho nào phù hợp.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => {
                  const isReversal = o.code.startsWith('PXK_R');
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/80 transition">
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-mono font-bold ${
                              isReversal ? 'text-rose-600' : 'text-slate-900'
                            }`}
                          >
                            {o.code}
                          </span>
                          {o.reversalOf && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 font-mono" title={`Đảo cho ${o.reversalOf}`}>
                              REV
                            </span>
                          )}
                        </div>
                        {o.note && (
                          <p className="text-[10px] text-slate-400 truncate max-w-[180px]">{o.note}</p>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-600 font-mono text-[11px]">
                        {new Date(o.dispatchedAt || o.createdAt).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="p-3.5 font-medium text-slate-700">
                        {o.warehouseName || o.fromWarehouseId}
                      </td>
                      <td className="p-3.5">
                        <p className="font-bold text-slate-800">{o.partnerName || 'Đại lý'}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{o.partnerCode || o.partnerId}</p>
                      </td>
                      <td className="p-3.5 text-right font-mono text-slate-600">
                        {(o.subtotal || 0).toLocaleString('vi-VN')} đ
                      </td>
                      <td className="p-3.5 text-center font-mono font-bold text-amber-600">
                        {Math.round((o.discountRate || 0) * 100)}%
                      </td>
                      <td className="p-3.5 text-right font-mono font-black text-slate-900">
                        {(o.finalAmount || 0).toLocaleString('vi-VN')} đ
                      </td>
                      <td className="p-3.5 text-center">
                        {o.status === 'DISPATCHED_LOCKED' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <Lock className="w-3 h-3" /> Đã Khóa Sổ
                          </span>
                        ) : o.status === 'VOIDED_REVERSED' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                            <RotateCcw className="w-3 h-3" /> Đã Hủy
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3" /> Bản Nháp
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Nút Xem & In A4 */}
                          <button
                            onClick={() => handleOpenReceipt(o.id)}
                            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                            title="Xem & In phiếu xuất kho A4"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* Ký xuất kho nếu là DRAFT */}
                          {o.status === 'DRAFT' && (
                            <button
                              onClick={() => handleDispatchDraft(o.id)}
                              disabled={isDispatchingId === o.id}
                              className="p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition font-bold"
                              title="Ký duyệt xuất kho & Khóa sổ"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}

                          {/* Đảo bút toán hủy nếu là DISPATCHED_LOCKED */}
                          {o.status === 'DISPATCHED_LOCKED' && !isReversal && (
                            <button
                              onClick={() => setReversalTargetOrder(o)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              title="Đảo bút toán hủy phiếu (PXK_R)"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal xác nhận Đảo bút toán hủy (Reversal) */}
      {reversalTargetOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-rose-700">
                <RotateCcw className="w-5 h-5" />
                <h3 className="font-extrabold text-base text-slate-900">Đảo Bút Toán Hủy Phiếu</h3>
              </div>
              <button
                onClick={() => setReversalTargetOrder(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Hệ thống sẽ giữ nguyên phiếu gốc{' '}
                <strong className="font-mono text-slate-900 font-bold">{reversalTargetOrder.code}</strong>,
                đánh dấu <span className="text-rose-600 font-bold">VOIDED_REVERSED</span>, đồng thời sinh
                một phiếu đảo đối ứng <span className="font-mono font-bold text-rose-600">PXK_R-YYYY-XXXX</span> để
                hoàn lại toàn bộ sách vào kho nguồn (thẻ kho <span className="font-mono font-bold">RECEIPT_RETURN</span>).
              </p>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Lý do đảo bút toán hủy chứng từ (*):
                </label>
                <textarea
                  rows={3}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="Ví dụ: Đại lý hủy đơn không nhận, lập nhầm số lượng ấn bản..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-rose-500 font-medium"
                />
              </div>

              {reversalError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-bold text-[11px] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{reversalError}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReversalTargetOrder(null)}
                disabled={isReversing}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                Quay Lại
              </button>
              <button
                type="button"
                onClick={handleConfirmReverse}
                disabled={isReversing}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-md transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isReversing ? 'Đang đảo sổ...' : 'Xác Nhận Đảo Hủy (PXK_R)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal In Phiếu Xuất Kho A4 */}
      {selectedOrderForPrint && (
        <DeliveryReceiptPrint
          order={selectedOrderForPrint}
          isOpen={!!selectedOrderForPrint}
          onClose={() => setSelectedOrderForPrint(null)}
        />
      )}
    </div>
  );
}
