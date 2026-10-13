import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { allocateOrderCode } from '@/services/order-code';
import { businessDateOf } from '@/services/order.service';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/reserve-code - Cap truoc 1 ma don ORD cho portal.
 *
 * Portal goi API nay khi khach bam dat hang, lay ma ve hien cho khach, ghi
 * Google Sheet va nhung san vao VietQR. Sau do portal gui don kem ma nay qua
 * POST /api/portal-orders (truong order_code).
 *
 * Ma duoc cap la duy nhat (bo dem ngay trong DB) nhung DON CHUA TAO: neu khach
 * bo don giua chung thi so thu tu do trong (chap nhan ho, khong lot bao cao).
 * Xac thuc: Bearer PORTAL_API_KEY, giong /api/portal-orders.
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.PORTAL_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Tich hop portal chua duoc cau hinh.' },
        { status: 500 },
      );
    }
    if (req.headers.get('authorization') !== `Bearer ${apiKey}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const orderCode = await db.transaction(async (tx) =>
      allocateOrderCode(tx, businessDateOf(new Date()))
    );
    return NextResponse.json({ success: true, data: { orderCode } });
  } catch (e) {
    console.error(`[reserve-code] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
