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
  Camera,
  Wifi,
  WifiOff,
  RefreshCw,
  CloudUpload,
} from 'lucide-react';
import { matchesAnyVietnameseField } from '@/lib/vietnamese';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { InAppBarcodeScanner } from '@/components/scanner/InAppBarcodeScanner';
import { generateUUIDv7 } from '@/lib/uuidv7';
import {
  saveOfflineOrder,
  getPendingOfflineOrders,
  removeOfflineOrder,
  getPendingOrdersCount,
  OfflineOrder,
} from '@/lib/offline-db';
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
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanToast, setScanToast] = useState<{ title: string; code: string; isbn: string } | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingOfflineCount, setPendingOfflineCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Micro giọng nói tiếng Việt đồng bộ
  const {
    isListening,
    isSupported,
    error: voiceError,
    startListening,
    stopListening,
    toggleListening,
    clearError: clearVoiceError,
  } = useVoiceSearch((text) => {
    setSearchQuery(text);
  });

  // Xử lý đồng bộ các đơn hàng ngoại tuyến lên máy chủ
  const syncPendingOrders = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const pending = await getPendingOfflineOrders();
      if (pending.length === 0) {
        setPendingOfflineCount(0);
        setIsSyncing(false);
        return;
      }
      let successCount = 0;
      for (const order of pending) {
        try {
          const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: order.id,
              orderCode: order.orderCode,
              idempotencyKey: order.idempotencyKey,
              createdAt: order.createdAt,
              warehouseId: order.warehouseId,
              channel: order.channel,
              customerName: order.customerName,
              discountRate: order.discountRate,
              paymentMethod: order.paymentMethod,
              fiscalScope: order.fiscalScope,
              cashierId: order.cashierId,
              note: order.note,
              items: order.items.map((it) => ({
                editionId: it.editionId,
                quantity: it.quantity,
                unitCoverPrice: it.unitCoverPrice,
              })),
            }),
          });
          const resData = await res.json();
          if (resData.success) {
            await removeOfflineOrder(order.id);
            successCount++;
          } else {
            console.error('Lỗi khi đồng bộ đơn', order.orderCode, resData.error);
            break;
          }
        } catch (err) {
          console.error('Mạng gián đoạn trong khi sync:', err);
          break;
        }
      }
      const remaining = await getPendingOrdersCount();
      setPendingOfflineCount(remaining);
      if (successCount > 0) {
        setSyncToast(`🎉 Đã đồng bộ thành công ${successCount} đơn hàng ngoại tuyến lên máy chủ!`);
        setTimeout(() => setSyncToast(null), 4000);
        if (onOrderCompleted) onOrderCompleted();
      }
    } catch (err: any) {
      console.error('Lỗi đồng bộ:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Lắng nghe sự kiện Online/Offline của mạng và đếm đơn chờ sync
  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);

    const checkCount = async () => {
      const count = await getPendingOrdersCount();
      setPendingOfflineCount(count);
    };
    checkCount();

    const handleOnline = () => {
      setIsOnline(true);
      setSyncToast('🟢 Đã có kết nối mạng trở lại! Đang tự động đồng bộ đơn hàng...');
      syncPendingOrders();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncToast('🔴 Mất kết nối mạng! Chuyển sang chế độ bán hàng ngoại tuyến (Offline-First).');
      setTimeout(() => setSyncToast(null), 5000);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Xử lý khi Súng Quét Mã Vạch Camera đọc được mã ISBN-13
  const handleBarcodeScan = (scannedCode: string) => {
    setErrorMessage(null);
    const cleanScanned = scannedCode.replace(/[^0-9X]/gi, '');

    // Tìm trong danh mục 81 sách
    const matchedBook = books.find((b) => {
      const cleanIsbn = b.isbn ? b.isbn.replace(/[^0-9X]/gi, '') : '';
      return (
        cleanIsbn === cleanScanned ||
        b.code.toLowerCase() === scannedCode.toLowerCase() ||
        (b.isbnLast4 && cleanScanned.endsWith(b.isbnLast4))
      );
    });

    if (matchedBook) {
      addToCart(matchedBook);
      setScanToast({
        title: matchedBook.title,
        code: matchedBook.code,
        isbn: matchedBook.isbn || cleanScanned,
      });
      setTimeout(() => setScanToast(null), 3000);
    } else {
      setErrorMessage(`Không tìm thấy ấn bản nào trong danh mục có mã ISBN: ${scannedCode}`);
    }
  };

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

  // Xử lý nộp đơn bán hàng (Offline-First: Lưu IndexedDB khi mất mạng, Sync khi có mạng)
  const handleCheckout = async () => {
    if (cart.length === 0) {
      setErrorMessage('Giỏ hàng trống! Vui lòng chọn ít nhất 1 cuốn sách.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const orderUuid = generateUUIDv7();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const shortSuffix = orderUuid.slice(-5).toUpperCase();
    const channel = selectedWarehouseId === 'wh-du-phong' ? 'FAIR_EVENT' : 'RETAIL_OFFICE';
    const cashierId = `User-${currentRole}`;
    const orderTimestamp = new Date().toISOString();
    const idempotencyKey = `idem-${orderUuid}`;

    // Helper lưu ngoại tuyến vào IndexedDB
    const fallbackToOffline = async (reason?: string) => {
      try {
        const offlineOrderCode = `OFF-${dateStr}-${shortSuffix}`;
        const offlineOrder: OfflineOrder = {
          id: orderUuid,
          orderCode: offlineOrderCode,
          idempotencyKey,
          warehouseId: selectedWarehouseId,
          customerName,
          channel,
          discountRate,
          paymentMethod,
          fiscalScope,
          cashierId,
          note,
          items: cart.map((c) => ({
            editionId: c.editionId,
            code: c.code,
            title: c.title,
            quantity: c.quantity,
            unitCoverPrice: c.coverPrice,
          })),
          subtotal,
          discountAmount,
          finalAmount,
          totalQuantity: totalCopies,
          createdAt: orderTimestamp,
          syncStatus: 'PENDING',
        };

        await saveOfflineOrder(offlineOrder);
        const count = await getPendingOrdersCount();
        setPendingOfflineCount(count);

        setCompletedOrder({
          id: orderUuid,
          orderCode: offlineOrderCode,
          warehouseId: selectedWarehouseId,
          customerName,
          fiscalScope,
          subtotal,
          discountAmount,
          finalAmount,
          totalQuantity: totalCopies,
          items: [...cart],
          discountRate,
          paymentMethod,
          date: new Date().toLocaleString('vi-VN'),
          isOffline: true,
        });

        setCart([]);
        setNote('');
        setSyncToast(
          reason
            ? `⚠️ ${reason} Đơn đã lưu ngoại tuyến an toàn vào máy (IndexedDB).`
            : `💾 Đã ghi nhận đơn ngoại tuyến [${offlineOrderCode}]. Hệ thống sẽ tự động đồng bộ khi có mạng!`
        );
        setTimeout(() => setSyncToast(null), 6000);
      } catch (err: any) {
        setErrorMessage('Lỗi lưu đơn hàng ngoại tuyến: ' + err.message);
      }
    };

    // A. Nếu trình duyệt đang rớt mạng: Lưu vào IndexedDB ngay lập tức
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await fallbackToOffline();
      setIsSubmitting(false);
      return;
    }

    // B. Nếu có mạng: Thử gửi lên Máy chủ qua REST API
    try {
      const orderCode = `ORD-${dateStr}-${shortSuffix}`;
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: orderUuid,
          orderCode,
          idempotencyKey,
          createdAt: orderTimestamp,
          warehouseId: selectedWarehouseId,
          channel,
          customerName,
          discountRate,
          paymentMethod,
          fiscalScope,
          cashierId,
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
        isOffline: false,
      });

      // Xóa giỏ hàng
      setCart([]);
      setNote('');
      if (onOrderCompleted) onOrderCompleted();
    } catch (err: any) {
      // Nếu rớt mạng bất ngờ giữa chừng hoặc fetch thất bại
      if (err.name === 'TypeError' || err.message?.includes('fetch') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        await fallbackToOffline('Mất kết nối mạng đột ngột!');
      } else {
        setErrorMessage(err.message || 'Lỗi xử lý thanh toán.');
      }
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

      // 3. Phím tắt Alt + V hoặc Alt + Shift + V -> Bật/Tắt Micro giọng nói tiếng Việt
      if (e.altKey && (e.key === 'V' || e.key === 'v' || e.code === 'KeyV')) {
        e.preventDefault();
        toggleListening();
        return;
      }

      // 4. Tổ hợp Alt + Shift + C -> Bật/Tắt Súng Quét Mã Vạch Camera
      if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        setIsScannerOpen((prev) => !prev);
        return;
      }

      // 5. Tổ hợp Ctrl + Enter (hoặc Cmd + Enter) -> Thanh toán & Khấu trừ kho
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCheckout();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, selectedWarehouseId, customerName, discountRate, paymentMethod, fiscalScope, completedOrder, searchQuery, isListening, toggleListening, isScannerOpen]);

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

        {/* Network Status & Warehouse Selector */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Online/Offline Status Indicator */}
          <div className="flex items-center gap-2">
            {isOnline ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Trực tuyến</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 animate-pulse">
                <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                <span>Ngoại tuyến (Offline)</span>
              </span>
            )}

            {/* Offline Pending Orders Badge & Sync Button */}
            {pendingOfflineCount > 0 && (
              <button
                type="button"
                onClick={syncPendingOrders}
                disabled={isSyncing || !isOnline}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition disabled:opacity-50 cursor-pointer"
                title={isOnline ? "Bấm để đồng bộ đơn hàng lên máy chủ ngay" : "Cần có mạng internet để đồng bộ"}
              >
                <CloudUpload className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Đang sync...' : `${pendingOfflineCount} đơn chờ`}</span>
              </button>
            )}
          </div>

          {/* Warehouse Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 shrink-0">Kho:</span>
            <select
              value={selectedWarehouseId}
              onChange={(e) => {
                setSelectedWarehouseId(e.target.value);
                setCart([]); // Reset giỏ khi đổi kho để đảm bảo tồn kho
              }}
              className="bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer min-h-[40px]"
            >
              <option value="wh-au-co">Kho 1 - Âu Cơ (Văn phòng chính)</option>
              <option value="wh-du-phong">Kho 3 - Hội Chợ (Gian hàng sự kiện)</option>
              <option value="wh-quynh-mai">Kho 2 - Quỳnh Mai (Kho tổng)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Toast thông báo mạng / Đồng bộ */}
      {syncToast && (
        <div className="p-3 bg-slate-900 text-slate-100 border border-slate-700 text-xs font-semibold rounded-2xl flex items-center justify-between shadow-lg animate-slide-up">
          <div className="flex items-center gap-2">
            <CloudUpload className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{syncToast}</span>
          </div>
          <button onClick={() => setSyncToast(null)} className="text-slate-400 hover:text-white p-1 ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
              placeholder={
                isListening
                  ? '🔴 Đang lắng nghe tiếng Việt... Hãy nói tên sách (ví dụ: Bệnh tưởng, H01)'
                  : 'Gõ tên không dấu (truong, benh), mã (H01), 4 số cuối (7507)...'
              }
              className={`w-full pl-10 pr-32 py-3 bg-white border rounded-2xl text-sm font-medium outline-none shadow-sm min-h-[48px] transition-all ${
                isListening
                  ? 'border-rose-500 ring-2 ring-rose-300'
                  : 'border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500'
              }`}
            />
            {/* Shortcut hint badge: [/] */}
            {!searchQuery && !isInputFocused && !isListening && (
              <span className="absolute right-24 text-[10px] font-mono text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded pointer-events-none hidden sm:inline">
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
              {/* Nút Quét Barcode Bằng Camera 0 Đồng */}
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="p-2 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 active:scale-95 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center"
                title="Bật Súng Quét Mã Vạch Camera 0 Đồng (Alt + Shift + C)"
              >
                <Camera className="w-4 h-4" />
              </button>
              {/* Nút Micro Giọng Nói Tiếng Việt */}
              <button
                type="button"
                onClick={toggleListening}
                className={`p-2 rounded-xl text-xs font-bold transition-all min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer ${
                  isListening
                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 ring-2 ring-rose-400 animate-pulse'
                    : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:scale-95'
                }`}
                title={
                  isListening
                    ? 'Đang lắng nghe tiếng Việt... Bấm để dừng (Alt + Shift + V)'
                    : 'Bật Micro tìm sách bằng giọng nói tiếng Việt (Alt + Shift + V)'
                }
              >
                {isListening ? (
                  <MicOff className="w-4 h-4 text-white animate-bounce" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Banner trạng thái Micro đang lắng nghe */}
          {isListening && (
            <div className="p-3 bg-rose-950/90 border border-rose-500/60 text-rose-100 rounded-2xl flex items-center justify-between shadow-xl animate-pulse">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                </span>
                <span className="text-xs font-bold text-white">
                  Đang thu âm giọng nói tiếng Việt:
                </span>
                <span className="text-[11px] text-rose-200 font-medium hidden sm:inline">
                  Hãy nói to rõ tên sách hoặc mã SKU (ví dụ: "Bệnh tưởng", "H01", "7507")
                </span>
              </div>
              <button
                type="button"
                onClick={stopListening}
                className="px-2.5 py-1 bg-rose-800 hover:bg-rose-700 text-white rounded-xl text-[11px] font-bold transition"
              >
                Dừng Nghe
              </button>
            </div>
          )}

          {/* Toast / Banner thông báo lỗi Micro nếu có */}
          {voiceError && (
            <div className="p-3 bg-amber-950/95 border border-amber-500/60 text-amber-100 rounded-2xl flex items-center justify-between shadow-xl">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs font-medium">{voiceError}</span>
              </div>
              <button
                type="button"
                onClick={clearVoiceError}
                className="p-1 text-amber-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

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
                  Khách hàng / Đại lý sỉ:
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
                        setCustomerName('Đại lý sỉ Đinh Lễ');
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
                    <option value="DAU_NAU">Đại lý sỉ Đinh Lễ (-40%)</option>
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
                    <option value="INTERNAL_MANAGEMENT">Sổ Quản trị Nội bộ</option>
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
                <span>{completedOrder.isOffline ? 'Đã Lưu Ngoại Tuyến (Offline)!' : 'Bán Hàng Thành Công!'}</span>
              </div>
              <button
                onClick={() => setCompletedOrder(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {completedOrder.isOffline && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs font-medium space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <WifiOff className="w-4 h-4 text-amber-600" />
                  <span>Đơn hàng ngoại tuyến (Chưa sync lên server)</span>
                </div>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  Dữ liệu đã lưu an toàn vào IndexedDB với khóa thời gian UUID v7. Hệ thống sẽ tự động đồng bộ và khấu trừ kho máy chủ ngay khi có mạng trở lại.
                </p>
              </div>
            )}

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs font-mono">
              <div className="flex justify-between font-bold text-slate-900">
                <span>MÃ ĐƠN:</span>
                <span className={completedOrder.isOffline ? 'text-amber-600' : 'text-indigo-600'}>
                  {completedOrder.orderCode}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Khách hàng:</span>
                <span>{completedOrder.customerName}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Kho xuất:</span>
                <span>
                  {completedOrder.warehouseId === 'wh-au-co'
                    ? 'Kho Âu Cơ'
                    : completedOrder.warehouseId === 'wh-du-phong'
                    ? 'Kho Hội Chợ'
                    : 'Kho Quỳnh Mai'}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Phân loại sổ:</span>
                <span className="font-bold">
                  {completedOrder.fiscalScope === 'OFFICIAL_TAX' ? 'Hóa đơn VAT' : 'Sổ Quản trị Nội bộ'}
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
              {completedOrder.isOffline
                ? '💾 Đã chốt bill ngoại tuyến thành công. Có thể in phiếu giao hàng ngay!'
                : '✅ Thẻ kho vật lý đã được khấu trừ tức thì. Kho máy = Kho kệ 100%!'}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition-colors"
              >
                <Printer className="w-4 h-4" />
                In Phiếu Giao Hàng (K80)
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

      {/* Dedicated 80mm POS Thermal Receipt for K80/Continuous Roll Printing */}
      {completedOrder && (
        <div id="thermal-receipt-print" className="hidden print:block text-black bg-white">
          <div className="text-[12px] leading-tight font-mono w-[72mm] max-w-[72mm] mx-auto py-1">
            {/* Header */}
            <div className="text-center pb-2 border-b border-dashed border-black">
              <h1 className="text-sm font-black uppercase tracking-wider">FORMAPUBLI OS</h1>
              <p className="text-[10px]">HỆ THỐNG XUẤT BẢN & PHÁT HÀNH SÁCH</p>
              <p className="text-[10px]">Hotline: 098.xxx.xxxx | Hà Nội</p>
              <div className="my-1.5 border-t border-black"></div>
              <h2 className="text-xs font-black uppercase">PHIẾU BÁN HÀNG & GIAO KHO</h2>
              <p className="text-[10px] italic">
                {completedOrder.fiscalScope === 'OFFICIAL_TAX'
                  ? '(Hóa đơn thương mại / Kê khai VAT)'
                  : '(Phiếu xuất kho & thanh toán nội bộ)'}
              </p>
            </div>

            {/* Order Info */}
            <div className="py-2 border-b border-dashed border-black text-[11px] space-y-1">
              <div className="flex justify-between">
                <span>Số phiếu:</span>
                <span className="font-bold">{completedOrder.orderCode}</span>
              </div>
              <div className="flex justify-between">
                <span>Thời gian:</span>
                <span>{completedOrder.date || new Date().toLocaleString('vi-VN')}</span>
              </div>
              <div className="flex justify-between">
                <span>Thu ngân:</span>
                <span>{completedOrder.cashierId || `User-${currentRole}`}</span>
              </div>
              <div className="flex justify-between">
                <span>Khách hàng:</span>
                <span className="font-bold">{completedOrder.customerName || 'Khách vãng lai'}</span>
              </div>
              <div className="flex justify-between">
                <span>Kho xuất:</span>
                <span>
                  {completedOrder.warehouseId === 'wh-au-co'
                    ? 'Kho 1 - Âu Cơ'
                    : completedOrder.warehouseId === 'wh-du-phong'
                    ? 'Kho 3 - Hội Chợ'
                    : 'Kho 2 - Quỳnh Mai'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Hình thức TT:</span>
                <span className="font-semibold">
                  {completedOrder.paymentMethod === 'CASH'
                    ? 'Tiền mặt'
                    : completedOrder.paymentMethod === 'BANK_TRANSFER'
                    ? 'Chuyển khoản'
                    : 'Mã QR'}
                </span>
              </div>
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-black">
              <div className="grid grid-cols-12 font-bold text-[11px] pb-1 border-b border-black">
                <span className="col-span-7">Tên sách / SKU</span>
                <span className="col-span-2 text-center">SL</span>
                <span className="col-span-3 text-right">T.Tiền</span>
              </div>
              <div className="space-y-1.5 pt-1.5">
                {completedOrder.items?.map((item: any, idx: number) => {
                  const unitPrice = item.coverPrice || item.unitCoverPrice || 0;
                  const itemTotal = unitPrice * item.quantity;
                  return (
                    <div key={idx} className="text-[11px]">
                      <div className="font-semibold leading-tight">{item.title}</div>
                      <div className="grid grid-cols-12 text-[10px] text-gray-800 pt-0.5">
                        <span className="col-span-7 font-mono">[{item.code}]</span>
                        <span className="col-span-2 text-center font-bold">x{item.quantity}</span>
                        <span className="col-span-3 text-right font-mono">
                          {itemTotal.toLocaleString('vi-VN')} đ
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Totals */}
            <div className="py-2 border-b border-dashed border-black text-[11px] space-y-1">
              <div className="flex justify-between">
                <span>Tổng số lượng:</span>
                <span className="font-bold">{completedOrder.totalQuantity} cuốn</span>
              </div>
              <div className="flex justify-between">
                <span>Tổng tiền bìa:</span>
                <span className="font-mono">{(completedOrder.subtotal || 0).toLocaleString('vi-VN')} đ</span>
              </div>
              {completedOrder.discountAmount > 0 && (
                <div className="flex justify-between">
                  <span>Chiết khấu ({Math.round((completedOrder.discountRate || 0) * 100)}%):</span>
                  <span className="font-mono">-{(completedOrder.discountAmount || 0).toLocaleString('vi-VN')} đ</span>
                </div>
              )}
              <div className="flex justify-between text-xs font-bold pt-1.5 border-t border-black text-black">
                <span className="uppercase">TỔNG THỰC THU:</span>
                <span className="font-mono text-sm font-black">
                  {(completedOrder.finalAmount || 0).toLocaleString('vi-VN')} đ
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-2 text-center text-[10px] space-y-1">
              <p className="font-medium">Quý khách vui lòng kiểm tra sách trước khi rời quầy.</p>
              <p className="font-bold uppercase tracking-wider">CẢM ƠN QUÝ KHÁCH & HẸN GẶP LẠI!</p>
              <p className="text-[9px] text-gray-600 pt-1">
                {completedOrder.orderCode} • {completedOrder.isOffline ? 'OFFLINE_PENDING_SYNC' : 'SYNCED'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Súng Quét Mã Vạch Bằng Camera 0 Đồng (In-App Barcode Scanner) */}
      <InAppBarcodeScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleBarcodeScan}
        sampleBooks={books.map((b) => ({ code: b.code, title: b.title, isbn: b.isbn }))}
      />

      {/* Toast thông báo đã quét Barcode thành công */}
      {scanToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-emerald-950/95 border border-emerald-500/50 text-emerald-100 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-slide-up">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-extrabold text-white">Đã Quét Thành Công (+1 cuốn vào giỏ):</p>
            <p className="text-[11px] text-emerald-300 truncate max-w-xs font-medium">
              [{scanToast.code}] {scanToast.title}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

