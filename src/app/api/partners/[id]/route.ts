import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { PartnerDebtService } from '@/services/partner-debt.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/partners/[id] — sửa chiết khấu cố định hợp đồng (OWNER/MANAGER).
 * Body: { discountRate: 0..1 }. Không hồi tố phiếu cũ.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const routeParams = await params;
    const body = await req.json().catch(() => ({}));
    const data = await PartnerDebtService.updateTerms({
      id: decodeURIComponent(routeParams.id || '').trim(),
      discountRate: Number(body.discountRate),
    });
    await recordAuditLog({
      action: 'PARTNER_UPDATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/partners',
      details: `Sửa CK cố định ${data.id} → ${Math.round(data.discountRate * 100)}%.`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
