'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
} from 'lucide-react';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { matchesVietnameseSearch } from '@/lib/vietnamese';
import { DeliveryReceiptPrint, DeliveryOrderData } from './DeliveryReceiptPrint';

interface BookItem {
  id: string;
  code: string;
  title: string;
  isbn: string;
  coverPrice: number;
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

interface PartnerItem {
  id: string;
  code: string;
  name: string;
  type?: string;
  discountRate?: number;
}

interface WholesaleDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouses: WarehouseItem[];
  books: BookItem[];
  partners?: PartnerItem[];
  currentRole?: string;
  onOrderCreated?: (order: any) => void;
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
}: WholesaleDispatchModalProps) {
  const [partnerId, setPartnerId] = useState<string>('');
  const [fromWarehouseId, setFromWarehouseId] = useState<string>('wh-au-co');
  const [discountPercent, setDiscountPercent] = useState<number>(35); // 35% mặc định bán buôn
  const [fiscalScope, setFiscalScope] = useState<'COMMERCIAL_WHOLESALE' | 'CONSIGNMENT_DISPATCH'>('COMMERCIAL_WHOLESALE');
  const [note, setNote] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  // Tìm kiếm sách để thêm
  const [searchBookTerm, setSearchBookTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // State hiển thị modal in A4 sau khi xuất kho thành công
  const [createdOrderForPrint, setCreatedOrderForPrint] = useState<DeliveryOrderData | null>(null);

  // Mặc định chọn đối tác đầu tiên nếu có
  useEffect(() => {
    if (partners && partners.length > 0 && !partnerId) {
      setPartnerId(partners[0].id);
      if (partners[0].discountRate && partners[0].discountRate > 0) {
        setDiscountPercent(Math.round(partners[0].discountRate * 100));
      }
    }
  }, [partners, partnerId]);

  // Khi đổi partner, tự động điền tỷ lệ chiết khấu hợp đồng của họ nếu có
  const handleSelectPartner = (pId: string) => {
    setPartnerId(pId);
    const p = partners.find((it) => it.id === pId);
    if (p && p.discountRate && p.discountRate > 0) {
      setDiscountPercent(Math.round(p.discountRate * 100));
    }
  };

  // Tính tồn kho của sách tại kho nguồn được chọn
  const getBookStockInWarehouse = (book: BookItem, whId: string) => {
    if (whId === 'wh-au-co') return book.stockAuCo;
    if (whId === 'wh-quynh-mai') return book.stockQuynhMai;
    if (whId === 'wh-du-phong') return book.stockDuPhong;
    return book.totalStock || 0;
  };

  // Sách khả dụng sau lọc
  const filteredAvailableBooks = useMemo(() => {
    const q = searchBookTerm.trim();
    return books
      .filter((b) => {
        const stock = getBookStockInWarehouse(b, fromWarehouseId);
        if (stock <= 0) return false;
        if (!q) return true;
        return matchesVietnameseSearch(q, `${b.title} ${b.code} ${b.isbn}`);
      })
      .slice(0, 10);
  }, [books, fromWarehouseId, searchBookTerm]);

  // Thêm sách vào danh sách xuất
  const handleAddItem = (book: BookItem) => {
    setErrorMessage(null);
    const stock = getBookStockInWarehouse(book, fromWarehouseId);
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

  // Xử lý gửi phiếu: createDraft hoặc autoDispatch
  const handleSubmit = async (isAutoDispatch: boolean) => {
    if (!partnerId) {
      setErrorMessage('Vui lòng chọn đối tác / đại lý nhận hàng.');
      return;
    }
    if (selectedItems.length === 0) {
      setErrorMessage('Danh sách xuất kho trống! Hãy chọn ít nhất 1 đầu sách.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const payload = {
        partnerId,
        fromWarehouseId,
        discountRate,
        fiscalScope,
        note: note.trim() || undefined,
        items: selectedItems.map((it) => ({
          editionId: it.editionId,
          quantity: it.quantity,
          unitCoverPrice: it.unitCoverPrice,
          unitSellingPrice: it.unitSellingPrice,
        })),
        autoDispatch: isAutoDispatch,
        idempotencyKey: isAutoDispatch ? generateUUIDv7() : undefined,
      };

      const res = await fetch('/api/delivery-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-formapubli-role': currentRole,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Lỗi xử lý phiếu xuất kho');
      }

      const orderData = json.data;

      // Tra cứu chi tiết đầy đủ để chuẩn bị in A4
      const detailRes = await fetch(`/api/delivery-orders/${orderData.id}`, {
        headers: { 'x-formapubli-role': currentRole },
      });
      const detailJson = await detailRes.json();
      const enrichedOrder = detailJson.success ? detailJson.data : orderData;

      if (onOrderCreated) {
        onOrderCreated(enrichedOrder);
      }

      if (isAutoDispatch) {
        // Mở ngay cửa sổ in A4
        setCreatedOrderForPrint(enrichedOrder);
      } else {
        alert(`Đã lưu nháp thành công phiếu: ${enrichedOrder.code}`);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi không xác định khi lập phiếu xuất kho');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
          {/* Header Modal */}
          <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base">Lập Phiếu Xuất Kho Cung Ứng Đối Tác (PXK)</h3>
                <p className="text-xs text-slate-400">
                  Xuất hàng đối tác (nhà sách, thư viện, trường học, đại lý...) — Cấp số liên tục trong Transaction
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1 text-slate-400 hover:text-white rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Form */}
          <div className="p-6 space-y-5 overflow-y-auto flex-1">
            {errorMessage && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-700 font-semibold animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Khung cấu hình thông tin xuất kho */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              {/* Chọn Đại lý / Đối tác */}
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

              {/* Chọn Kho Xuất */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Kho nguồn xuất hàng (*):
                </label>
                <select
                  value={fromWarehouseId}
                  onChange={(e) => setFromWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      [{wh.code}] {wh.name}
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
              <label className="text-xs font-bold text-slate-700 block">
                Chọn ấn bản xuất kho (Tồn kho tại nguồn &gt; 0):
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchBookTerm}
                  onChange={(e) => setSearchBookTerm(e.target.value)}
                  placeholder="Gõ tên sách, mã SKU hoặc 4 số cuối ISBN..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>

              {/* Gợi ý sách khi tìm kiếm */}
              {searchBookTerm.trim() && (
                <div className="border border-slate-200 rounded-2xl p-2 bg-white shadow-lg space-y-1 max-h-48 overflow-y-auto">
                  {filteredAvailableBooks.length === 0 ? (
                    <p className="text-xs text-slate-400 p-2 text-center">Không tìm thấy sách có tồn khả dụng.</p>
                  ) : (
                    filteredAvailableBooks.map((b) => {
                      const stock = getBookStockInWarehouse(b, fromWarehouseId);
                      return (
                        <div
                          key={b.id}
                          onClick={() => handleAddItem(b)}
                          className="p-2 hover:bg-amber-50 rounded-xl cursor-pointer flex items-center justify-between text-xs transition"
                        >
                          <div>
                            <span className="font-mono font-bold text-amber-700 mr-2">[{b.code}]</span>
                            <span className="font-semibold text-slate-800">{b.title}</span>
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
              <table className="w-full text-xs">
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
                  <span>TỔNG CỘNG THANH TOÁN (PXK):</span>
                  <span className="font-mono text-base text-amber-700">
                    {finalAmount.toLocaleString('vi-VN')} đ
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer nút hành động */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition"
            >
              Hủy Bỏ
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting || selectedItems.length === 0}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition disabled:opacity-50"
              >
                {isSubmitting ? 'Đang lưu...' : 'Lưu Nháp (DRAFT)'}
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting || selectedItems.length === 0}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-extrabold shadow-md transition disabled:opacity-50 flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                {isSubmitting ? 'Đang khóa sổ...' : 'Ký Duyệt & In Phiếu A4'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal in phiếu xuất kho A4 sau khi xuất */}
      {createdOrderForPrint && (
        <DeliveryReceiptPrint
          order={createdOrderForPrint}
          isOpen={!!createdOrderForPrint}
          onClose={() => {
            setCreatedOrderForPrint(null);
            onClose();
          }}
        />
      )}
    </>
  );
}
