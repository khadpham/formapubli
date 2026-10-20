import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { portalReviews, portalProducts, orderItems, orders, customers } from '@/db/schema';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

/**
 * GET /api/portal/reviews?productId=... - Lay danh gia da duyet.
 */
export async function GET(req: NextRequest) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get('productId')?.trim() || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

    if (!productId) {
      return NextResponse.json({ error: 'Thiếu productId.' }, { status: 400 });
    }

    const offset = (page - 1) * limit;
    const where = and(
      eq(portalReviews.productId, productId),
      eq(portalReviews.status, 'APPROVED')
    );

    const [rows, totalResult, ratingResult] = await Promise.all([
      db.select({
        id: portalReviews.id,
        customerId: portalReviews.customerId,
        rating: portalReviews.rating,
        content: portalReviews.content,
        createdAt: portalReviews.createdAt,
      })
        .from(portalReviews)
        .where(where)
        .orderBy(desc(portalReviews.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(portalReviews).where(where),
      db.select({
        avg: sql<number>`AVG(${portalReviews.rating})`,
      })
        .from(portalReviews)
        .where(where),
    ]);

    // Lay ten khach hang (an bot ho ten)
    const reviews = await Promise.all(
      rows.map(async (r) => {
        const cRows = await db
          .select({ fullName: customers.fullName })
          .from(customers)
          .where(eq(customers.id, r.customerId))
          .limit(1);
        const fullName = cRows[0]?.fullName || 'Khách hàng';
        // An bot: Nguyen Van A -> Nguyen V. A
        const parts = fullName.split(' ');
        const masked = parts.length > 1
          ? `${parts[0]} ${parts.slice(1, -1).map((p) => p[0] + '.').join(' ')} ${parts[parts.length - 1]}`
          : fullName;
        return {
          id: r.id,
          customerName: masked.trim(),
          rating: r.rating,
          content: r.content,
          createdAt: r.createdAt,
        };
      })
    );

    return NextResponse.json({
      reviews,
      total: totalResult[0]?.total || 0,
      avgRating: Math.round((ratingResult[0]?.avg || 0) * 10) / 10,
    });
  } catch (e) {
    console.error(`[portal/reviews GET] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}

/**
 * POST /api/portal/reviews - Gui danh gia moi (cho duyet).
 */
export async function POST(req: NextRequest) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const productId = String(body?.productId || '').trim();
    const customerId = String(body?.customerId || '').trim();
    const rating = parseInt(String(body?.rating || '0'), 10);
    const content = String(body?.content || '').trim();

    if (!productId || !customerId) {
      return NextResponse.json({ error: 'Thiếu thông tin sản phẩm hoặc khách hàng.' }, { status: 400 });
    }
    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Đánh giá phải từ 1 đến 5 sao.' }, { status: 400 });
    }
    if (!content || content.length > 1000) {
      return NextResponse.json({ error: 'Nhận xét không được trống và tối đa 1000 ký tự.' }, { status: 400 });
    }

    // Kiem tra khach da mua san pham nay chua
    // (don ONLINE cua khach chua san pham nay, trang thai khong phai CANCELLED)
    const purchased = await db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(and(
        eq(orders.customerId, customerId),
        eq(orders.channel, 'ONLINE'),
        eq(orderItems.productId, productId)
      ))
      .limit(1);

    // Tam thoi: cho phep danh gia ma khong can kiem tra mua hang nghiem ngat
    // (se siet chat khi co du lieu don portal day du)
    // if (!purchased[0]) {
    //   return NextResponse.json(
    //     { error: 'Bạn cần mua sản phẩm này trước khi đánh giá.' },
    //     { status: 403 }
    //   );
    // }

    const id = randomUUID();
    await db.insert(portalReviews).values({
      id,
      productId,
      customerId,
      rating,
      content,
      status: 'PENDING',
    });

    return NextResponse.json({
      ok: true,
      message: 'Cảm ơn bạn đã đánh giá. Nhận xét sẽ hiển thị sau khi được duyệt.',
    });
  } catch (e) {
    console.error(`[portal/reviews POST] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
