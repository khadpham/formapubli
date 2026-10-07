'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { BrowserQRCodeSvgWriter } from '@zxing/library';
import { COMPANY_HOTLINE } from '@/lib/companyInfo';

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
  partnerAddress?: string | null;
  partnerPhone?: string | null;
  partnerReceiverName?: string | null;
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

interface CompanyProfileState {
  tenCongTy?: string;
  diaChi?: string;
  sdt?: string;
  email?: string;
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

/**
 * Thân nội dung Phiếu xuất kho chuẩn A4
 * Dùng chung cho cả màn hình Xem trước (Preview) và Khối in thật (window.print)
 */
function ReceiptContent({
  order,
  companyProfile,
  qrSvgXml,
}: {
  order: DeliveryOrderData;
  companyProfile: CompanyProfileState;
  qrSvgXml: string;
}) {
  const isReversal = order.code.startsWith('PXK_R') || !!order.reversalOf;
  const isConsignment = order.fiscalScope === 'CONSIGNMENT_DISPATCH';
  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const discountAmount = Math.max(0, order.subtotal - order.finalAmount);
  const createdDate = order.dispatchedAt ? new Date(order.dispatchedAt) : new Date(order.createdAt || Date.now());

  return (
    <div className="font-sans text-slate-900 text-[12px] leading-relaxed">
      {/* Header doanh nghiệp & Mẫu chứng từ */}
      <div className="flex justify-between items-start border-b border-slate-300 pb-4 mb-4">
        <div className="space-y-0.5">
          <h4 className="font-black text-sm tracking-wider uppercase text-slate-900">
            {companyProfile.tenCongTy || 'FORMApubli'}
          </h4>
          <p className="text-[11px] text-slate-600">
            Địa chỉ: {companyProfile.diaChi || '177 Phố Huế, P. Phố Huế, Q. Hai Bà Trưng, Hà Nội'}
          </p>
          <p className="text-[11px] text-slate-600">
            Hotline: {companyProfile.sdt || COMPANY_HOTLINE} | Email: {companyProfile.email || 'contact@formapubli.vn'}
          </p>
          <p className="text-[11px] text-slate-600">
            Kho xuất:{' '}
            <strong className="text-slate-900">{order.warehouseName || order.fromWarehouseId}</strong>
          </p>
        </div>

        <div className="flex items-start gap-3">
          <div className="text-right text-[11px] text-slate-600">
            <p className="font-bold text-slate-800">Mẫu số: 02 - VT</p>
            <p>(Ban hành theo TT số 200/2014/TT-BTC</p>
            <p>ngày 22/12/2014 của Bộ Tài chính)</p>
          </div>
          {/* QR Code tra cứu */}
          {qrSvgXml ? (
            <div
              className="shrink-0 p-1 border border-slate-200 bg-white"
              dangerouslySetInnerHTML={{ __html: qrSvgXml }}
            />
          ) : (
            <div className="w-[90px] h-[90px] border border-slate-200 bg-slate-50" />
          )}
        </div>
      </div>

      {/* Tiêu đề Phiếu */}
      <div className="text-center my-5">
        <h1 className="font-black text-2xl tracking-wide uppercase text-slate-900">
          {isReversal
            ? 'PHIẾU XUẤT KHO (ĐẢO BÚT TOÁN)'
            : isConsignment
              ? 'PHIẾU XUẤT KHO KÝ GỬI ĐẠI LÝ'
              : 'PHIẾU XUẤT KHO CUNG ỨNG ĐỐI TÁC'}
        </h1>
        <p className="italic text-xs text-slate-600 mt-1">
          Ngày {createdDate.getDate()} tháng {createdDate.getMonth() + 1} năm {createdDate.getFullYear()}
        </p>
        <p className="font-mono font-bold text-sm text-slate-800 mt-0.5">
          Số: <span className="underline">{order.code}</span>
          {order.reversalOf && (
            <span className="text-rose-600 ml-2 font-normal font-sans">
              (Đảo bút toán cho phiếu: {order.reversalOf})
            </span>
          )}
        </p>
      </div>

      {/* Thông tin đối tác & lý do xuất */}
      <div className="space-y-1.5 text-xs mb-5">
        <div className="flex">
          <span className="w-48 text-slate-600 shrink-0">- Họ và tên người nhận hàng:</span>
          <strong className="text-slate-900 uppercase">
            {order.partnerReceiverName || order.partnerName || 'Đối tác nhận hàng'} (
            {order.partnerCode || order.partnerId})
          </strong>
        </div>
        {(order.partnerAddress || order.partnerPhone) && (
          <div className="flex">
            <span className="w-48 text-slate-600 shrink-0">- Địa chỉ giao hàng:</span>
            <span className="text-slate-800">
              {[order.partnerAddress, order.partnerPhone && `SĐT: ${order.partnerPhone}`]
                .filter(Boolean)
                .join(' — ')}
            </span>
          </div>
        )}
        <div className="flex">
          <span className="w-48 text-slate-600 shrink-0">- Lý do xuất kho:</span>
          <span className="text-slate-800">
            {order.fiscalScope === 'CONSIGNMENT_DISPATCH'
              ? 'Xuất kho ký gửi đại lý theo hợp đồng liên kết phát hành'
              : 'Xuất kho cung ứng đối tác (nhà sách / thư viện / trường học / đại lý)'}
            {order.note ? ` (${order.note})` : ''}
          </span>
        </div>
        <div className="flex">
          <span className="w-48 text-slate-600 shrink-0">- Xuất tại kho:</span>
          <span className="text-slate-800">{order.warehouseName || order.fromWarehouseId}</span>
        </div>
      </div>

      {/* Bảng chi tiết ấn bản xuất kho (chống tràn với table-fixed và width %) */}
      <div className="w-full overflow-x-auto print:overflow-visible">
        <table className="w-full table-fixed border-collapse border border-slate-900 text-xs mb-4">
          <thead>
            <tr className="bg-slate-100 font-bold text-center">
              {isConsignment ? (
                <>
                  <th className="border border-slate-900 p-1.5 w-[6%]">STT</th>
                  <th className="border border-slate-900 p-1.5 w-[14%]">Mã SKU</th>
                  <th className="border border-slate-900 p-1.5 w-[44%] text-left">Tên tác phẩm / Ấn phẩm</th>
                  <th className="border border-slate-900 p-1.5 w-[8%]">ĐVT</th>
                  <th className="border border-slate-900 p-1.5 w-[12%]">Số lượng</th>
                  <th className="border border-slate-900 p-1.5 w-[16%] text-right">Đơn giá bìa</th>
                </>
              ) : (
                <>
                  <th className="border border-slate-900 p-1.5 w-[5%]">STT</th>
                  <th className="border border-slate-900 p-1.5 w-[11%]">Mã SKU</th>
                  <th className="border border-slate-900 p-1.5 w-[28%] text-left">Tên tác phẩm / Ấn phẩm</th>
                  <th className="border border-slate-900 p-1.5 w-[6%]">ĐVT</th>
                  <th className="border border-slate-900 p-1.5 w-[7%]">Số lượng</th>
                  <th className="border border-slate-900 p-1.5 w-[11%] text-right">Đơn giá bìa</th>
                  <th className="border border-slate-900 p-1.5 w-[8%]">CK (%)</th>
                  <th className="border border-slate-900 p-1.5 w-[11%] text-right">Giá bán</th>
                  <th className="border border-slate-900 p-1.5 w-[13%] text-right">Thành tiền (đ)</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, idx) => (
              <tr key={item.id || idx} className="hover:bg-slate-50">
                <td className="border border-slate-900 p-1.5 text-center font-mono">{idx + 1}</td>
                <td className="border border-slate-900 p-1.5 text-center font-mono font-bold break-all">
                  {item.editionCode || 'SKU'}
                </td>
                <td className="border border-slate-900 p-1.5 font-medium break-words">
                  {item.title}
                  {item.isbn && (
                    <span className="text-[10px] text-slate-500 block font-mono">
                      ISBN: {item.isbn}
                    </span>
                  )}
                </td>
                <td className="border border-slate-900 p-1.5 text-center">Cuốn</td>
                <td className="border border-slate-900 p-1.5 text-center font-mono font-bold">
                  {item.quantity.toLocaleString('vi-VN')}
                </td>
                <td className="border border-slate-900 p-1.5 text-right font-mono">
                  {item.unitCoverPrice.toLocaleString('vi-VN')}
                </td>
                {!isConsignment && (
                  <>
                    <td className="border border-slate-900 p-1.5 text-center font-mono">
                      {Math.round(order.discountRate * 100)}%
                    </td>
                    <td className="border border-slate-900 p-1.5 text-right font-mono">
                      {item.unitSellingPrice.toLocaleString('vi-VN')}
                    </td>
                    <td className="border border-slate-900 p-1.5 text-right font-mono font-bold">
                      {item.totalAmount.toLocaleString('vi-VN')}
                    </td>
                  </>
                )}
              </tr>
            ))}

            {/* Dòng tổng cộng */}
            {isConsignment ? (
              <tr className="font-bold bg-slate-50">
                <td colSpan={6} className="border border-slate-900 p-2 text-center uppercase">
                  Cộng số lượng ký gửi: {totalQuantity.toLocaleString('vi-VN')} cuốn
                  (giá bìa tham khảo — hàng chưa bán, chưa thu tiền)
                </td>
              </tr>
            ) : (
              <>
                <tr className="font-bold bg-slate-50">
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
                  <tr>
                    <td colSpan={8} className="border border-slate-900 p-2 text-right italic">
                      Chiết khấu thương mại đại lý ({Math.round(order.discountRate * 100)}%):
                    </td>
                    <td className="border border-slate-900 p-2 text-right font-mono text-rose-600 font-bold">
                      -{discountAmount.toLocaleString('vi-VN')}
                    </td>
                  </tr>
                )}

                <tr className="font-bold bg-slate-100 text-sm">
                  <td colSpan={8} className="border border-slate-900 p-2 text-right uppercase text-slate-900">
                    TỔNG CỘNG TIỀN THANH TOÁN (VNĐ):
                  </td>
                  <td className="border border-slate-900 p-2 text-right font-mono text-base font-black text-slate-900">
                    {order.finalAmount.toLocaleString('vi-VN')}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Số tiền bằng chữ */}
      {!isConsignment && (
        <div className="text-xs italic mb-6">
          - Số tiền viết bằng chữ:{' '}
          <strong className="text-slate-900 font-bold not-italic">
            {numberToVietnameseWords(order.finalAmount)}
          </strong>
          .
        </div>
      )}

      {/* 4 Chữ ký trách nhiệm - Bỏ in sẵn tên đại lý để đối tác tự ký và ghi họ tên */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs mt-6 pt-4 print-avoid-break">
        <div>
          <p className="font-bold text-slate-900 uppercase">Người lập phiếu</p>
          <p className="italic text-[11px] text-slate-500">(Ký, họ tên)</p>
          <div className="h-16" />
          <p className="font-bold text-slate-800">{order.createdBy || 'Người lập'}</p>
        </div>

        <div>
          <p className="font-bold text-slate-900 uppercase">Người giao hàng</p>
          <p className="italic text-[11px] text-slate-500">(Ký, họ tên)</p>
          <div className="h-16" />
          <p className="font-bold text-slate-800">........................</p>
        </div>

        <div>
          <p className="font-bold text-slate-900 uppercase">Thủ kho xuất</p>
          <p className="italic text-[11px] text-slate-500">(Ký, họ tên)</p>
          <div className="h-16" />
          <p className="font-bold text-slate-800">{order.dispatchedBy || 'Thủ kho'}</p>
        </div>

        <div>
          <p className="font-bold text-slate-900 uppercase">Đại lý nhận hàng</p>
          <p className="italic text-[11px] text-slate-500">(Ký, đóng dấu, họ tên)</p>
          <div className="h-16" />
          <p className="font-bold text-slate-800">........................</p>
        </div>
      </div>

      {/* Chú thích pháp lý cuối trang */}
      <div className="mt-8 pt-4 border-t border-dashed border-slate-300 text-center text-[10px] text-slate-400 print-avoid-break">
        Chứng từ được tạo tự động bởi {companyProfile.tenCongTy || 'FORMApubli'} | Bản quyền lưu hành nội bộ và giao dịch thương mại.
      </div>
    </div>
  );
}

export function DeliveryReceiptPrint({ order, isOpen, onClose }: DeliveryReceiptPrintProps) {
  const [mounted, setMounted] = useState(false);
  const [qrSvgXml, setQrSvgXml] = useState<string>('');
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileState>({
    tenCongTy: 'FORMApubli',
    diaChi: '177 Phố Huế, P. Phố Huế, Q. Hai Bà Trưng, Hà Nội',
    sdt: COMPANY_HOTLINE,
    email: 'contact@formapubli.vn',
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lấy thông tin công ty Bên A đồng bộ từ phân hệ Hợp đồng
  useEffect(() => {
    let active = true;
    fetch('/api/contracts/company-profile')
      .then((res) => res.json())
      .then((json) => {
        if (active && json.success && json.data) {
          setCompanyProfile((prev) => ({
            tenCongTy: json.data.tenCongTy || prev.tenCongTy,
            diaChi: json.data.diaChi || prev.diaChi,
            sdt: json.data.sdt || prev.sdt,
            email: json.data.email || prev.email,
          }));
        }
      })
      .catch(() => {
        // Giữ fallback mặc định
      });
    return () => {
      active = false;
    };
  }, []);

  // Tạo chuỗi SVG mã QR
  useEffect(() => {
    if (!isOpen) return;
    try {
      const writer = new BrowserQRCodeSvgWriter();
      const qrSvg = writer.write(
        `FORMAPUBLI:PXK:${order.code}:${order.finalAmount}:${order.partnerCode || ''}`,
        85,
        85
      );
      const xml = new XMLSerializer().serializeToString(qrSvg);
      setQrSvgXml(xml);
    } catch (e) {
      console.error('Không thể vẽ QR cho phiếu xuất kho:', e);
    }
  }, [isOpen, order.code, order.finalAmount, order.partnerCode]);

  // Phím tắt Esc
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

  return (
    <>
      {/* ============================================================== */}
      {/* STYLES KHỔ IN A4: Khắc phục triệt để lỗi trang trắng */}
      {/* ============================================================== */}
      <style jsx global>{`
        @media print {
          /* Ẩn mọi thành phần con trực tiếp của body trừ nhánh chứa khối in */
          body > *:not(:has(#printable-delivery-receipt)):not(#printable-delivery-receipt) {
            display: none !important;
          }
          #printable-delivery-receipt,
          #printable-delivery-receipt * {
            visibility: visible !important;
          }
          #printable-delivery-receipt {
            display: block !important;
            width: 100% !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
            color: #0f172a !important;
            box-shadow: none !important;
            border: none !important;
          }
          #printable-delivery-receipt .font-mono {
            font-family: Consolas, "SFMono-Regular", Menlo, Monaco, monospace !important;
          }
          .no-print {
            display: none !important;
          }
          #printable-delivery-receipt table {
            width: 100% !important;
            table-layout: fixed !important;
            break-inside: auto;
            page-break-inside: auto;
          }
          #printable-delivery-receipt thead {
            display: table-header-group;
          }
          #printable-delivery-receipt tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          #printable-delivery-receipt td,
          #printable-delivery-receipt th,
          #printable-delivery-receipt p,
          #printable-delivery-receipt div,
          #printable-delivery-receipt span,
          #printable-delivery-receipt strong {
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          #printable-delivery-receipt .print-avoid-break {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          html:has(#printable-delivery-receipt),
          body:has(#printable-delivery-receipt) {
            width: auto !important;
            max-width: 210mm !important;
            background: white !important;
          }
          @page {
            size: A4 portrait;
            margin: 12mm 10mm;
          }
        }
      `}</style>

      {/* ============================================================== */}
      {/* 1. GIAO DIỆN XEM TRƯỚC (MODAL ON-SCREEN, ẨN KHI IN) */}
      {/* ============================================================== */}
      {createPortal(
        <div
          className="no-print fixed inset-0 z-[70] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl overflow-hidden border border-slate-200 my-auto flex flex-col max-h-[94vh]">
            {/* Thanh công cụ Modal */}
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xl">📄</span>
                <div>
                  <h3 className="font-bold text-sm">
                    Xem Trước Phiếu Xuất Kho A4:{' '}
                    <span className="font-mono text-amber-400">{order.code}</span>
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
                  type="button"
                  onClick={handlePrint}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition"
                >
                  <Printer className="w-4 h-4" />
                  In Phiếu (A4)
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Khung cuộn xem trước tài liệu A4 */}
            <div className="overflow-y-auto p-4 sm:p-8 bg-slate-100 flex-1 flex justify-center">
              <div className="bg-white p-6 sm:p-10 text-slate-900 shadow-lg border border-slate-300 w-full max-w-[210mm] min-h-[297mm]">
                <ReceiptContent
                  order={order}
                  companyProfile={companyProfile}
                  qrSvgXml={qrSvgXml}
                />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ============================================================== */}
      {/* 2. KHỐI IN DÀNH RIÊNG CHO TRÌNH DUYỆT (CHỈ HIỂN THỊ KHI IN) */}
      {/* Render thẳng con trực tiếp của document.body để không bị modal cắt xén */}
      {/* ============================================================== */}
      {createPortal(
        <div
          id="printable-delivery-receipt"
          className="hidden print:block bg-white text-slate-900 text-[12px] font-sans leading-normal"
        >
          <ReceiptContent
            order={order}
            companyProfile={companyProfile}
            qrSvgXml={qrSvgXml}
          />
        </div>,
        document.body
      )}
    </>
  );
}
