import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { PrintOrderService } from '@/services/print-order.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER'] as UserRole[];

/** GET /api/owner/print-orders/[id] — chi tiết (chỉ chủ). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const data = await PrintOrderService.getById(decodeURIComponent(id || '').trim(), session.role);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** PATCH /api/owner/print-orders/[id] — sửa giá vốn/số lượng (chỉ chủ, có audit). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const data = await PrintOrderService.update(
      decodeURIComponent(id || '').trim(),
      {
        unitCostAgreed: body.unitCostAgreed,
        quantityPlanned: body.quantityPlanned,
        note: body.note,
        status: body.status,
      },
      session.role,
      session.actorId
    );
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
