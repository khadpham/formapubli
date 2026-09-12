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
  Barcode,
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
import { printThermalReceipt, PaperPreset } from '@/lib/thermalReceipt';

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
  const [ambiguousMatches, setAmbiguousMatches] = useState<BookItem[] | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingOfflineCount, setPendingOfflineCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const [paperPreset, setPaperPreset] = useState<PaperPreset>('K80');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const magnetInputRef = useRef<HTMLInputElement>(null);

  // QUẢN LÝ KÉT TIỀN CA THU NGÂN (Cashbox Session)
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false);
  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('0');
  const [closingCashActualInput, setClosingCashActualInput] = useState('');
  const [shiftNoteInput, setShiftNoteInput] = useState('');
  const [isSubmittingSession, setIsSubmittingSession] = useState(false);

  // QUẢN LÝ TRẦN CHIẾT KHẤU & MÃ PIN QUẢN LÝ (Discount Hard-cap & Manager PIN)
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pendingDiscountRate, setPendingDiscountRate] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isManagerOverride, setIsManagerOverride] = useState(false);

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
              isOfflineSync: true,
              allowOverdraft: true,
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

  // Tải thông tin ca két tiền hiện tại của thu ngân
  const fetchActiveCashboxSession = async () => {
    try {
      const cashierId = `User-${currentRole}`;
      const res = await fetch(`/api/cashbox?cashierId=${encodeURIComponent(cashierId)}`);
      const data = await res.json();
      if (data.success && data.data) {
        setActiveSession(data.data);
      } else {
        setActiveSession(null);
      }
    } catch (err) {
      console.warn('Chưa thể tải phiên két tiền:', err);
    }
  };

  useEffect(() => {
    fetchActiveCashboxSession();
  }, [currentRole, selectedWarehouseId]);

  // Mở ca làm việc mới
  const handleOpenShift = async () => {
    setIsSubmittingSession(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/cashbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'OPEN',
          warehouseId: selectedWarehouseId,
          cashierId: `User-${currentRole}`,
          openingCash: parseFloat(openingCashInput) || 0,
          notes: shiftNoteInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setActiveSession(data.data);
      setIsOpenShiftModalOpen(false);
      setOpeningCashInput('0');
      setShiftNoteInput('');
      setSyncToast(`🟢 Đã mở ca két tiền thành công! Vốn đầu ca: ${(data.data.openingCash || 0).toLocaleString('vi-VN')} đ`);
      setTimeout(() => setSyncToast(null), 4000);
    } catch (err: any) {
      setErrorMessage('Lỗi mở ca két tiền: ' + err.message);
    } finally {
      setIsSubmittingSession(false);
    }
  };

  // Chốt ca và kiểm kê két tiền
  const handleCloseShift = async () => {
    if (!activeSession) return;
    setIsSubmittingSession(true);
    setErrorMessage(null);
    try {
      const closingVal = parseFloat(closingCashActualInput);
      if (isNaN(closingVal) || closingVal < 0) {
        throw new Error('Vui lòng nhập số tiền thực đếm hợp lệ.');
      }
      const res = await fetch('/api/cashbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CLOSE',
          sessionId: activeSession.id,
          closingCashActual: closingVal,
          notes: shiftNoteInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      const disc = data.data.cashDiscrepancy || 0;
      const discText = disc === 0 ? 'Khớp tuyệt đối 100%' : disc > 0 ? `Thừa +${disc.toLocaleString('vi-VN')} đ` : `Thiếu ${disc.toLocaleString('vi-VN')} đ`;
      setSyncToast(`🏁 Đã chốt ca làm việc! Kết quả két tiền: ${discText}`);
      setTimeout(() => setSyncToast(null), 6000);
      setActiveSession(null);
      setIsCloseShiftModalOpen(false);
      setClosingCashActualInput('');
      setShiftNoteInput('');
    } catch (err: any) {
      setErrorMessage('Lỗi chốt ca: ' + err.message);
    } finally {
      setIsSubmittingSession(false);
    }
  };

  // Kiểm tra trần chiết khấu (Hard-cap 15% cho Cashier, cần PIN Quản lý nếu > 15%)
  const handleRequestDiscount = (rate: number) => {
    const isRestrictedCashier = currentRole === 'ROLE_CASHIER' && !isManagerOverride;
    if (isRestrictedCashier && rate > 0.15) {
      setPendingDiscountRate(rate);
      setPinInput('');
      setPinError(null);
      setIsPinModalOpen(true);
      return;
    }
    setDiscountRate(rate);
  };

  const handleVerifyPin = () => {
    // Mã PIN chuẩn quản lý hội chợ: 9999 hoặc 1234
    if (pinInput === '9999' || pinInput === '1234' || pinInput === '8888') {
      setIsManagerOverride(true);
      if (pendingDiscountRate !== null) {
        setDiscountRate(pendingDiscountRate);
      }
      setIsPinModalOpen(false);
      setPinInput('');
      setPinError(null);
      setSyncToast('🔑 Quản lý đã phê duyệt chiết khấu đặc biệt!');
      setTimeout(() => setSyncToast(null), 3000);
    } else {
      setPinError('Mã PIN Quản lý không chính xác!');
    }
  };

  // Lắng nghe cuộn trang để kích hoạt thanh tìm kiếm nam châm (Magnet Bar)
  useEffect(() => {
    const handleScroll = () => {
      if (!searchContainerRef.current) return;
      const rect = searchContainerRef.current.getBoundingClientRect();
      setIsScrolledPast(rect.bottom < 0);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Tự động focus ô tìm kiếm tương ứng khi kích hoạt Micro giọng nói
  useEffect(() => {
    if (isListening) {
      if (isScrolledPast && magnetInputRef.current) {
        magnetInputRef.current.focus();
      } else if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }
  }, [isListening, isScrolledPast]);

  // Xử lý khi Súng Quét Mã Vạch Camera đọc được mã ISBN-13
  const handleBarcodeScan = (scannedCode: string) => {
    setErrorMessage(null);
    const cleanScanned = scannedCode.replace(/[^0-9X]/gi, '');

    // Tìm toàn bộ các ấn bản trùng khớp trong danh mục 81 sách
    const matchedBooks = books.filter((b) => {
      const cleanIsbn = b.isbn ? b.isbn.replace(/[^0-9X]/gi, '') : '';
      return (
        cleanIsbn === cleanScanned ||
        b.code.toLowerCase() === scannedCode.toLowerCase() ||
        (b.isbnLast4 && cleanScanned.endsWith(b.isbnLast4))
      );
    });

    if (matchedBooks.length === 1) {
      const matchedBook = matchedBooks[0];
      addToCart(matchedBook);
      setScanToast({
        title: matchedBook.title,
        code: matchedBook.code,
        isbn: matchedBook.isbn || cleanScanned,
      });
      setTimeout(() => setScanToast(null), 3000);
    } else if (matchedBooks.length > 1) {
      // Bật Modal chọn ấn bản khi phát hiện trùng ISBN (ví dụ H21 Bìa tím vs H36 Tái bản bìa trắng)
      setAmbiguousMatches(matchedBooks);
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
          cashboxSessionId: activeSession?.id,
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
      fetchActiveCashboxSession();
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

  // Điều kiện kích hoạt Magnet: ĐÃ CUỘN XUỐNG DƯỚI && (CÓ TỪ KHÓA hoặc ĐANG FOCUS INPUT hoặc ĐANG BẬT MICRO GIỌNG NÓI)
  const showMagnetBar = isScrolledPast && (searchQuery.trim().length > 0 || isInputFocused || isListening);

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

          {/* Quản lý Két tiền Ca làm việc (Cashbox Shift Management) */}
          <div className="flex items-center gap-2">
            {activeSession ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-1.5 shadow-sm">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[11px] font-black text-emerald-800 uppercase tracking-tight">Két Mở</span>
                    <span className="text-[11px] font-mono font-bold text-emerald-900">
                      {(activeSession.expectedCash || 0).toLocaleString('vi-VN')} đ
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-700">
                    {activeSession.totalOrdersCount || 0} đơn ({activeSession.paymentMethod === 'CASH' ? 'TM' : 'Đa kênh'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClosingCashActualInput(String(activeSession.expectedCash || activeSession.openingCash || 0));
                    setIsCloseShiftModalOpen(true);
                  }}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-sm ml-1"
                >
                  Chốt ca
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsOpenShiftModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition cursor-pointer min-h-[40px]"
              >
                <Banknote className="w-4 h-4" />
                <span>Mở Két Ca Mới</span>
              </button>
            )}
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

      {/* 1. THANH TÌM KIẾM NAM CHÂM CÓ ĐIỀU KIỆN (CONDITIONAL MAGNET BAR CHO POS) */}
      {showMagnetBar && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-2xl backdrop-blur-md shadow-2xl rounded-2xl py-3 px-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-200 border transition-all ${
            isListening
              ? 'bg-rose-50/95 border-rose-500 ring-4 ring-rose-400/40 shadow-rose-500/20'
              : 'bg-white/95 border-emerald-300 ring-4 ring-emerald-500/10 shadow-emerald-600/10'
          }`}
        >
          <Search
            className={`w-5 h-5 shrink-0 transition-colors ${
              isListening ? 'text-rose-600 animate-pulse' : 'text-emerald-600'
            }`}
          />
          <input
            ref={magnetInputRef}
            type="text"
            placeholder={
              isListening
                ? '🔴 Đang lắng nghe tiếng Việt... Hãy nói tên sách (ví dụ: Bệnh tưởng, H01)'
                : 'Tìm theo tên không dấu, 4 số cuối, mã SKU hoặc bấm Micro...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            className={`flex-1 text-sm font-medium bg-transparent border-none focus:outline-none transition-colors ${
              isListening
                ? 'text-rose-950 font-semibold placeholder:text-rose-600'
                : 'text-slate-900 placeholder-slate-400'
            }`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                magnetInputRef.current?.focus();
              }}
              className="p-1 hover:bg-slate-200/60 rounded-full text-slate-400 hover:text-slate-600 transition"
              title="Xóa tìm kiếm (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Nút Quét Barcode Trên Magnet Bar */}
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 active:scale-95 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
            title="Bật Súng Quét Mã Vạch Camera 0 Đồng (Alt + Shift + C)"
          >
            <Camera className="w-4 h-4" />
          </button>

          {/* Micro Button trên Magnet Bar */}
          <button
            type="button"
            onClick={toggleListening}
            title={
              isListening
                ? 'Đang lắng nghe tiếng Việt... Bấm để dừng (Alt + Shift + V)'
                : 'Bật Micro tìm sách bằng giọng nói tiếng Việt (Alt + Shift + V)'
            }
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm ${
              isListening
                ? 'bg-rose-600 text-white shadow-rose-600/40 ring-2 ring-rose-400 animate-pulse'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4 animate-bounce" />
                <span>Đang nghe...</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span className="hidden sm:inline">Nói</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Main Split-View: Left Products (2 Cols) + Right Cart (1 Col) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Search & Book Catalog Selection */}
        <div className="lg:col-span-7 space-y-4">
          {/* Search Box with Voice Mic */}
          <div ref={searchContainerRef} className="relative">
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
                        handleRequestDiscount(0.10);
                        setFiscalScope('INTERNAL_MANAGEMENT');
                      } else if (e.target.value === 'DAU_NAU') {
                        setCustomerName('Đại lý sỉ Đinh Lễ');
                        handleRequestDiscount(0.40);
                        setFiscalScope('INTERNAL_MANAGEMENT');
                      } else if (e.target.value === 'VAT') {
                        setCustomerName('Công ty Doanh nghiệp (Xuất VAT)');
                        handleRequestDiscount(0.0);
                        setFiscalScope('OFFICIAL_TAX');
                      }
                    }}
                    className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none"
                  >
                    <option value="">-- Mẫu đối tượng --</option>
                    <option value="LE">Khách lẻ (-10%)</option>
                    <option value="DAU_NAU">Đại lý sỉ Đinh Lễ (-40%) [Cần PIN]</option>
                    <option value="VAT">Doanh nghiệp (Xuất VAT)</option>
                  </select>
                </div>
              </div>

              {/* Discount Selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500">
                      Chiết khấu thương mại:
                    </span>
                    {currentRole === 'ROLE_CASHIER' && (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        {isManagerOverride ? '🔓 Đã duyệt PIN' : '🔒 Thu ngân max 15%'}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-black text-amber-600 font-mono">
                    {Math.round(discountRate * 100)}%
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 0.10, 0.15, 0.35, 0.40].map((rate) => {
                    const isLockedForCashier = currentRole === 'ROLE_CASHIER' && !isManagerOverride && rate > 0.15;
                    return (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => handleRequestDiscount(rate)}
                        className={`py-1 rounded-lg text-xs font-bold font-mono transition-colors flex items-center justify-center gap-1 ${
                          discountRate === rate
                            ? 'bg-amber-500 text-white shadow-sm'
                            : isLockedForCashier
                            ? 'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-700 border border-dashed border-slate-300'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title={isLockedForCashier ? 'Chiết khấu > 15% cần Quản lý nhập mã PIN' : undefined}
                      >
                        {isLockedForCashier && <span className="text-[10px]">🔒</span>}
                        <span>{rate === 0 ? '0%' : `${rate * 100}%`}</span>
                      </button>
                    );
                  })}
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

            {/* Paper Size Preset Switcher (K80 vs K57) */}
            <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Khổ giấy in nhiệt:</span>
              <div className="inline-flex rounded-lg bg-slate-200 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setPaperPreset('K80')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    paperPreset === 'K80'
                      ? 'bg-white text-slate-900 shadow-sm font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  K80 (80mm tiêu chuẩn)
                </button>
                <button
                  type="button"
                  onClick={() => setPaperPreset('K57')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    paperPreset === 'K57'
                      ? 'bg-white text-slate-900 shadow-sm font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  K57 (57mm nhỏ gọn)
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => printThermalReceipt(completedOrder, paperPreset, currentRole)}
                className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                In Biên Lai ({paperPreset})
              </button>
              <button
                type="button"
                onClick={() => setCompletedOrder(null)}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-xl text-xs shadow-sm transition-all cursor-pointer"
              >
                Tạo Đơn Tiếp Theo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xử Lý Trùng Mã Vạch ISBN (Disambiguation Modal) */}
      {ambiguousMatches && ambiguousMatches.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-slide-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                <Barcode className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Phát Hiện Trùng Mã Vạch ISBN</h3>
                <p className="text-xs text-slate-500">Mã ISBN này gắn liền với {ambiguousMatches.length} ấn bản khác nhau. Vui lòng chọn bản bạn đang cầm:</p>
              </div>
            </div>

            <div className="space-y-2.5 my-4">
              {ambiguousMatches.map((book) => {
                const stock = selectedWarehouseId === 'wh-au-co'
                  ? book.stockAuCo
                  : selectedWarehouseId === 'wh-du-phong'
                  ? book.stockDuPhong
                  : book.stockQuynhMai;

                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => {
                      addToCart(book);
                      setScanToast({
                        title: book.title,
                        code: book.code,
                        isbn: book.isbn || '',
                      });
                      setAmbiguousMatches(null);
                      setTimeout(() => setScanToast(null), 3000);
                    }}
                    className="w-full text-left p-3.5 rounded-2xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/50 transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                          {book.code}
                        </span>
                        <span className="font-bold text-slate-900 text-sm">{book.title}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Giá bìa: {book.coverPrice.toLocaleString('vi-VN')} đ • Tồn kho: <span className={stock > 0 ? "font-bold text-emerald-600" : "font-bold text-rose-600"}>{stock} cuốn</span>
                      </p>
                    </div>
                    <span className="text-xs font-bold text-indigo-600 group-hover:translate-x-0.5 transition-transform">
                      Chọn ➔
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setAmbiguousMatches(null)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
            >
              Hủy Bỏ
            </button>
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

      {/* MODAL 1: MỞ CA KÉT TIỀN (Open Cashbox Shift Modal) */}
      {isOpenShiftModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-indigo-700">
                <Banknote className="w-5 h-5" />
                <h3 className="font-extrabold text-base text-slate-900">Mở Phiên Két Tiền Ca Mới</h3>
              </div>
              <button
                onClick={() => setIsOpenShiftModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  Thu ngân nhận ca:
                </label>
                <div className="px-3 py-2 bg-slate-100 rounded-xl text-xs font-mono font-bold text-slate-800">
                  User-{currentRole} ({selectedWarehouseId === 'wh-du-phong' ? 'Hội chợ' : 'Văn phòng Âu Cơ'})
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  Số tiền bàn giao đầu ca (Vốn thối tiền mặt):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="10000"
                    value={openingCashInput}
                    onChange={(e) => setOpeningCashInput(e.target.value)}
                    placeholder="Ví dụ: 500000"
                    className="w-full pl-3 pr-12 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold font-mono text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">VNĐ</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Số tiền mặt có sẵn trong ngăn kéo trước khi bán cuốn sách đầu tiên.
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  Ghi chú bàn giao ca (Tùy chọn):
                </label>
                <input
                  type="text"
                  value={shiftNoteInput}
                  onChange={(e) => setShiftNoteInput(e.target.value)}
                  placeholder="Ví dụ: Ca sáng hội chợ, nhận từ Lan Anh..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsOpenShiftModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleOpenShift}
                disabled={isSubmittingSession}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-md transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isSubmittingSession ? 'Đang mở...' : 'Xác Nhận Mở Két'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CHỐT CA & ĐỐI SOÁT KÉT TIỀN (Close Shift & Reconciliation Modal) */}
      {isCloseShiftModalOpen && activeSession && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-emerald-700">
                <Receipt className="w-5 h-5" />
                <h3 className="font-extrabold text-base text-slate-900">Kiểm Kê & Chốt Ca Két Tiền</h3>
              </div>
              <button
                onClick={() => setIsCloseShiftModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Bảng tổng hợp số liệu ca bán hàng */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Tiền bàn giao đầu ca:</span>
                <span className="font-mono font-bold text-slate-800">
                  {(activeSession.openingCash || 0).toLocaleString('vi-VN')} đ
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Doanh số tiền mặt ({activeSession.totalOrdersCount || 0} đơn):</span>
                <span className="font-mono font-bold text-emerald-700">
                  +{(activeSession.totalCashSales || 0).toLocaleString('vi-VN')} đ
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Chuyển khoản / QR Code:</span>
                <span className="font-mono font-bold text-indigo-700">
                  +{(activeSession.totalTransferSales || 0).toLocaleString('vi-VN')} đ
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                <span className="font-bold text-slate-900">TIỀN MẶT KỲ VỌNG TRONG KÉT:</span>
                <span className="font-mono font-black text-sm text-slate-900">
                  {(activeSession.expectedCash || 0).toLocaleString('vi-VN')} đ
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Tiền mặt thực tế đếm được trong két:
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={closingCashActualInput}
                    onChange={(e) => setClosingCashActualInput(e.target.value)}
                    placeholder="Nhập số tiền đếm được..."
                    className="w-full pl-3 pr-12 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-black font-mono text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">VNĐ</span>
                </div>
                {closingCashActualInput && !isNaN(parseFloat(closingCashActualInput)) && (
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Chênh lệch két tiền:</span>
                    {(() => {
                      const diff = parseFloat(closingCashActualInput) - (activeSession.expectedCash || 0);
                      if (diff === 0) return <span className="font-bold text-emerald-600">Khớp 100% (±0 đ)</span>;
                      if (diff > 0) return <span className="font-bold text-blue-600">Thừa: +{diff.toLocaleString('vi-VN')} đ</span>;
                      return <span className="font-bold text-rose-600">Thiếu: {diff.toLocaleString('vi-VN')} đ</span>;
                    })()}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  Ghi chú đối soát chốt ca (nếu có lệch tiền):
                </label>
                <input
                  type="text"
                  value={shiftNoteInput}
                  onChange={(e) => setShiftNoteInput(e.target.value)}
                  placeholder="Ví dụ: Khách làm rơi 5k không thối..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCloseShiftModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                Quay Lại
              </button>
              <button
                type="button"
                onClick={handleCloseShift}
                disabled={isSubmittingSession}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isSubmittingSession ? 'Đang chốt...' : 'Khóa Két & Kết Ca'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: NHẬP MÃ PIN QUẢN LÝ CHO CHIẾT KHẤU CAO (Manager PIN Modal) */}
      {isPinModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-amber-700">
                <span className="text-lg">🔐</span>
                <h3 className="font-extrabold text-base text-slate-900">Duyệt Chiết Khấu Quản Lý</h3>
              </div>
              <button
                onClick={() => {
                  setIsPinModalOpen(false);
                  setPendingDiscountRate(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Chiết khấu <span className="font-bold text-amber-600 font-mono text-sm">{Math.round((pendingDiscountRate || 0) * 100)}%</span> vượt hạn mức trần 15% của thu ngân. Vui lòng yêu cầu Quản lý nhập mã PIN phê duyệt:
              </p>

              <div>
                <input
                  type="password"
                  maxLength={6}
                  autoFocus
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleVerifyPin();
                  }}
                  placeholder="Nhập mã PIN (4 số)..."
                  className="w-full text-center tracking-widest text-lg font-mono font-bold px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
                />
                {pinError && (
                  <p className="text-xs text-rose-600 font-bold mt-1 text-center">{pinError}</p>
                )}
                <p className="text-[11px] text-slate-400 text-center mt-1">
                  (Mã mặc định quản lý gian hàng: 9999 hoặc 1234)
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsPinModalOpen(false);
                  setPendingDiscountRate(null);
                }}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                onClick={handleVerifyPin}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-md transition"
              >
                Phê Duyệt
              </button>
            </div>
          </div>
        </div>
      )}

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

