import { NextRequest, NextResponse } from 'next/server';
import { SponsorshipService } from '@/services/sponsorship.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Bước 4 — Contract API Quỹ Tài trợ (INTERNAL, không VAT lúc nhận).
 * POST /api/sponsorships { action, ... }:
 * - CREATE_FUND: { sponsorName, amountReceived, quotaType:'CAPPED'|'OPEN', quotaLimit?, partnerId?, note? }
 * - DRAW: { fundId, editionId, warehouseId, quantity, note?, idempotencyKey? }
 * - CLOSE_FUND: { fundId }
 * GET /api/sponsorships → danh sách quỹ.
 * GET /api/sponsorships?fundId= → báo cáo đối soát 1 quỹ.
 * P1b: Default-Deny, chỉ ROLE_OWNER & ROLE_MANAGER (TAX/CASHIER/WAREHOUSE bị chặn 403).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { searchParams } = new URL(req.url);
    const fundId = searchParams.get('fundId');
    if (fundId) {
      const statement = await SponsorshipService.getStatement(fundId);
      return NextResponse.json({ success: true, statement });
    }
    const funds = await SponsorshipService.list();
    return NextResponse.json({ success: true, funds });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const body = await req.json();
    const userRole = session.role;
    const actorHeader = session.actorId;

    if (body.action === 'CREATE_FUND') {
      const result = await SponsorshipService.createFund({
        sponsorName: body.sponsorName,
        amountReceived: parseFloat(body.amountReceived),
        quotaType: body.quotaType,
        quotaLimit: body.quotaLimit !== undefined ? parseFloat(body.quotaLimit) : undefined,
        partnerId: body.partnerId,
        createdBy: actorHeader,
        note: body.note,
        actorRole: userRole,
      });
      recordAuditLog({
        action: 'FUND_CREATED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/sponsorships', details: `Mở quỹ ${result.fundCode} (${body.sponsorName}, nhận ${body.amountReceived}đ, ${body.quotaType}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'DRAW') {
      const result = await SponsorshipService.draw({
        fundId: body.fundId,
        editionId: body.editionId,
        warehouseId: body.warehouseId,
        quantity: parseInt(body.quantity ?? 0, 10),
        drawnBy: actorHeader,
        note: body.note,
        idempotencyKey: body.idempotencyKey,
        actorRole: userRole,
      });
      if (!result.isDuplicate) {
        recordAuditLog({
          action: 'FUND_DRAWN', actorRole: userRole, actorId: actorHeader,
          resource: '/api/sponsorships', details: `Rút quỹ ${body.fundId}: ${body.quantity} cuốn ${body.editionId} (đơn ${result.orderCode}).`,
        });
      }
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'CLOSE_FUND') {
      const result = await SponsorshipService.closeFund(body.fundId, userRole);
      recordAuditLog({
        action: 'FUND_CLOSED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/sponsorships', details: `Đóng quỹ ${body.fundId}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: 'action không hợp lệ (CREATE_FUND | DRAW | CLOSE_FUND).' },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

