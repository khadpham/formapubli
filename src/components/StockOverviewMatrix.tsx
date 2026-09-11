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
  Mic,
  MicOff,
  X,
  Keyboard,
} from 'lucide-react';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { StockMovementModal } from './StockMovementModal';
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
}

export function StockOverviewMatrix({
  initialBooks,
  warehouses,
  initialLedger,
}: StockOverviewMatrixProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'RECEIPT' | 'DISPATCH' | 'TRANSFER'>('TRANSFER');
  const [selectedBookForAction, setSelectedBookForAction] = useState<MatrixBookItem | null>(null);
  const [activeTab, setActiveTab] = useState<'MATRIX' | 'LEDGER'>('MATRIX');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isScrolledPast, setIsScrolledPast] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const magnetInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Khởi tạo Custom Hook Voice Search
  const { isListening, isSupported, toggleListening, error: voiceError } = useVoiceSearch((text) => {
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

      // Tổ hợp Alt + Shift + V -> Bật/Tắt Micro giọng nói tiếng Việt
      if (e.altKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        toggleListening();
        return;
      }

      // Tổ hợp Alt + Shift + T -> Mở Phiếu Chuyển Kho (Transfer)
      if (e.altKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        openAction('TRANSFER');
        return;
      }

      // Tổ hợp Alt + Shift + R -> Mở Phiếu Nhập Kho (Receipt)
      if (e.altKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        e.preventDefault();
        openAction('RECEIPT');
        return;
      }

      // Tổ hợp Alt + Shift + X -> Mở Phiếu Xuất Kho (Dispatch)
      if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
        e.preventDefault();
        openAction('DISPATCH');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, searchTerm, isScrolledPast, toggleListening]);

  const filteredBooks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return initialBooks;

    return initialBooks.filter((b) => {
      // 1. Khớp 4 số cuối hoặc toàn bộ ISBN
      if (b.isbnLast4.includes(q) || b.isbn.includes(q)) return true;
      // 2. Khớp mã SKU (H01, H02...)
      if (b.code.toLowerCase().includes(q)) return true;
      // 3. Khớp mã viết tắt (bt, nbl, dddhc...)
      if (b.shortCode && b.shortCode.toLowerCase() === q) return true;
      // 4. Khớp tiếng Việt không dấu trên Tên sách
      if (matchesVietnameseSearch(b.title, q)) return true;
      // 5. Khớp tiếng Việt không dấu trên Tác giả
      if (matchesVietnameseSearch(b.author, q)) return true;
      // 6. Khớp tiếng Việt không dấu trên Dịch giả
      if (matchesVietnameseSearch(b.translator, q)) return true;

      return false;
    });
  }, [searchTerm, initialBooks]);

  const openAction = (action: 'RECEIPT' | 'DISPATCH' | 'TRANSFER', book: MatrixBookItem | null = null) => {
    setModalAction(action);
    setSelectedBookForAction(book || initialBooks[0] || null);
    setModalOpen(true);
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  // Điều kiện kích hoạt Magnet: ĐÃ CUỘN XUỐNG DƯỚI && (CÓ TỪ KHÓA hoặc ĐANG FOCUS INPUT)
  const showMagnetBar = isScrolledPast && (searchTerm.trim().length > 0 || isInputFocused);

  return (
    <div className="space-y-6">
      {/* 1. THANH TÌM KIẾM NAM CHÂM CÓ ĐIỀU KIỆN (CONDITIONAL MAGNET BAR) */}
      {showMagnetBar && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-2xl bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl border border-indigo-200 py-2.5 px-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-200">
          <Search className="w-4 h-4 text-indigo-600 shrink-0" />
          <input
            ref={magnetInputRef}
            type="text"
            placeholder="Tìm theo tên không dấu, 4 số cuối hoặc bấm Micro..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            className="flex-1 text-xs font-semibold text-slate-800 bg-transparent border-none focus:outline-none placeholder-slate-400"
          />

          <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full shrink-0 font-bold">
            {filteredBooks.length} sách
          </span>

          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0"
              title="Xóa tìm kiếm (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {isSupported && (
            <button
              type="button"
              onClick={toggleListening}
              title="Tìm kiếm bằng giọng nói tiếng Việt (Alt + Shift + V)"
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center justify-center transition-all shrink-0 min-h-[32px] min-w-[32px] ${
                isListening
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/40 animate-pulse'
                  : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'
              }`}
            >
              {isListening ? (
                <MicOff className="w-3.5 h-3.5 animate-bounce" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      )}

      {/* 2. THANH CÔNG CỤ BAN ĐẦU (IN-FLOW TOOLBAR) */}
      <div
        ref={searchContainerRef}
        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4"
      >
        {/* Search Input with Voice & Shortcut Badge */}
        <div className="relative flex-1 flex items-center">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Tìm theo tên không dấu (truong, benh), 4 số cuối (7507), mã tắt (bt) hoặc bấm Micro..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            className="w-full pl-10 pr-28 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800"
          />

          {/* Shortcut hint badge: [/] */}
          {!searchTerm && !isInputFocused && (
            <span className="absolute right-20 text-[10px] font-mono text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded pointer-events-none hidden sm:inline">
              /
            </span>
          )}

          {/* Voice Search Button */}
          {isSupported && (
            <button
              type="button"
              onClick={toggleListening}
              title="Tìm kiếm bằng giọng nói tiếng Việt (Alt + Shift + V)"
              className={`absolute right-2 p-1.5 rounded-lg text-xs font-bold transition-all min-h-[32px] min-w-[32px] flex items-center justify-center ${
                isListening
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/40 animate-pulse'
                  : 'text-slate-400 hover:text-indigo-600 hover:bg-slate-100'
              }`}
            >
              {isListening ? (
                <MicOff className="w-3.5 h-3.5 animate-bounce" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
            </button>
          )}
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
          </div>

          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

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
        </div>
      </div>

      {/* Main View: Matrix vs Ledger */}
      {activeTab === 'MATRIX' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 uppercase text-slate-500 font-semibold border-b border-slate-200 tracking-wider">
                <tr>
                  <th className="px-3 py-3 w-14">Mã</th>
                  <th className="px-3 py-3">Tên sách & Tác phẩm</th>
                  <th className="px-3 py-3 w-24">Tên tắt</th>
                  <th className="px-3 py-3 w-28">4 số ISBN</th>
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
                    <td className="px-3 py-2.5 text-right font-mono font-bold bg-indigo-50/20 text-indigo-800">
                      {b.stockAuCo.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold bg-emerald-50/20 text-emerald-800">
                      {b.stockQuynhMai.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold bg-amber-50/20 text-amber-800">
                      {b.stockDuPhong.toLocaleString('vi-VN')}
                    </td>
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
    </div>
  );
}