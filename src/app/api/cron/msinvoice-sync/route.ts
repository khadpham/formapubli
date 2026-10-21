import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { MSInvoiceService } from '@/services/msinvoice.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/msinvoice-sync
 *
 * Tự động đồng bộ trạng thái ký từ MS-Invoice về ERP (thay việc bấm tay
 * "Tải từ MS-Invoice" trên tab Hóa đơn). Kế toán ký trên MS-Invoice xong,
 * cron này kéo trạng thái về: SIGNED (đã ký, có mã CQT) hoặc CANCELLED.
 *
 * AN TOÀN:
 * - Chỉ chạy với `Authorization: Bearer <CRON_SECRET>` (so sánh constant-time).
 *   Thiếu secret thì fail-closed 401.
 * - Idempotent: chạy lại không đổi gì thêm (service chỉ chuyển trạng thái tiến,
 *   đã đúng thì bỏ qua). Chỉ đọc + cập nhật trạng thái, KHÔNG tạo/ký hóa đơn.
 * - Mock mode (chưa cấu hình MSINVOICE_*): trả về ngay, không làm gì.
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

async function handle(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const to = searchParams.get('to') || now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const from = searchParams.get('from') || fromDate.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ success: false, error: 'Ngày phải dạng YYYY-MM-DD' }, { status: 400 });
  }

  const remote = await MSInvoiceService.listRemote({ fromDate: from, toDate: to });
  if (remote.mock) {
    return NextResponse.json({
      success: true,
      mock: true,
      message: 'Mock mode: chưa cấu hình MSINVOICE_* nên không có gì để đồng bộ.',
      summary: { scanned: 0, matched: 0, updated: 0, skipped: 0, unmatched: 0, updates: [] },
      from,
      to,
    });
  }

  const summary = await MSInvoiceService.applyRemoteStatuses(remote.invoices);
  return NextResponse.json({ success: true, mock: false, summary, from, to });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Không được phép gọi cron.' }, { status: 401 });
  }
  return handle(req);
}

// Cron services thường chỉ gọi được GET nên hỗ trợ cả hai.
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Không được phép gọi cron.' }, { status: 401 });
  }
  return handle(req);
}
