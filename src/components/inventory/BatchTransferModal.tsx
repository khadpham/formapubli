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
  initialToWarehouseId?: string;
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
  initialToWarehouseId,
}: BatchTransferModalProps) {
  const [fromWarehouseId, setFromWarehouseId] = useState<string>(
    warehouses.find((w) => w.code === 'KHO_AU_CO')?.id || warehouses[0]?.id || 'wh-au-co'
  );
  const [toWarehouseId, setToWarehouseId] = useState<string>(
    initialToWarehouseId || warehouses.find((w) => w.id !== fromWarehouseId)?.id || warehouses[1]?.id || ''
  );
  const [note, setNote] = useState<string>('Điều chuyển hàng loạt phục vụ sự kiện / hội chợ');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkQtyInput, setBulkQtyInput] = useState<string>('');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState<boolean>(false);
  const [searchBookTerm, setSearchBookTerm] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationSuccess, setValidationSuccess] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ pckCode: string; totalItems: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  const selectAllCheckboxRef = React.useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = React.useRef<string | null>(null);
  const payloadFingerprintRef = React.useRef<string>('');
  const validationRequestIdRef = React.useRef<number>(0);
  const validationAbortControllerRef = React.useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Vô hiệu hóa và hủy an toàn mọi request validation đang chạy (P1 & P2)
  const invalidateValidation = () => {
    if (validationAbortControllerRef.current) {
      try {
        validationAbortControllerRef.current.abort();
      } catch {}
      validationAbortControllerRef.current = null;
    }
    validationRequestIdRef.current++;
    setIsValidating(false);
    setValidationSuccess(null);
  };

  // Đồng bộ kho đích khi có initialToWarehouseId (#10-CTA)
  useEffect(() => {
    if (initialToWarehouseId) {
      setToWarehouseId(initialToWarehouseId);
      if (fromWarehouseId === initialToWarehouseId) {
        const alt = warehouses.find((w) => w.id !== initialToWarehouseId);
        if (alt) setFromWarehouseId(alt.id);
      }
      invalidateValidation();
    }
  }, [initialToWarehouseId, warehouses]);

  // Reset state khi mở/đóng lại modal
  useEffect(() => {
    if (!isOpen) {
      invalidateValidation();
      setSelectedIds(new Set());
      setBulkQtyInput('');
      setConfirmDeleteAll(false);
      setErrorMessage(null);
      setSuccessInfo(null);
      idempotencyKeyRef.current = null;
      payloadFingerprintRef.current = '';
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !isValidating) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, isValidating, onClose]);

  // Trạng thái chọn dòng & Master Checkbox
  const isAllSelected = lines.length > 0 && selectedIds.size === lines.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < lines.length;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const toggleSelectLine = (editionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(editionId)) {
        next.delete(editionId);
      } else {
        next.add(editionId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(lines.map((l) => l.editionId)));
    }
  };

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
    invalidateValidation();
    setErrorMessage(null);
  };

  const handleRemoveLine = (editionId: string) => {
    setLines((prev) => prev.filter((l) => l.editionId !== editionId));
    setSelectedIds((prev) => {
      if (!prev.has(editionId)) return prev;
      const next = new Set(prev);
      next.delete(editionId);
      return next;
    });
    invalidateValidation();
    setErrorMessage(null);
  };

  const handleRemoveSelected = () => {
    if (selectedIds.size === 0) return;
    setLines((prev) => prev.filter((l) => !selectedIds.has(l.editionId)));
    setSelectedIds(new Set());
    invalidateValidation();
    setErrorMessage(null);
  };

  const handleRemoveAll = () => {
    setLines([]);
    setSelectedIds(new Set());
    setConfirmDeleteAll(false);
    invalidateValidation();
    setErrorMessage(null);
  };

  const handleQuantityChange = (editionId: string, qty: number) => {
    const validQty = Math.max(1, Math.floor(qty) || 1);
    setLines((prev) =>
      prev.map((l) => (l.editionId === editionId ? { ...l, quantity: validQty, staleWarning: undefined } : l))
    );
    invalidateValidation();
    setErrorMessage(null);
  };

  const handleApplyBulkQuantity = () => {
    if (selectedIds.size === 0) {
      setErrorMessage('Vui lòng chọn ít nhất một dòng trước khi áp dụng số lượng.');
      return;
    }
    const trimmed = bulkQtyInput.trim();
    if (!trimmed) {
      setErrorMessage('Vui lòng nhập số lượng cần áp dụng.');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      setErrorMessage('Số lượng hàng loạt phải là số nguyên dương lớn hơn 0 (không nhận số âm, 0, thập phân).');
      return;
    }

    setLines((prev) =>
      prev.map((l) =>
        selectedIds.has(l.editionId) ? { ...l, quantity: parsed, staleWarning: undefined } : l
      )
    );
    setBulkQtyInput('');
    invalidateValidation();
    setErrorMessage(null);
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
    invalidateValidation();
    setErrorMessage(null);
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

    // Hủy request cũ nếu đang chạy
    if (validationAbortControllerRef.current) {
      try {
        validationAbortControllerRef.current.abort();
      } catch {}
    }
    const controller = new AbortController();
    validationAbortControllerRef.current = controller;

    setIsValidating(true);
    setErrorMessage(null);
    setValidationSuccess(null);
    const reqId = ++validationRequestIdRef.current;

    try {
      const res = await fetch('/api/inventory/transfer-batch/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fromWarehouseId,
          toWarehouseId,
          items: lines.map((l) => ({ editionId: l.editionId, quantity: l.quantity })),
        }),
      });

      const data = await res.json();
      // Bỏ qua nếu có thao tác mới xảy ra trong lúc chờ mạng
      if (reqId !== validationRequestIdRef.current) return;

      // Route trả {success, data:{ok, staleItems}}; đọc data.ok ở top-level
      // luôn undefined nên validate thành công vẫn bị coi là lỗi (bug #4).
      const result = data?.data ?? data;

      if (res.ok && result?.ok) {
        setValidationSuccess(true);
        // Xóa cảnh báo cũ nếu có
        setLines((prev) => prev.map((l) => ({ ...l, staleWarning: undefined })));
      } else if (res.status === 409 && result?.staleItems) {
        setValidationSuccess(false);
        const staleMap = new Map<string, { requested: number; availableNow: number }>();
        for (const item of result.staleItems) {
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
      if (err.name === 'AbortError') return;
      if (reqId !== validationRequestIdRef.current) return;
      setErrorMessage('Lỗi mạng khi kiểm tra tồn kho: ' + err.message);
    } finally {
      if (reqId === validationRequestIdRef.current) {
        setIsValidating(false);
        if (validationAbortControllerRef.current === controller) {
          validationAbortControllerRef.current = null;
        }
      }
    }
  };

  // 1-Chạm: Tự động hạ các dòng thiếu về tồn khả dụng tối đa, loại bỏ dòng có tồn = 0 (Spec #5)
  const handleCapToMax = () => {
    let zeroCount = 0;
    const nextLines: TransferLine[] = [];
    const removedIds = new Set<string>();

    for (const l of lines) {
      if (l.staleWarning && l.availableStock !== undefined) {
        if (l.availableStock <= 0) {
          zeroCount++;
          removedIds.add(l.editionId);
          continue;
        }
        nextLines.push({
          ...l,
          quantity: l.availableStock,
          staleWarning: undefined,
        });
      } else {
        nextLines.push(l);
      }
    }

    setLines(nextLines);
    if (removedIds.size > 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        removedIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    invalidateValidation();
    if (zeroCount > 0) {
      setErrorMessage(`Đã hạ số lượng về tồn tối đa và tự động loại bỏ ${zeroCount} đầu sách có tồn khả dụng bằng 0.`);
    } else {
      setErrorMessage(null);
    }
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
    if (validationSuccess !== true) {
      setErrorMessage('Vui lòng bấm "Kiểm tra tồn kho" thành công trước khi xác nhận chuyển kho.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const currentFingerprint = JSON.stringify({
      from: fromWarehouseId,
      to: toWarehouseId,
      note: note.trim(),
      items: lines.map((l) => ({ id: l.editionId, q: l.quantity })).sort((a, b) => a.id.localeCompare(b.id)),
    });

    let idempotencyKey: string;
    if (payloadFingerprintRef.current === currentFingerprint && idempotencyKeyRef.current) {
      idempotencyKey = idempotencyKeyRef.current;
    } else {
      idempotencyKey = `batch-transfer-${generateUUIDv7()}`;
      idempotencyKeyRef.current = idempotencyKey;
      payloadFingerprintRef.current = currentFingerprint;
    }

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
      const committed = data?.data ?? data;

      if (res.ok && data?.success !== false) {
        setSuccessInfo({
          pckCode: committed?.pckCode || 'PCK-SUCCESS',
          totalItems: lines.reduce((acc, l) => acc + l.quantity, 0),
        });
      } else if (res.status === 409 && committed?.staleItems) {
        // TOCTOU lúc commit
        setValidationSuccess(false);
        const staleMap = new Map<string, number>();
        for (const item of committed.staleItems) {
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
        setErrorMessage('Tồn kho nguồn đã biến động trong lúc thao tác. Đã đánh dấu đỏ dòng thiếu, vui lòng bấm "Hạ về tồn tối đa" rồi kiểm tra lại.');
      } else {
        setErrorMessage(data.error || 'Lỗi khi thực hiện chuyển kho hàng loạt.');
      }
    } catch (err: any) {
      setErrorMessage('Lỗi mạng khi gửi lệnh chuyển kho (dữ liệu được giữ nguyên để thử lại): ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting && !isValidating) onClose();
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/80">
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
                      invalidateValidation();
                      setErrorMessage(null);
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
                      invalidateValidation();
                      setErrorMessage(null);
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

              {/* Thanh thao tác hàng loạt (Bulk Actions Toolbar) */}
              {lines.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-slate-700">
                      Đã chọn: <strong className="text-indigo-600 font-mono text-sm">{selectedIds.size}</strong> / {lines.length} dòng
                    </span>
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      disabled={isSubmitting}
                      className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline disabled:opacity-50"
                    >
                      {isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Áp dụng SL hàng loạt */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={bulkQtyInput}
                        onChange={(e) => setBulkQtyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyBulkQuantity();
                          }
                        }}
                        placeholder="SL mới..."
                        disabled={isSubmitting || selectedIds.size === 0}
                        className="w-20 px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-slate-100"
                        title="Chỉ nhận số nguyên dương (> 0)"
                      />
                      <button
                        type="button"
                        onClick={handleApplyBulkQuantity}
                        disabled={isSubmitting || selectedIds.size === 0}
                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title={selectedIds.size === 0 ? 'Chọn ít nhất 1 dòng để áp dụng' : `Áp dụng SL cho ${selectedIds.size} dòng`}
                      >
                        Áp dụng ({selectedIds.size})
                      </button>
                    </div>

                    <div className="h-4 w-px bg-slate-300 mx-1 hidden sm:block"></div>

                    {/* Xóa dòng đã chọn */}
                    <button
                      type="button"
                      onClick={handleRemoveSelected}
                      disabled={isSubmitting || selectedIds.size === 0}
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Xóa ({selectedIds.size})
                    </button>

                    {/* Xóa tất cả có xác nhận */}
                    {confirmDeleteAll ? (
                      <div className="flex items-center gap-1 bg-rose-100/80 px-2 py-0.5 rounded-lg border border-rose-300">
                        <span className="text-[11px] font-bold text-rose-800">Xóa hết {lines.length} dòng?</span>
                        <button
                          type="button"
                          onClick={handleRemoveAll}
                          disabled={isSubmitting}
                          className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-bold shadow-xs transition"
                        >
                          Có
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAll(false)}
                          className="px-1.5 py-0.5 bg-white text-slate-700 hover:bg-slate-100 rounded text-[11px] font-semibold border border-slate-200 transition"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteAll(true)}
                        disabled={isSubmitting}
                        className="px-2.5 py-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition disabled:opacity-50"
                      >
                        Xóa tất cả
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Bảng chi tiết các dòng sách đã chọn */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100/80 sticky top-0 border-b border-slate-200 text-slate-600 font-bold">
                      <tr>
                        <th className="px-3 py-2 text-center w-10">
                          <input
                            type="checkbox"
                            ref={selectAllCheckboxRef}
                            checked={isAllSelected}
                            onChange={handleSelectAll}
                            disabled={isSubmitting || lines.length === 0}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                            title={isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                          />
                        </th>
                        <th className="px-2 py-2 text-left w-10">#</th>
                        <th className="px-3 py-2 text-left">Đầu Sách</th>
                        <th className="px-3 py-2 text-center w-28">Tồn Nguồn</th>
                        <th className="px-3 py-2 text-center w-32">Số Lượng Chuyển</th>
                        <th className="px-3 py-2 text-center w-12">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-slate-400 italic">
                            Chưa có đầu sách nào. Tìm kiếm ở trên hoặc bấm &quot;Thêm nhanh toàn bộ sách có tồn&quot;.
                          </td>
                        </tr>
                      ) : (
                        lines.map((line, idx) => (
                          <tr
                            key={line.editionId}
                            className={`transition-colors ${
                              line.staleWarning
                                ? 'bg-rose-50/80'
                                : selectedIds.has(line.editionId)
                                ? 'bg-indigo-50/40'
                                : 'hover:bg-slate-50/60'
                            }`}
                          >
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(line.editionId)}
                                onChange={() => toggleSelectLine(line.editionId)}
                                disabled={isSubmitting}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-2 py-2 font-mono text-slate-400 text-center">{idx + 1}</td>
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
                                disabled={isSubmitting}
                                value={line.quantity}
                                onChange={(e) =>
                                  handleQuantityChange(line.editionId, parseInt(e.target.value) || 1)
                                }
                                className={`w-20 px-2 py-1 text-center font-mono font-bold border rounded-lg focus:outline-none ${
                                  line.staleWarning
                                    ? 'border-rose-400 bg-rose-50 text-rose-700 focus:ring-1 focus:ring-rose-500'
                                    : 'border-slate-300 bg-white focus:ring-1 focus:ring-indigo-500'
                                } disabled:opacity-50`}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(line.editionId)}
                                disabled={isSubmitting}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                                title="Xóa dòng này"
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
          <div className="px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/80">
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
                disabled={isSubmitting || isValidating || lines.length === 0 || validationSuccess !== true}
                title={
                  validationSuccess !== true
                    ? 'Vui lòng bấm "Kiểm tra tồn kho" thành công trước khi chuyển'
                    : 'Xác nhận chuyển kho'
                }
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
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
