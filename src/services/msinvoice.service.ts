/**
 * MSInvoiceService - Tích hợp MS-Invoice (hóa đơn điện tử)
 *
 * Luồng: login -> POST /create-from-3rd
 * Kế toán duyệt/ký trên MS-Invoice, ERP đồng bộ trạng thái về.
 *
 * Khi chưa cấu hình credentials (MSINVOICE_*), service chạy ở MOCK MODE:
 * - Giả lập thành công để test end-to-end
 * - Không gọi API thật
 *
 * Credentials cần (hỏi MS-INVOICE bên phần mềm):
 * - MSINVOICE_API_URL: URL API
 * - MSINVOICE_USERNAME, MSINVOICE_PASSWORD: tài khoản
 * - MSINVOICE_CERT_SN: certSn (khi có remote signing)
 */

import { db } from '@/db';
import { einvoices } from '@/db/schema';
import { eq } from 'drizzle-orm';

interface MSInvoiceConfig {
  apiUrl: string;
  username: string;
  password: string;
  certSn?: string;
}

function getConfig(): MSInvoiceConfig | null {
  const apiUrl = process.env.MSINVOICE_API_URL;
  const username = process.env.MSINVOICE_USERNAME;
  const password = process.env.MSINVOICE_PASSWORD;
  if (!apiUrl || !username || !password) return null;
  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    username,
    password,
    certSn: process.env.MSINVOICE_CERT_SN,
  };
}

export function isMockMode(): boolean {
  return getConfig() === null;
}

export class MSInvoiceService {
  /**
   * Đẩy hóa đơn đã PREPARED sang MS-Invoice.
   * - Mock mode: giả lập thành công, cập nhật SYNCED
   * - Real mode: gọi API thật
   */
  static async pushInvoice(invoiceId: string) {
    const rows = await db.select().from(einvoices).where(eq(einvoices.id, invoiceId)).limit(1);
    if (rows.length === 0) throw new Error('Không tìm thấy hóa đơn');
    const inv: any = rows[0];

    if (inv.status !== 'PREPARED') {
      throw new Error(`Hóa đơn ở trạng thái ${inv.status}, cần PREPARED mới đẩy được`);
    }

    const config = getConfig();
    const now = new Date().toISOString();

    if (!config) {
      // MOCK MODE: giả lập đẩy thành công
      const mockId = `MOCK-${Date.now()}`;
      await db.update(einvoices).set({
        status: 'SYNCED',
        msinvoiceId: mockId,
        invoiceSerial: '1C26TVN',
        invoiceNumber: `MOCK-${String(Date.now()).slice(-6)}`,
        lookupCode: `MOCK${Date.now()}`,
        updatedAt: now,
      } as any).where(eq(einvoices.id, invoiceId));

      return {
        ok: true,
        mock: true,
        msinvoiceId: mockId,
        message: 'Mock mode: chưa cấu hình MSINVOICE_*, giả lập đẩy thành công',
      };
    }

    // REAL MODE: gọi API MS-Invoice
    try {
      // Bước 1: login lấy token
      const loginRes = await fetch(`${config.apiUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: config.username, password: config.password }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok || !loginData.token) {
        throw new Error('Đăng nhập MS-Invoice thất bại: ' + (loginData.message || loginRes.status));
      }
      const token = loginData.token;

      // Bước 2: tạo hóa đơn từ dữ liệu ERP
      const payload = {
        buyerTaxCode: inv.buyerTaxCode,
        buyerName: inv.buyerName,
        buyerAddress: inv.buyerAddress,
        subtotal: inv.subtotal,
        vatRate: inv.vatRate,
        vatAmount: inv.vatAmount,
        totalAmount: inv.totalAmount,
        invoiceSerial: '1C26TVN', // Ký hiệu đã chốt
        certSn: config.certSn,
        refId: inv.id, // ID tham chiếu về ERP
      };

      const createRes = await fetch(`${config.apiUrl}/create-from-3rd`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error('Tạo hóa đơn thất bại: ' + (createData.message || createRes.status));
      }

      await db.update(einvoices).set({
        status: 'SYNCED',
        msinvoiceId: createData.id || createData.msinvoiceId,
        invoiceSerial: createData.serial || '1C26TVN',
        invoiceNumber: createData.number,
        lookupCode: createData.lookupCode,
        lookupUrl: createData.lookupUrl,
        updatedAt: now,
      } as any).where(eq(einvoices.id, invoiceId));

      return { ok: true, mock: false, data: createData };
    } catch (e: any) {
      await db.update(einvoices).set({
        status: 'SYNC_FAILED',
        updatedAt: now,
      } as any).where(eq(einvoices.id, invoiceId));
      throw e;
    }
  }

  /**
   * Đồng bộ trạng thái từ MS-Invoice về (kế toán đã ký).
   * Trong thực tế: webhook từ MS-Invoice hoặc poll định kỳ.
   */
  static async syncStatus(invoiceId: string, status: 'SIGNED' | 'REJECTED', signedData?: any) {
    const now = new Date().toISOString();
    const update: any = { status, updatedAt: now };
    if (status === 'SIGNED') {
      update.isSigned = 'Y';
      update.issuedAt = now;
      if (signedData?.pdfUrl) update.pdfUrl = signedData.pdfUrl;
      if (signedData?.certSn) update.certSn = signedData.certSn;
    }
    await db.update(einvoices).set(update).where(eq(einvoices.id, invoiceId));

    // Cập nhật đơn hàng liên quan
    const rows = await db.select().from(einvoices).where(eq(einvoices.id, invoiceId)).limit(1);
    if (rows.length > 0 && (rows[0] as any).orderId) {
      const { orders } = await import('@/db/schema');
      await db.update(orders).set({
        invoiceStatus: status,
        vatInvoiceCode: (rows[0] as any).invoiceNumber,
      } as any).where(eq(orders.id, (rows[0] as any).orderId));
    }
    return true;
  }
}
