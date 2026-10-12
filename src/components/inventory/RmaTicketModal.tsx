'use client';

import React, { useState, useEffect } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import Modal from '../ui/Modal';

interface RmaTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: Array<{
    id: string;
    code: string;
    title: string;
    author: string;
  }>;
  warehouses: Array<{ id: string; name: string; code: string }>;
  onSuccess?: () => void;
}

export function RmaTicketModal({
  isOpen,
  onClose,
  books,
  warehouses,
  onSuccess,
}: RmaTicketModalProps) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || 'wh-du-phong');
  const [editionId, setEditionId] = useState(books[0]?.id || '');
  const [quantity, setQuantity] = useState(1);
  const [defectReason, setDefectReason] = useState<string>('PRINT_DEFECT');
  const [targetCondition, setTargetCondition] = useState<'QUARANTINE' | 'DEFECTIVE'>('QUARANTINE');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/rma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId,
          editionId,
          quantity,
          defectReason,
          targetCondition,
          sourceCondition: 'NEW',
          notes,
          inspectedBy: 'warehouse-staff',
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Có lỗi xảy ra khi tạo phiếu RMA');
      }

      setSuccessMsg(`Đã tạo phiếu cách ly [${json.data.id}] thành công. Tồn NEW đã được trừ và chuyển vào ${targetCondition}!`);
      setTimeout(() => {
        if (onSuccess) onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi kết nối máy chủ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={() => { if (!submitting) onClose(); }}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
            <ShieldAlert className="w-4 h-4" />
          </span>
          Cách Ly Sách Lỗi & Đổi Trả
        </span>
      }
      subtitle="Chuyển sách hỏng vào kho cách ly, tuyệt đối không lẫn vào tồn NEW"
    >
        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Kho tiếp nhận:</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium outline-none"
              >
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Số lượng lỗi:</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Đầu sách lỗi:</label>
            <select
              value={editionId}
              onChange={(e) => setEditionId(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium outline-none"
              required
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  [{b.code}] {b.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Lý do hư hỏng:</label>
              <select
                value={defectReason}
                onChange={(e) => setDefectReason(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium outline-none"
              >
                <option value="PRINT_DEFECT">Lỗi in (ngược trang, lem mực)</option>
                <option value="BINDING_DEFECT">Lỗi gáy (bung keo, rách bìa)</option>
                <option value="TRANSIT_DAMAGE">Hỏng khi vận chuyển (dập góc)</option>
                <option value="CUSTOMER_RETURN">Khách hàng đổi trả</option>
                <option value="WATER_DAMAGE">Ẩm ướt / mốc nước</option>
                <option value="OTHER">Lý do khác</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Chuyển vào thùng:</label>
              <select
                value={targetCondition}
                onChange={(e) => setTargetCondition(e.target.value as any)}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium outline-none"
              >
                <option value="QUARANTINE">QUARANTINE (Chờ kiểm định)</option>
                <option value="DEFECTIVE">DEFECTIVE (Hỏng chờ hủy/trả NXB)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú kiểm định:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi rõ chi tiết lỗi, vị trí phát hiện..."
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 font-medium outline-none resize-none"
            />
          </div>

          {/* Footer actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span>{submitting ? 'Đang cách ly...' : 'Xác Nhận Cách Ly'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
    </Modal>
  );
}
