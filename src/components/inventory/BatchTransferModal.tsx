'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { generateUUIDv7 } from '@/lib/uuidv7';

interface BookItem {
  id: string;
  code: string;
  title: string;
  isbnLast4?: string;
  stockAuCo?: number;
  stockQuynhMai?: number;
  stockDuPhong?: number;
  totalStock?: number;
}

interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  warehouseType?: string;
  isSellableOnPos?: boolean;
}

interface BatchTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: BookItem[];
  warehouses: WarehouseItem[];
  onSuccess: () => void;
}

interface TransferLine {
  editionId: string;
  quantity: number;
  code: string;
  title: string;
  availableStock?: number;
  staleWarning?: string;
}

export function BatchTransferModal({
  isOpen,
  onClose,
  books,
  warehouses,
  onSuccess,
}: BatchTransferModalProps) {
  const [fromWarehouseId, setFromWarehouseId] = useState<string>(
    warehouses.find((w) => w.code === 'KHO_AU_CO')?.id || warehouses[0]?.id || 'wh-au-co'
  );
  const [toWarehouseId, setToWarehouseId] = useState<string>(
    warehouses.find((w) => w.id !== fromWarehouseId)?.id || warehouses[1]?.id || ''
  );
  const [note, setNote] = useState<string>('Điều chuyển hàng loạt phục vụ sự kiện / hội chợ');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [searchBookTerm, setSearchBookTerm] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationSuccess, setValidationSuccess] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ pckCode: string; totalItems: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !isValidating) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, isValidating, onClose]);

  // Lấy tồn của sách tại kho nguồn
  const getFromStock = (bookId: string): number => {
    const book = books.find((b) => b.id === bookId);
    if (!book) return 0;
    if (fromWarehouseId === 'wh-au-co') return book.stockAuCo ?? 0;
    if (fromWarehouseId === 'wh-quynh-mai') return book.stockQuynhMai ?? 0;
    if (fromWarehouseId === 'wh-du-phong') return book.stockDuPhong ?? 0;
    return book.totalStock ?? 0;
  };

  // Tìm sách để thêm vào danh sách chuyển
  const filteredBooksToAdd = useMemo(() => {
    if (!searchBookTerm.trim()) return [];
    const q = searchBookTerm.toLowerCase().trim();
    const existingIds = new Set(lines.map((l) => l.editionId));
    return books
      .filter(
        (b) =>
          !existingIds.has(b.id) &&
          (b.title.toLowerCase().includes(q) ||
            b.code.toLowerCase().includes(q) ||
            (b.isbnLast4 && b.isbnLast4.includes(q)))
      )
      .slice(0, 8);
  }, [books, searchBookTerm, lines]);

  const handleAddLine = (book: BookItem) => {
    const stock = getFromStock(book.id);
    const defaultQty = stock > 0 ? Math.min(20, stock) : 10;
    setLines((prev) => [
      ...prev,
      {
        editionId: book.id,
        code: book.code,
        title: book.title,
        quantity: defaultQty,
        availableStock: stock,
      },
    ]);
    setSearchBookTerm('');
    setValidationSuccess(null);
    setErrorMessage(null);
  };

  const handleRemoveLine = (editionId: string) => {
    setLines((prev) => prev.filter((l) => l.editionId !== editionId));
    setValidationSuccess(null);
  };

  const handleQuantityChange = (editionId: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) => (l.editionId === editionId ? { ...l, quantity: Math.max(1, qty), staleWarning: undefined } : l))
    );
    setValidationSuccess(null);
  };

  // Thêm nhanh toàn bộ sách có tồn > 0 tại kho nguồn
  const handleBulkAddInStock = () => {
    const existingIds = new Set(lines.map((l) => l.editionId));
    const toAdd: TransferLine[] = [];
    for (const b of books) {
      if (existingIds.has(b.id)) continue;
      const stock = getFromStock(b.id);
      if (stock > 0) {
        toAdd.push({
          editionId: b.id,
          code: b.code,
          title: b.title,
          quantity: Math.min(stock, 30),
          availableStock: stock,
        });
      }
    }
    setLines((prev) => [...prev, ...toAdd]);
    setValidationSuccess(null);
  };

  // 1. Kiểm tra tồn trước (Dry-Run TOCTOU Validation)
  const handleValidateBatch = async () => {
    if (lines.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất một đầu sách cần chuyển.');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setErrorMessage('Kho xuất và kho nhập phải khác nhau.');
      return;
    }

    setIsValidating(true);
    setErrorMessage(null);
    setValidationSuccess(null);

    try {
      const res = await fetch('/api/inventory/transfer-batch/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromWarehouseId,
          toWarehouseId,
          items: lines.map((l) => ({ editionId: l.editionId, quantity: l.quantity })),
        }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setValidationSuccess(true);
        // Xóa cảnh báo cũ nếu có
        setLines((prev) => prev.map((l) => ({ ...l, staleWarning: undefined })));
      } else if (res.status === 409 && data.data?.staleItems) {
        setValidationSuccess(false);
        const staleMap = new Map<string, { requested: number; availableNow: number }>();
        for (const item of data.data.staleItems) {
          staleMap.set(item.editionId, item);
        }
        setLines((prev) =>
          prev.map((l) => {
            const stale = staleMap.get(l.editionId);
            if (stale) {
              return {
                ...l,
                availableStock: stale.availableNow,
                staleWarning: `Tồn kho khả dụng chỉ còn ${stale.availableNow} (cần ${stale.requested})`,
              };
            }
            return { ...l, staleWarning: undefined };
          })
        );
        setErrorMessage('Một số đầu sách không đủ tồn khả dụng (ATP). Hãy bấm "Hạ về tồn tối đa" hoặc điều chỉnh lại.');
      } else {
        setErrorMessage(data.error || 'Lỗi kiểm tra tồn kho.');
      }
    } catch (err: any) {
      setErrorMessage('Lỗi mạng khi kiểm tra tồn kho: ' + err.message);
    } finally {
      setIsValidating(false);
    }
  };

  // 1-Chạm: Tự động hạ các dòng thiếu về tồn khả dụng tối đa
  const handleCapToMax = () => {
    setLines((prev) =>
      prev
        .map((l) => {
          if (l.staleWarning && l.availableStock !== undefined) {
            return {
              ...l,
              quantity: Math.max(1, l.availableStock),
              staleWarning: undefined,
            };
          }
          return l;
        })
        .filter((l) => l.quantity > 0)
    );
    setValidationSuccess(null);
    setErrorMessage(null);
  };

  // 2. Commit Chuyển Kho Hàng Loạt
  const handleSubmitBatch = async () => {
    if (lines.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất một đầu sách.');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setErrorMessage('Kho xuất và kho nhập phải khác nhau.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const idempotencyKey = `batch-transfer-${generateUUIDv7()}`;

    try {
      const res = await fetch('/api/inventory/transfer-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          fromWarehouseId,
          toWarehouseId,
          note,
          items: lines.map((l) => ({ editionId: l.editionId, quantity: l.quantity })),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccessInfo({
          pckCode: data.pckCode || 'PCK-SUCCESS',
          totalItems: lines.reduce((acc, l) => acc + l.quantity, 0),
        });
      } else if (res.status === 409 && data.data?.staleItems) {
        // TOCTOU lúc commit
        const staleMap = new Map<string, number>();
        for (const item of data.data.staleItems) {
          staleMap.set(item.editionId, item.availableNow);
        }
        setLines((prev) =>
          prev.map((l) => {
            const avail = staleMap.get(l.editionId);
            if (avail !== undefined) {
              return {
                ...l,
                availableStock: avail,
                staleWarning: `Tồn kho vừa biến động: còn ${avail} (cần ${l.quantity})`,
              };
            }
            return l;
          })
        );
        setErrorMessage('Tồn kho nguồn đã biến động trong lúc thao tác. Đã đánh dấu đỏ dòng thiếu, vui lòng bấm "Hạ về tồn tối đa" rồi bấm chuyển lại.');
      } else {
        setErrorMessage(data.error || 'Lỗi khi thực hiện chuyển kho hàng loạt.');
      }
    } catch (err: any) {
      setErrorMessage('Lỗi mạng khi gửi lệnh chuyển kho: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting && !isValidating) onClose();
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Phiếu Chuyển Kho Hàng Loạt
              </h2>
              <p className="text-xs text-slate-500">
                Xuất nhanh danh sách N đầu sách sang kho hội chợ hoặc kho chi nhánh với 1 chứng từ PCK duy nhất
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {successInfo ? (
            <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-3">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-emerald-950">Chuyển Kho Hàng Loạt Thành Công!</h3>
              <p className="text-sm text-emerald-800">
                Chứng từ số <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-300">{successInfo.pckCode}</span> đã được ghi vào Sổ cái kho bất biến.
              </p>
              <p className="text-xs text-emerald-700 font-medium">
                Tổng cộng {lines.length} đầu sách ({successInfo.totalItems} cuốn) đã được trừ kho nguồn và nhập kho đích đồng thời.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onSuccess();
                    onClose();
                  }}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all"
                >
                  Hoàn Tất & Đóng
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Form chọn kho nguồn & kho đích */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">Kho Nguồn (Xuất Hàng)</label>
                  <select
                    value={fromWarehouseId}
                    onChange={(e) => {
                      setFromWarehouseId(e.target.value);
                      setValidationSuccess(null);
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">Kho Đích (Nhập Hàng)</label>
                  <select
                    value={toWarehouseId}
                    onChange={(e) => {
                      setToWarehouseId(e.target.value);
                      setValidationSuccess(null);
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {warehouses
                      .filter((w) => w.id !== fromWarehouseId)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} ({w.code})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-slate-700 block mb-1">Ghi chú điều chuyển</label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Nhập mục đích điều chuyển (ví dụ: Xuất hàng Hội chợ Sách Quốc Tế)..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Tìm & Thêm sách */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800">
                    Danh Sách Đầu Sách Điều Chuyển ({lines.length} đầu sách, {lines.reduce((acc, l) => acc + l.quantity, 0)} cuốn)
                  </label>
                  <button
                    type="button"
                    onClick={handleBulkAddInStock}
                    className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Thêm nhanh toàn bộ sách có tồn
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchBookTerm}
                    onChange={(e) => setSearchBookTerm(e.target.value)}
                    placeholder="Gõ tên sách, SKU hoặc 4 số cuối ISBN để thêm vào phiếu..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />

                  {/* Dropdown gợi ý */}
                  {filteredBooksToAdd.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden divide-y divide-slate-100">
                      {filteredBooksToAdd.map((book) => {
                        const stock = getFromStock(book.id);
                        return (
                          <button
                            key={book.id}
                            type="button"
                            onClick={() => handleAddLine(book)}
                            className="w-full px-3 py-2 text-left hover:bg-indigo-50/60 flex items-center justify-between text-xs transition-colors"
                          >
                            <div>
                              <span className="font-mono font-bold text-indigo-600 mr-2">[{book.code}]</span>
                              <span className="font-medium text-slate-900">{book.title}</span>
                            </div>
                            <span className="font-mono text-[11px] text-slate-500">
                              Tồn nguồn: <strong className="text-slate-800">{stock}</strong>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Bảng chi tiết các dòng sách đã chọn */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100/80 sticky top-0 border-b border-slate-200 text-slate-600 font-bold">
                      <tr>
                        <th className="px-3 py-2 text-left w-12">#</th>
                        <th className="px-3 py-2 text-left">Đầu Sách</th>
                        <th className="px-3 py-2 text-center w-28">Tồn Nguồn</th>
                        <th className="px-3 py-2 text-center w-32">Số Lượng Chuyển</th>
                        <th className="px-3 py-2 text-center w-12">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center text-slate-400 italic">
                            Chưa có đầu sách nào. Tìm kiếm ở trên hoặc bấm &quot;Thêm nhanh toàn bộ sách có tồn&quot;.
                          </td>
                        </tr>
                      ) : (
                        lines.map((line, idx) => (
                          <tr
                            key={line.editionId}
                            className={`transition-colors ${
                              line.staleWarning ? 'bg-rose-50/80' : 'hover:bg-slate-50/60'
                            }`}
                          >
                            <td className="px-3 py-2 font-mono text-slate-400 text-center">{idx + 1}</td>
                            <td className="px-3 py-2">
                              <span className="font-mono font-bold text-slate-800 mr-1.5">[{line.code}]</span>
                              <span className="font-medium text-slate-900">{line.title}</span>
                              {line.staleWarning && (
                                <p className="text-[10px] text-rose-600 font-bold flex items-center gap-1 mt-0.5">
                                  <AlertTriangle className="w-3 h-3" /> {line.staleWarning}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center font-mono font-semibold text-slate-600">
                              {line.availableStock ?? getFromStock(line.editionId)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min="1"
                                value={line.quantity}
                                onChange={(e) =>
                                  handleQuantityChange(line.editionId, parseInt(e.target.value) || 1)
                                }
                                className={`w-20 px-2 py-1 text-center font-mono font-bold border rounded-lg focus:outline-none ${
                                  line.staleWarning
                                    ? 'border-rose-400 bg-rose-50 text-rose-700 focus:ring-1 focus:ring-rose-500'
                                    : 'border-slate-300 bg-white focus:ring-1 focus:ring-indigo-500'
                                }`}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(line.editionId)}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Thông báo lỗi & Cảnh báo TOCTOU */}
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span>{errorMessage}</span>
                    {lines.some((l) => l.staleWarning) && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={handleCapToMax}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                        >
                          ⚡ Hạ về tồn tối đa (1-Chạm)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Thông báo kiểm tra hợp lệ thành công */}
              {validationSuccess === true && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Toàn bộ {lines.length} đầu sách ({lines.reduce((acc, l) => acc + l.quantity, 0)} cuốn) đều có đủ tồn khả dụng (ATP). Bạn có thể ấn &quot;Xác nhận chuyển kho&quot;.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {!successInfo && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              Hủy bỏ
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleValidateBatch}
                disabled={isValidating || isSubmitting || lines.length === 0}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isValidating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                Kiểm tra tồn kho
              </button>
              <button
                type="button"
                onClick={handleSubmitBatch}
                disabled={isSubmitting || isValidating || lines.length === 0}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                Xác nhận chuyển kho
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
