import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { orders, orderItems, products } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Đã giao',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

/**
 * GET /api/portal/customers/[id]/orders - Lich su don hang cua khach.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: customerId } = params;

    const orderRows = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        createdAt: orders.createdAt,
        status: orders.status,
        finalAmount: orders.finalAmount,
      })
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt))
      .limit(50);

    const result = await Promise.all(
      orderRows.map(async (o) => {
        const items = await db
          .select({
            productName: products.name,
            quantity: orderItems.quantity,
            price: orderItems.unitSellingPrice,
          })
          .from(orderItems)
          .innerJoin(products, eq(orderItems.productId, products.id))
          .where(eq(orderItems.orderId, o.id));

        const itemCount = items.reduce((s, i) => s + (i.quantity || 0), 0);

        return {
          orderCode: o.orderCode,
          createdAt: o.createdAt,
          status: o.status,
          statusLabel: STATUS_LABELS[o.status || ''] || o.status,
          totalAmount: o.finalAmount,
          itemCount,
          items: items.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            price: i.price,
          })),
        };
      })
    );

    return NextResponse.json({ orders: result });
  } catch (e) {
    console.error(`[portal/customers/orders] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
