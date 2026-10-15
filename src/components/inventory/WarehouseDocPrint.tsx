'use client';

/**
 * WarehouseDocPrint - Component in chứng từ kho chung
 * Hỗ trợ: Phiếu nhập kho, Phiếu xuất kho, Phiếu chuyển kho, Biên bản kiểm kê
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, Archive } from 'lucide-react';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_HOTLINE, COMPANY_EMAIL } from '@/lib/companyInfo';

export interface DocPrintItem {
  productCode?: string;
  productName: string;
  quantity: number;
  unitPrice?: number;
  amount?: number;
  note?: string;
}

export interface DocPrintData {
  docType: 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'COUNT_MINUTES';
  docNumber: string;
  docDate: string;
  warehouseName?: string;
  toWarehouseName?: string;
  partnerName?: string;
  items: DocPrintItem[];
  totalQuantity: number;
  totalAmount?: number;
  note?: string;
  createdBy?: string;
}

const DOC_TITLES: Record<string, string> = {
  INBOUND: 'PHIẾU NHẬP KHO',
  OUTBOUND: 'PHIẾU XUẤT KHO',
  TRANSFER: 'PHIẾU CHUYỂN KHO',
  COUNT_MINUTES: 'BIÊN BẢN KIỂM KÊ KHO',
};

interface Props {
  data: DocPrintData;
  isOpen: boolean;
  onClose: () => void;
  onArchive?: (html: string) => Promise<void>;
}

export function WarehouseDocPrint({ data, isOpen, onClose, onArchive }: Props) {
  const [archiving, setArchiving] = React.useState(false);

  if (!isOpen) return null;

  const title = DOC_TITLES[data.docType] || 'CHỨNG TỪ KHO';
  const docDate = new Date(data.docDate).toLocaleDateString('vi-VN');

  const handlePrint = () => {
    window.print();
  };

  const handleArchive = async () => {
    if (!onArchive) return;
    setArchiving(true);
    try {
      const el = document.getElementById('warehouse-doc-print-content');
      const html = el ? el.outerHTML : '';
      await onArchive(html);
      alert('Đã lưu trữ chứng từ lên R2');
    } catch (e: any) {
      alert('Lỗi lưu trữ: ' + e.message);
    } finally {
      setArchiving(false);
    }
  };

  const content = (
    <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto print:max-h-none print:rounded-none print:shadow-none">
        {/* Toolbar - ẩn khi in */}
        <div className="flex items-center justify-between p-4 border-b print:hidden">
          <h3 className="font-bold">{title} - {data.docNumber}</h3>
          <div className="flex gap-2">
            {onArchive && (
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 disabled:opacity-50"
              >
                <Archive className="w-4 h-4" /> {archiving ? 'Đang lưu...' : 'Lưu trữ R2'}
              </button>
            )}
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold flex items-center gap-2"
            >
              <Printer className="w-4 h-4" /> In
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nội dung phiếu in */}
        <div id="warehouse-doc-print-content" className="p-8 print:p-6">
          {/* Header công ty */}
          <div className="text-center mb-6">
            <p className="font-bold text-lg">{COMPANY_NAME}</p>
            <p className="text-sm text-slate-600">{COMPANY_ADDRESS}</p>
            <p className="text-sm text-slate-600">ĐT: {COMPANY_HOTLINE} - Email: {COMPANY_EMAIL}</p>
          </div>

          {/* Tiêu đề phiếu */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-sm mt-1">Số: <span className="font-bold">{data.docNumber}</span></p>
            <p className="text-sm">Ngày: {docDate}</p>
          </div>

          {/* Thông tin chung */}
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              {data.warehouseName && (
                <p><span className="font-bold">Kho:</span> {data.warehouseName}</p>
              )}
              {data.toWarehouseName && (
                <p><span className="font-bold">Kho đích:</span> {data.toWarehouseName}</p>
              )}
            </div>
            <div>
              {data.partnerName && (
                <p><span className="font-bold">Đối tác:</span> {data.partnerName}</p>
              )}
              {data.createdBy && (
                <p><span className="font-bold">Người lập:</span> {data.createdBy}</p>
              )}
            </div>
          </div>

          {/* Bảng hàng hóa */}
          <table className="w-full border-collapse border border-slate-300 text-sm mb-6">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-2">STT</th>
                <th className="border border-slate-300 px-2 py-2">Mã hàng</th>
                <th className="border border-slate-300 px-2 py-2">Tên hàng</th>
                <th className="border border-slate-300 px-2 py-2">Số lượng</th>
                {data.totalAmount !== undefined && (
                  <>
                    <th className="border border-slate-300 px-2 py-2">Đơn giá</th>
                    <th className="border border-slate-300 px-2 py-2">Thành tiền</th>
                  </>
                )}
                <th className="border border-slate-300 px-2 py-2">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, idx) => (
                <tr key={idx}>
                  <td className="border border-slate-300 px-2 py-1 text-center">{idx + 1}</td>
                  <td className="border border-slate-300 px-2 py-1">{it.productCode || ''}</td>
                  <td className="border border-slate-300 px-2 py-1">{it.productName}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-bold">{it.quantity}</td>
                  {data.totalAmount !== undefined && (
                    <>
                      <td className="border border-slate-300 px-2 py-1 text-right">{(it.unitPrice || 0).toLocaleString('vi-VN')}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{(it.amount || 0).toLocaleString('vi-VN')}</td>
                    </>
                  )}
                  <td className="border border-slate-300 px-2 py-1">{it.note || ''}</td>
                </tr>
              ))}
              <tr className="font-bold bg-slate-50">
                <td colSpan={3} className="border border-slate-300 px-2 py-1 text-right">Tổng cộng:</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{data.totalQuantity}</td>
                {data.totalAmount !== undefined && (
                  <>
                    <td className="border border-slate-300 px-2 py-1"></td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{data.totalAmount.toLocaleString('vi-VN')}</td>
                  </>
                )}
                <td className="border border-slate-300 px-2 py-1"></td>
              </tr>
            </tbody>
          </table>

          {data.note && (
            <p className="text-sm mb-6"><span className="font-bold">Ghi chú:</span> {data.note}</p>
          )}

          {/* Chữ ký */}
          <div className="grid grid-cols-3 gap-4 text-center text-sm mt-8">
            <div>
              <p className="font-bold">Người lập phiếu</p>
              <p className="text-xs text-slate-500 italic mt-1">(Ký, họ tên)</p>
              <div className="h-16"></div>
            </div>
            <div>
              <p className="font-bold">Thủ kho</p>
              <p className="text-xs text-slate-500 italic mt-1">(Ký, họ tên)</p>
              <div className="h-16"></div>
            </div>
            <div>
              <p className="font-bold">Người duyệt</p>
              <p className="text-xs text-slate-500 italic mt-1">(Ký, họ tên)</p>
              <div className="h-16"></div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #warehouse-doc-print-content, #warehouse-doc-print-content * { visibility: visible; }
          #warehouse-doc-print-content { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
}
