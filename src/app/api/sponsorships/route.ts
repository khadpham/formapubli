import { NextRequest, NextResponse } from 'next/server';
import { SponsorshipService } from '@/services/sponsorship.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

/**
 * Bước 4 — Contract API Quỹ Tài trợ (INTERNAL, không VAT lúc nhận).
 * POST /api/sponsorships { action, ... }:
 * - CREATE_FUND: { sponsorName, amountReceived, quotaType:'CAPPED'|'OPEN', quotaLimit?, partnerId?, note? }
 * - DRAW: { fundId, editionId, warehouseId, quantity, note?, idempotencyKey? }
 * - CLOSE_FUND: { fundId }
 * GET /api/sponsorships → danh sách quỹ.
 * GET /api/sponsorships?fundId= → báo cáo đối soát 1 quỹ.
 * TAX bị chặn toàn bộ (quỹ thuộc Sổ Nội bộ).
 */
export async function GET(req: NextRequest) {
  try {
    const userRole = extractUserRole(req);
    if (userRole === 'ROLE_TAX') {
      return NextResponse.json({ success: false, error: 'Quỹ tài trợ thuộc Sổ Nội bộ.' }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const fundId = searchParams.get('fundId');
    if (fundId) {
      const statement = await SponsorshipService.getStatement(fundId);
      return NextResponse.json({ success: true, statement });
    }
    const funds = await SponsorshipService.list();
    return NextResponse.json({ success: true, funds });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Lỗi truy vấn quỹ' }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userRole = extractUserRole(req);
    const actorHeader = req.headers.get('x-formapubli-actor') || body.createdBy || body.drawnBy || userRole;
    if (userRole === 'ROLE_TAX') {
      return NextResponse.json({ success: false, error: 'Quỹ tài trợ thuộc Sổ Nội bộ.' }, { status: 403 });
    }

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
    const status = /Manager\/Owner|Kế toán thuế/.test(error.message || '') ? 403 : 400;
    return NextResponse.json({ success: false, error: error.message || 'Lỗi quỹ tài trợ' }, { status });
  }
}
