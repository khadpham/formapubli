/**
 * POST /api/invoices/[id]/push - Đẩy hóa đơn sang MS-Invoice
 * POST /api/invoices/[id]/sync - Đồng bộ trạng thái (kế toán ký xong)
 * Body sync: { status: 'SIGNED' | 'REJECTED', pdfUrl?, certSn? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { MSInvoiceService, isMockMode } from '@/services/msinvoice.service';
import { requireSessionRole } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_TAX']);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === 'push' || !action) {
      const result = await MSInvoiceService.pushInvoice(id);
      return NextResponse.json({
        ok: true,
        data: result,
        mockMode: isMockMode(),
        note: isMockMode() ? 'Chưa cấu hình MSINVOICE_* - đang chạy mock mode' : undefined,
      });
    }

    if (action === 'sync') {
      const { status, pdfUrl, certSn } = body;
      if (!['SIGNED', 'REJECTED'].includes(status)) {
        return NextResponse.json({ ok: false, error: 'Status không hợp lệ' }, { status: 400 });
      }
      await MSInvoiceService.syncStatus(id, status, { pdfUrl, certSn });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'Action không hợp lệ' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
