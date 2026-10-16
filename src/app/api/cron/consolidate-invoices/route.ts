/**
 * POST /api/cron/consolidate-invoices - Gom hóa đơn tổng hợp cuối ngày
 *
 * Chạy lúc 23:00 giờ VN mỗi ngày (cấu hình cron bên ngoài).
 * Gom tất cả đơn INTERNAL_MANAGEMENT trong ngày thành 1 hóa đơn tổng hợp.
 *
 * Bảo mật: cần Authorization: Bearer <CRON_SECRET>
 * Idempotent: ngày đã gom thì trả về bản ghi cũ, không tạo thêm.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { InvoiceService } from '@/services/invoice.service';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const secret = `${process.env.CRON_SECRET || ''}`.trim();
  if (!secret) return false;
  const header = `${req.headers.get('authorization') || ''}`.trim();
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    // Mặc định gom ngày hôm nay (giờ VN). Có thể chỉ định date để gom bù.
    const targetDate = body.date ||
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

    const result = await InvoiceService.consolidateDay({
      date: targetDate,
      createdBy: 'cron-consolidate',
    });

    return NextResponse.json({
      ok: true,
      data: {
        date: targetDate,
        orderCount: result.orderCount,
        skipped: result.skipped,
        invoiceId: (result.invoice as any)?.id || null,
        reason: (result as any).reason,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET để kiểm tra (cũng cần auth)
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, message: 'Consolidate cron ready' });
}
