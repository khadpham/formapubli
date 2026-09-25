'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, CheckSquare, Square, PackageSearch, Layers, Sparkles } from 'lucide-react';

interface PickListModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: Array<{
    id: string;
    code: string;
    title: string;
    author: string;
    stockDuPhong: number;
    stockAuCo: number;
    stockQuynhMai: number;
  }>;
  warehouses: Array<{ id: string; name: string; code: string }>;
}

export function PickListModal({ isOpen, onClose, books, warehouses }: PickListModalProps) {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(warehouses[0]?.id || 'wh-du-phong');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [pickList, setPickList] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen || !mounted) return null;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      // Mặc định lấy tất cả các sách có tồn kho ở kho đã chọn với số lượng mặc định 10 cuốn
      const requests = books.slice(0, 30).map((b) => ({
        editionId: b.id,
        quantityNeeded: 10,
      }));

      const res = await fetch(
        `/api/allocations?warehouseId=${selectedWarehouseId}&mode=picklist&items=${encodeURIComponent(
          JSON.stringify(requests)
        )}`
      );
      const json = await res.json();
      if (json.success) {
        setPickList(json.data);
      }
    } catch (err) {
      console.error('Lỗi khi sinh picklist:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (id: string) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handlePrint = () => {
    window.print();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 overflow-y-auto"
      onClick={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}
    >
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <PackageSearch className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Danh Sách Soạn Sách Kệ Kho</h3>
              <p className="text-xs text-slate-500">
                Gom nhóm sách theo thứ tự vị trí kệ để tối ưu đường đi soạn hàng
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-4 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-slate-700">Kho Soạn:</label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => {
                setSelectedWarehouseId(e.target.value);
                setPickList(null);
              }}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 font-medium outline-none"
            >
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                </option>
              ))}
            </select>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {loading ? 'Đang tạo...' : 'Tạo Pick List Tự Động'}
            </button>
          </div>

          {pickList && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 font-medium">
                Tổng cộng: <strong className="text-slate-900">{pickList.totalSkus}</strong> đầu sách (
                <strong className="text-indigo-600">{pickList.totalItemsToPick}</strong> cuốn)
              </span>
              <button
                onClick={handlePrint}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" /> In Phiếu Soạn
              </button>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-6">
          {!pickList ? (
            <div className="text-center py-12 text-slate-400">
              <Layers className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-[1.5]" />
              <p className="text-sm font-medium">Chọn kho và bấm &quot;Tạo Pick List Tự Động&quot; để sinh bảng soạn sách theo kệ</p>
            </div>
          ) : (
            pickList.groups.map((grp: any, idx: number) => (
              <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-mono text-xs font-bold">
                      📍 {grp.shelfLocation}
                    </span>
                    <span className="text-xs text-slate-500">
                      ({grp.items.length} đầu sách)
                    </span>
                  </div>
                  <span className="text-xs font-bold text-slate-700">
                    Cần soạn: <span className="text-indigo-600">{grp.totalQuantity}</span> cuốn
                  </span>
                </div>

                <div className="divide-y divide-slate-100">
                  {grp.items.map((item: any) => {
                    const isDone = !!checkedItems[item.editionId];
                    return (
                      <div
                        key={item.editionId}
                        onClick={() => toggleCheck(item.editionId)}
                        className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                          isDone ? 'bg-emerald-50/50 text-slate-400 line-through' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {isDone ? (
                            <CheckSquare className="w-5 h-5 text-emerald-600 shrink-0" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-300 shrink-0" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-900">{item.editionCode}</span>
                              <span className="text-xs font-medium text-slate-800">{item.title}</span>
                            </div>
                            <span className="text-[11px] text-slate-400">{item.author}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                            Lấy: {item.quantityNeeded} cuốn
                          </span>
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            Tồn kho: {item.currentStock}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
