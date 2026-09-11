'use client';

import React, { useState, useMemo } from 'react';
import { Search, BookOpen, Warehouse, CheckCircle2, AlertCircle } from 'lucide-react';

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
}

interface CatalogTableProps {
  initialBooks: BookItem[];
  warehouseCount: number;
  partnerCount: number;
}

export function CatalogTable({ initialBooks, warehouseCount, partnerCount }: CatalogTableProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredBooks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return initialBooks;

    return initialBooks.filter((book) => {
      const codeMatch = book.code.toLowerCase().includes(query);
      const titleMatch = book.title.toLowerCase().includes(query);
      const isbnMatch = book.isbn.includes(query);
      const isbnLast4Match = book.isbnLast4.includes(query);
      const shortCodeMatch = book.shortCode?.toLowerCase().includes(query);
      const authorMatch = book.author.toLowerCase().includes(query);
      const translatorMatch = book.translator?.toLowerCase().includes(query);

      return (
        codeMatch ||
        titleMatch ||
        isbnMatch ||
        isbnLast4Match ||
        shortCodeMatch ||
        authorMatch ||
        translatorMatch
      );
    });
  }, [searchTerm, initialBooks]);

  return (
    <div className="space-y-6">
      {/* Search Input Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-3 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder="Tra cứu tức thì: Gõ 4 số cuối ISBN (vd: 7507), tên tắt (vd: bt, nbl), mã sách (H01) hoặc tên sách..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-medium text-slate-800 placeholder-slate-400"
            autoFocus
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              Tìm thấy: <strong className="text-slate-800 font-semibold">{filteredBooks.length}</strong> / {initialBooks.length} đầu sách
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
              {filteredBooks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Không tìm thấy sách phù hợp với từ khóa &ldquo;{searchTerm}&rdquo;
                  </td>
                </tr>
              ) : (
                filteredBooks.map((b) => (
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