'use client';

import React, { useState, useEffect } from 'react';
import { Printer, CheckSquare, Square, PackageSearch, Layers, Sparkles } from 'lucide-react';
import Modal from '../ui/Modal';

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

  return (
    <Modal
      open={isOpen}
      onClose={() => { if (!loading) onClose(); }}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <PackageSearch className="w-4 h-4" />
          </span>
          Danh Sách Soạn Sách Kệ Kho
        </span>
      }
      subtitle="Gom nhóm sách theo thứ tự vị trí kệ để tối ưu đường đi soạn hàng"
      actions={
        pickList ? (
          <>
            <div className="text-xs font-black uppercase text-slate-400">Tổng hợp</div>
            <div className="text-xs text-slate-600 font-medium">
              Tổng cộng: <strong className="text-slate-900">{pickList.totalSkus}</strong> đầu sách (
              <strong className="text-indigo-600">{pickList.totalItemsToPick}</strong> cuốn)
            </div>
            <button
              onClick={handlePrint}
              className="w-full px-3 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" /> In Phiếu Soạn
            </button>
          </>
        ) : undefined
      }
    >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
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

        {/* Content Body */}
        <div className="space-y-6">
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
    </Modal>
  );
}
