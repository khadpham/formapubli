'use client';

/**
 * WarehouseDocList - Danh sách chứng từ kho
 * Hiển thị trong tab Kho hàng
 */

import React, { useState, useEffect } from 'react';
import { FileText, Printer, Archive, RefreshCw, XCircle } from 'lucide-react';
import Modal from '../ui/Modal';
import { WarehouseDocPrint, DocPrintData } from './WarehouseDocPrint';

interface DocItem {
  id: string;
  docType: string;
  docTypeName?: string;
  docNumber: string;
  docDate: string;
  warehouseId?: string;
  toWarehouseId?: string;
  partnerName?: string;
  totalQuantity: number;
  totalAmount: number;
  status: string;
  r2Url?: string;
  createdAt?: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Nháp', color: 'bg-slate-100 text-slate-600' },
  ISSUED: { label: 'Đã phát hành', color: 'bg-emerald-100 text-emerald-700' },
  VOIDED: { label: 'Đã hủy', color: 'bg-rose-100 text-rose-700' },
};

const TYPE_FILTER = [
  { value: '', label: 'Tất cả' },
  { value: 'INBOUND', label: 'Nhập kho' },
  { value: 'OUTBOUND', label: 'Xuất kho' },
  { value: 'TRANSFER', label: 'Chuyển kho' },
  { value: 'COUNT_MINUTES', label: 'Biên bản KK' },
];

export function WarehouseDocList({ refreshKey }: { refreshKey?: number }) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [printDoc, setPrintDoc] = useState<DocPrintData | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/warehouse-documents?docType=${filter}&limit=100`);
      const data = await res.json();
      if (data.ok) setDocs(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter, refreshKey]);

  const handlePrint = async (doc: DocItem) => {
    try {
      // Lấy chi tiết chứng từ
      const res = await fetch(`/api/warehouse-documents/${doc.id}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const d = data.data;
      setPrintDoc({
        docType: d.docType,
        docNumber: d.docNumber,
        docDate: d.docDate,
        warehouseName: d.warehouseId,
        toWarehouseName: d.toWarehouseId,
        partnerName: d.partnerName,
        items: (d.items || []).map((it: any) => ({
          productCode: it.productCode,
          productName: it.productName,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
          note: it.note,
        })),
        totalQuantity: d.totalQuantity,
        totalAmount: d.totalAmount,
        note: d.note,
        createdBy: d.createdBy,
      });
      setPrintOpen(true);
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
  };

  const handleArchive = async (docId: string, html: string) => {
    const res = await fetch(`/api/warehouse-documents/${docId}/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await load();
  };

  const handleVoid = async (doc: DocItem) => {
    const reason = prompt(`Hủy chứng từ ${doc.docNumber}? Nhập lý do:`);
    if (!reason) return;
    try {
      const res = await fetch(`/api/warehouse-documents/${doc.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await load();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" /> Chứng từ kho
        </h3>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="px-3 py-1.5 border rounded-lg text-sm"
          >
            {TYPE_FILTER.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 border rounded-lg text-sm flex items-center gap-1"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>
      </div>

      {docs.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          {loading ? 'Đang tải...' : 'Chưa có chứng từ nào'}
        </p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Số chứng từ</th>
                <th className="px-3 py-2 text-left">Loại</th>
                <th className="px-3 py-2 text-left">Ngày</th>
                <th className="px-3 py-2 text-left">Đối tác</th>
                <th className="px-3 py-2 text-right">SL</th>
                <th className="px-3 py-2 text-left">Trạng thái</th>
                <th className="px-3 py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map(d => {
                const st = STATUS_LABEL[d.status] || STATUS_LABEL.DRAFT;
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-bold">{d.docNumber}</td>
                    <td className="px-3 py-2">{d.docTypeName || d.docType}</td>
                    <td className="px-3 py-2">{new Date(d.docDate).toLocaleDateString('vi-VN')}</td>
                    <td className="px-3 py-2">{d.partnerName || '-'}</td>
                    <td className="px-3 py-2 text-right">{d.totalQuantity}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handlePrint(d)}
                          title="In / Xem"
                          className="p-1.5 hover:bg-slate-200 rounded"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        {d.status === 'DRAFT' && (
                          <button
                            onClick={() => handleVoid(d)}
                            title="Hủy"
                            className="p-1.5 hover:bg-rose-100 rounded text-rose-600"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        {d.r2Url && (
                          <a
                            href={d.r2Url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Mở bản lưu trữ"
                            className="p-1.5 hover:bg-blue-100 rounded text-blue-600"
                          >
                            <Archive className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {printDoc && (
        <WarehouseDocPrint
          data={printDoc}
          isOpen={printOpen}
          onClose={() => { setPrintOpen(false); setPrintDoc(null); }}
        />
      )}
    </div>
  );
}
