'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, ShieldCheck, AlertTriangle } from 'lucide-react';
import { BrowserQRCodeSvgWriter } from '@zxing/library';

export interface DeliveryOrderItemDetail {
  id: string;
  editionId: string;
  editionCode?: string;
  isbn?: string;
  title: string;
  author?: string;
  quantity: number;
  unitCoverPrice: number;
  unitSellingPrice: number;
  totalAmount: number;
}

export interface DeliveryOrderData {
  id: string;
  code: string;
  partnerId: string;
  partnerName?: string;
  partnerCode?: string;
  fromWarehouseId: string;
  warehouseName?: string;
  subtotal: number;
  discountRate: number;
  finalAmount: number;
  fiscalScope: string;
  status: 'DRAFT' | 'DISPATCHED_LOCKED' | 'VOIDED_REVERSED';
  reversalOf?: string | null;
  note?: string | null;
  createdBy: string;
  dispatchedBy?: string | null;
  dispatchedAt?: string | null;
  createdAt?: string;
  items: DeliveryOrderItemDetail[];
}

interface DeliveryReceiptPrintProps {
  order: DeliveryOrderData;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Chuyển số nguyên thành chữ tiếng Việt chuẩn kế toán
 */
function numberToVietnameseWords(n: number): string {
  if (n === 0) return 'Không đồng';
  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

  function readGroup(num: number): string {
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const u = num % 10;
    let res = '';

    if (h > 0 || t > 0 || u > 0) {
      res += digits[h] + ' trăm ';
      if (t === 0 && u > 0) res += 'lẻ ';
      if (t === 1) res += 'mười ';
      if (t > 1) res += digits[t] + ' mươi ';
      if (t > 0 && u === 1 && t !== 1) res += 'mốt ';
      else if (t > 0 && u === 5) res += 'lăm ';
      else if (u > 0) res += digits[u] + ' ';
    }
    return res.trim();
  }

  let temp = Math.abs(Math.round(n));
  let str = '';
  let groupIdx = 0;

  while (temp > 0) {
    const group = temp % 1000;
    if (group > 0) {
      const groupText = readGroup(group);
      str = groupText + ' ' + units[groupIdx] + ' ' + str;
    }
    temp = Math.floor(temp / 1000);
    groupIdx++;
  }

  str = str.trim() + ' đồng chẵn';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function DeliveryReceiptPrint({ order, isOpen, onClose }: DeliveryReceiptPrintProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  const isReversal = order.code.startsWith('PXK_R') || !!order.reversalOf;
  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const discountAmount = Math.max(0, order.subtotal - order.finalAmount);
  const createdDate = order.dispatchedAt ? new Date(order.dispatchedAt) : new Date(order.createdAt || Date.now());

  useEffect(() => {
    if (!isOpen || !qrRef.current) return;
    try {
      qrRef.current.innerHTML = '';
      const writer = new BrowserQRCodeSvgWriter();
      const qrSvg = writer.write(
        `FORMAPUBLI:PXK:${order.code}:${order.finalAmount}:${order.partnerCode || ''}`,
        90,
        90
      );
      qrRef.current.appendChild(qrSvg);
    } catch (e) {
      console.error('Không thể vẽ QR cho phiếu xuất kho:', e);
    }
  }, [isOpen, order.code, order.finalAmount, order.partnerCode]);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const handlePrint = () => {
    window.print();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Styles dành riêng cho khổ in A4 */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-delivery-receipt,
          #printable-delivery-receipt * {
            visibility: visible;
          }
          #printable-delivery-receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 15mm;
            background: white !important;
            color: black !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
        }
      `}</style>

      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden border border-slate-200 my-auto flex flex-col max-h-[92vh]">
        {/* Thanh công cụ Modal (Ẩn khi in) */}
        <div className="no-print bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">📄</span>
            <div>
              <h3 className="font-bold text-sm">
                Phiếu Xuất Kho A4: <span className="font-mono text-amber-400">{order.code}</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Trạng thái:{' '}
                {order.status === 'DISPATCHED_LOCKED' ? (
                  <span className="text-emerald-400 font-bold">ĐÃ XUẤT KHO & KHÓA SỔ</span>
                ) : order.status === 'VOIDED_REVERSED' ? (
                  <span className="text-rose-400 font-bold">ĐÃ ĐẢO BÚT TOÁN HỦY</span>
                ) : (
                  <span className="text-amber-400 font-bold">BẢN NHÁP</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition"
            >
              <Printer className="w-4 h-4" />
              In Phiếu (A4)
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nội dung Phiếu xuất kho chuẩn A4 */}
        <div className="overflow-y-auto p-8 bg-slate-100 flex-1 flex justify-center">
          <div
            id="printable-delivery-receipt"
            className="bg-white p-10 text-slate-900 shadow-lg border border-slate-300 w-full max-w-[210mm] text-[13px] leading-relaxed font-serif"
          >
            {/* Header doanh nghiệp & Mẫu chứng từ */}
            <div className="flex justify-between items-start border-b border-slate-300 pb-4 mb-4">
              <div>
                <h4 className="font-sans font-black text-sm tracking-wider uppercase text-slate-900">
                  CÔNG TY TNHH XUẤT BẢN FORMA
                </h4>
                <p className="font-sans text-[11px] text-slate-600">
                  Địa chỉ: 177 Phố Huế, P. Phố Huế, Q. Hai Bà Trưng, Hà Nội
                </p>
                <p className="font-sans text-[11px] text-slate-600">
                  Hotline: 0988.xxx.xxx | Email: contact@formapubli.vn
                </p>
                <p className="font-sans text-[11px] text-slate-600">
                  Kho xuất:{' '}
                  <strong className="text-slate-900">{order.warehouseName || order.fromWarehouseId}</strong>
                </p>
              </div>

              <div className="flex items-start gap-4">
                <div className="text-right font-sans text-[11px] text-slate-600">
                  <p className="font-bold text-slate-800">Mẫu số: 02 - VT</p>
                  <p>(Ban hành theo TT số 200/2014/TT-BTC</p>
                  <p>ngày 22/12/2014 của Bộ Tài chính)</p>
                </div>
                {/* QR Code tra cứu */}
                <div ref={qrRef} className="shrink-0 p-1 border border-slate-200 bg-white" />
              </div>
            </div>

            {/* Tiêu đề Phiếu */}
            <div className="text-center my-6">
              <h1 className="font-sans font-black text-2xl tracking-wide uppercase text-slate-900">
                {isReversal ? 'PHIẾU XUẤT KHO (ĐẢO BÚT TOÁN)' : 'PHIẾU XUẤT KHO CUNG ỨNG ĐỐI TÁC'}
              </h1>
              <p className="font-sans italic text-xs text-slate-600 mt-1">
                Ngày {createdDate.getDate()} tháng {createdDate.getMonth() + 1} năm {createdDate.getFullYear()}
              </p>
              <p className="font-sans font-mono font-bold text-sm text-slate-800 mt-0.5">
                Số: <span className="underline">{order.code}</span>
                {order.reversalOf && (
                  <span className="text-rose-600 ml-2 font-normal">
                    (Đảo bút toán cho phiếu: {order.reversalOf})
                  </span>
                )}
              </p>
            </div>

            {/* Thông tin đối tác & lý do xuất */}
            <div className="font-sans space-y-1.5 text-xs mb-6">
              <div className="flex">
                <span className="w-48 text-slate-600">- Họ và tên người nhận hàng:</span>
                <strong className="text-slate-900 uppercase">
                  {order.partnerName || 'Đối tác nhận hàng'} ({order.partnerCode || order.partnerId})
                </strong>
              </div>
              <div className="flex">
                <span className="w-48 text-slate-600">- Lý do xuất kho:</span>
                <span className="text-slate-800">
                  {order.fiscalScope === 'CONSIGNMENT_DISPATCH'
                    ? 'Xuất kho ký gửi đại lý theo hợp đồng liên kết phát hành'
                    : 'Xuất kho cung ứng đối tác (nhà sách / thư viện / trường học / đại lý)'}
                  {order.note ? ` (${order.note})` : ''}
                </span>
              </div>
              <div className="flex">
                <span className="w-48 text-slate-600">- Xuất tại kho:</span>
                <span className="text-slate-800">{order.warehouseName || order.fromWarehouseId}</span>
              </div>
            </div>

            {/* Bảng chi tiết ấn bản xuất kho */}
            <table className="w-full border-collapse border border-slate-900 text-xs mb-4">
              <thead>
                <tr className="bg-slate-100 font-sans font-bold text-center">
                  <th className="border border-slate-900 p-2 w-10">STT</th>
                  <th className="border border-slate-900 p-2 w-20">Mã SKU</th>
                  <th className="border border-slate-900 p-2 text-left">Tên tác phẩm / Ấn phẩm</th>
                  <th className="border border-slate-900 p-2 w-14">ĐVT</th>
                  <th className="border border-slate-900 p-2 w-16">Số lượng</th>
                  <th className="border border-slate-900 p-2 w-24 text-right">Đơn giá bìa</th>
                  <th className="border border-slate-900 p-2 w-16">CK (%)</th>
                  <th className="border border-slate-900 p-2 w-24 text-right">Giá bán</th>
                  <th className="border border-slate-900 p-2 w-28 text-right">Thành tiền (đ)</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-slate-50">
                    <td className="border border-slate-900 p-2 text-center font-mono">{idx + 1}</td>
                    <td className="border border-slate-900 p-2 text-center font-mono font-bold">
                      {item.editionCode || 'SKU'}
                    </td>
                    <td className="border border-slate-900 p-2 font-medium">
                      {item.title}
                      {item.isbn && (
                        <span className="font-sans text-[10px] text-slate-500 block font-mono">
                          ISBN: {item.isbn}
                        </span>
                      )}
                    </td>
                    <td className="border border-slate-900 p-2 text-center">Cuốn</td>
                    <td className="border border-slate-900 p-2 text-center font-mono font-bold">
                      {item.quantity.toLocaleString('vi-VN')}
                    </td>
                    <td className="border border-slate-900 p-2 text-right font-mono">
                      {item.unitCoverPrice.toLocaleString('vi-VN')}
                    </td>
                    <td className="border border-slate-900 p-2 text-center font-mono">
                      {Math.round(order.discountRate * 100)}%
                    </td>
                    <td className="border border-slate-900 p-2 text-right font-mono">
                      {item.unitSellingPrice.toLocaleString('vi-VN')}
                    </td>
                    <td className="border border-slate-900 p-2 text-right font-mono font-bold">
                      {item.totalAmount.toLocaleString('vi-VN')}
                    </td>
                  </tr>
                ))}

                {/* Dòng tổng cộng */}
                <tr className="font-bold bg-slate-50 font-sans">
                  <td colSpan={4} className="border border-slate-900 p-2 text-center uppercase">
                    Cộng tiền hàng (Tổng số lượng: {totalQuantity.toLocaleString('vi-VN')} cuốn)
                  </td>
                  <td className="border border-slate-900 p-2 text-center font-mono font-bold">
                    {totalQuantity.toLocaleString('vi-VN')}
                  </td>
                  <td colSpan={3} className="border border-slate-900 p-2 text-right text-slate-600">
                    Tiền bìa: {order.subtotal.toLocaleString('vi-VN')} đ
                  </td>
                  <td className="border border-slate-900 p-2 text-right font-mono text-sm">
                    {order.subtotal.toLocaleString('vi-VN')}
                  </td>
                </tr>

                {discountAmount > 0 && (
                  <tr className="font-sans">
                    <td colSpan={8} className="border border-slate-900 p-2 text-right italic">
                      Chiết khấu thương mại đại lý ({Math.round(order.discountRate * 100)}%):
                    </td>
                    <td className="border border-slate-900 p-2 text-right font-mono text-rose-600 font-bold">
                      -{discountAmount.toLocaleString('vi-VN')}
                    </td>
                  </tr>
                )}

                <tr className="font-bold bg-slate-100 font-sans text-sm">
                  <td colSpan={8} className="border border-slate-900 p-2.5 text-right uppercase text-slate-900">
                    TỔNG CỘNG TIỀN THANH TOÁN (VNĐ):
                  </td>
                  <td className="border border-slate-900 p-2.5 text-right font-mono text-base font-black text-slate-900">
                    {order.finalAmount.toLocaleString('vi-VN')}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Số tiền bằng chữ */}
            <div className="font-sans text-xs italic mb-8">
              - Số tiền viết bằng chữ: <strong className="text-slate-900 font-bold not-italic">{numberToVietnameseWords(order.finalAmount)}</strong>.
            </div>

            {/* 4 Chữ ký */}
            <div className="font-sans grid grid-cols-4 gap-2 text-center text-xs mt-6 pt-4">
              <div>
                <p className="font-bold text-slate-900 uppercase">Người lập phiếu</p>
                <p className="italic text-[11px] text-slate-500">(Ký, họ tên)</p>
                <div className="h-20" />
                <p className="font-bold text-slate-800">{order.createdBy || 'Người lập'}</p>
              </div>

              <div>
                <p className="font-bold text-slate-900 uppercase">Người giao hàng</p>
                <p className="italic text-[11px] text-slate-500">(Ký, họ tên)</p>
                <div className="h-20" />
                <p className="font-bold text-slate-800">........................</p>
              </div>

              <div>
                <p className="font-bold text-slate-900 uppercase">Thủ kho xuất</p>
                <p className="italic text-[11px] text-slate-500">(Ký, họ tên)</p>
                <div className="h-20" />
                <p className="font-bold text-slate-800">{order.dispatchedBy || 'Thủ kho'}</p>
              </div>

              <div>
                <p className="font-bold text-slate-900 uppercase">Đại lý nhận hàng</p>
                <p className="italic text-[11px] text-slate-500">(Ký, đóng dấu, họ tên)</p>
                <div className="h-20" />
                <p className="font-bold text-slate-800">{order.partnerName || 'Đại diện đại lý'}</p>
              </div>
            </div>

            {/* Chú thích pháp lý cuối trang */}
            <div className="mt-8 pt-4 border-t border-dashed border-slate-300 text-center font-sans text-[10px] text-slate-400">
              Chứng từ bất biến được tạo tự động bởi Formapubli OS | Bản quyền lưu hành nội bộ và giao dịch thương mại.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
