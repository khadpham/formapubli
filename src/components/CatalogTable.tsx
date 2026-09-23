'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, BookOpen, Warehouse, CheckCircle2, AlertCircle, Mic, MicOff, X } from 'lucide-react';
import { matchesVietnameseSearch } from '@/lib/vietnamese';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { matchActionShortcut } from '@/lib/keyboard';

interface BookItem {
  code: string;
  title: string;
  isbn: string;
  isbnLast4: string;
  author: string;
  translator: string | null;
  category: string | null;
  shortCode: string | null;
  coverPrice: number;
  publisher: string | null;
  status: string;
  // BV-04: optional khi caller có số tồn (matrixBooks). Không bắt buộc để tương thích ngược.
  totalStock?: number;
}

type StockFilter = 'ALL' | 'IN_STOCK' | 'OUT_OF_STOCK';
type SortMode = 'DEFAULT' | 'STOCK_DESC' | 'STOCK_ASC' | 'AZ' | 'ZA' | 'TOP';

interface CatalogTableProps {
  initialBooks: BookItem[];
  warehouseCount: number;
  partnerCount: number;
}

export function CatalogTable({ initialBooks, warehouseCount, partnerCount }: CatalogTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  // BV-05: debounce 200ms — input gõ mượt, filter chạy trên bản debounced
  const [debouncedTerm, setDebouncedTerm] = useState('');
  // BV-04: filter tồn kho + sort
  const [stockFilter, setStockFilter] = useState<StockFilter>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('DEFAULT');
  const [isScrolledPast, setIsScrolledPast] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const magnetInputRef = useRef<HTMLInputElement>(null);

  // Voice Search Hook
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

  // BV-05: debounce search 200ms để instant search không giật
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(searchTerm), 200);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Lắng nghe cuộn trang
  useEffect(() => {
    const handleScroll = () => {
      if (!searchContainerRef.current) return;
      const rect = searchContainerRef.current.getBoundingClientRect();
      setIsScrolledPast(rect.bottom < 0);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Tự động focus input tương ứng khi kích hoạt giọng nói
  useEffect(() => {
    if (isListening) {
      if (isScrolledPast && magnetInputRef.current) {
        magnetInputRef.current.focus();
      } else if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }
  }, [isListening, isScrolledPast]);

  // Phím tắt bàn phím
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isTypingInInput = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT';

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

      if (e.key === 'Escape') {
        if (searchTerm) {
          setSearchTerm('');
        }
        return;
      }

      if (matchActionShortcut(e, 'KeyV') || matchActionShortcut(e, 'KeyV', { shift: true })) {
        e.preventDefault();
        toggleListening();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchTerm, isScrolledPast, toggleListening]);

  const filteredBooks = useMemo(() => {
    const query = debouncedTerm.trim().toLowerCase();
    if (!query) return initialBooks;

    // Null-safe: tránh crash render làm input trông như "gõ không ra chữ".
    return initialBooks.filter((book) => {
      try {
        // 1. Khớp ISBN hoặc 4 số cuối
        if (
          String(book?.isbn ?? '').toLowerCase().includes(query) ||
          String(book?.isbnLast4 ?? '').toLowerCase().includes(query)
        )
          return true;
        // 2. Khớp mã SKU
        if (String(book?.code ?? '').toLowerCase().includes(query)) return true;
        // 3. Khớp mã viết tắt (BV-05: includes thay vì === để gõ "tg" ra hàng loạt)
        if (book?.shortCode && String(book.shortCode).toLowerCase().includes(query)) return true;
        // 4. Khớp tiếng Việt không dấu trên Tên sách (+ acronym tg->tghls bên trong)
        if (matchesVietnameseSearch(book?.title, query)) return true;
        // 5. Khớp tiếng Việt không dấu trên Tác giả
        if (matchesVietnameseSearch(book?.author, query)) return true;
        // 6. Khớp tiếng Việt không dấu trên Dịch giả
        if (matchesVietnameseSearch(book?.translator, query)) return true;
        // 7. Khớp tiếng Việt không dấu trên Thể loại / NXB
        if (matchesVietnameseSearch(book?.category, query) || matchesVietnameseSearch(book?.publisher, query))
          return true;
      } catch {
        return false;
      }

      return false;
    });
  }, [debouncedTerm, initialBooks]);

  // BV-04: áp filter tồn kho + sort trên kết quả search
  const displayedBooks = useMemo(() => {
    const isOut = (b: BookItem) =>
      b.status === 'SOLD_OUT' || (typeof b.totalStock === 'number' && b.totalStock <= 0);
    let rows = filteredBooks.filter((b) => {
      if (stockFilter === 'IN_STOCK') return !isOut(b);
      if (stockFilter === 'OUT_OF_STOCK') return isOut(b);
      return true;
    });
    const byTitle = (a: BookItem, b: BookItem) =>
      String(a.title ?? '').localeCompare(String(b.title ?? ''), 'vi');
    const stockOf = (b: BookItem) => (typeof b.totalStock === 'number' ? b.totalStock : b.status === 'SOLD_OUT' ? 0 : 1);
    if (sortMode === 'AZ') rows = [...rows].sort(byTitle);
    else if (sortMode === 'ZA') rows = [...rows].sort((a, b) => byTitle(b, a));
    else if (sortMode === 'STOCK_DESC' || sortMode === 'TOP') rows = [...rows].sort((a, b) => stockOf(b) - stockOf(a));
    else if (sortMode === 'STOCK_ASC') rows = [...rows].sort((a, b) => stockOf(a) - stockOf(b));
    return rows;
  }, [filteredBooks, stockFilter, sortMode]);

  const showMagnetBar = isScrolledPast && (searchTerm.trim().length > 0 || isInputFocused || isListening);

  return (
    <div className="space-y-6">
      {/* THANH TÌM KIẾM NAM CHÂM CÓ ĐIỀU KIỆN (CONDITIONAL MAGNET BAR) */}
      {showMagnetBar && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-2xl backdrop-blur-md shadow-2xl rounded-2xl py-3 px-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-200 border transition-all ${
            isListening
              ? 'bg-rose-50/95 border-rose-500 ring-4 ring-rose-400/40 shadow-rose-500/20'
              : 'bg-white/95 border-indigo-200 ring-4 ring-indigo-500/10 shadow-indigo-600/10'
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
            placeholder={
              isListening
                ? '🔴 Đang lắng nghe tiếng Việt... Hãy nói tên sách (ví dụ: Bệnh tưởng, H01)'
                : 'Tìm theo tên không dấu, 4 số cuối, mã SKU hoặc bấm Micro...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            className={`flex-1 text-sm font-medium bg-transparent border-none focus:outline-none transition-colors ${
              isListening
                ? 'text-rose-950 font-semibold placeholder:text-rose-600'
                : 'text-slate-900 placeholder-slate-400'
            }`}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                magnetInputRef.current?.focus();
              }}
              className="p-1 hover:bg-slate-200/60 rounded-full text-slate-400 hover:text-slate-600 transition"
              title="Xóa tìm kiếm"
            >
              <X className="w-4 h-4" />
            </button>
          )}

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
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
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

      {/* Search Input Bar */}
      <div ref={searchContainerRef} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="relative flex items-center">
          <Search className="absolute left-3.5 top-3 h-5 w-5 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={
              isListening
                ? '🔴 Đang lắng nghe tiếng Việt... Hãy nói tên sách (ví dụ: Bệnh tưởng, H01)'
                : 'Tra cứu tức thì: Gõ tên không dấu (vd: truong, benh), 4 số cuối ISBN (7507), mã tắt (bt) hoặc bấm Micro...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            className={`w-full pl-11 pr-28 py-2.5 text-sm border rounded-lg outline-none transition-all font-medium ${
              isListening
                ? 'border-rose-500 ring-2 ring-rose-300 bg-rose-50/20 text-slate-900'
                : 'border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 placeholder-slate-400'
            }`}
            autoFocus
          />

          {/* Voice Search Button */}
          <button
            type="button"
            onClick={toggleListening}
            title={
              isListening
                ? 'Đang lắng nghe tiếng Việt... Bấm để dừng (Alt + Shift + V)'
                : 'Tìm kiếm bằng giọng nói tiếng Việt (Alt + Shift + V)'
            }
            className={`absolute right-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isListening
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 ring-2 ring-rose-400 animate-pulse'
                : 'text-slate-500 hover:text-rose-600 hover:bg-rose-50'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="w-4 h-4 text-white animate-bounce" />
                <span className="font-bold">Đang nghe...</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span className="hidden sm:inline">Nói để tìm</span>
              </>
            )}
          </button>
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              Tìm thấy: <strong className="text-slate-800 font-semibold">{displayedBooks.length}</strong> / {initialBooks.length} đầu sách
              {searchTerm !== debouncedTerm && <span className="ml-1 text-slate-400">(đang lọc…)</span>}
            </span>
            <span className="text-slate-300">|</span>
            <span className="flex items-center gap-1">
              <Warehouse className="h-3.5 w-3.5 text-slate-400" /> {warehouseCount} Kho vật lý (Âu Cơ, Quỳnh Mai, Dự phòng)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">Gõ 4 số</span>
            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">Gõ tên tắt</span>
            <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">Enter để chọn</span>
          </div>
        </div>
        {/* BV-04: Filter tồn kho + Sort */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(
            [
              { v: 'ALL', label: 'Tất cả' },
              { v: 'IN_STOCK', label: 'Còn hàng' },
              { v: 'OUT_OF_STOCK', label: 'Hết hàng' },
            ] as Array<{ v: StockFilter; label: string }>
          ).map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setStockFilter(f.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-bold border transition ${
                stockFilter === f.v
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="text-slate-300 text-xs">|</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none cursor-pointer"
            title="Sắp xếp danh mục"
          >
            <option value="DEFAULT">Mặc định</option>
            <option value="STOCK_DESC">Tồn nhiều → ít</option>
            <option value="STOCK_ASC">Tồn ít → nhiều</option>
            <option value="AZ">A → Z</option>
            <option value="ZA">Z → A</option>
            <option value="TOP">Bán chạy (tồn cao)</option>
          </select>
        </div>
      </div>

      {/* Table Results */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 w-16">Mã</th>
                <th className="px-4 py-3">Tên sách / Tác phẩm</th>
                <th className="px-4 py-3 w-28">Tên tắt</th>
                <th className="px-4 py-3 w-36">ISBN (4 số cuối)</th>
                <th className="px-4 py-3">Tác giả / Dịch giả</th>
                <th className="px-4 py-3 text-right w-28">Giá bìa</th>
                <th className="px-4 py-3 text-center w-28">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedBooks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Không tìm thấy sách phù hợp với từ khóa &ldquo;{debouncedTerm}&rdquo;
                  </td>
                </tr>
              ) : (
                displayedBooks.map((b) => (
                  <tr key={b.code} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-indigo-600">{b.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{b.title}</div>
                      <div className="text-xs text-slate-400">{b.category || b.publisher}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 bg-amber-50 text-amber-700 rounded font-mono text-xs font-semibold">
                        {b.shortCode || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-slate-500">{b.isbn}</div>
                      <div className="font-mono text-xs font-bold text-slate-800">
                        Đuôi: <span className="bg-indigo-50 text-indigo-700 px-1 rounded">{b.isbnLast4}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-slate-700 font-medium">{b.author}</div>
                      {b.translator && <div className="text-slate-400">Dịch: {b.translator}</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800 font-mono">
                      {b.coverPrice.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="px-4 py-3 text-center">
                      {b.status === 'SOLD_OUT' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          <AlertCircle className="w-3 h-3" /> Hết hàng
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Còn hàng
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}