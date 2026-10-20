import { NextRequest, NextResponse } from 'next/server';
import { MSInvoiceService } from '@/services/msinvoice.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/invoices/ms-list?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Mirror danh sách hóa đơn từ MS-Invoice + trạng thái đồng bộ với ERP.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_TAX']);
    const { searchParams } = new URL(req.url);
    const now = new Date(Date.now() + 7 * 3600 * 1000);
    const to = searchParams.get('to') || now.toISOString().slice(0, 10);
    const fromDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const from = searchParams.get('from') || fromDate.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ ok: false, error: 'Ngày phải dạng YYYY-MM-DD' }, { status: 400 });
    }
    const result = await MSInvoiceService.listRemote({ fromDate: from, toDate: to });
    return NextResponse.json({ ok: true, data: { ...result, from, to } });
  } catch (e: any) {
    // Loi xac thuc/phien phai tra dung ma (401/403) qua handleApiError;
    // chi loi goi MS-Invoice moi la 502.
    if (e?.name === 'AppError' || typeof e?.status === 'number') {
      return handleApiError(e);
    }
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
