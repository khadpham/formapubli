/**
 * GET /api/invoices/online-queue - Hàng đợi hóa đơn đơn online (D1).
 *
 * Trả 2 nhóm:
 * - awaitingDelivery: đơn online đã hoàn tất nhưng CHƯA xác nhận khách
 *   nhận hàng - hóa đơn đang bị giữ lại theo quy định D1.
 * - readyToIssue: đã xác nhận nhận hàng, hóa đơn chưa phát hành xong
 *   (chưa chuẩn bị, hoặc đã PREPARED mà chưa đẩy/thành công).
 * Đơn tại quầy không xuất hiện ở đây (xử lý như cũ ở danh sách chờ chung).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { orders, einvoices } from '@/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { ONLINE_CHANNELS } from '@/lib/order-channels';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_TAX', 'ROLE_WAREHOUSE']);
    const rows = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        channel: orders.channel,
        customerName: orders.customerName,
        finalAmount: orders.finalAmount,
        fiscalScope: orders.fiscalScope,
        invoiceStatus: orders.invoiceStatus,
        shippingStatus: orders.shippingStatus,
        deliveryConfirmedAt: orders.deliveryConfirmedAt,
        deliveryConfirmedBy: orders.deliveryConfirmedBy,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.channel, [...ONLINE_CHANNELS]),
          eq(orders.status, 'COMPLETED')
        )
      )
      .orderBy(desc(orders.createdAt))
      .limit(200);

    const invRows = await db
      .select({ id: einvoices.id, orderId: einvoices.orderId, status: einvoices.status })
      .from(einvoices);
    const invByOrder = new Map<string, { id: string; status: string }>();
    for (const r of invRows) if (r.orderId) invByOrder.set(r.orderId, { id: r.id, status: r.status as string });

    const awaitingDelivery: any[] = [];
    const readyToIssue: any[] = [];
    for (const o of rows as any[]) {
      const inv = invByOrder.get(o.id);
      // Đã phát hành xong (SYNCED/SIGNED) hoặc đã gom tổng hợp: khỏi hàng đợi.
      if (inv && (inv.status === 'SYNCED' || inv.status === 'SIGNED')) continue;
      if (o.invoiceStatus === 'CONSOLIDATED') continue;
      const item = { ...o, einvoiceId: inv?.id || null, einvoiceStatus: inv?.status || null };
      if (!o.deliveryConfirmedAt) awaitingDelivery.push(item);
      else readyToIssue.push(item);
    }

    return NextResponse.json({ ok: true, data: { awaitingDelivery, readyToIssue } });
  } catch (e: any) {
    return handleApiError(e);
  }
}
