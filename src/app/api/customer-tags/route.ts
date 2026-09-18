import { NextRequest, NextResponse } from 'next/server';
import { CustomerTagService, VALID_CUSTOMER_TAGS } from '@/services/customer-tag.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Bước 3 — Contract API phân tệp CRM.
 * GET /api/customer-tags?tags=TAG_SUBSCRIPTION,TAG_NEWSLETTER&match=any|all&limit=500
 * POST /api/customer-tags { action:'ASSIGN'|'UNASSIGN', customerId, tag }
 */
export async function GET(req: NextRequest) {
  try {
    // P1b: Default-Deny — bắt buộc session cookie hợp lệ.
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);
    const { searchParams } = new URL(req.url);
    const tags = (searchParams.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
    const match = (searchParams.get('match') || 'any') as 'any' | 'all';
    const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get('limit') || '500', 10) || 500));
    const list = await CustomerTagService.filterByTags(tags, match, limit);
    return NextResponse.json({ success: true, customers: list, total: list.length });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    // P1b: Default-Deny — TAX không có trong allowlist nên bị chặn 403 tại requireSessionRole.
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);
    const userRole = session.role;
    const actorHeader = session.actorId;

    const body = await req.json();

    if (body.action === 'ASSIGN') {
      const result = await CustomerTagService.assign(body.customerId, body.tag, userRole);
      if (!result.already) {
        await recordAuditLog({
          action: 'MUTATE_ORDER', actorRole: userRole, actorId: actorHeader,
          resource: '/api/customer-tags', details: `Gắn tag ${body.tag} cho khách ${body.customerId}.`,
        });
      }
      return NextResponse.json({ success: true, data: result });
    }
    if (body.action === 'UNASSIGN') {
      const result = await CustomerTagService.unassign(body.customerId, body.tag, userRole);
      await recordAuditLog({
        action: 'MUTATE_ORDER', actorRole: userRole, actorId: actorHeader,
        resource: '/api/customer-tags', details: `Gỡ tag ${body.tag} khỏi khách ${body.customerId}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }
    return NextResponse.json(
      { success: false, error: 'action không hợp lệ (ASSIGN | UNASSIGN).', validTags: [...VALID_CUSTOMER_TAGS] },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

