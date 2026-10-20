/**
 * MSInvoiceService - Tích hợp MS-Invoice demo (hóa đơn điện tử)
 *
 * API thật (xác minh 2026-10-19 từ main.js của demo site):
 * - Base: {MSINVOICE_API_URL}/api/rest/s1
 * - Login: POST {base}/iam-auth/login {username, password}
 *   -> {moquiSessionToken, isSuccess: 'Y'} + cookie moqui.visitor
 * - Tạo HĐ nháp: POST {base}/iam-invoice/invoices/create
 *   header X-CSRF-Token: {moquiSessionToken} + cookie
 * - Session hết hạn (401) thì login lại 1 lần rồi retry.
 *
 * Luồng: ERP chuẩn bị HĐ (PREPARED) -> đẩy sang demo (SYNCED, trạng thái
 * "Chờ ký bởi SDA") -> kế toán duyệt/ký trên MS-Invoice -> ERP đồng bộ về.
 *
 * Khi chưa cấu hình credentials (MSINVOICE_*), service chạy ở MOCK MODE.
 *
 * Template 1C26TVN của công ty đã có sẵn trên demo (xác minh 2026-10-19):
 * - MSINVOICE_TEMPLATE_ID default: VAT_A4_TT78_03
 * - MSINVOICE_TEMPLATE_PARTY_ID default: 127288
 */

import { db } from '@/db';
import { einvoices, orders, orderItems, products } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';

const API_PATH = '/api/rest/s1';

interface MSInvoiceConfig {
  apiUrl: string;
  username: string;
  password: string;
  templateId: string;
  templatePartyId: string;
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
    templateId: process.env.MSINVOICE_TEMPLATE_ID || 'VAT_A4_TT78_03',
    templatePartyId: process.env.MSINVOICE_TEMPLATE_PARTY_ID || '127288',
  };
}

export function isMockMode(): boolean {
  return getConfig() === null;
}

// Session cache (theo process, demo chỉ cần 1 session)
let sessionToken: string | null = null;
let sessionCookie: string = '';

async function apiLogin(config: MSInvoiceConfig): Promise<void> {
  const res = await fetch(`${config.apiUrl}${API_PATH}/iam-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.isSuccess !== 'Y' || !data.moquiSessionToken) {
    throw new Error('Đăng nhập MS-Invoice thất bại: ' + (data.errors || res.status));
  }
  sessionToken = data.moquiSessionToken;
  // Lấy TẤT CẢ cookie (moqui.visitor + moqui.session_token)
  const getSetCookie = (res.headers as any).getSetCookie?.bind(res.headers);
  const cookies: string[] = getSetCookie ? getSetCookie() : [res.headers.get('set-cookie') || ''];
  sessionCookie = cookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

async function apiCall(config: MSInvoiceConfig, path: string, body: any, retry = true): Promise<any> {
  if (!sessionToken) await apiLogin(config);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': sessionToken as string,
  };
  if (sessionCookie) headers['Cookie'] = sessionCookie;
  const res = await fetch(`${config.apiUrl}${API_PATH}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 401 && retry) {
    sessionToken = null;
    await apiLogin(config);
    return apiCall(config, path, body, false);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.errorCode) {
    throw new Error('MS-Invoice API lỗi: ' + (data.errors || res.status));
  }
  return data;
}

function mapVatRate(vatRate: number): string {
  if (vatRate >= 0.095) return 'VatTax10';
  if (vatRate >= 0.075) return 'VatTax8'; // in ấn
  if (vatRate >= 0.04) return 'VatTax5'; // sách
  return 'VatTax0';
}

/**
 * Dựng productItems cho MS-Invoice từ đơn hàng ERP.
 * - SINGLE: dòng hàng của đơn gốc (kèm tên sản phẩm).
 * - CONSOLIDATED: gộp dòng hàng từ các đơn nguồn theo productId.
 */
async function buildProductItems(inv: any): Promise<any[]> {
  let items: any[] = [];
  if (inv.invoiceKind === 'CONSOLIDATED') {
    const orderIds: string[] = JSON.parse(inv.sourceOrderIds || '[]');
    if (orderIds.length === 0) return [];
    const rows = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
    // Gộp theo productId
    const grouped = new Map<string, { quantity: number; totalAmount: number; unitSellingPrice: number; productId: string }>();
    for (const r of rows) {
      const g = grouped.get(r.productId) || { quantity: 0, totalAmount: 0, unitSellingPrice: Number(r.unitSellingPrice || 0), productId: r.productId };
      g.quantity += Number(r.quantity || 0);
      g.totalAmount += Number(r.totalAmount || 0);
      grouped.set(r.productId, g);
    }
    items = Array.from(grouped.values());
  } else {
    if (!inv.orderId) return [];
    items = await db.select().from(orderItems).where(eq(orderItems.orderId, inv.orderId));
  }

  const result: any[] = [];
  for (const it of items) {
    const prodRows = await db.select({ name: products.name, productKind: products.productKind })
      .from(products).where(eq(products.id, it.productId || (it as any).productId)).limit(1);
    const prod = prodRows[0] as any;
    const qty = Number(it.quantity || 0);
    const unitPrice = Math.round(Number(it.unitSellingPrice || 0));
    const amountTotal = Math.round(Number(it.totalAmount || qty * unitPrice));
    if (qty <= 0) continue;
    result.push({
      description: prod?.name || 'Hàng hóa',
      quantity: qty,
      unitPrice,
      amountTotal,
      unitOfMeasure: prod?.productKind === 'BOOK' ? 'Cuốn' : 'Cái',
      taxRateEnumId: mapVatRate(Number(inv.vatRate || 0)),
    });
  }
  return result;
}

export class MSInvoiceService {
  /**
   * Đẩy hóa đơn đã PREPARED sang MS-Invoice demo (tạo HĐ nháp).
   * - Mock mode: giả lập thành công, cập nhật SYNCED
   * - Real mode: POST /iam-invoice/invoices/create
   */
  static async pushInvoice(invoiceId: string) {
    const rows = await db.select().from(einvoices).where(eq(einvoices.id, invoiceId)).limit(1);
    if (rows.length === 0) throw new Error('Không tìm thấy hóa đơn');
    const inv: any = rows[0];

    if (inv.status !== 'PREPARED' && inv.status !== 'SYNC_FAILED') {
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

    // REAL MODE: gọi API demo thật
    try {
      const productItems = await buildProductItems(inv);
      if (productItems.length === 0) {
        throw new Error('Hóa đơn không có dòng hàng nào để đẩy');
      }

      const payload: any = {
        invoiceTemplateId: config.templateId,
        invoiceTemplatePartyId: config.templatePartyId,
        currencyUomId: 'VND',
        toPartyName: inv.buyerName || 'Khách lẻ',
        toAddress: inv.buyerAddress || 'Không có địa chỉ',
        thirdPartyCode: inv.id, // refId về ERP
        productItems,
      };
      if (inv.buyerTaxCode) payload.toTaxId = inv.buyerTaxCode;
      // Email/SĐT nếu đơn có (lưu ở orders)
      if (inv.orderId) {
        const ordRows = await db.select().from(orders).where(eq(orders.id, inv.orderId)).limit(1);
        const ord: any = ordRows[0];
        if (ord?.customerEmail) payload.toEmailAddress = ord.customerEmail;
        if (ord?.customerPhone) payload.toTelecomNumber = ord.customerPhone;
      }

      const data = await apiCall(config, '/iam-invoice/invoices/create', payload);

      await db.update(einvoices).set({
        status: 'SYNCED',
        msinvoiceId: String(data.invoiceId || ''),
        invoiceSerial: '1C26TVN',
        updatedAt: now,
      } as any).where(eq(einvoices.id, invoiceId));

      return { ok: true, mock: false, msinvoiceId: String(data.invoiceId || ''), data };
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

  /**
   * Lấy chi tiết hóa đơn trên MS-Invoice theo msinvoiceId.
   */
  static async getDetail(msinvoiceId: string): Promise<any> {
    const config = getConfig();
    if (!config) return null;
    // GET detail qua apiCall GET riêng (apiCall mặc định POST).
    if (!sessionToken) await apiLogin(config);
    const doGet = async (): Promise<any> => {
      const headers: Record<string, string> = { 'X-CSRF-Token': sessionToken as string };
      if (sessionCookie) headers['Cookie'] = sessionCookie;
      return fetch(`${config.apiUrl}${API_PATH}/iam-invoice/invoices/${msinvoiceId}/detail`, { headers });
    };
    let res = await doGet();
    if (res.status === 401) {
      sessionToken = null;
      await apiLogin(config);
      res = await doGet();
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('MS-Invoice detail lỗi: ' + (data.errors || res.status));
    return data;
  }

  /**
   * Mirror: lấy danh sách hóa đơn TỪ MS-Invoice (search) trong khoảng ngày,
   * kèm trạng thái đồng bộ so với DB local (khớp theo msinvoice_id).
   * Dữ liệu giữ nguyên field của MS-Invoice ở "raw", chỉ chuẩn hoá vài field chính.
   */
  static async listRemote(params: { fromDate: string; toDate: string; pageSize?: number }): Promise<{
    mock: boolean;
    invoices: any[];
  }> {
    const config = getConfig();
    if (!config) return { mock: true, invoices: [] };

    const data = await apiCall(config, '/iam-invoice/invoices/search', {
      fromDate: params.fromDate,
      toDate: params.toDate,
      pageSize: params.pageSize || 100,
    });

    const list: any[] = Array.isArray(data) ? data : data.invoices || data.items || data.results || [];

    // Khớp với local để biết hóa đơn nào đã đồng bộ, hóa đơn nào chỉ có trên MS-Invoice.
    const locals = await db.select().from(einvoices);
    const byMsId = new Map<string, any>();
    for (const l of locals as any[]) {
      if (l.msinvoiceId) byMsId.set(String(l.msinvoiceId), l);
    }

    const invoices = list.map((r: any) => {
      const msId = String(r.invoiceId ?? r.id ?? '');
      const local = byMsId.get(msId) || null;
      return {
        msinvoiceId: msId,
        serial: r.invoiceSerial || r.serial || r.pattern || '',
        number: r.invoiceNumber || r.number || '',
        date: r.invoiceDate || r.issuedDate || r.createdDate || '',
        buyerName: r.toPartyName || r.buyerName || '',
        buyerTaxCode: r.toTaxId || r.taxId || '',
        totalAmount: Number(r.grandTotal ?? r.totalAmount ?? r.amountTotal ?? 0),
        status: r.status || r.invoiceStatus || '',
        thirdPartyCode: r.thirdPartyCode || '',
        lookupCode: r.lookupCode || '',
        sync: local
          ? { matched: true, localId: local.id, localStatus: local.status }
          : { matched: false },
        raw: r,
      };
    });
    return { mock: false, invoices };
  }
}
