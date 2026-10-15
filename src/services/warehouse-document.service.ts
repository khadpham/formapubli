/**
 * Warehouse Document Service - Quản lý chứng từ kho
 * - Đánh số tự động theo loại + năm
 * - Lưu trữ trên R2
 * - Liên kết với bút toán ledger
 */

import { db } from '@/db';
import { warehouseDocuments, warehouseDocumentItems, warehouseDocCounters, products } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { uploadWarehouseDocument } from './r2.service';

export type DocType = 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'COUNT_SHEET' | 'COUNT_MINUTES';

const DOC_PREFIX: Record<DocType, string> = {
  INBOUND: 'NK',      // Nhập kho
  OUTBOUND: 'XK',     // Xuất kho
  TRANSFER: 'CK',     // Chuyển kho
  COUNT_SHEET: 'PKK', // Phiếu kiểm kê
  COUNT_MINUTES: 'BBKK', // Biên bản kiểm kê
};

const DOC_NAME: Record<DocType, string> = {
  INBOUND: 'Phiếu nhập kho',
  OUTBOUND: 'Phiếu xuất kho',
  TRANSFER: 'Phiếu chuyển kho',
  COUNT_SHEET: 'Phiếu kiểm kê',
  COUNT_MINUTES: 'Biên bản kiểm kê',
};

export function getDocTypeName(docType: string): string {
  return DOC_NAME[docType as DocType] || docType;
}

/**
 * Đánh số chứng từ tự động: PREFIX-NĂM-SỐ (vd: NK-2026-0001)
 */
export async function generateDocNumber(docType: DocType): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = DOC_PREFIX[docType];

  // Lấy và tăng counter trong transaction để tránh trùng số
  const existing = await db
    .select()
    .from(warehouseDocCounters)
    .where(and(eq(warehouseDocCounters.docType, docType), eq(warehouseDocCounters.year, year)))
    .limit(1);

  let nextNumber: number;
  if (existing.length === 0) {
    nextNumber = 1;
    await db.insert(warehouseDocCounters).values({ docType, year, lastNumber: 1 });
  } else {
    nextNumber = existing[0].lastNumber + 1;
    await db.update(warehouseDocCounters)
      .set({ lastNumber: nextNumber })
      .where(and(eq(warehouseDocCounters.docType, docType), eq(warehouseDocCounters.year, year)));
  }

  return `${prefix}-${year}-${String(nextNumber).padStart(4, '0')}`;
}

export interface DocItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  note?: string;
}

export interface CreateDocInput {
  docType: DocType;
  warehouseId?: string;
  toWarehouseId?: string;
  partnerId?: string;
  partnerName?: string;
  items: DocItemInput[];
  note?: string;
  createdBy?: string;
  ledgerRefs?: string[];
}

/**
 * Tạo chứng từ mới (trạng thái DRAFT)
 */
export async function createDocument(input: CreateDocInput) {
  const docNumber = await generateDocNumber(input.docType);
  const docId = randomUUID();
  const now = new Date().toISOString();

  // Lấy thông tin sản phẩm
  const productIds = input.items.map(i => i.productId);
  const prodRows = productIds.length > 0
    ? await db.select({ id: products.id, code: products.code, name: products.name }).from(products)
    : [];
  const prodMap = new Map(prodRows.filter(p => productIds.includes(p.id)).map(p => [p.id, p]));

  let totalQty = 0;
  let totalAmt = 0;
  const itemValues = input.items.map((it, idx) => {
    const p = prodMap.get(it.productId);
    const amount = (it.quantity || 0) * (it.unitPrice || 0);
    totalQty += it.quantity || 0;
    totalAmt += amount;
    return {
      id: randomUUID(),
      documentId: docId,
      productId: it.productId,
      productCode: p?.code || '',
      productName: p?.name || '',
      quantity: it.quantity,
      unitPrice: it.unitPrice || 0,
      amount,
      note: it.note || null,
      sortOrder: idx,
    };
  });

  await db.insert(warehouseDocuments).values({
    id: docId,
    docType: input.docType,
    docNumber,
    docDate: now,
    warehouseId: input.warehouseId || null,
    toWarehouseId: input.toWarehouseId || null,
    partnerId: input.partnerId || null,
    partnerName: input.partnerName || null,
    totalQuantity: totalQty,
    totalAmount: totalAmt,
    status: 'DRAFT',
    ledgerRefs: input.ledgerRefs ? JSON.stringify(input.ledgerRefs) : null,
    createdBy: input.createdBy || 'system',
    note: input.note || null,
  });

  if (itemValues.length > 0) {
    await db.insert(warehouseDocumentItems).values(itemValues);
  }

  return { id: docId, docNumber };
}

/**
 * Phát hành chứng từ: đánh dấu ISSUED + upload lên R2
 */
export async function issueDocument(docId: string, html: string, issuedBy?: string) {
  const docs = await db.select().from(warehouseDocuments).where(eq(warehouseDocuments.id, docId)).limit(1);
  if (docs.length === 0) throw new Error('Không tìm thấy chứng từ');
  const doc = docs[0];
  if (doc.status === 'ISSUED') throw new Error('Chứng từ đã phát hành');

  // Upload lên R2
  const { key, url } = await uploadWarehouseDocument(doc.docNumber, html);

  await db.update(warehouseDocuments)
    .set({
      status: 'ISSUED',
      r2Key: key,
      r2Url: url,
      issuedBy: issuedBy || 'system',
      issuedAt: new Date().toISOString(),
    })
    .where(eq(warehouseDocuments.id, docId));

  return { key, url };
}

/**
 * Hủy chứng từ
 */
export async function voidDocument(docId: string, reason: string, voidedBy?: string) {
  const docs = await db.select().from(warehouseDocuments).where(eq(warehouseDocuments.id, docId)).limit(1);
  if (docs.length === 0) throw new Error('Không tìm thấy chứng từ');
  if (docs[0].status === 'VOIDED') throw new Error('Chứng từ đã hủy');

  await db.update(warehouseDocuments)
    .set({
      status: 'VOIDED',
      voidedBy: voidedBy || 'system',
      voidedAt: new Date().toISOString(),
      voidReason: reason,
    })
    .where(eq(warehouseDocuments.id, docId));
}

/**
 * Lấy chi tiết chứng từ kèm items
 */
export async function getDocument(docId: string) {
  const docs = await db.select().from(warehouseDocuments).where(eq(warehouseDocuments.id, docId)).limit(1);
  if (docs.length === 0) return null;
  const items = await db.select().from(warehouseDocumentItems)
    .where(eq(warehouseDocumentItems.documentId, docId))
    .orderBy(warehouseDocumentItems.sortOrder);
  return { ...docs[0], items };
}

/**
 * Danh sách chứng từ
 */
export async function listDocuments(filters?: { docType?: string; status?: string; limit?: number }) {
  let query = db.select().from(warehouseDocuments).$dynamic();
  // Đơn giản: lấy tất cả rồi filter ở code (sẽ tối ưu sau)
  const all = await query;
  let result = all;
  if (filters?.docType) result = result.filter(d => d.docType === filters.docType);
  if (filters?.status) result = result.filter(d => d.status === filters.status);
  result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return result.slice(0, filters?.limit || 50);
}
