'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  Building2,
  Package,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Search,
  Percent,
  ClipboardPaste,
  Clock,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { matchesVietnameseSearch } from '@/lib/vietnamese';
import { stockOfWarehouse } from '@/lib/warehouse-stock';
import { parsePastedBookList } from '@/lib/batch-paste-parser';
import { DeliveryReceiptPrint, DeliveryOrderData } from './DeliveryReceiptPrint';

interface BookItem {
  id: string;
  code: string;
  title: string;
  isbn: string;
  isbnLast4?: string;
  author?: string;
  coverPrice: number;
  stockAuCo: number;
  stockQuynhMai: number;
  stockDuPhong: number;
  stockByWarehouse?: Record<string, number>;
}

interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
  warehouseType?: string;
}

interface PartnerItem {
  id: string;
  code: string;
  name: string;
  type?: string;
  discountRate?: number;
  address?: string | null;
  phone?: string | null;
}

interface WholesaleDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouses: WarehouseItem[];
  books: BookItem[];
  partners?: PartnerItem[];
  currentRole?: string;
  onOrderCreated?: (order: any) => void;
  initialDraft?: any | null;
}

interface SelectedItem {
  editionId: string;
  code: string;
  title: string;
  isbn: string;
  quantity: number;
  unitCoverPrice: number;
  unitSellingPrice: number;
  stockAvailable: number;
}

export function WholesaleDispatchModal({
  isOpen,
  onClose,
  warehouses,
  books,
  partners = [],
  currentRole = 'ROLE_WAREHOUSE',
  onOrderCreated,
  initialDraft = null,
}: WholesaleDispatchModalProps) {
  // Lọc chỉ lấy kho nguồn xuất hàng: LOẠI BỎ kho ký gửi (CONSIGNMENT) và kho trung chuyển (IN_TRANSIT)
  const availableSourceWarehouses = useMemo(() => {
    return warehouses.filter((wh) => {
      const type = wh.warehouseType;
      const code = wh.code || '';
      if (type === 'CONSIGNMENT' || type === 'IN_TRANSIT') return false;
      if (code.startsWith('KHO_KY_GUI')) return false;
      if (wh.isActive === false) return false;
      return true;
    });
  }, [warehouses]);

  const [fromWarehouseId, setFromWarehouseId] = useState<string>('wh-au-co');
  const [partnerId, setPartnerId] = useState<string>('');
  const [discountPercent, setDiscountPercent] = useState<number>(35); // 35% mặc định bán buôn
  const [fiscalScope, setFiscalScope] = useState<'COMMERCIAL_WHOLESALE' | 'CONSIGNMENT_DISPATCH'>('COMMERCIAL_WHOLESALE');
  const [note, setNote] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  // Quản lý trạng thái bản nháp (DRAFT)
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editingDraftCode, setEditingDraftCode] = useState<string | null>(null);
  const [draftsList, setDraftsList] = useState<any[]>([]);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Tìm kiếm sách để thêm
  const [searchBookTerm, setSearchBookTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Dán danh sách 2 cột (Tên + Số lượng) từ Excel
  const [isPasteOpen, setIsPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  // Kiểm tra tồn kho cứng ATP
  const [isCheckingAtp, setIsCheckingAtp] = useState(false);
  const [atpNotice, setAtpNotice] = useState<string | null>(null);
  const [checkedFingerprint, setCheckedFingerprint] = useState<string>('');

  // State in A4 sau khi xuất kho hoặc xem trước bản in
  const [createdOrderForPrint, setCreatedOrderForPrint] = useState<DeliveryOrderData | null>(null);
  const [previewOrderForPrint, setPreviewOrderForPrint] = useState<DeliveryOrderData | null>(null);

  // Đảm bảo kho nguồn mặc định luôn hợp lệ
  useEffect(() => {
    if (availableSourceWarehouses.length > 0) {
      if (!fromWarehouseId || !availableSourceWarehouses.some((w) => w.id === fromWarehouseId)) {
        const def = availableSourceWarehouses.find((w) => w.id === 'wh-au-co') || availableSourceWarehouses[0];
        setFromWarehouseId(def.id);
      }
    }
  }, [availableSourceWarehouses, fromWarehouseId]);

  // Tải danh sách bản nháp hiện có
  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/delivery-orders?status=DRAFT', {
        headers: { 'x-formapubli-role': currentRole },
      });
      const json = await res.json();
      if (json.success) {
        setDraftsList(json.data || []);
      }
    } catch (err) {
      console.error('Không tải được danh sách nháp:', err);
    }
  }, [currentRole]);

  useEffect(() => {
    if (isOpen) {
      fetchDrafts();
    }
  }, [isOpen, fetchDrafts]);

  // Nạp dữ liệu một bản nháp vào form soạn thảo
  const loadDraftIntoForm = useCallback(
    async (draft: any) => {
      try {
        setErrorMessage(null);
        setSaveSuccessMessage(null);
        let fullDraft = draft;
        if (!draft.items || draft.items.length === 0) {
          const res = await fetch(`/api/delivery-orders/${draft.id}`, {
            headers: { 'x-formapubli-role': currentRole },
          });
          const json = await res.json();
          if (json.success) {
            fullDraft = json.data;
          }
        }

        setEditingDraftId(fullDraft.id);
        setEditingDraftCode(fullDraft.code);
        setPartnerId(fullDraft.partnerId || '');
        if (fullDraft.fromWarehouseId) {
          setFromWarehouseId(fullDraft.fromWarehouseId);
        }
        setDiscountPercent(
          fullDraft.discountRate !== undefined ? Math.round(fullDraft.discountRate * 100) : 35
        );
        setFiscalScope(fullDraft.fiscalScope || 'COMMERCIAL_WHOLESALE');
        setNote(fullDraft.note || '');

        const mappedItems: SelectedItem[] = (fullDraft.items || []).map((it: any) => {
          const book = books.find((b) => b.id === it.editionId);
          const stock = book ? stockOfWarehouse(book, fullDraft.fromWarehouseId) : 0;
          return {
            editionId: it.editionId,
            code: it.editionCode || book?.code || '',
            title: it.title || book?.title || '',
            isbn: it.isbn || book?.isbn || '',
            quantity: it.quantity,
            unitCoverPrice: it.unitCoverPrice,
            unitSellingPrice: it.unitSellingPrice,
            stockAvailable: stock,
          };
        });
        setSelectedItems(mappedItems);
        setCheckedFingerprint('');
        setAtpNotice(null);
      } catch (e: any) {
        setErrorMessage(e.message || 'Không thể nạp bản nháp');
      }
    },
    [books, currentRole]
  );

  // Nhận initialDraft từ bên ngoài nếu có
  useEffect(() => {
    if (isOpen && initialDraft) {
      loadDraftIntoForm(initialDraft);
    }
  }, [isOpen, initialDraft, loadDraftIntoForm]);

  // Làm mới form để soạn phiếu mới hoàn toàn
  const handleResetNew = () => {
    setEditingDraftId(null);
    setEditingDraftCode(null);
    setSelectedItems([]);
    setNote('');
    setSaveSuccessMessage(null);
    setErrorMessage(null);
    setCheckedFingerprint('');
    setAtpNotice(null);
    if (partners && partners.length > 0) {
      setPartnerId(partners[0].id);
      if (partners[0].discountRate) {
        setDiscountPercent(Math.round(partners[0].discountRate * 100));
      }
    }
    if (availableSourceWarehouses.length > 0) {
      setFromWarehouseId(availableSourceWarehouses[0].id);
    }
  };

  const cartFingerprint = useMemo(() => {
    const parts = selectedItems
      .map((it) => `${it.editionId}:${it.quantity}`)
      .sort()
      .join('|');
    return `${fromWarehouseId}#${discountPercent}#${parts}`;
  }, [selectedItems, fromWarehouseId, discountPercent]);

  const applyPastedList = () => {
    const lookup = books.map((b) => ({
      id: b.id,
      title: b.title,
      code: b.code,
      isbnLast4: (b.isbn || '').slice(-4) || null,
    }));
    const { rows, summary } = parsePastedBookList(pasteText, lookup, { defaultQuantity: 5 });
    let added = 0;
    const problems: string[] = [];
    setSelectedItems((prev) => {
      const next = [...prev];
      for (const r of rows) {
        if (r.status !== 'matched') {
          problems.push(r.status === 'needs_confirm' ? `Chưa chắc: ${r.line}` : `Không thấy: ${r.line}`);
          continue;
        }
        const book = books.find((b) => b.id === r.editionId);
        if (!book) continue;
        const stock = stockOfWarehouse(book, fromWarehouseId);
        if (stock <= 0) {
          problems.push(`Hết tồn: ${r.title}`);
          continue;
        }
        const qty = Math.min(r.quantity, stock);
        if (qty < r.quantity) problems.push(`Chỉ còn ${stock}: ${r.title}`);
        const existing = next.find((it) => it.editionId === book.id);
        const cover = book.coverPrice || 0;
        if (existing) {
          existing.quantity = Math.min(existing.quantity + qty, stock);
        } else {
          next.push({
            editionId: book.id,
            code: book.code,
            title: book.title,
            isbn: book.isbn,
            quantity: qty,
            unitCoverPrice: cover,
            unitSellingPrice: Math.round(cover * (1 - discountPercent / 100)),
            stockAvailable: stock,
          });
        }
        added++;
      }
      return next;
    });
    setPasteNotice(
      `Đã thêm ${added}/${summary.matched} đầu sách` +
        (problems.length > 0 ? ` - cần xem: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? '…' : ''}` : '')
    );
    if (added > 0) {
      setPasteText('');
      setIsPasteOpen(false);
    }
    setCheckedFingerprint('');
    setAtpNotice(null);
  };

  const handleCheckAtp = async () => {
    if (selectedItems.length === 0) {
      setErrorMessage('Danh sách xuất kho trống! Hãy chọn ít nhất 1 đầu sách.');
      return;
    }
    try {
      setIsCheckingAtp(true);
      setErrorMessage(null);
      const ids = selectedItems.map((it) => it.editionId).join(',');
      const res = await fetch(
        `/api/atp?editionIds=${encodeURIComponent(ids)}&warehouseId=${encodeURIComponent(fromWarehouseId)}`
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Không kiểm tra được tồn kho');
      const atpById = new Map<string, number>(
        (json.data.items || []).map((it: any) => [it.editionId, Number(it.atp ?? 0)])
      );
      const short = selectedItems.filter((it) => it.quantity > (atpById.get(it.editionId) ?? 0));
      if (short.length > 0) {
        setCheckedFingerprint('');
        setAtpNotice(
          `Thiếu tồn khả dụng: ${short.map((it) => `[${it.code}] cần ${it.quantity}, còn ${atpById.get(it.editionId) ?? 0}`).join('; ')}`
        );
        return;
      }
      setCheckedFingerprint(cartFingerprint);
      setAtpNotice(`Đủ tồn khả dụng cho ${selectedItems.length} đầu sách tại kho xuất.`);
    } catch (err: any) {
      setCheckedFingerprint('');
      setErrorMessage(err.message || 'Lỗi kiểm tra tồn kho');
    } finally {
      setIsCheckingAtp(false);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !previewOrderForPrint && !createdOrderForPrint) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, previewOrderForPrint, createdOrderForPrint, onClose]);

  // Mặc định chọn đối tác đầu tiên nếu chưa chọn
  useEffect(() => {
    if (partners && partners.length > 0 && !partnerId && !editingDraftId) {
      setPartnerId(partners[0].id);
      if (partners[0].discountRate && partners[0].discountRate > 0) {
        setDiscountPercent(Math.round(partners[0].discountRate * 100));
      }
    }
  }, [partners, partnerId, editingDraftId]);

  // Khi đổi partner, tự động điền tỷ lệ chiết khấu hợp đồng của họ nếu có
  const handleSelectPartner = (pId: string) => {
    setPartnerId(pId);
    const p = partners.find((it) => it.id === pId);
    if (p && p.discountRate && p.discountRate > 0) {
      setDiscountPercent(Math.round(p.discountRate * 100));
    }
  };

  // Sách khả dụng sau lọc tìm kiếm: SỬA LỖI ĐẢO THAM SỐ (Target trước, Query sau)
  const filteredAvailableBooks = useMemo(() => {
    const q = searchBookTerm.trim();
    return books
      .filter((b) => {
        const stock = stockOfWarehouse(b, fromWarehouseId);
        if (stock <= 0) return false;
        if (!q) return true;
        const searchable = `${b.title} ${b.code} ${b.isbn} ${b.author || ''} ${b.isbnLast4 || ''}`;
        return matchesVietnameseSearch(searchable, q);
      })
      .slice(0, 15);
  }, [books, fromWarehouseId, searchBookTerm]);

  // Thêm sách vào danh sách xuất
  const handleAddItem = (book: BookItem) => {
    setErrorMessage(null);
    const stock = stockOfWarehouse(book, fromWarehouseId);
    if (stock <= 0) {
      setErrorMessage(`Ấn phẩm [${book.code}] hiện không còn tồn tại kho nguồn đã chọn!`);
      return;
    }

    setSelectedItems((prev) => {
      const existing = prev.find((it) => it.editionId === book.id);
      if (existing) {
        if (existing.quantity >= stock) {
          setErrorMessage(`Số lượng xuất [${book.code}] đã đạt tối đa tồn kho (${stock} cuốn).`);
          return prev;
        }
        return prev.map((it) =>
          it.editionId === book.id ? { ...it, quantity: it.quantity + 1 } : it
        );
      }

      const coverPrice = book.coverPrice || 0;
      const unitSelling = Math.round(coverPrice * (1 - discountPercent / 100));

      return [
        ...prev,
        {
          editionId: book.id,
          code: book.code,
          title: book.title,
          isbn: book.isbn,
          quantity: 1,
          unitCoverPrice: coverPrice,
          unitSellingPrice: unitSelling,
          stockAvailable: stock,
        },
      ];
    });
    setSearchBookTerm('');
  };

  // Cập nhật số lượng
  const handleUpdateQuantity = (editionId: string, qty: number) => {
    setSelectedItems((prev) =>
      prev
        .map((it) => {
          if (it.editionId !== editionId) return it;
          const newQty = Math.max(1, Math.min(it.stockAvailable, qty));
          return { ...it, quantity: newQty };
        })
        .filter(Boolean) as SelectedItem[]
    );
  };

  // Xóa sách khỏi danh sách
  const handleRemoveItem = (editionId: string) => {
    setSelectedItems((prev) => prev.filter((it) => it.editionId !== editionId));
  };

  // Tính toán tổng tiền
  const discountRate = discountPercent / 100;
  const subtotal = useMemo(() => {
    return selectedItems.reduce((sum, it) => sum + it.quantity * it.unitCoverPrice, 0);
  }, [selectedItems]);

  const discountAmount = Math.round(subtotal * discountRate);
  const finalAmount = subtotal - discountAmount;
  const totalQuantity = selectedItems.reduce((sum, it) => sum + it.quantity, 0);

  // Cập nhật lại đơn giá bán khi đổi % chiết khấu
  useEffect(() => {
    setSelectedItems((prev) =>
      prev.map((it) => ({
        ...it,
        unitSellingPrice: Math.round(it.unitCoverPrice * (1 - discountPercent / 100)),
      }))
    );
  }, [discountPercent]);

  // Xử lý gửi phiếu: createDraft, updateDraft, hoặc autoDispatch & Lock
  const handleSubmit = async (isAutoDispatch: boolean) => {
    if (!partnerId) {
      setErrorMessage('Vui lòng chọn đơn vị / đối tác nhận hàng.');
      return;
    }
    if (selectedItems.length === 0) {
      setErrorMessage('Danh sách xuất kho trống! Hãy chọn ít nhất 1 đầu sách.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      setSaveSuccessMessage(null);

      const itemsPayload = selectedItems.map((it) => ({
        editionId: it.editionId,
        quantity: it.quantity,
        unitCoverPrice: it.unitCoverPrice,
        unitSellingPrice: it.unitSellingPrice,
      }));

      if (isAutoDispatch) {
        // LUỒNG KÝ DUYỆT & KHÓA SỔ (Auto-dispatch)
        let finalOrderId = editingDraftId;
        const idemKey = generateUUIDv7();

        if (finalOrderId) {
          // Bước 1: Lưu các thay đổi mới nhất vào bản nháp
          await fetch(`/api/delivery-orders/${finalOrderId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'x-formapubli-role': currentRole,
            },
            body: JSON.stringify({
              partnerId,
              fromWarehouseId,
              discountRate,
              fiscalScope,
              note: note.trim() || undefined,
              items: itemsPayload,
            }),
          });

          // Bước 2: Ký duyệt xuất kho & khóa sổ
          const dispatchRes = await fetch(`/api/delivery-orders/${finalOrderId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-formapubli-role': currentRole,
            },
            body: JSON.stringify({
              action: 'DISPATCH',
              idempotencyKey: idemKey,
            }),
          });

          const dispatchJson = await dispatchRes.json();
          if (!dispatchJson.success) {
            throw new Error(dispatchJson.error || 'Lỗi khi ký duyệt xuất kho');
          }
          const dispatchedData = dispatchJson.data;

          const detailRes = await fetch(`/api/delivery-orders/${dispatchedData.id}`, {
            headers: { 'x-formapubli-role': currentRole },
          });
          const detailJson = await detailRes.json();
          const enrichedOrder = detailJson.success ? detailJson.data : dispatchedData;

          if (onOrderCreated) onOrderCreated(enrichedOrder);
          setCreatedOrderForPrint(enrichedOrder);
        } else {
          // Tạo mới trực tiếp và khóa sổ ngay
          const res = await fetch('/api/delivery-orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-formapubli-role': currentRole,
            },
            body: JSON.stringify({
              partnerId,
              fromWarehouseId,
              discountRate,
              fiscalScope,
              note: note.trim() || undefined,
              items: itemsPayload,
              autoDispatch: true,
              idempotencyKey: idemKey,
            }),
          });

          const json = await res.json();
          if (!json.success) {
            throw new Error(json.error || 'Lỗi xử lý phiếu xuất kho');
          }

          const orderData = json.data;
          const detailRes = await fetch(`/api/delivery-orders/${orderData.id}`, {
            headers: { 'x-formapubli-role': currentRole },
          });
          const detailJson = await detailRes.json();
          const enrichedOrder = detailJson.success ? detailJson.data : orderData;

          if (onOrderCreated) onOrderCreated(enrichedOrder);
          setCreatedOrderForPrint(enrichedOrder);
        }
      } else {
        // LUỒNG LƯU NHÁP (DRAFT)
        if (editingDraftId) {
          const res = await fetch(`/api/delivery-orders/${editingDraftId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'x-formapubli-role': currentRole,
            },
            body: JSON.stringify({
              partnerId,
              fromWarehouseId,
              discountRate,
              fiscalScope,
              note: note.trim() || undefined,
              items: itemsPayload,
            }),
          });

          const json = await res.json();
          if (!json.success) {
            throw new Error(json.error || 'Lỗi cập nhật phiếu nháp');
          }

          setSaveSuccessMessage(`Đã cập nhật bản nháp [${json.data.code}] thành công.`);
          fetchDrafts();
          if (onOrderCreated) onOrderCreated(json.data);
        } else {
          const res = await fetch('/api/delivery-orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-formapubli-role': currentRole,
            },
            body: JSON.stringify({
              partnerId,
              fromWarehouseId,
              discountRate,
              fiscalScope,
              note: note.trim() || undefined,
              items: itemsPayload,
              autoDispatch: false,
            }),
          });

          const json = await res.json();
          if (!json.success) {
            throw new Error(json.error || 'Lỗi lưu nháp phiếu xuất kho');
          }

          setEditingDraftId(json.data.id);
          setEditingDraftCode(json.data.code);
          setSaveSuccessMessage(`Đã lưu nháp [${json.data.code}] thành công. Bạn có thể xem trước hoặc chỉnh sửa tiếp.`);
          fetchDrafts();
          if (onOrderCreated) onOrderCreated(json.data);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi không xác định khi lập phiếu xuất kho');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mở cửa sổ Xem Trước Bản In A4 (Không khóa sổ, không trừ tồn kho)
  const handlePreviewPrint = () => {
    if (!partnerId) {
      setErrorMessage('Vui lòng chọn đơn vị / đối tác nhận hàng để xem trước bản in.');
      return;
    }
    if (selectedItems.length === 0) {
      setErrorMessage('Danh sách xuất kho trống! Hãy chọn ít nhất 1 đầu sách.');
      return;
    }

    const currentPartner = partners.find((p) => p.id === partnerId);
    const currentWh = warehouses.find((w) => w.id === fromWarehouseId);

    const previewOrder: DeliveryOrderData = {
      id: editingDraftId || 'preview-id',
      code: editingDraftCode || 'DRAFT-PREVIEW',
      partnerId,
      partnerName: currentPartner?.name || 'Đối tác nhận hàng',
      partnerCode: currentPartner?.code,
      partnerAddress: currentPartner?.address || null,
      partnerPhone: currentPartner?.phone || null,
      partnerReceiverName: null,
      fromWarehouseId,
      warehouseName: currentWh?.name || fromWarehouseId,
      subtotal,
      discountRate,
      finalAmount,
      fiscalScope,
      status: 'DRAFT',
      note: note.trim() || null,
      createdBy: 'Thủ kho',
      createdAt: new Date().toISOString(),
      items: selectedItems.map((it, idx) => ({
        id: `preview-${idx}`,
        editionId: it.editionId,
        editionCode: it.code,
        isbn: it.isbn,
        title: it.title,
        quantity: it.quantity,
        unitCoverPrice: it.unitCoverPrice,
        unitSellingPrice: it.unitSellingPrice,
        totalAmount: it.quantity * it.unitSellingPrice,
      })),
    };

    setPreviewOrderForPrint(previewOrder);
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isSubmitting) onClose();
        }}
      >
        <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
          {/* Header Modal */}
          <div className="bg-slate-900 text-white px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-base">Lập Phiếu Xuất Kho Đối Tác</h3>
                  {editingDraftCode && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/30 text-amber-300 text-[11px] font-mono font-bold">
                      Đang sửa: {editingDraftCode}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Xuất hàng đối tác: nhà sách, thư viện, trường học, đại lý - Cấp số liên tục trong Transaction
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1 text-slate-400 hover:text-white rounded-lg transition self-end sm:self-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Form */}
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {/* Thanh quản lý các bản nháp đang lưu */}
            {(draftsList.length > 0 || editingDraftCode) && (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  {editingDraftCode ? (
                    <span className="font-semibold text-amber-900">
                      Đang mở bản nháp: <b className="font-mono text-amber-800">{editingDraftCode}</b>
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-900">
                      Hệ thống có <b>{draftsList.length}</b> bản nháp xuất kho chưa khóa sổ.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {draftsList.length > 0 && (
                    <select
                      value={editingDraftId || ''}
                      onChange={(e) => {
                        const targetId = e.target.value;
                        if (targetId) {
                          const found = draftsList.find((d) => d.id === targetId);
                          if (found) loadDraftIntoForm(found);
                        } else {
                          handleResetNew();
                        }
                      }}
                      className="px-2.5 py-1 bg-white border border-amber-300 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-amber-500 max-w-[240px] truncate"
                    >
                      <option value="">-- Chọn bản nháp để nạp ({draftsList.length}) --</option>
                      {draftsList.map((d) => (
                        <option key={d.id} value={d.id}>
                          [{d.code}] {d.partnerName || 'Đối tác'} - {new Date(d.createdAt).toLocaleDateString('vi-VN')}
                        </option>
                      ))}
                    </select>
                  )}
                  {editingDraftId && (
                    <button
                      type="button"
                      onClick={handleResetNew}
                      className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-700 transition flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Lập mới
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Thông báo thành công */}
            {saveSuccessMessage && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-800 font-semibold animate-in fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{saveSuccessMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSaveSuccessMessage(null)}
                  className="text-emerald-600 hover:text-emerald-800 font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Thông báo lỗi */}
            {errorMessage && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-700 font-semibold animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Khung cấu hình thông tin xuất kho (ĐÃ ĐỔI VỊ TRÍ: Nguồn bên Trái, Nhận bên Phải) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              {/* 1. Chọn Kho Nguồn Xuất Hàng (BÊN TRÁI) */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Kho nguồn xuất hàng (*):
                </label>
                <select
                  value={fromWarehouseId}
                  onChange={(e) => {
                    setFromWarehouseId(e.target.value);
                    setCheckedFingerprint('');
                    setAtpNotice(null);
                  }}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {availableSourceWarehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      [{wh.code}] {wh.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Chọn Đơn vị / Đối tác Nhận Hàng (BÊN PHẢI) */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Đơn vị / Đối tác nhận hàng (*):
                </label>
                <select
                  value={partnerId}
                  onChange={(e) => handleSelectPartner(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">-- Chọn đơn vị / đối tác nhận hàng --</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.code}] {p.name} {p.discountRate ? `(CK: ${Math.round(p.discountRate * 100)}%)` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tỷ lệ chiết khấu đại lý */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">Chiết khấu đại lý (%):</label>
                  <div className="flex gap-1">
                    {[35, 40, 45, 50].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setDiscountPercent(rate)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition ${
                          discountPercent === rate
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {rate}%
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    className="w-full pl-3 pr-8 py-2 bg-white border border-slate-300 rounded-xl text-xs font-black font-mono text-slate-900 outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="absolute right-3 top-2 text-xs font-bold text-slate-400">%</span>
                </div>
              </div>

              {/* Tính chất kế toán */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Tính chất xuất kho:
                </label>
                <select
                  value={fiscalScope}
                  onChange={(e) => setFiscalScope(e.target.value as any)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="COMMERCIAL_WHOLESALE">Thương mại bán buôn (Ghi nhận doanh số)</option>
                  <option value="CONSIGNMENT_DISPATCH">Ký gửi đại lý (Chưa chuyển giao quyền sở hữu)</option>
                </select>
              </div>

              {/* Ghi chú */}
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Ghi chú điều chuyển / Giao nhận:
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ví dụ: Giao xe anh Tuấn, thanh toán 50% gối đầu..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Ô tìm kiếm & thêm sách vào danh sách */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 block">
                  Chọn ấn bản xuất kho (Tồn kho tại nguồn &gt; 0):
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsPasteOpen((v) => !v);
                    setPasteNotice(null);
                  }}
                  className="px-2.5 py-1 bg-white border border-slate-300 rounded-xl text-[11px] font-bold text-slate-700 hover:bg-slate-100 transition flex items-center gap-1"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Dán danh sách
                </button>
              </div>

              {isPasteOpen && (
                <div className="border border-amber-200 bg-amber-50/60 rounded-2xl p-3 space-y-2">
                  <p className="text-[11px] text-slate-600">
                    Dán 2 cột từ Excel: <b>Tên sách</b> + <b>Số lượng</b> (thiếu số lượng = 5 cuốn).
                  </p>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={5}
                    placeholder={'Bốn tình yêu\t10\nMay\t5'}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {pasteNotice && <p className="text-[11px] font-semibold text-slate-700">{pasteNotice}</p>}
                  <button
                    type="button"
                    onClick={applyPastedList}
                    disabled={!pasteText.trim()}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition disabled:opacity-50"
                  >
                    Thêm vào danh sách
                  </button>
                </div>
              )}

              <div className="relative">
                <input
                  type="text"
                  value={searchBookTerm}
                  onChange={(e) => setSearchBookTerm(e.target.value)}
                  placeholder="Gõ tên sách, tác giả, mã SKU hoặc 4 số cuối ISBN..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>

              {/* Gợi ý sách khi tìm kiếm */}
              {searchBookTerm.trim() && (
                <div className="border border-slate-200 rounded-2xl p-2 bg-white shadow-lg space-y-1 max-h-48 overflow-y-auto">
                  {filteredAvailableBooks.length === 0 ? (
                    <p className="text-xs text-slate-400 p-2 text-center">Không tìm thấy sách có tồn khả dụng tại kho này.</p>
                  ) : (
                    filteredAvailableBooks.map((b) => {
                      const stock = stockOfWarehouse(b, fromWarehouseId);
                      return (
                        <div
                          key={b.id}
                          onClick={() => handleAddItem(b)}
                          className="p-2 hover:bg-amber-50 rounded-xl cursor-pointer flex items-center justify-between text-xs transition"
                        >
                          <div>
                            <span className="font-mono font-bold text-amber-700 mr-2">[{b.code}]</span>
                            <span className="font-semibold text-slate-800">{b.title}</span>
                            {b.author && <span className="text-slate-400 ml-1.5 font-normal">({b.author})</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500 font-mono">
                              {(b.coverPrice || 0).toLocaleString('vi-VN')} đ
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 font-bold font-mono text-[11px]">
                              Tồn: {stock}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Bảng danh sách sách đã chọn */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[520px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold text-left border-b border-slate-200">
                      <th className="p-3 w-10 text-center">#</th>
                      <th className="p-3">Ấn bản sách</th>
                      <th className="p-3 text-right">Giá bìa</th>
                      <th className="p-3 text-center w-28">Số lượng</th>
                      <th className="p-3 text-right">Đơn giá bán</th>
                      <th className="p-3 text-right">Thành tiền</th>
                      <th className="p-3 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-400 italic">
                          Chưa có ấn bản nào được chọn để xuất kho. Hãy tìm kiếm ở trên.
                        </td>
                      </tr>
                    ) : (
                      selectedItems.map((item, idx) => (
                        <tr key={item.editionId} className="hover:bg-slate-50">
                          <td className="p-3 text-center font-mono text-slate-400">{idx + 1}</td>
                          <td className="p-3">
                            <p className="font-bold text-slate-800">
                              [{item.code}] {item.title}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono">Tồn tại kho: {item.stockAvailable}</p>
                          </td>
                          <td className="p-3 text-right font-mono text-slate-600">
                            {item.unitCoverPrice.toLocaleString('vi-VN')} đ
                          </td>
                          <td className="p-3 text-center">
                            <input
                              type="number"
                              min={1}
                              max={item.stockAvailable}
                              value={item.quantity}
                              onChange={(e) => handleUpdateQuantity(item.editionId, parseInt(e.target.value) || 1)}
                              className="w-16 px-2 py-1 text-center font-bold font-mono border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
                            />
                          </td>
                          <td className="p-3 text-right font-mono font-medium text-slate-700">
                            {item.unitSellingPrice.toLocaleString('vi-VN')} đ
                          </td>
                          <td className="p-3 text-right font-mono font-black text-slate-900">
                            {(item.quantity * item.unitSellingPrice).toLocaleString('vi-VN')} đ
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.editionId)}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded-lg transition"
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

            {/* Tóm tắt tổng tiền */}
            {selectedItems.length > 0 && (
              <div className="bg-amber-50/60 border border-amber-200/80 rounded-2xl p-4 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Tổng số lượng xuất:</span>
                  <span className="font-mono font-bold text-slate-900">{totalQuantity} cuốn</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tổng tiền giá bìa niêm yết:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {subtotal.toLocaleString('vi-VN')} đ
                  </span>
                </div>
                <div className="flex justify-between text-rose-600">
                  <span>Chiết khấu đối tác ({discountPercent}%):</span>
                  <span className="font-mono font-bold">
                    -{discountAmount.toLocaleString('vi-VN')} đ
                  </span>
                </div>
                <div className="pt-2 border-t border-amber-200 flex justify-between items-center text-sm font-black text-slate-900">
                  <span>TỔNG CỘNG THANH TOÁN:</span>
                  <span className="font-mono text-base text-amber-700">
                    {finalAmount.toLocaleString('vi-VN')} đ
                  </span>
                </div>
              </div>
            )}

            {/* Kết quả kiểm tra tồn kho cứng */}
            {atpNotice && (
              <div
                className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center gap-2 ${
                  checkedFingerprint === cartFingerprint
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{atpNotice}</span>
              </div>
            )}
          </div>

          {/* Footer nút hành động */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
            >
              Hủy Bỏ
            </button>
            <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
              {/* Kiểm tra tồn kho */}
              <button
                type="button"
                onClick={handleCheckAtp}
                disabled={isSubmitting || isCheckingAtp || selectedItems.length === 0}
                className="px-3.5 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5"
                title="Kiểm tra tồn kho khả dụng tại nguồn"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAtp ? 'animate-spin' : ''}`} />
                {isCheckingAtp ? 'Đang kiểm...' : 'Kiểm tra tồn kho'}
              </button>

              {/* Lưu nháp */}
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting || selectedItems.length === 0}
                className="px-3.5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5"
                title="Lưu lại bản nháp để soạn tiếp sau"
              >
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                {isSubmitting ? 'Đang lưu...' : editingDraftId ? 'Cập Nhật Nháp' : 'Lưu Nháp (DRAFT)'}
              </button>

              {/* Xem trước bản in A4 */}
              <button
                type="button"
                onClick={handlePreviewPrint}
                disabled={selectedItems.length === 0 || !partnerId}
                className="px-3.5 py-2.5 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-800 rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5"
                title="Xem trước mẫu in A4 gửi đối tác duyệt trước khi ký"
              >
                <Eye className="w-3.5 h-3.5 text-indigo-600" />
                Xem Trước Bản In
              </button>

              {/* Ký duyệt & In phiếu A4 */}
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting || selectedItems.length === 0}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-extrabold shadow-md transition disabled:opacity-50 flex items-center gap-1.5"
                title="Khóa sổ xuất kho & in phiếu A4 chính thức"
              >
                <Printer className="w-4 h-4" />
                {isSubmitting ? 'Đang khóa sổ...' : 'Ký Duyệt & In Phiếu A4'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal in phiếu xuất kho A4 (Chính thức hoặc Xem trước) */}
      {(createdOrderForPrint || previewOrderForPrint) &&
        (() => {
          const orderForPrint = createdOrderForPrint || previewOrderForPrint!;
          // Chỉ cho xóa khi là nháp THẬT trong DB (preview chưa lưu dùng id giả 'preview-id').
          const canDeleteDraft =
            orderForPrint.status === 'DRAFT' && orderForPrint.id !== 'preview-id';
          return (
            <DeliveryReceiptPrint
              order={orderForPrint}
              isOpen={true}
              onClose={() => {
                if (createdOrderForPrint) {
                  setCreatedOrderForPrint(null);
                  onClose();
                } else {
                  setPreviewOrderForPrint(null);
                }
              }}
              onDeleteDraft={
                canDeleteDraft
                  ? async (orderId: string) => {
                      const res = await fetch(`/api/delivery-orders/${orderId}`, {
                        method: 'DELETE',
                        headers: { 'x-formapubli-role': currentRole },
                      });
                      const json = await res.json().catch(() => ({}));
                      if (!res.ok || !json.success) {
                        throw new Error(json.error || 'Xoá bản nháp thất bại');
                      }
                      setPreviewOrderForPrint(null);
                      setCreatedOrderForPrint(null);
                      setEditingDraftId(null);
                      setEditingDraftCode(null);
                      fetchDrafts();
                    }
                  : undefined
              }
            />
          );
        })()}
    </>,
    document.body
  );
}
