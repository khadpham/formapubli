/**
 * MSInvoiceService - Tích hợp MS-Invoice (hóa đơn điện tử) theo luồng chuẩn
 * bên thứ 3 của vendor (Postman collection "Tích hợp MS" do My Software cấp).
 *
 * LUỒNG CHUẨN (xác minh trên PROD 2026-10-20):
 * - Đăng nhập lấy khóa: POST {MSINVOICE_API_URL}/api/rest/s1/iam-auth/login-key
 *     body {username, password} -> {login_key, moquiSessionToken, isSuccess: 'Y'}
 *     Tài khoản web dùng chung cho API (đã test trên prod, không cần cấp riêng).
 * - Tạo hóa đơn: POST {MSINVOICE_API_URL}/erp/rest/s1/iam-invoice/invoices/create-from-3rd
 *     header: api_key: <login_key>
 *     body: invoiceForm (1), invoiceSerial ('1C26TVN' - ký hiệu thật của công ty),
 *     currencyUomId 'VND', paymentInstrumentEnumId, thirdPartyCode (mã đối soát
 *     về ERP), toPartyName/toPartyTaxId/toAddress/toEmailAddress/toTelecomNumber,
 *     productItems[]: { quantity, amount (đơn giá CHƯA thuế), amountTotal,
 *     taxRate ('0'|'5'|'8'|'10' - mã chuỗi), taxAmount, description,
 *     quantityUomDesc, itemClassTypeEnumId 'IiclsProduct', isPromotion 'N' }
 * - Chi tiết hóa đơn: GET {base}/erp/rest/s1/iam-invoice/invoices/{id}/detail
 * - Danh sách mức thuế: GET {base}/erp/rest/s1/iam-common/invoice/tax-rate
 *     -> VatTax0/5/8/10. Sách = 5%, in ấn = 8% (anh Kha chốt 2026-10-20).
 *
 * CHÚ Ý GIÁ: giá bìa ERP đã GỒM VAT. Payload vendor tính theo giá CHƯA thuế
 * (amountTotal là tiền hàng chưa thuế, taxAmount cộng riêng) nên service tách
 * ngược VAT theo từng dòng trước khi gửi - tổng cuối vẫn bằng tiền đã thu.
 *
 * Phạm vi: ERP chỉ ĐẨY hóa đơn lên (tạo nháp trên MS-Invoice). Kế toán
 * duyệt/ký trên MS-Invoice như cũ. KHÔNG đụng ký số.
 *
 * Khi chưa cấu hình MSINVOICE_* thì chạy MOCK MODE (không gọi ra ngoài).
 */

import { db } from '@/db';
import { einvoices, orders, orderItems, products } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';

const AUTH_PATH = '/api/rest/s1';
const ERP_PATH = '/erp/rest/s1';

interface MSInvoiceConfig {
  apiUrl: string;
  username: string;
  password: string;
  /** Ký hiệu hóa đơn đầy đủ để hiển thị (vd 1C26TVN). */
  serial: string;
  /** Mẫu hóa đơn (invoiceForm, chữ số đầu của ký hiệu). */
  form: number;
  /** Phần ký hiệu sau chữ số form (vd C26TVN) - đúng format create-from-3rd yêu cầu. */
  serialPart: string;
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
    serial: process.env.MSINVOICE_SERIAL || '1C26TVN',
    ...splitSerial(process.env.MSINVOICE_SERIAL || '1C26TVN'),
  };
}

/**
 * Tách ký hiệu hiển thị thành form + serial cho API create-from-3rd.
 * VD: '1C26TVN' -> { form: 1, serial: 'C26TVN' } (API sẽ nối thành '1C26TVN').
 * MSINVOICE_FORM ưu tiên nếu được set riêng.
 */
function splitSerial(full: string): { form: number; serialPart: string } {
  const m = /^([1-9])([A-Z0-9]{4,})$/i.exec(full.trim());
  if (m) {
    const form = Number(process.env.MSINVOICE_FORM || m[1]);
    return { form, serialPart: m[2].toUpperCase() };
  }
  return { form: Number(process.env.MSINVOICE_FORM || 1), serialPart: full.toUpperCase() };
}

export function isMockMode(): boolean {
  return getConfig() === null;
}

// Cache khóa truy cập theo process (login_key của Moqui dùng được nhiều lần).
let cachedLoginKey: string | null = null;

async function getLoginKey(config: MSInvoiceConfig, force = false): Promise<string> {
  if (cachedLoginKey && !force) return cachedLoginKey;
  const res = await fetch(`${config.apiUrl}${AUTH_PATH}/iam-auth/login-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.isSuccess !== 'Y' || !data.login_key) {
    throw new Error('Đăng nhập MS-Invoice thất bại: ' + (data.errors || data.message || res.status));
  }
  cachedLoginKey = data.login_key;
  return cachedLoginKey as string;
}

/** Gọi API /erp/rest/s1 với header api_key. 401 -> login lại 1 lần rồi retry. */
async function erpCall(
  config: MSInvoiceConfig,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: any,
  retry = true
): Promise<any> {
  const key = await getLoginKey(config);
  const res = await fetch(`${config.apiUrl}${ERP_PATH}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', api_key: key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry) {
    cachedLoginKey = null;
    await getLoginKey(config, true);
    return erpCall(config, method, path, body, false);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.errorCode || data.success === 'N' || data.error === true) {
    throw new Error('MS-Invoice API lỗi: ' + (data.message || data.errors || res.status));
  }
  return data;
}

/** Mã thuế dạng chuỗi cho create-from-3rd: '0' | '5' | '8' | '10' (sách 5%, in ấn 8%). */
function taxRateCode(vatRate: number): string {
  if (vatRate >= 0.095) return '10';
  if (vatRate >= 0.075) return '8';
  if (vatRate >= 0.04) return '5';
  return '0';
}

/**
 * Dựng productItems cho create-from-3rd từ hóa đơn ERP.
 * - SINGLE: dòng hàng của đơn gốc. CONSOLIDATED: gộp theo productId từ các đơn nguồn.
 * - Giá ERP đã gồm VAT -> tách ngược: amount = đơn giá chưa thuế,
 *   amountTotal = amount * số lượng, taxAmount = tiền thuế của dòng.
 */
async function buildProductItems(inv: any): Promise<any[]> {
  let items: any[] = [];
  if (inv.invoiceKind === 'CONSOLIDATED') {
    const orderIds: string[] = JSON.parse(inv.sourceOrderIds || '[]');
    if (orderIds.length === 0) return [];
    const rows = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
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

  const vatRate = Number(inv.vatRate || 0);
  const result: any[] = [];
  for (const it of items) {
    const prodRows = await db.select({ name: products.name, productKind: products.productKind })
      .from(products).where(eq(products.id, it.productId)).limit(1);
    const prod = prodRows[0] as any;
    const qty = Number(it.quantity || 0);
    if (qty <= 0) continue;
    const grossUnit = Number(it.unitSellingPrice || 0);
    const grossTotal = Number(it.totalAmount || qty * grossUnit);
    // Tách ngược VAT (giá đã gồm thuế).
    const netUnit = vatRate > 0 ? Math.round(grossUnit / (1 + vatRate)) : Math.round(grossUnit);
    const netTotal = netUnit * qty;
    const taxAmount = Math.max(0, Math.round(grossTotal) - netTotal);
    result.push({
      quantity: qty,
      amount: netUnit,
      description: prod?.name || 'Hàng hóa',
      quantityUomDesc: prod?.productKind === 'BOOK' ? 'Cuốn' : 'Cái',
      isPromotion: 'N',
      amountTotal: netTotal,
      itemClassTypeEnumId: 'IiclsProduct',
      taxAmount,
      taxRate: taxRateCode(vatRate),
    });
  }
  return result;
}

export class MSInvoiceService {
  /**
   * Đẩy hóa đơn PREPARED (hoặc SYNC_FAILED để thử lại) lên MS-Invoice bằng
   * create-from-3rd. Thành công -> SYNCED + lưu msinvoiceId + ký hiệu.
   * Mock mode: giả lập thành công khi chưa cấu hình MSINVOICE_*.
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

    try {
      const productItems = await buildProductItems(inv);
      if (productItems.length === 0) {
        throw new Error('Hóa đơn không có dòng hàng nào để đẩy');
      }

      const payload: any = {
        invoiceDate: null, // null = ngày hiện tại theo MS-Invoice
        invoiceForm: config.form,
        invoiceSerial: config.serialPart,
        discountTypeEnumId: null,
        currencyUomId: 'VND',
        paymentInstrumentEnumId: 'PiCashOrWireTransfer',
        thirdPartyCode: inv.id, // mã đối soát về ERP
        toPartyName: inv.buyerName || 'Khách lẻ',
        toName: inv.buyerName || 'Khách lẻ',
        productItems,
      };
      if (inv.buyerAddress) payload.toAddress = inv.buyerAddress;
      if (inv.buyerTaxCode) payload.toPartyTaxId = inv.buyerTaxCode;
      if (inv.orderId) {
        const ordRows = await db.select().from(orders).where(eq(orders.id, inv.orderId)).limit(1);
        const ord: any = ordRows[0];
        if (ord?.customerEmail) payload.toEmailAddress = ord.customerEmail;
        if (ord?.customerPhone) payload.toTelecomNumber = ord.customerPhone;
      }

      const data = await erpCall(config, 'POST', '/iam-invoice/invoices/create-from-3rd', payload);

      const msinvoiceId = String(
        data?.invoiceId ?? data?.id ?? data?.invoice?.invoiceId ?? data?.invoice?.id ?? ''
      );
      await db.update(einvoices).set({
        status: 'SYNCED',
        msinvoiceId,
        invoiceSerial: config.serial, // hiển thị đầy đủ 1C26TVN
        updatedAt: now,
      } as any).where(eq(einvoices.id, invoiceId));

      return { ok: true, mock: false, msinvoiceId, data };
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
   * Hiện tại gọi từ UI khi kế toán xác nhận; tương lai có thể poll detail.
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

  /** Chi tiết hóa đơn trên MS-Invoice (luồng /erp/rest/s1, header api_key). */
  static async getDetail(msinvoiceId: string): Promise<any> {
    const config = getConfig();
    if (!config) return null;
    return erpCall(config, 'GET', `/iam-invoice/invoices/${msinvoiceId}/detail`);
  }

  /**
   * Mirror: lấy danh sách hóa đơn từ MS-Invoice trong khoảng ngày và đối chiếu
   * với DB local theo msinvoice_id. Dùng endpoint search với header api_key
   * (login_key đã test thành công trên prod).
   */
  static async listRemote(params: { fromDate: string; toDate: string; pageSize?: number }): Promise<{
    mock: boolean;
    invoices: any[];
  }> {
    const config = getConfig();
    if (!config) return { mock: true, invoices: [] };

    const key = await getLoginKey(config);
    const res = await fetch(`${config.apiUrl}${AUTH_PATH}/iam-invoice/invoices/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', api_key: key },
      body: JSON.stringify({ fromDate: params.fromDate, toDate: params.toDate, pageSize: params.pageSize || 100 }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data.errorCode) {
      throw new Error('MS-Invoice search lỗi: ' + (data.errors || data.message || res.status));
    }

    const list: any[] = Array.isArray(data) ? data : data.invoices || data.items || data.results || [];

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
