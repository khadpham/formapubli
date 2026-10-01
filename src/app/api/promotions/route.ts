import { NextRequest, NextResponse } from 'next/server';
import { PromotionService } from '@/services/promotion.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Chương trình khuyến mại.
 * GET  /api/promotions
 * POST /api/promotions { name, isActive?, startsAt?, endsAt?, gifts:[{minSubtotal, productId, giftQuantity}] }
 *
 * Chỉ Chủ sở hữu / Quản lý cấu hình khuyến mại.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const items = await PromotionService.list();
    return NextResponse.json({ success: true, promotions: items, total: items.length });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const body = await req.json();
    const created = await PromotionService.create({
      name: body.name,
      isActive: body.isActive,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      gifts: Array.isArray(body.gifts) ? body.gifts : [],
    });

    await recordAuditLog({
      action: 'ADJUST_STOCK',
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/promotions',
      details: `Tạo chương trình khuyến mại ${created.id} — ${created.name}.`,
    });

    return NextResponse.json({ success: true, promotion: created }, { status: 201 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
