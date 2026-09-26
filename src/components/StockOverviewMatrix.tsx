'use client';

import {
  Warehouse,
  Search,
  ArrowRightLeft,
  PlusCircle,
  MinusCircle,
  History,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Mic,
  MicOff,
  X,
  Keyboard,
  PackageSearch,
  ShieldAlert,
  Store,
  Landmark,
  Building2,
  ChevronDown,
  Check,
  Truck,
  FileCheck,
} from 'lucide-react';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { PortalToBody } from './PortalToBody';
import { StockMovementModal } from './StockMovementModal';
import { BatchTransferModal } from './inventory/BatchTransferModal';
import { PickListModal } from './inventory/PickListModal';
import { RmaTicketModal } from './inventory/RmaTicketModal';
import { TransitPanel } from './inventory/TransitPanel';
import { WholesaleDispatchModal } from './inventory/WholesaleDispatchModal';
import { CreateWarehouseModal } from './inventory/CreateWarehouseModal';
import { WarehouseBankManager } from './inventory/WarehouseBankManager';
import { DeliveryOrdersLedger } from './inventory/DeliveryOrdersLedger';
import { FileText } from 'lucide-react';
import { matchesVietnameseSearch } from '@/lib/vietnamese';

import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { matchActionShortcut } from '@/lib/keyboard';

interface MatrixBookItem {
  id: string;
  code: string;
  title: string;
  isbn: string;
  isbnLast4: string;
  author: string;
  translator: string | null;
  shortCode: string | null;
  coverPrice: number;
  publisher: string | null;
  status: string;
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

interface LedgerEntry {
  id: string;
  eventType: string;
  quantityDelta: number;
  condition: string | null;
  documentRef: string;
  note: string | null;
  actorId: string;
  recordedAt: string | null;
  bookCode: string;
  bookTitle: string | null;
  isbnLast4: string;
  warehouseCode: string;
  warehouseName: string;
}

type MainTabId = 'MATRIX' | 'LEDGER' | 'TRANSIT' | 'DELIVERY_ORDERS';

interface StockOverviewMatrixProps {
  initialBooks: MatrixBookItem[];
  warehouses: WarehouseItem[];
  initialLedger: LedgerEntry[];
  partners?: any[];
  currentRole?: string;
}

export function StockOverviewMatrix({
  initialBooks,
  warehouses,
  initialLedger,
  partners = [],
  currentRole = 'ROLE_OWNER',
}: StockOverviewMatrixProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [pickListOpen, setPickListOpen] = useState(false);
  const [rmaModalOpen, setRmaModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'RECEIPT' | 'DISPATCH' | 'TRANSFER'>('TRANSFER');
  const [batchTransferOpen, setBatchTransferOpen] = useState(false);
  const [wholesaleModalOpen, setWholesaleModalOpen] = useState(false);
  const [createWarehouseOpen, setCreateWarehouseOpen] = useState(false);
  const [bankManagerOpen, setBankManagerOpen] = useState(false);
  const [createdWarehouseToast, setCreatedWarehouseToast] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);
  const [presetTargetWarehouseId, setPresetTargetWarehouseId] = useState<string | undefined>(undefined);
  const [localWarehouses, setLocalWarehouses] = useState<WarehouseItem[]>(warehouses);

  useEffect(() => {
    setLocalWarehouses(warehouses);
  }, [warehouses]);

  const [selectedBookForAction, setSelectedBookForAction] = useState<MatrixBookItem | null>(null);
  const [activeTab, setActiveTab] = useState<MainTabId>('MATRIX');
  // Ticket 3 MVP: tab kho kiểu Sheets — chỉ lọc hiển thị read-only, không đụng ledger.
  const [warehouseTab, setWarehouseTab] = useState<'ALL' | 'wh-au-co' | 'wh-quynh-mai' | 'wh-du-phong'>('ALL');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  // Menu tab gọn: thay vì dải 4 pill inline (bị bóp + tràn trên ~470px), ta dùng
  // 1 chip trigger gọn + dropdown render qua portal trên document.body.
  const [mounted, setMounted] = useState(false);
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [tabMenuPos, setTabMenuPos] = useState({ top: 0, left: 0, openUp: false });
  // Option đang được bàn phím chỉ tới (mô hình aria-activedescendant: focus thật
  // vẫn nằm trên trigger nên không mất vị trí focus sau khi menu đóng).
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const tabTriggerRef = useRef<HTMLButtonElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);

  const TAB_ITEMS = useMemo(
    () =>
      [
        { id: 'MATRIX' as MainTabId, label: 'Ma trận 3 Kho', short: 'Ma trận', Icon: Warehouse, title: 'Bảng tồn kho theo 3 kho' },
        { id: 'LEDGER' as MainTabId, label: `Sổ Cái Bất Biến (${initialLedger.length})`, short: 'Sổ cái', Icon: History, title: 'Sổ cái append-only, nghiêm cấm sửa/xóa' },
        { id: 'TRANSIT' as MainTabId, label: 'Đi Đường', short: 'Đi đường', Icon: Truck, title: 'Xe đang đi đường qua trạm wh-in-transit, kẹt quá 12h sẽ đỏ' },
        { id: 'DELIVERY_ORDERS' as MainTabId, label: 'Sổ Phiếu Xuất', short: 'Sổ PX', Icon: FileText, title: 'Sổ phiếu xuất kho bán buôn đại lý' },
      ] as const,
    [initialLedger.length]
  );
  const activeTabItem = TAB_ITEMS.find((t) => t.id === activeTab) || TAB_ITEMS[0];

  useEffect(() => {
    setMounted(true);
  }, []);

  // Vị trí dropdown: neo dưới chip, clamp trong khung nhìn để không bao giờ
  // tràn ra ngoài màn hình (kể cả 320px) và không bị chồng lên mép dưới.
  const positionTabMenu = useCallback(() => {
    const el = tabTriggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(320, Math.max(160, window.innerWidth - 24));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    const estimatedHeight = 4 * 44 + 12;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    const top = openUp ? Math.max(8, rect.top - estimatedHeight - 6) : rect.bottom + 6;
    setTabMenuPos({ top, left, openUp });
  }, []);

  useEffect(() => {
    if (!isTabMenuOpen) return;
    positionTabMenu();
    const handleOutsidePointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (tabMenuRef.current?.contains(t) || tabTriggerRef.current?.contains(t)) return;
      setIsTabMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      const lastIndex = TAB_ITEMS.length - 1;
      // Chặn phím mũi tên/Home/End khiến trang bị cuộn khỏi màn hình trong lúc
      // người dùng đang duyệt danh sách.
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          setIsTabMenuOpen(false);
          tabTriggerRef.current?.focus();
          return;
        case 'ArrowDown':
          e.preventDefault();
          setActiveTabIndex((i) => (i >= lastIndex ? 0 : i + 1));
          return;
        case 'ArrowUp':
          e.preventDefault();
          setActiveTabIndex((i) => (i <= 0 ? lastIndex : i - 1));
          return;
        case 'Home':
          e.preventDefault();
          setActiveTabIndex(0);
          return;
        case 'End':
          e.preventDefault();
          setActiveTabIndex(lastIndex);
          return;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const picked = TAB_ITEMS[activeTabIndex];
          if (picked) {
            setActiveTab(picked.id);
            setIsTabMenuOpen(false);
            tabTriggerRef.current?.focus();
          }
          return;
        }
        default:
      }
    };
    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', positionTabMenu);
    window.addEventListener('scroll', positionTabMenu, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', positionTabMenu);
      window.removeEventListener('scroll', positionTabMenu, true);
    };
  }, [isTabMenuOpen, positionTabMenu, activeTabIndex]);

  // Giữ option đang chỉ tới nằm trong khung nhìn khi menu cuộn dài.
  useEffect(() => {
    if (!isTabMenuOpen) return;
    const id = `kho-tab-option-${TAB_ITEMS[activeTabIndex]?.id}`;
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  }, [activeTabIndex, isTabMenuOpen]);

  const selectTab = (id: MainTabId) => {
    setActiveTab(id);
    setIsTabMenuOpen(false);
    tabTriggerRef.current?.focus();
  };

  const searchInputRef = useRef<HTMLInputElement>(null);
  const magnetInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Khởi tạo Custom Hook Voice Search
  const {
    isListening,
    isSupported,
    error: voiceError,
    startListening,
    stopListening,
    toggleListening,
    clearError: clearVoiceError,
  } = useVoiceSearch((text) => {
    setSearchTerm(text);
  });

  // 1. Lắng nghe cuộn trang để kích hoạt Magnet Search có điều kiện
  useEffect(() => {
    const handleScroll = () => {
      if (!searchContainerRef.current) return;
      const rect = searchContainerRef.current.getBoundingClientRect();
      // Khi đáy của thanh search vượt qua mép trên cửa sổ
      setIsScrolledPast(rect.bottom < 0);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 2. Lắng nghe phím tắt toàn cục không xung đột (Non-Conflicting Keyboard Shortcuts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isTypingInInput = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT';

      // Phím '/' -> Nhảy vào ô tìm kiếm (chỉ khi không đang gõ trong input khác)
      if (e.key === '/' && !isTypingInInput) {
        e.preventDefault();
        if (isScrolledPast && magnetInputRef.current) {
          magnetInputRef.current.focus();
          magnetInputRef.current.select();
        } else if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
        return;
      }

      // Phím 'Escape' -> Xóa tìm kiếm hoặc đóng modal
      if (e.key === 'Escape') {
        if (modalOpen) {
          setModalOpen(false);
        } else if (searchTerm) {
          setSearchTerm('');
        }
        return;
      }

      // Phím tắt Alt + V hoặc Alt + Shift + V (Mac: Option+V / Option+Shift+V / Cmd+Shift+V) -> Bật/Tắt Micro giọng nói tiếng Việt
      if (matchActionShortcut(e, 'KeyV') || matchActionShortcut(e, 'KeyV', { shift: true })) {
        e.preventDefault();
        toggleListening();
        return;
      }

      // Tổ hợp Alt + Shift + T (Mac: Option+Shift+T / Cmd+Shift+T) -> Mở Phiếu Chuyển Kho
      if (matchActionShortcut(e, 'KeyT', { shift: true })) {
        e.preventDefault();
        if (!modalOpen) openAction('TRANSFER');
        return;
      }

      // Tổ hợp Alt + Shift + R (Mac: Option+Shift+R / Cmd+Shift+R) -> Mở Phiếu Nhập Kho
      if (matchActionShortcut(e, 'KeyR', { shift: true })) {
        e.preventDefault();
        if (!modalOpen) openAction('RECEIPT');
        return;
      }

      // Tổ hợp Alt + Shift + X (Mac: Option+Shift+X / Cmd+Shift+X) -> Mở Phiếu Xuất Kho
      if (matchActionShortcut(e, 'KeyX', { shift: true })) {
        e.preventDefault();
        if (!modalOpen) openAction('DISPATCH');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, searchTerm, isScrolledPast, toggleListening]);

  const filteredBooks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return initialBooks;

    // Null-safe: bất kỳ bản ghi thiếu isbn/code nào cũng không được làm crash
    // render (crash render = ô input trông như "gõ không ra chữ").
    return initialBooks.filter((b) => {
      try {
        // 1. Khớp 4 số cuối hoặc toàn bộ ISBN
        const isbn = String(b?.isbnLast4 ?? b?.isbn ?? '');
        const fullIsbn = String(b?.isbn ?? '');
        if (isbn.toLowerCase().includes(q) || fullIsbn.toLowerCase().includes(q)) return true;
        // 2. Khớp mã SKU (H01, H02...)
        if (String(b?.code ?? '').toLowerCase().includes(q)) return true;
        // 3. Khớp mã viết tắt (bt, nbl, dddhc...)
        if (b?.shortCode && String(b.shortCode).toLowerCase() === q) return true;
        // 4. Khớp tiếng Việt không dấu trên Tên sách
        if (matchesVietnameseSearch(b?.title, q)) return true;
        // 5. Khớp tiếng Việt không dấu trên Tác giả
        if (matchesVietnameseSearch(b?.author, q)) return true;
        // 6. Khớp tiếng Việt không dấu trên Dịch giả
        if (matchesVietnameseSearch(b?.translator, q)) return true;
      } catch {
        return false;
      }

      return false;
    });
  }, [searchTerm, initialBooks]);

  const openAction = (action: 'RECEIPT' | 'DISPATCH' | 'TRANSFER', book: MatrixBookItem | null = null) => {
    const fallbackBook = book || initialBooks[0] || null;
    if (!fallbackBook) return;
    setModalAction(action);
    setSelectedBookForAction(fallbackBook);
    setModalOpen(true);
  };

  // Tổng tồn từng kho cho tab bar (tính từ matrix đã load, không query thêm).
  const warehouseTotals = useMemo(() => {
    return initialBooks.reduce(
      (acc, b) => ({
        auCo: acc.auCo + (b.stockAuCo || 0),
        quynhMai: acc.quynhMai + (b.stockQuynhMai || 0),
        duPhong: acc.duPhong + (b.stockDuPhong || 0),
      }),
      { auCo: 0, quynhMai: 0, duPhong: 0 }
    );
  }, [initialBooks]);

  const getWarehouseStock = (b: MatrixBookItem, tab: typeof warehouseTab) => {
    if (tab === 'wh-au-co') return b.stockAuCo;
    if (tab === 'wh-quynh-mai') return b.stockQuynhMai;
    if (tab === 'wh-du-phong') return b.stockDuPhong;
    return b.totalStock;
  };

  const handleRefresh = () => {
    window.location.reload();
  };

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

  // Điều kiện kích hoạt Magnet: ĐÃ CUỘN XUỐNG DƯỚI && (CÓ TỪ KHÓA hoặc ĐANG FOCUS INPUT hoặc ĐANG BẬT MICRO GIỌNG NÓI)
  const showMagnetBar = isScrolledPast && (searchTerm.trim().length > 0 || isInputFocused || isListening);

  return (
    <div className="space-y-6">
      {/* 1. THANH TÌM KIẾM NAM CHÂM CÓ ĐIỀU KIỆN — render qua portal trên
          document.body để không tổ tiên nào (overflow:hidden / transform) cắt mất nó. */}
      {showMagnetBar && mounted && (
        <PortalToBody>
          <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-2xl backdrop-blur-md shadow-2xl rounded-2xl py-3 px-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-200 border transition-all ${
              isListening
                ? 'bg-rose-50/95 border-rose-500 ring-4 ring-rose-400/40 shadow-rose-500/20'
                : 'bg-white/95 border-indigo-200'
            }`}
            >
            <Search
              className={`w-5 h-5 shrink-0 transition-colors ${
                isListening ? 'text-rose-600 animate-pulse' : 'text-indigo-600'
              }`}
            />
            <input
              ref={magnetInputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                isListening
                  ? '🔴 Đang lắng nghe tiếng Việt... Hãy nói tên sách (ví dụ: Bệnh tưởng, H01)'
                  : 'Tìm theo tên không dấu, 4 số cuối, mã SKU hoặc bấm Micro...'
              }
              value={searchTerm ?? ''}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              style={{ color: '#1e293b' }}
              className={`flex-1 min-w-0 text-sm font-medium bg-transparent border-none focus:outline-none transition-colors ${
                isListening
                  ? 'text-rose-950 font-semibold placeholder:text-rose-600'
                  : 'text-slate-800 placeholder:text-slate-400'
              }`}
            />

            <span
              className={`text-xs font-mono px-2.5 py-1 rounded-full shrink-0 font-bold border transition-colors ${
                isListening
                  ? 'bg-rose-200/80 text-rose-800 border-rose-300'
                  : 'bg-indigo-50 text-indigo-600 border-indigo-100'
              }`}
            >
              {isListening ? '🎙️ Đang nghe' : `${filteredBooks.length} sách`}
            </span>

            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 transition-colors"
                title="Xóa tìm kiếm"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Magnet Voice Search Button */}
            <button
              type="button"
              onClick={toggleListening}
              title={
                isListening
                  ? 'Đang lắng nghe tiếng Việt... Bấm để dừng (Alt + Shift + V)'
                  : 'Bật Micro tìm sách bằng giọng nói tiếng Việt (Alt + Shift + V)'
              }
              className={`p-2 rounded-xl text-xs font-semibold flex items-center justify-center transition-all shrink-0 min-h-[36px] min-w-[36px] cursor-pointer ${
                isListening
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 ring-2 ring-rose-400 animate-pulse'
                  : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
              }`}
            >
              {isListening ? (
                <MicOff className="w-4 h-4 text-white animate-bounce" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          </div>
        </PortalToBody>
      )}

      {/* 2. THANH CÔNG CỤ BAN ĐẦU (IN-FLOW TOOLBAR) */}
      {/* Ô search luôn full-width hàng riêng để text không bao giờ bị bóp hẹp/che mất. */}
      <div
        ref={searchContainerRef}
        className="bg-white p-4 md:p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col items-stretch gap-4"
      >
        {/* Search Input with Voice & Shortcut Badge */}
        <div className="relative w-full flex items-center min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={
              isListening
                ? '🔴 Đang lắng nghe tiếng Việt... Hãy nói tên sách (ví dụ: Bệnh tưởng, H01)'
                : 'Tìm theo tên không dấu (truong, benh), 4 số cuối (7507), mã tắt (bt) hoặc bấm Micro...'
            }
            value={searchTerm ?? ''}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            style={{ color: '#0f172a' }}
            className={`w-full pl-11 pr-28 py-2.5 text-sm font-medium border rounded-xl outline-none transition-all min-h-[44px] ${
              isListening
                ? 'border-rose-500 ring-2 ring-rose-300 bg-rose-50/20 text-slate-900'
                : 'border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 text-slate-900 placeholder:text-slate-400 bg-white'
            }`}
          />

          {/* Clear Search Button */}
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-12 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Xóa tìm kiếm"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Shortcut hint badge: [/] */}
          {!searchTerm && !isInputFocused && !isListening && (
            <span className="absolute right-12 text-[11px] font-mono text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md pointer-events-none hidden sm:inline font-semibold">
              /
            </span>
          )}

          {/* Voice Search Button */}
          <button
            type="button"
            onClick={toggleListening}
            title={
              isListening
                ? 'Đang lắng nghe tiếng Việt... Bấm để dừng (Alt + Shift + V)'
                : 'Bật Micro tìm sách bằng giọng nói tiếng Việt (Alt + Shift + V)'
            }
            className={`absolute right-2 p-2 rounded-xl text-xs font-bold transition-all min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer ${
              isListening
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 ring-2 ring-rose-400 animate-pulse'
                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
            }`}
          >
            {isListening ? (
              <MicOff className="w-4 h-4 text-white animate-bounce" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Tab & Action Buttons with Keyboard Shortcut Tooltips.
            Dải hành động WRAP + min-w-0; tab đi qua 1 chip gọn + dropdown portal
            nên không còn flex pill lồng nhau (nguyên nhân gốc của bug tràn nút). */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            ref={tabTriggerRef}
            type="button"
            id="kho-main-tab-trigger"
            aria-haspopup="listbox"
            aria-expanded={isTabMenuOpen}
            aria-controls="kho-main-tab-listbox"
            onClick={() => {
              if (isTabMenuOpen) {
                setIsTabMenuOpen(false);
                return;
              }
              // Mở đúng tại tab đang chọn để Enter ngay sau đó là lựa chọn hợp lý.
              const currentIndex = Math.max(
                0,
                TAB_ITEMS.findIndex((t) => t.id === activeTab)
              );
              setActiveTabIndex(currentIndex);
              setIsTabMenuOpen(true);
              positionTabMenu();
            }}
            onKeyDown={(e) => {
              if (isTabMenuOpen) return; // menu đang mở: handler document đảm nhiệm
              if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const currentIndex = Math.max(
                  0,
                  TAB_ITEMS.findIndex((t) => t.id === activeTab)
                );
                setActiveTabIndex(currentIndex);
                setIsTabMenuOpen(true);
              }
            }}
            title={activeTabItem.label}
            className="flex items-center gap-2 max-w-full min-w-0 shrink-0 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <activeTabItem.Icon className="w-4 h-4 shrink-0 text-indigo-600" />
            <span className="whitespace-nowrap shrink-0">{activeTabItem.short}</span>
            {activeTab === 'LEDGER' && (
              <span className="whitespace-nowrap shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-500 border border-slate-200">
                {initialLedger.length}
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform ${isTabMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

          {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && (
            <button
              type="button"
              onClick={() => setCreateWarehouseOpen(true)}
              title="Mở thêm kho hoặc gian hàng hội chợ mới"
              className="flex items-center gap-1.5 whitespace-nowrap shrink-0 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/40 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Store className="w-3.5 h-3.5 text-amber-400" /> Mở Kho
            </button>
          )}
          {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && (
            <button
              type="button"
              onClick={() => setBankManagerOpen(true)}
              title="Gán tài khoản nhận VietQR mặc định cho từng kho"
              className="flex items-center gap-1.5 whitespace-nowrap shrink-0 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Landmark className="w-3.5 h-3.5" /> TK Nhận Tiền
            </button>
          )}

          <button
            type="button"
            onClick={() => setWholesaleModalOpen(true)}
            title="Lập phiếu xuất kho cung ứng cho đối tác"
            className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" /> Xuất Kho Đối Tác
          </button>
          <button
            type="button"
            onClick={() => openAction('TRANSFER')}
            title="Chuyển kho giữa 3 kho"
            className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" /> Chuyển kho
          </button>
          <button
            type="button"
            onClick={() => setBatchTransferOpen(true)}
            title="Chuyển kho hàng loạt nhiều đầu sách"
            className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" /> Chuyển hàng loạt
          </button>
          <button
            type="button"
            onClick={() => openAction('RECEIPT')}
            title="Nhập kho nhà in"
            className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" /> Nhập in
          </button>
          <button
            type="button"
            onClick={() => openAction('DISPATCH')}
            title="Xuất bán / Quà tặng"
            className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <MinusCircle className="w-3.5 h-3.5" /> Xuất bán
          </button>

          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

          <button
            type="button"
            onClick={() => setPickListOpen(true)}
            title="Danh sách soạn sách gom hàng theo kệ"
            className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <PackageSearch className="w-3.5 h-3.5" /> Soạn Kệ
          </button>

          <button
            type="button"
            onClick={() => setRmaModalOpen(true)}
            title="Tiếp nhận sách lỗi & đổi trả vào kho cách ly"
            className="flex items-center gap-1 whitespace-nowrap shrink-0 px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Cách Ly Sách Lỗi
          </button>
        </div>

        {/* 2.4 MENU TAB — portal trên document.body + clamp trong viewport.
            Nhãn dài "Sổ Cái Bất Biến (n)" chỉ xuất hiện ở đây, trong 1 menu riêng,
            nên trên điện thoại không còn dải pill inline bị bóp/tràn.
            Điều hướng bàn phím: ArrowUp/Down di chuyển, Home/End nhảy đầu/cuối,
            Enter chọn, Escape đóng. Focus thật giữ trên trigger (mô hình
            aria-activedescendant) để không mất vị trí focus sau khi menu đóng. */}
        {isTabMenuOpen && mounted && (
          <PortalToBody className="fixed z-[80]">
            <div
              ref={tabMenuRef}
              id="kho-main-tab-listbox"
              role="listbox"
              aria-label="Chọn màn kho hàng"
              aria-activedescendant={`kho-tab-option-${TAB_ITEMS[activeTabIndex]?.id ?? 'MATRIX'}`}
              tabIndex={-1}
              style={{ top: tabMenuPos.top, left: tabMenuPos.left }}
              className="w-[min(20rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl"
            >
              {TAB_ITEMS.map((tab, index) => {
                const isActive = tab.id === activeTab;
                const isFocused = index === activeTabIndex;
                return (
                  <button
                    key={tab.id}
                    id={`kho-tab-option-${tab.id}`}
                    type="button"
                    role="option"
                    aria-selected={tab.id === activeTab}
                    // Dùng chung chỉ báo "đang được bàn phím chỉ tới" (không phải
                    // đã chọn) để người dùng screen reader biết con trỏ đang ở đâu.
                    data-focused={isFocused ? 'true' : undefined}
                    title={tab.title}
                    onMouseEnter={() => setActiveTabIndex(index)}
                    onClick={() => {
                      selectTab(tab.id);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-800'
                        : 'text-slate-700 hover:bg-slate-100'
                    } ${isFocused ? 'ring-2 ring-inset ring-indigo-300' : ''}`}
                  >
                    <tab.Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <span className="flex-1 min-w-0 whitespace-nowrap">{tab.label}</span>
                    {isActive && <Check className="w-4 h-4 shrink-0 text-indigo-600" />}
                  </button>
                );
              })}
            </div>
          </PortalToBody>
        )}
      </div>

      {/* 2.5 BANNER THÔNG BÁO TẠO KHO & CTA ĐIỀU CHUYỂN (#10-CTA) */}
      {createdWarehouseToast && (
        <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-indigo-500/10 border border-emerald-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                Đã mở kho mới thành công: <span className="text-emerald-700 font-extrabold">{createdWarehouseToast.name}</span>
                <span className="ml-2 font-mono text-xs font-semibold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {createdWarehouseToast.code}
                </span>
              </p>
              <p className="text-xs text-slate-600">
                Kho đã sẵn sàng hoạt động. Bạn có muốn chuyển hàng loạt sách vào kho này ngay bây giờ?
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setPresetTargetWarehouseId(createdWarehouseToast.id);
                setBatchTransferOpen(true);
                setCreatedWarehouseToast(null);
              }}
              className="px-4 py-2 whitespace-nowrap shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4" />
              Chuyển hàng vào kho này
            </button>
            <button
              type="button"
              onClick={() => setCreatedWarehouseToast(null)}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50 transition-colors"
              title="Đóng thông báo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}


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
            className="px-2.5 py-1 whitespace-nowrap shrink-0 bg-rose-800 hover:bg-rose-700 text-white rounded-xl text-[11px] font-bold transition"
          >
            Dừng Nghe
          </button>
        </div>
      )}

      {/* Banner thông báo lỗi Micro nếu có */}
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

      {/* Main View: Matrix vs Ledger vs Transit */}
      {activeTab === 'TRANSIT' ? (
        <TransitPanel currentRole={(currentRole as any) || 'ROLE_OWNER'} />
      ) : activeTab === 'MATRIX' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Ticket 3 MVP: Thanh tab kho kiểu Sheets — read-only, Transit/RMA để sprint sau */}
          <div className="flex items-center gap-1.5 px-3 pt-3 pb-2 overflow-x-auto border-b border-slate-100 bg-slate-50/60">
            {(
              [
                { id: 'ALL', label: 'Tất cả 3 kho', total: warehouseTotals.auCo + warehouseTotals.quynhMai + warehouseTotals.duPhong },
                { id: 'wh-au-co', label: 'Kho 1: Âu Cơ', total: warehouseTotals.auCo },
                { id: 'wh-quynh-mai', label: 'Kho 2: Quỳnh Mai', total: warehouseTotals.quynhMai },
                { id: 'wh-du-phong', label: 'Kho 3: Hội Chợ', total: warehouseTotals.duPhong },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setWarehouseTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${
                  warehouseTab === t.id
                    ? 'bg-white text-indigo-700 border-indigo-300 shadow-sm'
                    : 'bg-transparent text-slate-500 border-transparent hover:text-slate-800 hover:bg-white'
                }`}
              >
                {t.label} ({t.total.toLocaleString('vi-VN')})
              </button>
            ))}
            <span className="ml-auto text-[10px] text-slate-400 whitespace-nowrap hidden sm:inline">
              Tạo phiếu bằng nút Cách Ly Sách Lỗi
            </span>
          </div>
          <div className="overflow-x-auto pb-24 lg:pb-2" data-kho-ui="fab-gutter">
            <table className="w-full min-w-[640px] text-left text-xs text-slate-600">
              <thead className="bg-slate-50 uppercase text-slate-500 font-semibold border-b border-slate-200 tracking-wider">
                <tr>
                  <th className="px-3 py-3 w-14">Mã</th>
                  <th className="px-3 py-3">Tên sách & Tác phẩm</th>
                  <th className="px-3 py-3 w-24">Tên tắt</th>
                  <th className="px-3 py-3 w-28">4 số ISBN</th>
                  {warehouseTab === 'ALL' ? (
                    <>
                      <th className="px-3 py-3 text-right bg-indigo-50/50 font-bold text-indigo-900 w-28">
                        Kho Âu Cơ
                        <span className="block font-normal text-[10px] text-indigo-500">Sách lẻ</span>
                      </th>
                      <th className="px-3 py-3 text-right bg-emerald-50/50 font-bold text-emerald-900 w-32">
                        Kho Quỳnh Mai
                        <span className="block font-normal text-[10px] text-emerald-500">Kiện lưu sỉ</span>
                      </th>
                      <th className="px-3 py-3 text-right bg-amber-50/50 font-bold text-amber-900 w-28">
                        Kho Dự phòng
                        <span className="block font-normal text-[10px] text-amber-500">Hội chợ</span>
                      </th>
                    </>
                  ) : (
                    <th className="px-3 py-3 text-right bg-indigo-50/50 font-bold text-indigo-900 w-32">
                      {warehouseTab === 'wh-au-co' ? 'Kho Âu Cơ' : warehouseTab === 'wh-quynh-mai' ? 'Kho Quỳnh Mai' : 'Kho Hội Chợ'}
                      <span className="block font-normal text-[10px] text-indigo-500">Tồn tại kho này</span>
                    </th>
                  )}
                  <th className="px-3 py-3 text-right font-black text-slate-900 w-28">
                    Tổng tồn
                  </th>
                  <th className="px-3 py-3 text-center w-28">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBooks.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-3 py-2.5 font-mono font-bold text-indigo-600">{b.code}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-900">{b.title}</div>
                      <div className="text-[11px] text-slate-400">{b.author}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-mono font-semibold">
                        {b.shortCode || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded font-bold text-slate-700">
                        {b.isbnLast4}
                      </span>
                    </td>
                    {warehouseTab === 'ALL' ? (
                      <>
                        <td className="px-3 py-2.5 text-right font-mono font-bold bg-indigo-50/20 text-indigo-800">
                          {b.stockAuCo.toLocaleString('vi-VN')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold bg-emerald-50/20 text-emerald-800">
                          {b.stockQuynhMai.toLocaleString('vi-VN')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold bg-amber-50/20 text-amber-800">
                          {b.stockDuPhong.toLocaleString('vi-VN')}
                        </td>
                      </>
                    ) : (
                      <td className="px-3 py-2.5 text-right font-mono font-bold bg-indigo-50/20 text-indigo-800">
                        {getWarehouseStock(b, warehouseTab).toLocaleString('vi-VN')}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right font-mono font-black text-slate-900">
                      {b.totalStock > 0 ? (
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          {b.totalStock.toLocaleString('vi-VN')}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => openAction('TRANSFER', b)}
                        className="px-2 py-1 whitespace-nowrap text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 rounded border border-indigo-200 transition-colors"
                      >
                        Chuyển kho
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Gutter cuộn: chừa khoảng trống cuộn được để cột cuối (Thao tác) trượt
                khỏi nút tím nổi góc phải, không bị che vĩnh viễn. */}
            <div aria-hidden="true" className="h-0 w-20 shrink-0" />
          </div>
        </div>
      ) : (
        /* Ledger Audit Trail Tab */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Sổ Cái Kho Bất Biến (Append-Only Ledger) — Nghiêm Cấm Sửa/Xóa Lịch Sử
            </div>
            <span className="text-xs text-slate-400">Thời gian thực</span>
          </div>
          <div className="overflow-x-auto pb-24 lg:pb-2" data-kho-ui="fab-gutter">
            <table className="w-full min-w-[720px] text-left text-xs text-slate-600">
              <thead className="bg-slate-100/70 uppercase text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 w-36">Thời gian</th>
                  <th className="px-3 py-2.5 w-32">Số Chứng Từ</th>
                  <th className="px-3 py-2.5 w-32">Nghiệp vụ</th>
                  <th className="px-3 py-2.5">Tên sách</th>
                  <th className="px-3 py-2.5 w-28">Kho</th>
                  <th className="px-3 py-2.5 text-right w-28">Biến động</th>
                  <th className="px-3 py-2.5 w-36">Người tạo</th>
                  <th className="px-3 py-2.5">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {initialLedger.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400 font-sans">
                      Chưa có bút toán nào trong sổ cái.
                    </td>
                  </tr>
                ) : (
                  initialLedger.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-3 py-2 text-slate-500 text-[11px]">{item.recordedAt}</td>
                      <td className="px-3 py-2 font-bold text-slate-800">{item.documentRef}</td>
                      <td className="px-3 py-2">
                        {item.eventType === 'RECEIPT' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            NHẬP KHO
                          </span>
                        )}
                        {item.eventType === 'TRANSFER_OUT' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                            XUẤT CHUYỂN
                          </span>
                        )}
                        {item.eventType === 'TRANSFER_IN' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
                            NHẬP CHUYỂN
                          </span>
                        )}
                        {item.eventType === 'DISPATCH_SALE' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                            XUẤT BÁN
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-sans font-medium text-slate-900">
                        [{item.bookCode}] {item.bookTitle}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{item.warehouseCode}</td>
                      <td className="px-3 py-2 text-right font-bold">
                        {item.quantityDelta > 0 ? (
                          <span className="text-emerald-600">+{item.quantityDelta}</span>
                        ) : (
                          <span className="text-rose-600">{item.quantityDelta}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-sans text-slate-600 text-[11px]">{item.actorId}</td>
                      <td className="px-3 py-2 font-sans text-slate-400 text-[11px]">{item.note || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {/* Gutter cuộn cho sổ cái: cột Ghi chú cuối cùng trượt khỏi nút tím nổi. */}
            <div aria-hidden="true" className="h-0 w-20 shrink-0" />
          </div>
        </div>
      )}

      {/* 5. TAB SỔ PHIẾU XUẤT KHO BÁN BUÔN ĐẠI LÝ (DELIVERY ORDERS LEDGER) */}
      {activeTab === 'DELIVERY_ORDERS' && (
        <DeliveryOrdersLedger
          currentRole={currentRole}
          onOpenCreateModal={() => setWholesaleModalOpen(true)}
        />
      )}

      {/* Modal */}
      <StockMovementModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        books={initialBooks}
        warehouses={warehouses}
        defaultAction={modalAction}
        selectedBook={selectedBookForAction}
        onSuccess={handleRefresh}
      />

      {/* Batch Transfer Modal */}
      <BatchTransferModal
        isOpen={batchTransferOpen}
        onClose={() => {
          setBatchTransferOpen(false);
          setPresetTargetWarehouseId(undefined);
        }}
        books={initialBooks}
        warehouses={localWarehouses}
        onSuccess={handleRefresh}
        initialToWarehouseId={presetTargetWarehouseId}
      />

      {/* Wholesale Dispatch Modal (PXK) */}
      <WholesaleDispatchModal
        isOpen={wholesaleModalOpen}
        onClose={() => setWholesaleModalOpen(false)}
        warehouses={localWarehouses}
        books={initialBooks}
        partners={partners}
        currentRole={currentRole}
        onOrderCreated={handleRefresh}
      />

      {/* Pick List Modal */}
      <PickListModal
        isOpen={pickListOpen}
        onClose={() => setPickListOpen(false)}
        books={initialBooks}
        warehouses={localWarehouses}
      />

      {/* RMA Ticket Modal */}
      <RmaTicketModal
        isOpen={rmaModalOpen}
        onClose={() => setRmaModalOpen(false)}
        books={initialBooks}
        warehouses={localWarehouses}
        onSuccess={handleRefresh}
      />

      {/* Create Warehouse Modal */}
      <CreateWarehouseModal
        isOpen={createWarehouseOpen}
        onClose={() => setCreateWarehouseOpen(false)}
        onCreated={(newWh) => {
          if (newWh && newWh.id) {
            setLocalWarehouses((prev) => {
              if (prev.some((w) => w.id === newWh.id)) return prev;
              return [
                ...prev,
                {
                  id: newWh.id,
                  name: newWh.name || 'Kho mới',
                  code: newWh.code || 'MÃ_KHO',
                },
              ];
            });
            setCreatedWarehouseToast({
              id: newWh.id,
              name: newWh.name || 'Kho mới',
              code: newWh.code || 'MÃ_KHO',
            });
          }
        }}
      />
      {bankManagerOpen && (
        <WarehouseBankManager onClose={() => { setBankManagerOpen(false); handleRefresh(); }} />
      )}
    </div>
  );
}
