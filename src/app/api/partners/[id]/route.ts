import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { PartnerDebtService } from '@/services/partner-debt.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/partners/[id] — sửa hồ sơ đại lý (OWNER/MANAGER).
 * Body: bất kỳ trường nào trong { name, type, discountRate, address, phone,
 * email, taxCode, receiverName, shipNote, creditLimit, paymentDueDays,
 * paymentNote }. CK sửa ở đây chỉ đổi mặc định, không hồi tố phiếu cũ.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const routeParams = await params;
    const body = await req.json().catch(() => ({}));
    const allowed = [
      'name', 'type', 'discountRate', 'address', 'phone', 'email', 'taxCode',
      'receiverName', 'shipNote', 'creditLimit', 'paymentDueDays', 'paymentNote',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    const data: any = await PartnerDebtService.updateProfile({
      id: decodeURIComponent(routeParams.id || '').trim(),
      ...patch,
    });
    await recordAuditLog({
      action: 'PARTNER_UPDATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/partners',
      details: `Sửa hồ sơ ${data.code || data.id} (${Object.keys(patch).join(', ')}).`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
