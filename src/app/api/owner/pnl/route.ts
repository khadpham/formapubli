import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { getPnl, CHANNEL_GROUPS, type PnlFilters } from '@/services/cogs.service';

export const dynamic = 'force-dynamic';

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&channel=all|pos|online|shopee|wholesale
 *     &work_id=&book=TAX|INTERNAL|ALL
 * P&L 4 chiều theo đầu sách. Chỉ ROLE_OWNER.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER'] as UserRole[]);
    const p = new URL(req.url).searchParams;
    const from = `${p.get('from') || ''}`.trim();
    const to = `${p.get('to') || ''}`.trim();
    const channel = `${p.get('channel') || 'all'}`.trim();
    const workId = `${p.get('work_id') || ''}`.trim();
    const book = `${p.get('book') || 'ALL'}`.trim().toUpperCase();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ success: false, error: 'Ngày phải dạng YYYY-MM-DD.' }, { status: 400 });
    }
    if (from < '2026-01-01') {
      return NextResponse.json({ success: false, error: 'Chỉ tính từ 01/01/2026 trở đi.' }, { status: 400 });
    }
    if (channel !== 'all' && !CHANNEL_GROUPS[channel]) {
      return NextResponse.json({ success: false, error: 'Kênh không hợp lệ.' }, { status: 400 });
    }
    if (!['TAX', 'INTERNAL', 'ALL'].includes(book)) {
      return NextResponse.json({ success: false, error: 'Sổ phải là TAX, INTERNAL hoặc ALL.' }, { status: 400 });
    }

    const filters: PnlFilters = {
      from,
      to,
      channelGroup: channel as PnlFilters['channelGroup'],
      book: book as PnlFilters['book'],
    };
    if (workId) filters.workId = workId;
    const data = await getPnl(filters);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return handleApiError(e);
  }
}
