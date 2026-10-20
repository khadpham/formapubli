/**
 * POST /api/invoices/prepare - Chuẩn bị hóa đơn từ đơn hàng
 * Body: { orderId }
 *
 * POST /api/invoices/consolidate - Gom hóa đơn tổng hợp cuối ngày
 * Body: { date: 'YYYY-MM-DD' }
 *
 * GET /api/invoices - Danh sách hóa đơn
 * Query: status, kind, limit
 */
import { NextRequest, NextResponse } from 'next/server';
import { InvoiceService } from '@/services/invoice.service';
import { db } from '@/db';
import { einvoices } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_TAX']);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const kind = searchParams.get('kind');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    let query = db.select().from(einvoices).$dynamic();
    if (status) query = query.where(eq(einvoices.status, status)) as any;
    // Đơn giản: filter kind ở code
    const all = await query.orderBy(desc(einvoices.createdAt)).limit(limit * 2);
    let result = all;
    if (kind) result = result.filter((r: any) => r.invoiceKind === kind);
    return NextResponse.json({ ok: true, data: result.slice(0, limit) });
  } catch (e: any) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === 'prepare') {
      const { orderId } = body;
      if (!orderId) {
        return NextResponse.json({ ok: false, error: 'Thiếu orderId' }, { status: 400 });
      }
      const invoice = await InvoiceService.prepareFromOrder({
        orderId,
        createdBy: session.fullName || 'system',
      });
      return NextResponse.json({ ok: true, data: invoice });
    }

    if (action === 'consolidate') {
      if (!['ROLE_OWNER', 'ROLE_MANAGER'].includes(session.role as string)) {
        return NextResponse.json({ ok: false, error: 'Không có quyền' }, { status: 403 });
      }
      const { date } = body;
      // Mặc định hôm nay (giờ VN)
      const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
      const result = await InvoiceService.consolidateDay({
        date: targetDate,
        createdBy: session.fullName || 'system',
      });
      return NextResponse.json({ ok: true, data: result });
    }

    return NextResponse.json({ ok: false, error: 'Action không hợp lệ' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
