'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  ClipboardPaste,
  ShieldCheck,
  ShieldAlert,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { matchesAnyVietnameseField } from '@/lib/vietnamese';
import { SmartOrderParser } from '@/components/pos/SmartOrderParser';
import { DiscountApprovalModal } from '@/components/pos/DiscountApprovalModal';
import { ManagerApprovalDrawer } from '@/components/pos/ManagerApprovalDrawer';
import { DailyFairSettlementModal } from '@/components/pos/DailyFairSettlementModal';
import { VietQrPay } from '@/components/pos/VietQrPay';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { InAppBarcodeScanner } from '@/components/scanner/InAppBarcodeScanner';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { matchActionShortcut } from '@/lib/keyboard';
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
  // 1.0: tồn khả dụng ATP tại thời điểm thêm (null = chưa tra / offline)
  atpAvailable?: number | null;
}

interface PosCheckoutTerminalProps {
  books: BookItem[];
  currentRole: UserRole;
  onOrderCompleted?: () => void;
  /** Don nhap tu Copilot (prepare_sale_draft) — op vao gio 1 lan duy nhat. */
  externalDraft?: {
    nonce: number;
    items: Array<{ editionId: string; quantity: number }>;
    customerName?: string;
    phone?: string;
    address?: string;
    note?: string;
  } | null;
  onDraftApplied?: () => void;
}

/** F5 (#8): thu ngân xác nhận TAY đã nhận tiền chuyển khoản/QR trước khi chốt đơn. */
function MoneyReceivedToggle({
  id,
  confirmed,
  onToggle,
}: {
  id: string;
  confirmed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-pressed={confirmed}
      onClick={onToggle}
      className={`mt-2 w-full py-2 rounded-xl text-xs font-extrabold border transition flex items-center justify-center gap-1.5 min-h-[40px] ${
        confirmed
          ? 'bg-emerald-600 text-white border-emerald-700'
          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
      }`}
    >
      <ShieldCheck className="w-4 h-4" />
      {confirmed ? 'Đã nhận tiền (bấm để bỏ xác nhận)' : 'Xác nhận đã nhận tiền'}
    </button>
  );
}
export function PosCheckoutTerminal({
  books,
  currentRole,
  onOrderCompleted,
  externalDraft,
  onDraftApplied,
}: PosCheckoutTerminalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('wh-au-co');
  // V4.1 S2.1/S2.2/S2.3: kho bán + ATP nạp từ server (fallback cứng khi offline)
  const [sellableWarehouses, setSellableWarehouses] = useState<Array<{ id: string; code: string; name: string; warehouseType: string }>>([]);
  const [catalogAtp, setCatalogAtp] = useState<Record<string, { atp: number; soldToday: number }>>({});
  const [catalogReady, setCatalogReady] = useState(false);
  const [showAllBooks, setShowAllBooks] = useState(false); // mặc định ẩn sách hết hàng tại kho
  // Danh mục thu gọn mặc định (scan-first trên mobile): chỉ hiện vài món đầu.
  // Desktop giữ full grid nguyên bản (không gian rộng) — chỉ mobile mới thu gọn.
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const CATALOG_COLLAPSED_COUNT = 4; // 2x2 grid gọn gàng trên mobile (Ticket #11)
  // FAB quét chỉ hiện khi nút Quét to đã trôi khỏi viewport (IntersectionObserver)
  const scanButtonRef = useRef<HTMLButtonElement>(null);
  const [scanButtonVisible, setScanButtonVisible] = useState(true);
  useEffect(() => {
    const el = scanButtonRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => setScanButtonVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  // Panel kho/két ca: setup 1 lần đầu ca + cuối ca nên mobile thu gọn mặc định
  const [shiftPanelExpanded, setShiftPanelExpanded] = useState(false);
  // Noti duyệt chiết khấu cho quản lý: poll số đơn chờ + badge + toast + rung
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ id: string }>>([]);
  const [approvalToast, setApprovalToast] = useState<string | null>(null);
  const knownApprovalIds = useRef<Set<string>>(new Set());
  const isApprovalViewer = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  useEffect(() => {
    if (!isApprovalViewer) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/pos/discount-approvals');
        const j = await res.json();
        if (!alive || !j?.success || !Array.isArray(j.data)) return;
        const ids = j.data.map((r: any) => `${r.id}`);
        const prev = knownApprovalIds.current;
        const fresh = ids.filter((id: string) => !prev.has(id));
        if (prev.size > 0 && fresh.length > 0) {
          setApprovalToast(`${fresh.length} yêu cầu duyệt chiết khấu mới cần xử lý!`);
          try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(200);
          } catch {}
          setTimeout(() => {
            if (alive) setApprovalToast(null);
          }, 5000);
        }
        knownApprovalIds.current = new Set(ids);
        if (JSON.stringify(ids) !== JSON.stringify(Array.from(prev))) {
          setPendingApprovals(j.data);
        }
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isApprovalViewer]);
  const [isMobileView, setIsMobileView] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobileView(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const [sortMode, setSortMode] = useState<'default' | 'az' | 'hot'>('default');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('Khách lẻ vãng lai');
  const [discountRate, setDiscountRate] = useState(0.0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'QR_CODE'>('CASH');
  const [fiscalScope, setFiscalScope] = useState<'INTERNAL_MANAGEMENT' | 'OFFICIAL_TAX'>('INTERNAL_MANAGEMENT');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<any | null>(null);
  const [qrSnapshot, setQrSnapshot] = useState<{ dataUrl: string; payload: string; accountNo: string; content: string } | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  // 1.1: modal dán chat FB/Zalo
  const [isParserOpen, setIsParserOpen] = useState(false);
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // QUẢN LÝ KÉT TIỀN CA THU NGÂN (Cashbox Session)
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false);
  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('0');
  const [closingCashActualInput, setClosingCashActualInput] = useState('');
  const [shiftNoteInput, setShiftNoteInput] = useState('');
  const [isSubmittingSession, setIsSubmittingSession] = useState(false);

  // QUẢN LÝ TRẦN CHIẾT KHẤU & PHÊ DUYỆT BẢO MẬT (Discount Hard-cap & State Machine Approval)
  const [isDiscountApprovalModalOpen, setIsDiscountApprovalModalOpen] = useState(false);
  const [isManagerApprovalDrawerOpen, setIsManagerApprovalDrawerOpen] = useState(false);
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [isMobileCheckoutSheetOpen, setIsMobileCheckoutSheetOpen] = useState(false);
  const [approvedDiscountRequestId, setApprovedDiscountRequestId] = useState<string | null>(null);
  const [pendingDiscountRate, setPendingDiscountRate] = useState<number | null>(null);
  // A1-F / #1 UI: Freeze giỏ hàng khi chờ phê duyệt chiết khấu bảo mật
  const [isApprovalPending, setIsApprovalPending] = useState(false);
  // requestId yêu cầu đang chờ (do modal tạo) — cần để gọi API CANCEL trước khi mở khóa
  const [pendingApprovalRequestId, setPendingApprovalRequestId] = useState<string | null>(null);
  const [isCancellingApproval, setIsCancellingApproval] = useState(false);
  // F5 (#8): chuyển khoản/QR phải được thu ngân xác nhận TAY "Đã nhận tiền" trước khi chốt
  const [isMoneyReceived, setIsMoneyReceived] = useState(false);

  // Đang chờ Quản lý duyệt (chặn cả chốt đơn) vs giỏ bị khóa để sửa: chờ duyệt HOẶC
  // đã có phê duyệt gắn với giỏ này (sửa giỏ = phê duyệt hết hiệu lực → server 403).
  const isApprovalPendingState =
    isApprovalPending || (isDiscountApprovalModalOpen && pendingDiscountRate !== null);
  const isCartFrozen = isApprovalPendingState || approvedDiscountRequestId !== null;

  // F1/F2: hủy yêu cầu duyệt TRÊN SERVER rồi mới mở khóa giỏ; lỗi thì GIỮ khóa.
  const handleCancelApproval = async () => {
    const requestId = approvedDiscountRequestId || pendingApprovalRequestId;
    setIsCancellingApproval(true);
    try {
      if (requestId) {
        const res = await fetch(`/api/pos/discount-approvals/${requestId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'CANCEL' }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.message || json?.error || 'Không hủy được yêu cầu duyệt chiết khấu.');
        }
      }
      // ponytail: nếu thu ngân hủy đúng lúc modal đang tạo yêu cầu (chưa có id) thì
      // yêu cầu đó tự hết hạn sau 5 phút — không có rủi ro tiền, không thêm cơ chế chờ.
      setIsApprovalPending(false);
      setIsDiscountApprovalModalOpen(false);
      setPendingDiscountRate(null);
      setDiscountRate(0);
      setApprovedDiscountRequestId(null);
      setPendingApprovalRequestId(null);
      setIsManagerOverride(false);
      if (isGift) setIsGift(false);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không hủy được yêu cầu duyệt — giỏ vẫn tạm khóa.');
    } finally {
      setIsCancellingApproval(false);
    }
  };
  // V4.1 S2.4: ô nhập CK lẻ (% nguyên)
  const [customDiscountInput, setCustomDiscountInput] = useState('');
  const [isManagerOverride, setIsManagerOverride] = useState(false);
  const [approvedPin, setApprovedPin] = useState<string | null>(null);
  // Mã đơn hiện tại (sinh sẵn để đồng bộ với ShortCode duyệt chiết khấu)
  const [activeOrderCode, setActiveOrderCode] = useState<string>(() => {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const r = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${d}-${r}`;
  });
  // BV-03: chế độ Tặng sách 100% (doanh thu 0đ, vẫn trừ kho)
  const [isGift, setIsGift] = useState(false);
  const [giftReason, setGiftReason] = useState('Tặng sách / Quà tặng sự kiện');


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
              isGift: (order as any).isGift || order.discountRate === 1,
              giftReason: (order as any).giftReason || order.note,
              items: order.items.map((it) => ({
                editionId: it.editionId,
                quantity: it.quantity,
                unitCoverPrice: it.unitCoverPrice,
                unitDiscountRate: (order as any).isGift || order.discountRate === 1 ? 1 : undefined,
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

  // V4.1 S2.1: nạp kho bán động 1 lần khi mở quầy (thay hardcode 3 kho)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/warehouses');
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          setSellableWarehouses(json.data);
          setSelectedWarehouseId((prev) =>
            json.data.some((w: any) => w.id === prev) ? prev : json.data[0].id
          );
        }
      } catch {
        // offline: giữ fallback cứng trong selector
      }
    })();
  }, []);

  // V4.1 S2.2/S2.3: nạp ATP + số bán hôm nay mỗi khi đổi kho (1 request)
  useEffect(() => {
    if (!isOnline) {
      setCatalogReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/pos/catalog?warehouseId=${encodeURIComponent(selectedWarehouseId)}`);
        const json = await res.json();
        if (!cancelled && json.success) {
          const map: Record<string, { atp: number; soldToday: number }> = {};
          for (const it of json.data.items) map[it.editionId] = { atp: it.atp, soldToday: it.soldToday };
          setCatalogAtp(map);
          setCatalogReady(true);
        }
      } catch {
        if (!cancelled) setCatalogReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWarehouseId, isOnline]);

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

  // V4.1 S2.4: áp dụng CK lẻ từ ô nhập — chỉ CK thường (không phải tặng 100%)
  const applyCustomDiscount = () => {
    if (isCartFrozen) {
      setErrorMessage('Giỏ hàng đang tạm khóa do chờ Quản lý duyệt chiết khấu.');
      return;
    }
    const raw = customDiscountInput.trim();
    if (raw === '') {
      setErrorMessage('Nhập số nguyên phần trăm chiết khấu (0 – 100).');
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      setErrorMessage('Chiết khấu phải là số nguyên trong khoảng 0 – 100%.');
      return;
    }
    handleRequestDiscount(n / 100);
    setCustomDiscountInput('');
  };
  const handleRequestDiscount = (rate: number) => {
    if (isCartFrozen) {
      setErrorMessage('Giỏ hàng đang tạm khóa do chờ Quản lý duyệt chiết khấu.');
      return;
    }
    // BV-03: rời chế độ tặng khi chọn CK thường
    if (rate !== 1) setIsGift(false);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      setErrorMessage('Chiết khấu phải nằm trong khoảng 0 - 100%.');
      return;
    }
    const isRestrictedCashier = currentRole === 'ROLE_CASHIER' && !isManagerOverride;
    if (isRestrictedCashier && rate >= 0.2) {
      setPendingDiscountRate(rate);
      setIsApprovalPending(true);
      setIsDiscountApprovalModalOpen(true);
      return;
    }
    setDiscountRate(rate);
    if (rate === 1) {
      setIsGift(true);
      setFiscalScope('INTERNAL_MANAGEMENT');
    }
  };

  // BV-03: bật/tắt chế độ Tặng 100% (tái dùng luồng duyệt chiết khấu bảo mật)
  const handleToggleGift = () => {
    if (isCartFrozen) {
      setErrorMessage('Giỏ hàng đang tạm khóa do chờ Quản lý duyệt chiết khấu.');
      return;
    }
    if (isGift) {
      setIsGift(false);
      setDiscountRate(0);
      return;
    }
    handleRequestDiscount(1);
    // Trường hợp được duyệt ngay (Owner/Manager hoặc đã có override): bật cờ tặng
    const canDirect = currentRole !== 'ROLE_CASHIER' || isManagerOverride;
    if (canDirect) {
      setIsGift(true);
      setFiscalScope('INTERNAL_MANAGEMENT');
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
      handleAddToCart(matchedBook);
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

  // V4.1 S2.2: tồn hiển thị = ATP server khi đã nạp; offline fallback snapshot ma trận, kho lạ → 0.
  // Server là guard cuối lúc thanh toán nên số hiển thị chỉ để tìm nhanh, không quyết định được bán.
  const getBookStock = (book: BookItem): number => {
    const hit = catalogAtp[book.id];
    if (hit) return hit.atp;
    if (selectedWarehouseId === 'wh-au-co') return book.stockAuCo;
    if (selectedWarehouseId === 'wh-du-phong') return book.stockDuPhong;
    if (selectedWarehouseId === 'wh-quynh-mai') return book.stockQuynhMai;
    return 0;
  };

  const selectedWarehouseType = useMemo(
    () =>
      sellableWarehouses.find((w) => w.id === selectedWarehouseId)?.warehouseType ??
      (selectedWarehouseId === 'wh-du-phong' ? 'FAIR_EVENT' : 'PHYSICAL_MAIN'),
    [selectedWarehouseId, sellableWarehouses]
  );

  // Bộ lọc sách thời gian thực + V4.1 S2.2/S2.3: ẩn hết hàng mặc định, sắp xếp A-Z / bán chạy
  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim();
    let list = q
      ? books.filter((b) =>
          matchesAnyVietnameseField(searchQuery, [b.title, b.code, b.isbnLast4, b.author])
        )
      : books.slice();
    if (!showAllBooks) list = list.filter((b) => getBookStock(b) > 0);
    if (sortMode === 'az') list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'vi'));
    else if (sortMode === 'hot' && catalogReady) {
      list = [...list].sort(
        (a, b) => (catalogAtp[b.id]?.soldToday || 0) - (catalogAtp[a.id]?.soldToday || 0)
      );
    }
    return q ? list : list.slice(0, 20); // Không tìm kiếm: hiển thị 20 cuốn đầu sau lọc/sắp xếp
  }, [books, searchQuery, showAllBooks, sortMode, catalogAtp, catalogReady, selectedWarehouseId]);

  // Thêm sách vào giỏ
  const addToCart = (book: BookItem, atpOverride?: number | null) => {
    setErrorMessage(null);
    const availableStock = getBookStock(book);

    if (availableStock <= 0) {
      setErrorMessage(`Sách [${book.code}] ${book.title} hiện đã hết hàng tại kho được chọn!`);
      return;
    }

    // 1.0: trần giỏ = min(tồn vật lý, ATP) khi đã tra ATP
    const atp = atpOverride === undefined || atpOverride === null ? null : Math.max(0, Math.floor(atpOverride));
    const effectiveLimit = atp === null ? availableStock : Math.min(availableStock, atp);
    if (effectiveLimit <= 0) {
      setErrorMessage(`Sách [${book.code}] ${book.title} đã bị giữ hết cho đơn online — tồn khả dụng tại quầy: 0 cuốn!`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.editionId === book.id);
      if (existing) {
        const curAtp = atp !== null ? atp : existing.atpAvailable ?? null;
        const limit = curAtp === null ? availableStock : Math.min(availableStock, curAtp);
        if (existing.quantity >= limit) {
          setErrorMessage(
            curAtp !== null && curAtp < availableStock
              ? `Sách giữ chỗ online! Giỏ (${existing.quantity}) đã đạt tồn khả dụng (${limit}, vật lý ${availableStock})!`
              : `Số lượng trong giỏ (${existing.quantity}) đã đạt mức tồn kho tối đa (${limit})!`
          );
          return prev;
        }
        return prev.map((item) =>
          item.editionId === book.id
            ? { ...item, quantity: item.quantity + 1, atpAvailable: curAtp }
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
          atpAvailable: atp,
        },
      ];
    });
  };

  // 1.0: bọc tra ATP trước khi thêm — cảnh báo hổ phách khi có giữ chỗ, rớt mạng thì bán theo tồn vật lý
  const handleAddToCart = async (book: BookItem, times = 1) => {
    if (isCartFrozen) {
      setErrorMessage('Giỏ hàng đang tạm khóa do chờ Quản lý duyệt chiết khấu. Hãy hủy yêu cầu duyệt nếu muốn thêm sách.');
      return;
    }
    let atp: number | null = null;
    try {
      const res = await fetch(`/api/atp?editionId=${encodeURIComponent(book.id)}&warehouseId=${encodeURIComponent(selectedWarehouseId)}`);
      const json = await res.json();
      if (json.success) {
        atp = Math.max(0, Math.floor(json.data.atp));
        if (json.data.held > 0) {
          setSyncToast(`⚠️ [${book.code}] có ${json.data.held} cuốn đang giữ chỗ online — khả dụng tại quầy: ${atp} cuốn.`);
          setTimeout(() => setSyncToast(null), 4000);
        }
      }
    } catch {
      // Offline/không tra được ATP: giữ hành vi cũ (tồn vật lý), server là guard cuối
    }
    const n = Math.max(1, Math.min(999, Math.floor(times) || 1));
    for (let i = 0; i < n; i++) addToCart(book, atp);
  };

  // 1.1: nạp đơn parser vào giỏ POS (tên/SĐT/địa chỉ → form, sách → giỏ qua guard ATP)
  const handleParserOrder = async (payload: {
    customerName: string;
    phone?: string;
    address?: string;
    items: Array<{ editionId: string; quantity: number }>;
    note: string;
  }) => {
    setCustomerName(payload.customerName);
    setNote((prev) => {
      const bits = [
        prev.trim(),
        payload.phone ? `SĐT: ${payload.phone}` : '',
        payload.address ? `ĐC: ${payload.address}` : '',
        payload.note,
      ].filter((s) => s && s.trim());
      return bits.join(' | ');
    });
    for (const it of payload.items) {
      const book = books.find((b) => b.id === it.editionId);
      if (book) await handleAddToCart(book, it.quantity);
    }
    setIsParserOpen(false);
    searchInputRef.current?.focus();
  };

  // Don nhap tu Copilot: op vao gio 1 lan theo nonce, qua guard ATP/ton nhu don tay.
  // Danh dau nonce DONG BO ngay dau effect (ke ca StrictMode dev double-effect
  // cung chi ap 1 lan); try/catch de draft loi khong ket posDraft.
  const appliedDraftNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!externalDraft || appliedDraftNonce.current === externalDraft.nonce) return;
    const draft = externalDraft;
    appliedDraftNonce.current = draft.nonce;
    const items = Array.isArray(draft.items)
      ? draft.items
          .filter((it) => it && typeof it.editionId === 'string' && it.editionId.trim())
          .map((it) => ({ editionId: it.editionId.trim(), quantity: Math.min(999, Math.max(1, Math.floor(Number(it.quantity) || 1))) }))
      : [];
    if (items.length === 0) {
      onDraftApplied?.();
      return;
    }
    (async () => {
      try {
        await handleParserOrder({
          customerName: typeof draft.customerName === 'string' && draft.customerName.trim() ? draft.customerName.trim() : 'Khách lẻ vãng lai',
          phone: typeof draft.phone === 'string' ? draft.phone : undefined,
          address: typeof draft.address === 'string' ? draft.address : undefined,
          items,
          note: typeof draft.note === 'string' && draft.note ? draft.note : '[COPILOT DRAFT]',
        });
        appliedDraftNonce.current = draft.nonce;
        setSyncToast('Đã ốp đơn nháp từ Copilot vào giỏ — kiểm tra lại rồi bấm Thanh toán (Ctrl+Enter).');
        setTimeout(() => setSyncToast(null), 4000);
      } catch (err: any) {
        setErrorMessage('Ốp đơn nháp thất bại: ' + (err?.message || 'lỗi không xác định'));
      } finally {
        onDraftApplied?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDraft]);

  const updateQuantity = (editionId: string, delta: number) => {
    if (isCartFrozen) {
      setErrorMessage('Giỏ hàng đang tạm khóa do chờ Quản lý duyệt chiết khấu. Hãy hủy yêu cầu duyệt nếu muốn chỉnh số lượng.');
      return;
    }
    setErrorMessage(null);
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.editionId === editionId) {
            const newQty = item.quantity + delta;
            // 1.0: trần tăng số lượng = min(vật lý, ATP đã tra)
            const limit = item.atpAvailable === undefined || item.atpAvailable === null
              ? item.stockAvailable
              : Math.min(item.stockAvailable, item.atpAvailable);
            if (newQty > limit) {
              setErrorMessage(
                item.atpAvailable !== undefined && item.atpAvailable !== null && item.atpAvailable < item.stockAvailable
                  ? `Giữ chỗ online! Tồn khả dụng chỉ còn ${limit} cuốn (vật lý ${item.stockAvailable})!`
                  : `Tồn kho chỉ còn ${limit} cuốn!`
              );
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
    if (isCartFrozen) {
      setErrorMessage('Giỏ hàng đang tạm khóa do chờ Quản lý duyệt chiết khấu. Hãy hủy yêu cầu duyệt nếu muốn xóa sách.');
      return;
    }
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
    // BV-03: đơn tặng bắt buộc có lý do
    if (isGift && !giftReason.trim() && !note.trim()) {
      setErrorMessage('Đơn Tặng sách bắt buộc nhập lý do (ví dụ: Quà tặng sự kiện).');
      return;
    }
    // F5 (#8): chuyển khoản/QR chỉ chốt khi thu ngân đã xác nhận tay "Đã nhận tiền"
    if (!isGift && (paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR_CODE') && !isMoneyReceived) {
      setErrorMessage(
        'Vui lòng xác nhận "Đã nhận tiền" (đã kiểm tra tài khoản/QR của khách) trước khi chốt đơn chuyển khoản/QR.'
      );
      return;
    }

    // 1.0: chốt chặn ATP lần cuối (giữ chỗ có thể tăng sau khi thêm giỏ).
    // Quản lý đã duyệt PIN được vượt (chịu trách nhiệm đối soát), server vẫn guard tồn vật lý.
    try {
      for (const item of cart) {
        const res = await fetch(`/api/atp?editionId=${encodeURIComponent(item.editionId)}&warehouseId=${encodeURIComponent(selectedWarehouseId)}`);
        const json = await res.json();
        if (json.success && item.quantity > json.data.atp && !isManagerOverride) {
          setErrorMessage(
            `Sách [${item.code}] vượt tồn khả dụng (${item.quantity} > ${json.data.atp}, có ${json.data.held} cuốn giữ chỗ online). Cần Quản lý duyệt PIN để vượt.`
          );
          return;
        }
      }
    } catch {
      // Không tra được ATP (mất mạng) → cho qua, server + offline-queue là guard cuối
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const orderUuid = generateUUIDv7();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const shortSuffix = orderUuid.slice(-5).toUpperCase();
    const channel = selectedWarehouseType === 'FAIR_EVENT' ? 'FAIR_EVENT' : 'RETAIL_OFFICE';
    const cashierId = `User-${currentRole}`;
    const orderTimestamp = new Date().toISOString();
    const idempotencyKey = `idem-${orderUuid}`;

    // Helper lưu ngoại tuyến vào IndexedDB
    const fallbackToOffline = async (reason?: string) => {
      try {
        const offlineOrderCode = `OFF-${dateStr}-${shortSuffix}`;
        const giftNote = isGift ? `[QUÀ TẶNG: ${giftReason.trim() || note.trim() || 'Tặng sách'}]${note ? ` ${note}` : ''}` : note;
        const offlineOrder: OfflineOrder = {
          id: orderUuid,
          orderCode: offlineOrderCode,
          idempotencyKey,
          warehouseId: selectedWarehouseId,
          customerName,
          channel,
          discountRate: isGift ? 1 : discountRate,
          paymentMethod,
          fiscalScope: isGift ? 'INTERNAL_MANAGEMENT' : fiscalScope,
          cashierId,
          note: giftNote,
          isGift,
          giftReason: isGift ? giftReason.trim() || note.trim() : undefined,
          items: cart.map((c) => ({
            editionId: c.editionId,
            code: c.code,
            title: c.title,
            quantity: c.quantity,
            unitCoverPrice: c.coverPrice,
          })),
          subtotal,
          discountAmount: isGift ? subtotal : discountAmount,
          finalAmount: isGift ? 0 : finalAmount,
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
          fiscalScope: isGift ? 'INTERNAL_MANAGEMENT' : fiscalScope,
          subtotal,
          discountAmount: isGift ? subtotal : discountAmount,
          finalAmount: isGift ? 0 : finalAmount,
          totalQuantity: totalCopies,
          items: [...cart],
          discountRate: isGift ? 1 : discountRate,
          paymentMethod,
          date: new Date().toLocaleString('vi-VN'),
          isOffline: true,
          isGift,
          qrDataUrl: (paymentMethod === 'QR_CODE' || paymentMethod === 'BANK_TRANSFER') ? qrSnapshot?.dataUrl || null : null,
          qrAccountNo: (paymentMethod === 'QR_CODE' || paymentMethod === 'BANK_TRANSFER') ? qrSnapshot?.accountNo || null : null,
        });

        setIsMobileCheckoutSheetOpen(false);
        setCart([]);
        setIsMoneyReceived(false);
        setNote('');
        setQrSnapshot(null);
        if (isGift) {
          setIsGift(false);
          setDiscountRate(0);
        }
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
          discountRate: isGift ? 1 : discountRate,
          paymentMethod,
          fiscalScope: isGift ? 'INTERNAL_MANAGEMENT' : fiscalScope,
          cashierId,
          cashboxSessionId: activeSession?.id,
          managerPin: approvedPin || undefined,
          discountApprovalId: approvedDiscountRequestId || undefined,
          note,
          isGift,
          giftReason: isGift ? giftReason.trim() || note.trim() : undefined,
          items: cart.map((item) => ({
            editionId: item.editionId,
            quantity: item.quantity,
            unitDiscountRate: isGift ? 1 : undefined,
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
        discountRate: isGift ? 1 : discountRate,
        paymentMethod,
        date: new Date().toLocaleString('vi-VN'),
        isOffline: false,
        isGift,
        qrDataUrl: (paymentMethod === 'QR_CODE' || paymentMethod === 'BANK_TRANSFER') ? qrSnapshot?.dataUrl || null : null,
        qrAccountNo: (paymentMethod === 'QR_CODE' || paymentMethod === 'BANK_TRANSFER') ? qrSnapshot?.accountNo || null : null,
      });

      // Xóa giỏ hàng
      setIsMobileCheckoutSheetOpen(false);
      setCart([]);
      setIsMoneyReceived(false);
      setNote('');
      setQrSnapshot(null);
      if (isGift) {
        setIsGift(false);
        setDiscountRate(0);
      }
      setApprovedPin(null);
      setApprovedDiscountRequestId(null);
      setIsManagerOverride(false);
      // Sinh mã đơn mới cho lượt khách kế tiếp
      const nextDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const nextRand = Math.floor(1000 + Math.random() * 9000);
      setActiveOrderCode(`ORD-${nextDate}-${nextRand}`);
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
        } else if (ambiguousMatches) {
          setAmbiguousMatches(null);
        } else if (isParserOpen) {
          setIsParserOpen(false);
        } else if (isOpenShiftModalOpen) {
          setIsOpenShiftModalOpen(false);
        } else if (isCloseShiftModalOpen) {
          setIsCloseShiftModalOpen(false);
        } else if (searchQuery) {
          setSearchQuery('');
          searchInputRef.current?.focus();
        } else if (isTypingInInput) {
          (e.target as HTMLElement)?.blur();
        }
        return;
      }

      // 3. Phím tắt Alt + V hoặc Alt + Shift + V (Mac: Option+V / Option+Shift+V / Cmd+Shift+V) -> Bật/Tắt Micro giọng nói tiếng Việt
      if (matchActionShortcut(e, 'KeyV') || matchActionShortcut(e, 'KeyV', { shift: true })) {
        e.preventDefault();
        toggleListening();
        return;
      }

      // 4. Tổ hợp Alt + Shift + C (Mac: Option+Shift+C / Cmd+Shift+C) -> Bật/Tắt Súng Quét Mã Vạch Camera
      if (matchActionShortcut(e, 'KeyC', { shift: true })) {
        e.preventDefault();
        setIsScannerOpen((prev) => !prev);
        return;
      }

      // 1.1: Tổ hợp Alt + Shift + P (Mac: Option+Shift+P / Cmd+Shift+P) -> Mở modal Dán Chat Khách
      if (matchActionShortcut(e, 'KeyP', { shift: true })) {
        e.preventDefault();
        setIsParserOpen((prev) => !prev);
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
  }, [cart, selectedWarehouseId, customerName, discountRate, paymentMethod, fiscalScope, completedOrder, searchQuery, isListening, toggleListening, isScannerOpen, isParserOpen, ambiguousMatches, isOpenShiftModalOpen, isCloseShiftModalOpen]);

  // Điều kiện kích hoạt Magnet: ĐÃ CUỘN XUỐNG DƯỚI && (CÓ TỪ KHÓA hoặc ĐANG FOCUS INPUT hoặc ĐANG BẬT MICRO GIỌNG NÓI)
  const showMagnetBar = isScrolledPast && (searchQuery.trim().length > 0 || isInputFocused || isListening);

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="bg-white rounded-2xl p-3 md:p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
        {/* Tiêu đề: chỉ desktop — mobile giấu để dành chỗ cho thao tác thu ngân */}
        <div className="hidden md:block">
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-600" />
            Quầy Thu Ngân POS
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Phím tắt <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-[11px]">/</kbd> tìm sách | <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-[11px]">Ctrl+Enter</kbd> thanh toán & trừ kho
          </p>
        </div>

        {/* Mobile slim: kho + két tóm tắt 1 dòng, sticky thay top bar (bấm để mở full setup đầu/ca-cuối ca) */}
        <div className="md:hidden sticky top-0 z-30 -mx-3 px-3 pt-2 pb-1 bg-slate-50/95 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setShiftPanelExpanded((v) => !v)}
          aria-expanded={shiftPanelExpanded}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-xl border border-slate-200/80 shadow-sm text-[11px] font-bold text-slate-700 min-h-[38px] active:scale-[0.99] transition-all"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${activeSession ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          <span className="flex-1 text-left truncate">
            {sellableWarehouses.find((w) => w.id === selectedWarehouseId)?.name ?? 'Chọn kho'} • {activeSession ? 'Két mở' : 'Chưa mở két'}
          </span>
          {shiftPanelExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
        </button>
        </div>

        {/* Network Status & Warehouse Selector */}
        <div className={`${shiftPanelExpanded ? 'flex' : 'hidden'} md:flex flex-wrap items-center gap-3 w-full md:w-auto`}>
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
                <span>Ngoại Tuyến</span>
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
              {(sellableWarehouses.length > 0
                ? sellableWarehouses
                : [
                    { id: 'wh-au-co', name: 'Kho 1 - Âu Cơ' },
                    { id: 'wh-du-phong', name: 'Kho 3 - Hội Chợ' },
                    { id: 'wh-quynh-mai', name: 'Kho 2 - Quỳnh Mai' },
                  ]
              ).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
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

          {/* Nút Mở Báo Cáo Chốt Ngày & Đối Soát Kiểm Kê Hội Chợ (#3-UI button: chỉ Owner & Manager) */}
          {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && (
            <button
              type="button"
              onClick={() => setIsSettlementModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition cursor-pointer min-h-[40px]"
              title="Báo cáo chốt ngày & Đối soát kiểm kê"
            >
              <CalendarCheck className="w-4 h-4" />
              <span>Chốt Ngày</span>
            </button>
          )}
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
        <div className="lg:col-span-7 space-y-3 md:space-y-4">
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
                  title="Xóa tìm kiếm"
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
              {/* Nút Dán Chat Khách (Smart Parser FB/Zalo) */}
              <button
                type="button"
                onClick={() => setIsParserOpen(true)}
                className="p-2 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 active:scale-95 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center"
                title="Dán chat khách, bóc đơn tự động (Alt + Shift + P)"
              >
                <ClipboardPaste className="w-4 h-4" />
              </button>
              {/* Nút Duyệt Chiết Khấu POS (Dành cho Quản lý / Chủ quầy) */}
              {(currentRole === 'ROLE_MANAGER' || currentRole === 'ROLE_OWNER') && (
                <button
                  type="button"
                  onClick={() => setIsManagerApprovalDrawerOpen(true)}
                  className="relative p-2 rounded-xl text-amber-600 bg-amber-50 hover:bg-amber-100 active:scale-95 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center font-bold"
                  title="Mở bảng duyệt chiết khấu POS (Quản lý)"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {pendingApprovals.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center shadow animate-pulse">
                      {pendingApprovals.length > 99 ? '99+' : pendingApprovals.length}
                    </span>
                  )}
                </button>
              )}
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

          {/* V4.1 S2.2/S2.3: gạt hiện tất cả + sắp xếp nhanh */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {(
              [
                ['default', 'Mặc định'],
                ['az', 'A → Z'],
                ['hot', '🔥 Bán chạy'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  sortMode === mode
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowAllBooks((v) => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                showAllBooks
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title={showAllBooks ? 'Ẩn sách hết hàng tại kho' : 'Hiện cả sách hết hàng để tư vấn'}
            >
              {showAllBooks ? 'Ẩn hết hàng' : 'Hiện tất cả'}
            </button>
            {!catalogReady && isOnline && (
              <span className="text-[11px] text-slate-400 font-medium">Đang tải tồn kho…</span>
            )}
          </div>

          {/* Mobile: nút Quét mã to rõ — cách thêm món chính khi bán thực tế */}
          <button
            ref={scanButtonRef}
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="md:hidden w-full min-h-[48px] px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-sm font-extrabold shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Camera className="w-5 h-5" />
            Quét mã thêm vào giỏ
          </button>

          {/* Book Catalog Grid — mobile thu gọn mặc định, desktop full như cũ.
              Hàng nút và slice dùng chung 1 cờ isMobileView (không dùng md:hidden
              để 2 phía không bao giờ lệch nhau). */}
          {isMobileView && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-extrabold text-slate-800">Danh mục ({filteredBooks.length})</span>
            {filteredBooks.length > CATALOG_COLLAPSED_COUNT && (
              <button
                type="button"
                onClick={() => setCatalogExpanded((v) => !v)}
                aria-expanded={catalogExpanded}
                className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 min-h-[36px] px-2 active:scale-95 transition-all"
              >
                {catalogExpanded ? (
                  <>Thu gọn <ChevronUp className="w-4 h-4" /></>
                ) : (
                  <>Xem tất cả <ChevronDown className="w-4 h-4" /></>
                )}
              </button>
            )}
          </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 max-h-[560px] overflow-y-auto pr-1">
            {(catalogExpanded || !isMobileView ? filteredBooks : filteredBooks.slice(0, CATALOG_COLLAPSED_COUNT)).map((b) => {
              const currentStock = getBookStock(b);

              const isOutOfStock = currentStock <= 0;

              return (
                <div
                  key={b.id}
                  onClick={() => !isOutOfStock && handleAddToCart(b)}
                  title={b.title}
                  className={`p-2.5 sm:p-3.5 bg-white rounded-2xl border transition-all cursor-pointer flex flex-col justify-between select-none min-h-[110px] ${
                    isOutOfStock
                      ? 'opacity-50 border-slate-200 cursor-not-allowed bg-slate-50/60'
                      : 'border-slate-200/80 hover:border-emerald-500 hover:shadow-md active:scale-[0.98]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-mono font-black truncate max-w-[65px]">
                        {b.code}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
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
                    <h4
                      title={b.title}
                      className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug break-words"
                    >
                      {b.title}
                    </h4>
                    <p
                      title={b.author}
                      className="text-[11px] text-slate-500 truncate mt-0.5"
                    >
                      {b.author}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 gap-1">
                    <span className="text-[11px] sm:text-xs font-black text-emerald-700 font-mono truncate">
                      {b.coverPrice.toLocaleString('vi-VN')} đ
                    </span>
                    <button
                      type="button"
                      disabled={isOutOfStock}
                      aria-label={`Thêm ${b.title} vào giỏ`}
                      className="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white transition-colors shrink-0 min-h-[32px] sm:min-h-[36px]"
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
        <div id="cart-checkout-panel" className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between scroll-mt-20">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-600" />
                Giỏ Hàng Quầy ({totalCopies} cuốn)
              </h3>
              {cart.length > 0 && (
                <button
                  type="button"
                  disabled={isCartFrozen}
                  onClick={() => !isCartFrozen && setCart([])}
                  className="text-xs text-rose-600 hover:text-rose-800 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Xóa giỏ
                </button>
              )}
            </div>

            {/* A1-F / #1 UI: Cart Frozen Banner */}
            {isCartFrozen && (
              <div id="pos-cart-frozen-banner" className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between gap-2 text-amber-900 shadow-sm animate-pulse">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold">🔒 Giỏ hàng đang tạm khóa</p>
                    <p className="text-[11px] text-amber-700">
                      {approvedDiscountRequestId
                        ? `Quản lý đã duyệt chiết khấu ${Math.round(discountRate * 100)}% — giỏ tạm khóa để giữ đúng phê duyệt.`
                        : `Đang chờ Quản lý duyệt chiết khấu ${pendingDiscountRate ? Math.round(pendingDiscountRate * 100) + '%' : ''}. Không thể sửa giỏ.`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isDiscountApprovalModalOpen && !approvedDiscountRequestId && (
                    <button
                      type="button"
                      onClick={() => setIsDiscountApprovalModalOpen(true)}
                      className="px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 text-xs font-bold transition shadow-sm cursor-pointer"
                    >
                      Mở lại mã
                    </button>
                  )}
                  <button
                    type="button"
                    id="btn-cancel-approval"
                    disabled={isCancellingApproval}
                    onClick={handleCancelApproval}
                    className="px-2.5 py-1 rounded bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 text-xs font-bold transition shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title={approvedDiscountRequestId ? 'Hủy phê duyệt để sửa giỏ hàng' : 'Hủy yêu cầu duyệt để mở khóa giỏ hàng'}
                  >
                    {isCancellingApproval
                      ? 'Đang hủy...'
                      : approvedDiscountRequestId
                      ? 'Sửa giỏ và hủy phê duyệt'
                      : 'Hủy duyệt để sửa giỏ'}
                  </button>
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div id="pos-error-message" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
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
                      {/* 1.0: Tồn vật lý | Khả dụng ATP */}
                      <span className="block text-[10px] font-mono text-slate-400">
                        Tồn: {item.stockAvailable}
                        {item.atpAvailable !== undefined && item.atpAvailable !== null && item.atpAvailable < item.stockAvailable && (
                          <span className="text-amber-600 font-bold"> | Khả dụng: {item.atpAvailable} (giữ chỗ {item.stockAvailable - item.atpAvailable})</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden">
                        <button
                          type="button"
                          disabled={isCartFrozen}
                          aria-label="Giảm số lượng"
                          onClick={() => updateQuantity(item.editionId, -1)}
                          className="p-1 hover:bg-slate-100 text-slate-600 min-h-[32px] min-w-[32px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-2 text-xs font-mono font-bold text-slate-900">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={isCartFrozen}
                          aria-label="Tăng số lượng"
                          onClick={() => updateQuantity(item.editionId, 1)}
                          className="p-1 hover:bg-slate-100 text-slate-600 min-h-[32px] min-w-[32px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={isCartFrozen}
                        aria-label="Xóa khỏi giỏ"
                        onClick={() => removeFromCart(item.editionId)}
                        className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
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
                        {isManagerOverride ? '🔓 Đã duyệt PIN' : '🔒 Thu ngân max 20%'}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-black text-amber-600 font-mono">
                    {Math.round(discountRate * 100)}%
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 5, 10, 15, 20].map((pct) => {
                    const rate = pct / 100;
                    const isLockedForCashier = currentRole === 'ROLE_CASHIER' && !isManagerOverride && rate >= 0.2;
                    const isActive = Math.round(discountRate * 100) === pct && !isGift;
                    return (
                      <button
                        key={pct}
                        type="button"
                        disabled={isCartFrozen}
                        onClick={() => handleRequestDiscount(rate)}
                        className={`py-1.5 rounded-lg text-xs font-bold font-mono transition-colors flex items-center justify-center gap-1 ${
                          isActive
                            ? 'bg-amber-500 text-white shadow-sm'
                            : isCartFrozen
                            ? 'bg-slate-100 text-slate-300 cursor-not-allowed border border-dashed border-slate-200'
                            : isLockedForCashier
                            ? 'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-700 border border-dashed border-slate-300'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                        title={isCartFrozen ? 'Giỏ hàng đang tạm khóa' : isLockedForCashier ? 'Chiết khấu từ 20% trở lên cần Quản lý cấp phép' : undefined}
                      >
                        {isLockedForCashier && <span className="text-[10px]">🔒</span>}
                        <span>{pct}%</span>
                      </button>
                    );
                  })}
                  {/* Nut tang 100% gon nhe — tai dung luong PIN quan ly nhu cu */}
                  <button
                    type="button"
                    disabled={isCartFrozen}
                    onClick={handleToggleGift}
                    className={`py-1.5 rounded-lg text-xs font-extrabold font-mono transition active:scale-[0.99] ${
                      isGift
                        ? 'bg-rose-600 text-white shadow-sm'
                        : isCartFrozen
                        ? 'bg-slate-100 text-slate-300 cursor-not-allowed border border-dashed border-slate-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                    }`}
                    title={isCartFrozen ? 'Giỏ hàng đang tạm khóa' : 'Tặng 100%: doanh thu 0đ, vẫn trừ kho, chỉ ghi Sổ Nội bộ (thu ngân cần PIN quản lý)'}
                  >
                    🎁 100%
                  </button>
                </div>
                {/* V4.1 S2.4: ô nhập CK lẻ */}
                <div className="flex items-center gap-2 mt-1.5">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={isCartFrozen}
                    inputMode="numeric"
                    value={customDiscountInput}
                    onChange={(e) => setCustomDiscountInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyCustomDiscount();
                    }}
                    placeholder="CK lẻ %"
                    className="w-24 px-2 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono font-bold text-center outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    disabled={isCartFrozen}
                    onClick={applyCustomDiscount}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Áp dụng
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Thu ngân quá 20% cần PIN quản lý • 100% là tặng sự kiện • Nhập số nguyên để chọn CK lẻ</p>
                {isGift && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-rose-700 block">
                      Lý do tặng (bắt buộc):
                    </label>
                    <input
                      type="text"
                      value={giftReason}
                      onChange={(e) => setGiftReason(e.target.value)}
                      placeholder="Ví dụ: Quà tặng sự kiện hội chợ, tri ân độc giả..."
                      className="w-full px-3 py-2 bg-rose-50/50 border border-rose-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-rose-500"
                    />
                    <p className="text-[11px] text-rose-600 font-medium">
                      Doanh thu = 0đ • Kho vẫn trừ đủ • Chỉ ghi Sổ Nội bộ (không VAT).
                    </p>
                  </div>
                )}
              </div>

              {/* Fiscal Scope (Sổ Kép) & Payment Method */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-500 block mb-1">
                    Phân loại Sổ:
                  </label>
                  <select
                    value={isGift ? 'INTERNAL_MANAGEMENT' : fiscalScope}
                    onChange={(e) => setFiscalScope(e.target.value as any)}
                    disabled={isGift}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none disabled:opacity-60"
                    title={isGift ? 'Đơn tặng chỉ ghi Sổ Nội bộ' : undefined}
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
                    id="pos-payment-method-select"
                    value={paymentMethod === 'QR_CODE' ? 'BANK_TRANSFER' : paymentMethod}
                    onChange={(e) => {
                      setPaymentMethod(e.target.value as any);
                      setIsMoneyReceived(false);
                    }}
                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                  >
                    <option value="CASH">Tiền mặt</option>
                    <option value="BANK_TRANSFER">Chuyển khoản / Quét QR</option>
                  </select>
                </div>
              </div>
              {(paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR_CODE') && (
                <div className="mt-3">
                  <VietQrPay
                    warehouseId={selectedWarehouseId}
                    amount={isGift ? 0 : finalAmount}
                    initialContent={activeOrderCode}
                    onQr={setQrSnapshot}
                  />
                  <MoneyReceivedToggle
                    id="btn-money-received"
                    confirmed={isMoneyReceived}
                    onToggle={() => setIsMoneyReceived((v) => !v)}
                  />
                </div>
              )}
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
                <span className="text-sm font-black text-slate-900">THỰC THU{isGift ? ' (TẶNG 100%)' : ''}:</span>
                <span className="text-2xl font-black text-emerald-700 font-mono">
                  {(isGift ? 0 : finalAmount).toLocaleString('vi-VN')} đ
                </span>
              </div>
            </div>

            <button
              type="button"
              id="btn-desktop-checkout"
              onClick={handleCheckout}
              disabled={isSubmitting || isApprovalPendingState || cart.length === 0}
              className={`w-full py-3.5 px-4 active:scale-[0.99] disabled:opacity-50 text-white font-extrabold rounded-2xl text-sm shadow-xl transition-all flex items-center justify-center gap-2 min-h-[50px] ${isGift ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/25' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25'}`}
            >
              {isSubmitting ? (
                <span>Đang khấu trừ kho & tạo đơn...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  <span>{isGift ? 'XÁC NHẬN TẶNG & TRỪ KHO' : 'THANH TOÁN & KHẤU TRỪ KHO'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Order Success Receipt Modal */}
      {completedOrder && mounted && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(event) => { if (event.target === event.currentTarget) setCompletedOrder(null); }}
        >
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-emerald-600 font-extrabold text-base">
                <CheckCircle2 className="w-6 h-6" />
                <span>{completedOrder.isGift ? 'Đã Tặng Sách Thành Công! 🎁' : completedOrder.isOffline ? 'Đã Lưu Ngoại Tuyến!' : 'Bán Hàng Thành Công!'}</span>
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

            {completedOrder.qrDataUrl && (
              <div className="flex flex-col items-center gap-1 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={completedOrder.qrDataUrl} alt="VietQR thanh toán" className="w-[180px] h-[180px] rounded-xl border border-slate-200 bg-white" />
                <div className="text-[11px] font-mono font-bold text-slate-700">
                  {completedOrder.finalAmount.toLocaleString('vi-VN')} đ{completedOrder.qrAccountNo ? ` → ${completedOrder.qrAccountNo}` : ''}
                </div>
              </div>
            )}

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
        </div>,
        document.body
      )}

      {/* Modal Xử Lý Trùng Mã Vạch ISBN (Disambiguation Modal) */}
      {ambiguousMatches && ambiguousMatches.length > 0 && mounted && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(event) => { if (event.target === event.currentTarget) setAmbiguousMatches(null); }}
        >
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
                const stock = getBookStock(book);

                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => {
                      handleAddToCart(book);
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
        </div>,
        document.body
      )}

      {/* Súng Quét Mã Vạch Bằng Camera 0 Đồng (In-App Barcode Scanner) */}
      <InAppBarcodeScanner
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleBarcodeScan}
      />

      {/* 1.1: Modal Dán Chat Khách (Smart Parser FB/Zalo → nạp giỏ) */}
      {isParserOpen && mounted && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(event) => { if (event.target === event.currentTarget) setIsParserOpen(false); }}
        >
          <div className="max-w-lg w-full max-h-[92vh] overflow-y-auto">
            <SmartOrderParser
              books={books.map((b) => ({ id: b.id, code: b.code, title: b.title, author: b.author }))}
              onCreateOrder={handleParserOrder}
            />
            <button
              type="button"
              onClick={() => setIsParserOpen(false)}
              className="mt-2 w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 1: MỞ CA KÉT TIỀN (Open Cashbox Shift Modal) */}
      {isOpenShiftModalOpen && mounted && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(event) => { if (event.target === event.currentTarget && !isSubmittingSession) setIsOpenShiftModalOpen(false); }}
        >
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
                  User-{currentRole} - {selectedWarehouseId === 'wh-du-phong' ? 'Kho Hội chợ' : 'Kho Âu Cơ'}
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
        </div>,
        document.body
      )}

      {/* MODAL 2: CHỐT CA & ĐỐI SOÁT KÉT TIỀN (Close Shift & Reconciliation Modal) */}
      {isCloseShiftModalOpen && activeSession && mounted && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(event) => { if (event.target === event.currentTarget && !isSubmittingSession) setIsCloseShiftModalOpen(false); }}
        >
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
                <span className="text-slate-500 font-medium">Doanh số tiền mặt:</span>
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
        </div>,
        document.body
      )}

      {/* Toast yêu cầu duyệt chiết khấu mới (chỉ quản lý) */}
      {approvalToast && (
        <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-2xl bg-amber-500 text-white text-xs font-bold shadow-xl animate-slide-up whitespace-nowrap max-w-[calc(100vw-2rem)] overflow-hidden text-ellipsis">
          {approvalToast}
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

      {/* MODAL 3: DUYỆT CHIẾT KHẤU BẢO MẬT (Discount Approval Modal - QR & ShortCode) */}
      <DiscountApprovalModal
        isOpen={isDiscountApprovalModalOpen}
        orderCode={activeOrderCode}
        warehouseId={selectedWarehouseId}
        requestedDiscountRate={pendingDiscountRate || 0}
        originalAmount={subtotal}
        items={cart.map((item) => ({
          editionId: item.editionId,
          quantity: item.quantity,
          unitPrice: item.coverPrice,
        }))}
        onRequestCreated={setPendingApprovalRequestId}
        onApproved={(data) => {
          setIsApprovalPending(false);
          setApprovedDiscountRequestId(data.requestId);
          setPendingApprovalRequestId(null);
          setIsManagerOverride(true);
          setDiscountRate(data.rate);
          if (data.rate === 1) {
            setIsGift(true);
            setFiscalScope('INTERNAL_MANAGEMENT');
          }
          setIsDiscountApprovalModalOpen(false);
          setPendingDiscountRate(null);
          setSyncToast(
            `✅ Quản lý đã duyệt chiết khấu ${Math.round(data.rate * 100)}% (${data.method === 'ONE_TOUCH' ? '1-Chạm' : data.method === 'SHORTCODE_BOUND' ? 'Mã 4 số' : data.method === 'OFFLINE_EMERGENCY' ? 'Mã Khẩn Cấp' : 'QR Scan'})!`
          );
          setTimeout(() => setSyncToast(null), 4000);
        }}
        onClose={() => {
          setIsDiscountApprovalModalOpen(false);
        }}
      />

      {/* DRAWER DUYỆT CHIẾT KHẤU QUẢN LÝ (Chỉ hiển thị cho Manager / Owner) */}
      {(currentRole === 'ROLE_MANAGER' || currentRole === 'ROLE_OWNER') && (
        <ManagerApprovalDrawer
          isOpen={isManagerApprovalDrawerOpen}
          onClose={() => setIsManagerApprovalDrawerOpen(false)}
          warehouseId={selectedWarehouseId}
        />
      )}

      {/* MODAL 4: BÁO CÁO CHỐT NGÀY HỘI CHỢ & ĐỐI SOÁT KIỂM KÊ (Sprint 4) */}
      <DailyFairSettlementModal
        isOpen={isSettlementModalOpen}
        onClose={() => setIsSettlementModalOpen(false)}
        warehouseId={selectedWarehouseId}
        warehouseName={sellableWarehouses.find((w) => w.id === selectedWarehouseId)?.name}
        currentRole={currentRole}
      />

      {/* Thanh thanh toán nhanh nổi trên Mobile (Pixel 11, iPhone, điện thoại hẹp) */}
      {cart.length > 0 && (
        <div id="cart-checkout-bar" className="lg:hidden fixed bottom-16 inset-x-3 z-30 animate-slide-up">
          <div className="bg-slate-900/95 backdrop-blur-md text-white px-4 py-3 rounded-2xl shadow-xl border border-slate-700/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              title="Quét mã thêm vào giỏ"
              className="w-11 h-11 rounded-xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 active:scale-95 transition-all flex items-center justify-center shrink-0"
            >
              <Camera className="w-5 h-5" />
            </button>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[11px] text-slate-400 font-medium">
                {totalCopies} cuốn • Giảm {Math.round(discountRate * 100)}%
              </span>
              <span className="text-base font-extrabold text-emerald-400 font-mono">
                {finalAmount.toLocaleString('vi-VN')} đ
              </span>
            </div>
            <button
              type="button"
              id="btn-open-mobile-checkout-sheet"
              onClick={() => setIsMobileCheckoutSheetOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-xs font-bold shadow-md shadow-emerald-950/30 flex items-center gap-1.5 active:scale-95 transition-all min-h-[44px] cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Xem giỏ & Thanh toán</span>
            </button>
          </div>
        </div>
      )}

      {/* MODAL 5: MOBILE CHECKOUT BOTTOM SHEET (Bug #7) */}
      {isMobileCheckoutSheetOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex flex-col justify-end lg:hidden animate-in fade-in duration-200">
          <div
            className="fixed inset-0"
            onClick={(event) => {
              // #7 / F1: bấm ra ngoài sheet để đóng (không đóng khi đang gửi đơn)
              if (event.target === event.currentTarget && !isSubmitting) {
                setIsMobileCheckoutSheetOpen(false);
              }
            }}
          />
          <div
            id="mobile-checkout-sheet"
            className="relative z-10 bg-white rounded-t-3xl max-h-[88vh] w-full flex flex-col shadow-2xl border-t border-slate-200 animate-in slide-in-from-bottom duration-200 overflow-hidden"
          >
            {/* Sheet Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-extrabold text-slate-900">Chi tiết Đơn hàng & Thanh toán</h3>
                  <p className="text-[10px] text-slate-500 font-medium">
                    {totalCopies} cuốn • Giảm {Math.round(discountRate * 100)}%
                  </p>
                </div>
              </div>
              <button
                type="button"
                id="close-mobile-checkout-sheet"
                disabled={isSubmitting}
                onClick={() => setIsMobileCheckoutSheetOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sheet Body (scrollable) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Cart Items Summary */}
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                {cart.map((item) => (
                  <div key={item.editionId} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100">
                    <div className="truncate flex-1 pr-2">
                      <span className="font-bold text-slate-800 truncate block">{item.title}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {item.quantity} × {item.coverPrice.toLocaleString('vi-VN')} đ
                      </span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 shrink-0">
                      {(item.quantity * item.coverPrice).toLocaleString('vi-VN')} đ
                    </span>
                  </div>
                ))}
              </div>

              {/* Payment selector */}
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">
                  Hình thức thanh toán:
                </label>
                <select
                  value={paymentMethod === 'QR_CODE' ? 'BANK_TRANSFER' : paymentMethod}
                  onChange={(e) => {
                    setPaymentMethod(e.target.value as any);
                    setIsMoneyReceived(false);
                  }}
                  className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                >
                  <option value="CASH">Tiền mặt</option>
                  <option value="BANK_TRANSFER">Chuyển khoản / Quét QR</option>
                </select>
              </div>

              {(paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR_CODE') && (
                <div className="mt-2">
                  <VietQrPay
                    warehouseId={selectedWarehouseId}
                    amount={isGift ? 0 : finalAmount}
                    initialContent={activeOrderCode}
                    onQr={setQrSnapshot}
                  />
                  <MoneyReceivedToggle
                    id="btn-money-received-mobile"
                    confirmed={isMoneyReceived}
                    onToggle={() => setIsMoneyReceived((v) => !v)}
                  />
                </div>
              )}

              {/* Price Breakdown */}
              <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Tạm tính:</span>
                  <span className="font-mono font-bold text-slate-700">{subtotal.toLocaleString('vi-VN')} đ</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-amber-600">
                    <span>Chiết khấu ({Math.round(discountRate * 100)}%):</span>
                    <span className="font-mono font-bold">-{discountAmount.toLocaleString('vi-VN')} đ</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-extrabold text-slate-900">
                  <span>Khách thanh toán:</span>
                  <span className="font-mono text-emerald-600 font-black">{finalAmount.toLocaleString('vi-VN')} đ</span>
                </div>
              </div>
            </div>

            {/* Sheet Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200">
              <button
                type="button"
                id="btn-confirm-mobile-checkout"
                disabled={isSubmitting || isApprovalPendingState || cart.length === 0}
                onClick={handleCheckout}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white text-xs font-extrabold shadow-lg shadow-emerald-950/20 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <span>Đang xử lý tạo đơn...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Xác nhận Thanh toán ({finalAmount.toLocaleString('vi-VN')} đ)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nút quét nổi mobile: chỉ hiện khi giỏ trống VÀ nút Quét to đã trôi khỏi
          màn hình (kéo xuống). Có giỏ thì dùng nút quét trong thanh trên. */}
      {cart.length === 0 && !scanButtonVisible && (
        <button
          type="button"
          onClick={() => setIsScannerOpen(true)}
          title="Quét mã thêm vào giỏ"
          className="lg:hidden fixed bottom-24 left-4 z-40 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl shadow-emerald-600/40 flex items-center justify-center active:scale-95 transition-all"
        >
          <Camera className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
