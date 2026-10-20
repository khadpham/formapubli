import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { CampaignService } from '@/services/campaign.service';

export const dynamic = 'force-dynamic';

/**
 * Tự động kết thúc chiến dịch bán ngắn hạn đã quá hạn (endDate < hôm nay, giờ VN).
 * Gọi bởi crontab cùng nhịp với auto-close (mỗi 30 phút).
 * Việc thực hiện: chuyển tồn về kho nguồn, ngưng kho chiến dịch + tắt POS,
 * sinh báo cáo kỳ. Xem CampaignService.autoEndExpired.
 *
 * AN TOÀN: chỉ chạy khi có Authorization: Bearer <CRON_SECRET>; fail-closed
 * nếu thiếu secret (401). Lỗi 1 chiến dịch không chặn các chiến dịch khác.
 */
function authorized(req: NextRequest): boolean {
  const secret = `${process.env.CRON_SECRET || ''}`.trim();
  if (!secret) return false;
  const header = `${req.headers.get('authorization') || ''}`.trim();
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  const given = header.slice(7).trim();
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const ended = await CampaignService.autoEndExpired();
    return NextResponse.json({ ok: true, endedCount: ended.length, ended });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
