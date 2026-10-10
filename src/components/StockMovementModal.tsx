'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, PlusCircle, AlertCircle, CheckCircle } from 'lucide-react';

interface BookItem {
  id: string;
  code: string;
  title: string;
  isbnLast4: string;
  shortCode: string | null;
  stockAuCo: number;
  stockQuynhMai: number;
  stockDuPhong: number;
  totalStock: number;
}

interface WarehouseItem {
  id: string;
  code: string;
  name: string;
}

interface StockMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: BookItem[];
  warehouses: WarehouseItem[];
  onSuccess: () => void;
  /** @deprecated Modal giờ chỉ làm NHẬP NHÀ IN - prop này giữ lại để không vỡ caller cũ. */
  defaultAction?: 'RECEIPT';
  selectedBook?: BookItem | null;
}

export function StockMovementModal({
  isOpen,
  onClose,
  books,
  warehouses,
  onSuccess,
  defaultAction = 'RECEIPT',
  selectedBook = null,
}: StockMovementModalProps) {
  // Modal này chỉ làm NHẬP NHÀ IN (RECEIPT). Chuyển kho dùng BatchTransferModal,
  // xuất bán dùng Xuất kho - các tab cũ đã bỏ để gọn nghiệp vụ.
  const actionType = 'RECEIPT' as const;
  const [selectedEditionId, setSelectedEditionId] = useState<string>(selectedBook?.id || (books[0]?.id || ''));
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>(
    warehouses.find((w) => w.code === 'KHO_AU_CO')?.id || warehouses[0]?.id || ''
  );
  const [quantity, setQuantity] = useState<number>(100);
  const [documentRef, setDocumentRef] = useState<string>(`PCK-${Date.now().toString().slice(-6)}`);
  const [note, setNote] = useState<string>('');
  const [actorId, setActorId] = useState<string>('Thủ kho chính');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Đồng bộ state khi modal được mở bằng phím tắt (Alt+Shift+T/R/X)
  // hoặc khi sách được chọn từ dòng trong bảng thay đổi.
  // Phải đặt trước early-return để giữ thứ tự hooks ổn định.
  useEffect(() => {
    if (!isOpen) return;
    const nextBookId =
      selectedBook?.id || books[0]?.id || '';
    setSelectedEditionId((prev) => {
      // Giữ lựa chọn hiện tại nếu vẫn hợp lệ, tránh reset khi đang gõ.
      if (prev && books.some((b) => b.id === prev)) {
        // Nhưng nếu caller chỉ định selectedBook khác prev thì ưu tiên caller.
        if (selectedBook && selectedBook.id !== prev) return selectedBook.id;
        // Nếu defaultAction đổi qua phím tắt mà prev vẫn hợp lệ thì giữ nguyên sách.
        return prev;
      }
      return nextBookId;
    });
    setErrorMessage(null);
    setSuccessMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedBook?.id]);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lắng nghe phím tắt trong modal: Ctrl+Enter để submit, Escape để đóng.
  // Đặt trước early-return để tránh lỗi "Rendered fewer hooks than expected"
  // khi isOpen chuyển false -> true (nguyên nhân crash Alt+Shift+T).
  useEffect(() => {
    if (!isOpen) return;

    const handleModalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const form = document.getElementById('stock-movement-form') as HTMLFormElement;
        if (form) {
          form.requestSubmit();
        }
      }
    };

    window.addEventListener('keydown', handleModalKeyDown);
    return () => window.removeEventListener('keydown', handleModalKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const currentBook = books.find((b) => b.id === selectedEditionId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/inventory/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editionId: selectedEditionId,
          warehouseId: targetWarehouseId,
          eventType: 'RECEIPT',
          quantityDelta: quantity,
          documentRef,
          actorId,
          note,
          // P2-02: key chống double-click ghi trùng kho (server từ chối key lặp)
          idempotencyKey: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi thao tác kho');
      setSuccessMessage(`Đã ghi sổ cái thành công cho ${currentBook?.title}!`);

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Thao tác thất bại');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <PlusCircle className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-800">
              Phiếu Nhập Kho Từ Nhà In
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>


        <form id="stock-movement-form" onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Book Select */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Chọn Đầu Sách
            </label>
            <select
              value={selectedEditionId}
              onChange={(e) => setSelectedEditionId(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  [{b.code}] {b.title} (Đuôi: {b.isbnLast4} | Tồn: {b.totalStock})
                </option>
              ))}
            </select>
          </div>

          {/* Current Stock Preview */}
          {currentBook && (
            <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
              <div className="text-center">
                <span className="text-slate-400 block">Kho Âu Cơ</span>
                <span className="font-bold text-slate-800 font-mono text-sm">{currentBook.stockAuCo}</span>
              </div>
              <div className="text-center border-x border-slate-200">
                <span className="text-slate-400 block">Kho Quỳnh Mai</span>
                <span className="font-bold text-slate-800 font-mono text-sm">{currentBook.stockQuynhMai}</span>
              </div>
              <div className="text-center">
                <span className="text-slate-400 block">Kho Dự phòng</span>
                <span className="font-bold text-slate-800 font-mono text-sm">{currentBook.stockDuPhong}</span>
              </div>
            </div>
          )}

          {/* Warehouse Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Kho Tiếp Nhận
              </label>
              <select
                value={targetWarehouseId}
                onChange={(e) => setTargetWarehouseId(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg p-2.5 font-medium"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

          {/* Quantity & Document Ref */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Số Lượng (Cuốn)</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
                className="w-full text-sm border border-slate-300 rounded-lg p-2 font-mono font-bold text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Mã Chứng Từ / Số Phiếu</label>
              <input
                type="text"
                value={documentRef}
                onChange={(e) => setDocumentRef(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg p-2 font-mono text-slate-800"
                required
              />
            </div>
          </div>

          {/* Note & Actor */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Người Thao Tác</label>
              <input
                type="text"
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Ghi Chú Nghiệp Vụ</label>
              <input
                type="text"
                placeholder="Lý do, số xe, đợt in..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          {/* Feedback Messages */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700 font-medium">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
            >
              {loading ? 'Đang ghi sổ cái...' : 'Ghi Bút Toán Sổ Cái'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
