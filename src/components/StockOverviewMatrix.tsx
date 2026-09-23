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
} from 'lucide-react';
import React, { useState, useMemo, useEffect, useRef } from 'react';
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

  const [selectedBookForAction, setSelectedBookForAction] = useState<MatrixBookItem | null>(null);
  const [activeTab, setActiveTab] = useState<'MATRIX' | 'LEDGER' | 'TRANSIT' | 'DELIVERY_ORDERS'>('MATRIX');
  // Ticket 3 MVP: tab kho kiểu Sheets — chỉ lọc hiển thị read-only, không đụng ledger.
  const [warehouseTab, setWarehouseTab] = useState<'ALL' | 'wh-au-co' | 'wh-quynh-mai' | 'wh-du-phong'>('ALL');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);

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

      // Phím tắt Alt + V hoặc Alt + Shift + V -> Bật/Tắt Micro giọng nói tiếng Việt
      if (e.altKey && (e.key === 'V' || e.key === 'v' || e.code === 'KeyV')) {
        e.preventDefault();
        toggleListening();
        return;
      }

      // Tổ hợp Alt + Shift + T -> Mở Phiếu Chuyển Kho (Transfer)
      // Dùng e.code để bắt đúng phím vật lý kể cả khi bộ gõ TV đổi e.key.
      // Không reopen khi modal đã mở để tránh reset state đang nhập.
      if (e.altKey && e.shiftKey && (e.key === 'T' || e.key === 't' || e.code === 'KeyT')) {
        e.preventDefault();
        if (!modalOpen) openAction('TRANSFER');
        return;
      }

      // Tổ hợp Alt + Shift + R -> Mở Phiếu Nhập Kho (Receipt)
      if (e.altKey && e.shiftKey && (e.key === 'R' || e.key === 'r' || e.code === 'KeyR')) {
        e.preventDefault();
        if (!modalOpen) openAction('RECEIPT');
        return;
      }

      // Tổ hợp Alt + Shift + X -> Mở Phiếu Xuất Kho (Dispatch)
      if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x' || e.code === 'KeyX')) {
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
      {/* 1. THANH TÌM KIẾM NAM CHÂM CÓ ĐIỀU KIỆN (CONDITIONAL MAGNET BAR) */}
      {showMagnetBar && (
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
            className={`flex-1 text-sm font-medium bg-transparent border-none focus:outline-none transition-colors ${
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
              title="Xóa tìm kiếm (Esc)"
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
              title="Xóa tìm kiếm (Esc)"
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

        {/* Tab & Action Buttons with Keyboard Shortcut Tooltips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="bg-slate-100 p-1 rounded-lg flex text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('MATRIX')}
              className={`px-3 py-1.5 rounded-md transition-all ${
                activeTab === 'MATRIX'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ma trận 3 Kho
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('LEDGER')}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'LEDGER'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Sổ Cái Bất Biến ({initialLedger.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('TRANSIT')}
              title="Xe đang đi đường qua trạm wh-in-transit, kẹt quá 12h sẽ đỏ"
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'TRANSIT'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              Đi Đường
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DELIVERY_ORDERS')}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'DELIVERY_ORDERS'
                  ? 'bg-white text-amber-700 font-bold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Sổ Phiếu Xuất Đối Tác (PXK)
            </button>
          </div>

          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

          {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && (
            <button
              type="button"
              onClick={() => setCreateWarehouseOpen(true)}
              title="Mở thêm kho hoặc gian hàng hội chợ mới (Chỉ Quản lý / Chủ)"
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/40 rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Store className="w-3.5 h-3.5 text-amber-400" /> Mở Kho / Gian Hàng
            </button>
          )}
          {(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && (
            <button
              type="button"
              onClick={() => setBankManagerOpen(true)}
              title="Gán tài khoản nhận VietQR mặc định cho từng kho (Chỉ Quản lý / Chủ)"
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Landmark className="w-3.5 h-3.5" /> TK Nhận Tiền
            </button>
          )}

          <button
            type="button"
            onClick={() => setWholesaleModalOpen(true)}
            title="Lập phiếu xuất kho cung ứng cho đối tác: Nhà sách, Thư viện, Trường học, Đại lý (PXK)"
            className="flex items-center gap-1 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" /> Xuất Kho Đối Tác
          </button>
          <button
            type="button"
            onClick={() => openAction('TRANSFER')}
            title="Chuyển kho giữa 3 kho (Alt + Shift + T)"
            className="flex items-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" /> Chuyển kho
            <span className="text-[9px] opacity-70 bg-indigo-800 px-1 py-0.2 rounded hidden lg:inline">Alt+Shift+T</span>
          </button>
          <button
            type="button"
            onClick={() => setBatchTransferOpen(true)}
            title="Chuyển kho hàng loạt nhiều đầu sách (Hội chợ / Sự kiện)"
            className="flex items-center gap-1 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" /> Chuyển hàng loạt
          </button>
          <button
            type="button"
            onClick={() => openAction('RECEIPT')}
            title="Nhập kho nhà in (Alt + Shift + R)"
            className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" /> Nhập in
            <span className="text-[9px] opacity-70 bg-emerald-800 px-1 py-0.2 rounded hidden lg:inline">Alt+Shift+R</span>
          </button>
          <button
            type="button"
            onClick={() => openAction('DISPATCH')}
            title="Xuất bán / Quà tặng (Alt + Shift + X)"
            className="flex items-center gap-1 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <MinusCircle className="w-3.5 h-3.5" /> Xuất bán
            <span className="text-[9px] opacity-70 bg-rose-800 px-1 py-0.2 rounded hidden lg:inline">Alt+Shift+X</span>
          </button>

          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

          <button
            type="button"
            onClick={() => setPickListOpen(true)}
            title="Danh sách soạn sách gom hàng theo kệ (Shelf Pick List)"
            className="flex items-center gap-1 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <PackageSearch className="w-3.5 h-3.5" /> Soạn Kệ
          </button>

          <button
            type="button"
            onClick={() => setRmaModalOpen(true)}
            title="Tiếp nhận sách lỗi & đổi trả vào kho cách ly (RMA)"
            className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Cách Ly RMA
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
              RMA tạo bằng nút Cách Ly RMA
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
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
                        className="px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 rounded border border-indigo-200 transition-colors"
                      >
                        Chuyển kho
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
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
        onClose={() => setBatchTransferOpen(false)}
        books={initialBooks}
        warehouses={warehouses}
        onSuccess={handleRefresh}
      />

      {/* Wholesale Dispatch Modal (PXK) */}
      <WholesaleDispatchModal
        isOpen={wholesaleModalOpen}
        onClose={() => setWholesaleModalOpen(false)}
        warehouses={warehouses}
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
        warehouses={warehouses}
      />

      {/* RMA Ticket Modal */}
      <RmaTicketModal
        isOpen={rmaModalOpen}
        onClose={() => setRmaModalOpen(false)}
        books={initialBooks}
        warehouses={warehouses}
        onSuccess={handleRefresh}
      />

      {/* Create Warehouse Modal */}
      <CreateWarehouseModal
        isOpen={createWarehouseOpen}
        onClose={() => setCreateWarehouseOpen(false)}
        onCreated={handleRefresh}
      />
      {bankManagerOpen && (
        <WarehouseBankManager onClose={() => { setBankManagerOpen(false); handleRefresh(); }} />
      )}
    </div>
  );
}