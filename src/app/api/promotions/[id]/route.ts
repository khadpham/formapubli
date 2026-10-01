import { NextRequest, NextResponse } from 'next/server';
import { PromotionService } from '@/services/promotion.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Sửa chương trình khuyến mại.
 * PATCH /api/promotions/:id { name?, isActive?, startsAt?, endsAt?, gifts? }
 *
 * `gifts` nếu có thì THAY THẾ toàn bộ các dòng quà cũ (không trộn).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { id } = await ctx.params;
    const body = await req.json();

    const updated = await PromotionService.update(id, {
      name: body.name,
      isActive: body.isActive,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      warehouseId: body.warehouseId !== undefined ? body.warehouseId : undefined,
      gifts: Array.isArray(body.gifts) ? body.gifts : undefined,
    });

    await recordAuditLog({
      action: 'ADJUST_STOCK',
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/promotions',
      details: `Sửa chương trình khuyến mại ${updated.id}.`,
    });

    return NextResponse.json({ success: true, promotion: updated });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
