'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Building2,
  Percent,
  Receipt,
  CreditCard,
  Banknote,
  QrCode,
  Mic,
  MicOff,
  Keyboard,
  Printer,
  X,
  Layers,
} from 'lucide-react';
import { matchesAnyVietnameseField } from '@/lib/vietnamese';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { UserRole } from '@/lib/roles';

interface BookItem {
  id: string;
  code: string;
  title: string;
  isbn: string;
  isbnLast4: string;
  author: string;
  coverPrice: number;
  stockAuCo: number;
  stockQuynhMai: number;
  stockDuPhong: number;
  totalStock: number;
}

interface CartItem {
  editionId: string;
  code: string;
  title: string;
  coverPrice: number;
  quantity: number;
  stockAvailable: number;
}

interface PosCheckoutTerminalProps {
  books: BookItem[];
  currentRole: UserRole;
  onOrderCompleted?: () => void;
}

export function PosCheckoutTerminal({
  books,
  currentRole,
  onOrderCompleted,
}: PosCheckoutTerminalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('wh-au-co');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('Khách lẻ vãng lai');
  const [discountRate, setDiscountRate] = useState(0.0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'QR_CODE'>('CASH');
  const [fiscalScope, setFiscalScope] = useState<'INTERNAL_MANAGEMENT' | 'OFFICIAL_TAX'>('INTERNAL_MANAGEMENT');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<any | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Micro giọng nói tiếng Việt đồng bộ
  const { isListening, isSupported, toggleListening } = useVoiceSearch((text) => {
    setSearchQuery(text);
  });

  // Bộ lọc sách thời gian thực
  const filteredBooks = useMemo(() => {
    if (!searchQuery.trim()) return books.slice(0, 20); // Hiển thị 20 cuốn đầu
    return books.filter((b) =>
      matchesAnyVietnameseField(searchQuery, [
        b.title,
        b.code,
        b.isbnLast4,
        b.author,
      ])
    );
  }, [books, searchQuery]);

  // Thêm sách vào giỏ
  const addToCart = (book: BookItem) => {
    setErrorMessage(null);
    const availableStock =
      selectedWarehouseId === 'wh-au-co'
        ? book.stockAuCo
        : selectedWarehouseId === 'wh-du-phong'
        ? book.stockDuPhong
        : book.stockQuynhMai;

    if (availableStock <= 0) {
      setErrorMessage(`Sách [${book.code}] ${book.title} hiện đã hết hàng tại kho được chọn!`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.editionId === book.id);
      if (existing) {
        if (existing.quantity >= availableStock) {
          setErrorMessage(`Số lượng trong giỏ (${existing.quantity}) đã đạt mức tồn kho tối đa (${availableStock})!`);
          return prev;
        }
        return prev.map((item) =>
          item.editionId === book.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          editionId: book.id,
          code: book.code,
          title: book.title,
          coverPrice: book.coverPrice,
          quantity: 1,
          stockAvailable: availableStock,
        },
      ];
    });
  };

  const updateQuantity = (editionId: string, delta: number) => {
    setErrorMessage(null);
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.editionId === editionId) {
            const newQty = item.quantity + delta;
            if (newQty > item.stockAvailable) {
              setErrorMessage(`Tồn kho chỉ còn ${item.stockAvailable} cuốn!`);
              return item;
            }
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (editionId: string) => {
    setCart((prev) => prev.filter((item) => item.editionId !== editionId));
  };

  // Tính toán số liệu giỏ hàng
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity * item.coverPrice, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    return Math.round(subtotal * discountRate);
  }, [subtotal, discountRate]);

  const finalAmount = subtotal - discountAmount;
  const totalCopies = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Xử lý nộp đơn bán hàng
  const handleCheckout = async () => {
    if (cart.length === 0) {
      setErrorMessage('Giỏ hàng trống! Vui lòng chọn ít nhất 1 cuốn sách.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: selectedWarehouseId,
          channel: selectedWarehouseId === 'wh-du-phong' ? 'FAIR_EVENT' : 'RETAIL_OFFICE',
          customerName,
          discountRate,
          paymentMethod,
          fiscalScope,
          cashierId: `User-${currentRole}`,
          note,
          items: cart.map((item) => ({
            editionId: item.editionId,
            quantity: item.quantity,
          })),
        }),
      });

      const resData = await response.json();
      if (!resData.success) {
        throw new Error(resData.error || 'Lỗi tạo đơn hàng');
      }

      setCompletedOrder({
        ...resData.data,
        items: [...cart],
        discountRate,
        paymentMethod,
        date: new Date().toLocaleString('vi-VN'),
      });

      // Xóa giỏ hàng
      setCart([]);
      setNote('');
      if (onOrderCompleted) onOrderCompleted();
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi xử lý thanh toán.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Lắng nghe phím tắt toàn cục không xung đột cho màn hình POS:
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isTypingInInput = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT';

      // 1. Phím '/' -> Nhảy vào ô tìm kiếm (chỉ khi không đang gõ trong input khác)
      if (e.key === '/' && !isTypingInInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // 2. Phím 'Escape' -> Xóa tìm kiếm hoặc đóng modal
      if (e.key === 'Escape') {
        if (completedOrder) {
          setCompletedOrder(null);
        } else if (searchQuery) {
          setSearchQuery('');
          searchInputRef.current?.focus();
        } else if (isTypingInInput) {
          (e.target as HTMLElement)?.blur();
        }
        return;
      }

      // 3. Tổ hợp Alt + Shift + V -> Bật/Tắt Micro giọng nói tiếng Việt
      if (e.altKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        toggleListening();
        return;
      }

      // 4. Tổ hợp Ctrl + Enter (hoặc Cmd + Enter) -> Thanh toán & Khấu trừ kho
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCheckout();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, selectedWarehouseId, customerName, discountRate, paymentMethod, fiscalScope, completedOrder, searchQuery, isListening, toggleListening]);

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-600" />
            Quầy Thu Ngân Bán Sách Siêu Tốc (POS)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Phím tắt <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-[11px]">/</kbd> tìm sách | <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-[11px]">Ctrl+Enter</kbd> thanh toán & trừ kho
          </p>
        </div>

        {/* Warehouse Selector */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs font-bold text-slate-500 shrink-0">Kho xuất bán:</span>
          <select
            value={selectedWarehouseId}
            onChange={(e) => {
              setSelectedWarehouseId(e.target.value);
              setCart([]); // Reset giỏ khi đổi kho để đảm bảo tồn kho
            }}
            className="bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer min-h-[44px]"
          >
            <option value="wh-au-co">Kho 1 - Âu Cơ (Văn phòng chính)</option>
            <option value="wh-du-phong">Kho 3 - Hội Chợ (Gian hàng sự kiện)</option>
            <option value="wh-quynh-mai">Kho 2 - Quỳnh Mai (Kho tổng)</option>
          </select>
        </div>
      </div>

      {/* Main Split-View: Left Products (2 Cols) + Right Cart (1 Col) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Search & Book Catalog Selection */}
        <div className="lg:col-span-7 space-y-4">
          {/* Search Box with Voice Mic */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              ref={searchInputRef}
              type="text"
              id="pos-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder="Gõ tên không dấu (truong, benh), mã (H01), 4 số cuối (7507)..."
              className="w-full pl-10 pr-24 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none shadow-sm min-h-[48px]"
            />
            {/* Shortcut hint badge: [/] */}
            {!searchQuery && !isInputFocused && (
              <span className="absolute right-12 text-[10px] font-mono text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded pointer-events-none hidden sm:inline">
                /
              </span>
            )}
            <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                  title="Xóa tìm kiếm (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              {isSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`p-2 rounded-xl text-xs font-bold transition-all min-h-[36px] min-w-[36px] flex items-center justify-center ${
                    isListening
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-600/40 animate-pulse'
                      : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'
                  }`}
                  title="Tìm bằng giọng nói tiếng Việt (Alt + Shift + V)"
                >
                  {isListening ? <MicOff className="w-4 h-4 animate-bounce" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          {/* Book Catalog Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[560px] overflow-y-auto pr-1">
            {filteredBooks.map((b) => {
              const currentStock =
                selectedWarehouseId === 'wh-au-co'
                  ? b.stockAuCo
                  : selectedWarehouseId === 'wh-du-phong'
                  ? b.stockDuPhong
                  : b.stockQuynhMai;

              const isOutOfStock = currentStock <= 0;

              return (
                <div
                  key={b.id}
                  onClick={() => !isOutOfStock && addToCart(b)}
                  className={`p-3.5 bg-white rounded-2xl border transition-all cursor-pointer flex flex-col justify-between select-none ${
                    isOutOfStock
                      ? 'opacity-50 border-slate-200 cursor-not-allowed bg-slate-50/60'
                      : 'border-slate-200/80 hover:border-emerald-500 hover:shadow-md active:scale-[0.98]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-mono font-black">
                        {b.code}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                          currentStock > 10
                            ? 'bg-emerald-50 text-emerald-700'
                            : currentStock > 0
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        Tồn: {currentStock}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug">
                      {b.title}
                    </h4>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {b.author}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
                    <span className="text-xs font-black text-emerald-700 font-mono">
                      {b.coverPrice.toLocaleString('vi-VN')} đ
                    </span>
                    <button
                      disabled={isOutOfStock}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-colors"
                    >
                      + Thêm
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Order Cart & Checkout Controls */}
        <div className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-600" />
                Giỏ Hàng Quầy ({totalCopies} cuốn)
              </h3>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
                >
                  Xóa giỏ
                </button>
              )}
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Cart Items List */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                  <ShoppingCart className="w-8 h-8 text-slate-300 stroke-1" />
                  <span>Chưa có sách trong giỏ. Chọn sách ở danh mục bên trái.</span>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.editionId}
                    className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                  >
                    <div className="truncate flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-indigo-700">
                          [{item.code}]
                        </span>
                        <span className="text-xs font-bold text-slate-800 truncate">
                          {item.title}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {item.coverPrice.toLocaleString('vi-VN')} đ / cuốn
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden">
                        <button
                          onClick={() => updateQuantity(item.editionId, -1)}
                          className="p-1 hover:bg-slate-100 text-slate-600 min-h-[32px] min-w-[32px] flex items-center justify-center"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-2 text-xs font-mono font-bold text-slate-900">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.editionId, 1)}
                          className="p-1 hover:bg-slate-100 text-slate-600 min-h-[32px] min-w-[32px] flex items-center justify-center"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        onClick={() => removeFromCart(item.editionId)}
                        className="p-1 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Customer & Discount Controls */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">
                  Khách hàng / Đầu nậu:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Tên khách hàng..."
                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <select
                    onChange={(e) => {
                      if (e.target.value === 'LE') {
                        setCustomerName('Khách lẻ hội chợ');
                        setDiscountRate(0.10);
                        setFiscalScope('INTERNAL_MANAGEMENT');
                      } else if (e.target.value === 'DAU_NAU') {
                        setCustomerName('Đầu nậu Đinh Lễ (Sỉ)');
                        setDiscountRate(0.40);
                        setFiscalScope('INTERNAL_MANAGEMENT');
                      } else if (e.target.value === 'VAT') {
                        setCustomerName('Công ty Doanh nghiệp (Xuất VAT)');
                        setDiscountRate(0.0);
                        setFiscalScope('OFFICIAL_TAX');
                      }
                    }}
                    className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none"
                  >
                    <option value="">-- Mẫu đối tượng --</option>
                    <option value="LE">Khách lẻ (-10%)</option>
                    <option value="DAU_NAU">Đầu nậu Đinh Lễ (-40%)</option>
                    <option value="VAT">Doanh nghiệp (Xuất VAT)</option>
                  </select>
                </div>
              </div>

              {/* Discount Selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-slate-500">
                    Chiết khấu thương mại:
                  </span>
                  <span className="text-xs font-black text-amber-600 font-mono">
                    {Math.round(discountRate * 100)}%
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 0.10, 0.20, 0.35, 0.40].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setDiscountRate(rate)}
                      className={`py-1 rounded-lg text-xs font-bold font-mono transition-colors ${
                        discountRate === rate
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {rate === 0 ? '0%' : `${rate * 100}%`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fiscal Scope (Sổ Kép) & Payment Method */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 block mb-1">
                    Phân loại Sổ:
                  </label>
                  <select
                    value={fiscalScope}
                    onChange={(e) => setFiscalScope(e.target.value as any)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                  >
                    <option value="INTERNAL_MANAGEMENT">Nội bộ / Đầu nậu</option>
                    <option value="OFFICIAL_TAX">Xuất Hóa đơn VAT</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-500 block mb-1">
                    Thanh toán:
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                  >
                    <option value="CASH">Tiền mặt</option>
                    <option value="BANK_TRANSFER">Chuyển khoản</option>
                    <option value="QR_CODE">Mã QR</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Financial Totals & Checkout Button */}
          <div className="pt-4 border-t border-slate-200 space-y-3 mt-4">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Tổng tiền bìa ({totalCopies} cuốn):</span>
                <span className="font-mono">{subtotal.toLocaleString('vi-VN')} đ</span>
              </div>
              <div className="flex justify-between text-amber-600 font-medium">
                <span>Tiền chiết khấu ({Math.round(discountRate * 100)}%):</span>
                <span className="font-mono">-{discountAmount.toLocaleString('vi-VN')} đ</span>
              </div>
              <div className="flex justify-between items-baseline pt-1 border-t border-slate-100">
                <span className="text-sm font-black text-slate-900">THỰC THU:</span>
                <span className="text-2xl font-black text-emerald-700 font-mono">
                  {finalAmount.toLocaleString('vi-VN')} đ
                </span>
              </div>
            </div>

            <button
              onClick={handleCheckout}
              disabled={isSubmitting || cart.length === 0}
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-extrabold rounded-2xl text-sm shadow-xl shadow-emerald-600/25 transition-all flex items-center justify-center gap-2 min-h-[50px]"
            >
              {isSubmitting ? (
                <span>Đang khấu trừ kho & tạo đơn...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  <span>THANH TOÁN & KHẤU TRỪ KHO (Ctrl+Enter)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Order Success Receipt Modal */}
      {completedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-emerald-600 font-extrabold text-base">
                <CheckCircle2 className="w-6 h-6" />
                <span>Bán Hàng Thành Công!</span>
              </div>
              <button
                onClick={() => setCompletedOrder(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs font-mono">
              <div className="flex justify-between font-bold text-slate-900">
                <span>MÃ ĐƠN:</span>
                <span className="text-indigo-600">{completedOrder.orderCode}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Khách hàng:</span>
                <span>{completedOrder.customerName}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Kho xuất:</span>
                <span>{completedOrder.warehouseId === 'wh-au-co' ? 'Kho Âu Cơ' : 'Kho Hội Chợ'}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Phân loại sổ:</span>
                <span className="font-bold">
                  {completedOrder.fiscalScope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Nội bộ / Đầu nậu'}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Tổng số sách:</span>
                <span>{completedOrder.totalQuantity} cuốn</span>
              </div>
              <div className="flex justify-between font-black text-sm pt-2 border-t border-slate-200 text-emerald-700">
                <span>THỰC THU:</span>
                <span>{completedOrder.finalAmount.toLocaleString('vi-VN')} đ</span>
              </div>
            </div>

            <p className="text-[11px] text-emerald-700 text-center font-medium bg-emerald-50 py-1.5 rounded-lg border border-emerald-200">
              ✅ Thẻ kho vật lý đã được khấu trừ tức thì. Kho máy = Kho kệ 100%!
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                In Phiếu Giao Hàng
              </button>
              <button
                onClick={() => setCompletedOrder(null)}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs"
              >
                Tạo Đơn Tiếp Theo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
