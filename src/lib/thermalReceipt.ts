/**
 * FORMAPUBLI OS - Isolated Thermal Receipt Printing Engine
 * 
 * Uses a dedicated hidden <iframe> dynamically constructed and printed.
 * This guarantees:
 * 1. ZERO interference with the host web application UI (no body display:none hacks).
 * 2. ZERO blank pages in Chrome/Edge/Safari/Firefox thermal print preview.
 * 3. Native support for K80 (80mm continuous roll) and K57 (57mm mini roll) paper widths.
 */

export type PaperPreset = 'K80' | 'K57';

export interface PrintableReceiptOrder {
  orderCode: string;
  customerName?: string;
  warehouseId?: string;
  fiscalScope?: string;
  paymentMethod?: string;
  discountRate?: number;
  subtotal?: number;
  discountAmount?: number;
  finalAmount: number;
  totalQuantity: number;
  date?: string;
  cashierId?: string;
  note?: string;
  isOffline?: boolean;
  items: Array<{
    code: string;
    title: string;
    quantity: number;
    unitCoverPrice?: number;
    coverPrice?: number;
  }>;
}

export function printThermalReceipt(
  order: PrintableReceiptOrder,
  preset: PaperPreset = 'K80',
  currentRole: string = 'ROLE_OWNER'
): void {
  if (typeof window === 'undefined') return;

  const isK57 = preset === 'K57';
  const paperWidthMm = isK57 ? '57mm' : '80mm';
  const contentWidthMm = isK57 ? '48mm' : '72mm';
  const baseFontSize = isK57 ? '10px' : '11px';
  const headerFontSize = isK57 ? '12px' : '13px';
  const titleFontSize = isK57 ? '10px' : '11px';

  const warehouseName =
    order.warehouseId === 'wh-au-co'
      ? 'Kho 1 - Âu Cơ'
      : order.warehouseId === 'wh-du-phong'
      ? 'Kho 3 - Hội Chợ'
      : order.warehouseId === 'wh-quynh-mai'
      ? 'Kho 2 - Quỳnh Mai'
      : 'Kho Âu Cơ';

  const paymentName =
    order.paymentMethod === 'CASH'
      ? 'Tiền mặt'
      : order.paymentMethod === 'BANK_TRANSFER'
      ? 'Chuyển khoản'
      : 'Mã QR';

  const orderDate = order.date || new Date().toLocaleString('vi-VN');
  const cashier = order.cashierId || `User-${currentRole}`;
  const customer = order.customerName || 'Khách vãng lai';

  const itemsHtml = order.items
    .map((item) => {
      const price = item.coverPrice || item.unitCoverPrice || 0;
      const total = price * item.quantity;
      return `
        <tr style="border-bottom: 1px dashed #ccc;">
          <td style="padding: 4px 0; vertical-align: top;">
            <div style="font-weight: 600; font-size: ${titleFontSize}; line-height: 1.2;">${escapeHtml(item.title)}</div>
            <div style="font-size: 9px; color: #555; font-family: monospace;">[${escapeHtml(item.code)}]</div>
          </td>
          <td style="padding: 4px 0; text-align: center; vertical-align: top; font-weight: bold;">x${item.quantity}</td>
          <td style="padding: 4px 0; text-align: right; vertical-align: top; font-family: monospace;">${price.toLocaleString('vi-VN')}</td>
          <td style="padding: 4px 0; text-align: right; vertical-align: top; font-family: monospace; font-weight: bold;">${total.toLocaleString('vi-VN')}</td>
        </tr>
      `;
    })
    .join('');

  const discountPercentText = Math.round((order.discountRate || 0) * 100);

  const htmlDoc = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <title>Hoa_Don_${order.orderCode}</title>
      <style>
        @page {
          size: ${paperWidthMm} auto;
          margin: 0mm;
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        html, body {
          width: ${paperWidthMm};
          margin: 0 auto;
          padding: 3mm 2mm;
          background: #fff;
          color: #000;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Courier New", monospace;
          font-size: ${baseFontSize};
          line-height: 1.35;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .container {
          width: ${contentWidthMm};
          margin: 0 auto;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .bold { font-weight: bold; }
        .divider-dashed {
          border-top: 1px dashed #000;
          margin: 6px 0;
        }
        .divider-solid {
          border-top: 1px solid #000;
          margin: 6px 0;
        }
        .row {
          display: flex;
          justify-content: space-between;
          padding: 1.5px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 4px 0;
        }
        th {
          font-size: 10px;
          border-bottom: 1px solid #000;
          padding: 3px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="text-center">
          <div style="font-size: ${headerFontSize}; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">FORMAPUBLI OS</div>
          <div style="font-size: 9px; font-weight: 500;">HỆ THỐNG XUẤT BẢN & PHÁT HÀNH SÁCH</div>
          <div style="font-size: 9px;">Hotline: 098.xxx.xxxx | Hà Nội</div>
          <div class="divider-solid"></div>
          <div style="font-size: ${baseFontSize}; font-weight: 800; text-transform: uppercase;">PHIẾU BÁN HÀNG & GIAO KHO</div>
          <div style="font-size: 9px; font-style: italic;">
            ${order.fiscalScope === 'OFFICIAL_TAX' ? '(Hóa đơn thương mại / Kê khai VAT)' : '(Phiếu xuất kho & thanh toán nội bộ)'}
          </div>
        </div>

        <div class="divider-dashed"></div>

        <div class="row"><span>Số phiếu:</span><span class="bold" style="font-family: monospace;">${escapeHtml(order.orderCode)}</span></div>
        <div class="row"><span>Thời gian:</span><span>${escapeHtml(orderDate)}</span></div>
        <div class="row"><span>Thu ngân:</span><span>${escapeHtml(cashier)}</span></div>
        <div class="row"><span>Khách hàng:</span><span class="bold">${escapeHtml(customer)}</span></div>
        <div class="row"><span>Kho xuất:</span><span>${escapeHtml(warehouseName)}</span></div>
        <div class="row"><span>Hình thức:</span><span class="bold">${escapeHtml(paymentName)}</span></div>

        <div class="divider-dashed"></div>

        <table>
          <thead>
            <tr>
              <th style="text-align: left; width: 45%;">Tên sách</th>
              <th style="text-align: center; width: 12%;">SL</th>
              <th style="text-align: right; width: 20%;">Đơn giá</th>
              <th style="text-align: right; width: 23%;">T.Tiền</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="divider-dashed"></div>

        <div class="row">
          <span>Tổng số lượng sách:</span>
          <span class="bold" style="font-family: monospace;">${order.totalQuantity} cuốn</span>
        </div>
        ${
          order.subtotal && order.subtotal !== order.finalAmount
            ? `<div class="row">
                <span>Tạm tính (Giá bìa):</span>
                <span style="font-family: monospace;">${order.subtotal.toLocaleString('vi-VN')} đ</span>
              </div>`
            : ''
        }
        ${
          order.discountAmount && order.discountAmount > 0
            ? `<div class="row">
                <span>Chiết khấu (${discountPercentText}%):</span>
                <span style="font-family: monospace;">-${order.discountAmount.toLocaleString('vi-VN')} đ</span>
              </div>`
            : ''
        }
        <div class="row" style="font-size: ${headerFontSize}; font-weight: 900; margin-top: 3px;">
          <span>THỰC THU:</span>
          <span style="font-family: monospace;">${order.finalAmount.toLocaleString('vi-VN')} đ</span>
        </div>

        <div class="divider-dashed"></div>

        ${
          order.note
            ? `<div style="font-size: 9.5px; margin-bottom: 4px;"><strong>Ghi chú:</strong> ${escapeHtml(order.note)}</div>`
            : ''
        }

        <div class="text-center" style="margin-top: 8px; font-size: 9px; line-height: 1.4;">
          <div>Cảm ơn Quý khách & Hẹn gặp lại!</div>
          <div style="font-size: 8px; color: #444; margin-top: 2px;">Mọi thắc mắc về đơn hàng xin liên hệ hotline CSKH</div>
          <div style="margin-top: 6px; font-family: monospace; font-size: 8px; letter-spacing: 2px;">*** ${escapeHtml(order.orderCode)} ***</div>
        </div>
      </div>
    </body>
    </html>
  `;

  const existingFrame = document.getElementById('__thermal_print_frame__');
  if (existingFrame) {
    existingFrame.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = '__thermal_print_frame__';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';

  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    console.error('Could not access print iframe document');
    return;
  }

  doc.open();
  doc.write(htmlDoc);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error('Print execution error:', e);
    }
  }, 250);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
