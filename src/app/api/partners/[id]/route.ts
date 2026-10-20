import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { PartnerDebtService } from '@/services/partner-debt.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { db } from '@/db';
import { partners, deliveryOrders } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/partners/[id] - sửa hồ sơ đại lý (OWNER/MANAGER).
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

/**
 * DELETE /api/partners/[id] - Xóa đối tác (OWNER/MANAGER).
 * Chặn nếu đã có phiếu xuất hàng liên quan.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const routeParams = await params;
    const id = decodeURIComponent(routeParams.id || '').trim();
    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu ID' }, { status: 400 });
    }

    // Kiểm tra tồn tại
    const rows = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy đối tác' }, { status: 404 });
    }
    const p: any = rows[0];

    // Chặn nếu đã có phiếu liên quan
    const related = await db.select().from(deliveryOrders).where(eq(deliveryOrders.partnerId, id)).limit(1);
    if (related.length > 0) {
      return NextResponse.json(
        { success: false, error: `Không xóa được: đã có ${related.length > 0 ? 'phiếu xuất hàng' : ''} liên quan đến đối tác này` },
        { status: 400 }
      );
    }

    await db.delete(partners).where(eq(partners.id, id));

    await recordAuditLog({
      action: 'PARTNER_DELETED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/partners',
      details: `Xóa đối tác ${p.code} - ${p.name}.`,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error);
  }
}
