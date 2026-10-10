import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { PrintOrderService } from '@/services/print-order.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER'] as UserRole[];

/** GET /api/owner/print-orders - danh sách lệnh in (chỉ chủ). */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { searchParams } = new URL(req.url);
    const data = await PrintOrderService.list({
      status: searchParams.get('status') || undefined,
      actorRole: session.role,
    });
    // Không bao giờ trả giá vốn cho non-owner - route này đã chặn ROLE_OWNER ở trên.
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/owner/print-orders - tạo lệnh in kèm giá vốn thỏa thuận (chỉ chủ). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const data = await PrintOrderService.create({
      editionId: body.editionId || undefined,
      productId: body.productId,
      quantityPlanned: body.quantityPlanned,
      unitCostAgreed: body.unitCostAgreed,
      note: body.note,
      actorRole: session.role,
      actorId: session.actorId,
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
