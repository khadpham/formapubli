/**
 * GET /api/invoices/pending-orders - Đơn OFFICIAL_TAX chưa có hóa đơn
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { orders, einvoices } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_TAX', 'ROLE_CASHIER']);

    // Đơn OFFICIAL_TAX, đã hoàn thành, invoiceStatus=NONE hoặc PENDING, chưa có einvoice
    const result = await db.select({
      id: orders.id,
      orderCode: orders.orderCode,
      customerName: orders.customerName,
      finalAmount: orders.finalAmount,
      invoiceTaxCode: orders.invoiceTaxCode,
      invoiceCompanyName: orders.invoiceCompanyName,
      createdAt: orders.createdAt,
    }).from(orders).where(
      and(
        eq(orders.fiscalScope, 'OFFICIAL_TAX'),
        eq(orders.status, 'COMPLETED'),
        sql`${orders.invoiceStatus} IN ('NONE', 'PENDING')`
      )
    ).limit(100);

    // Lọc đơn đã có einvoice (phòng trường hợp invoiceStatus chưa cập nhật)
    const withInvoice = await db.select({ orderId: einvoices.orderId }).from(einvoices);
    const invoicedIds = new Set(withInvoice.map((r: any) => r.orderId).filter(Boolean));
    const filtered = result.filter((r: any) => !invoicedIds.has(r.id));

    return NextResponse.json({ ok: true, data: filtered });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
