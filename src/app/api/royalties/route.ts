import { NextRequest, NextResponse } from 'next/server';
import { RoyaltyService } from '@/services/royalty.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole, resolveActorId } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// GET /api/royalties — danh sách (?lifecycle=ACTIVE)
// GET /api/royalties?id=<contractId> — chi tiết + quota + bảng nhuận bút
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const [quota, statement] = await Promise.all([
        RoyaltyService.quotaStatus(id),
        RoyaltyService.royaltyStatement(id),
      ]);
      return NextResponse.json({ success: true, data: { quota, statement } });
    }

    const lifecycle = searchParams.get('lifecycle') as any;
    if (lifecycle && !['ACTIVE', 'EXPIRED', 'TERMINATED'].includes(lifecycle)) {
      return NextResponse.json(
        { success: false, error: 'lifecycle chỉ chấp nhận ACTIVE, EXPIRED, TERMINATED.' },
        { status: 400 }
      );
    }
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 100;
    const list = await RoyaltyService.listContracts(lifecycle || undefined, limit);
    return NextResponse.json({ success: true, data: list });
  } catch (error: any) {
    return handleApiError(error);
  }
}

// POST /api/royalties { action: 'create' | 'terminate', ... }
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);

    const body = await req.json();
    const { action } = body;
    const userRole = session.role;

    if (action === 'create') {
      const {
        contractNumber, workId, licensorId, licensorName, royaltyRate,
        printQuota, advanceAmount, effectiveDate, expirationDate, createdBy, notes,
      } = body;
      if (!contractNumber || !workId || royaltyRate === undefined || !printQuota || !effectiveDate || !expirationDate) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã HĐ, tác phẩm, royalty_rate, print_quota hoặc thời hạn.' },
          { status: 400 }
        );
      }
      const result = await RoyaltyService.createContract({
        contractNumber,
        workId,
        licensorId,
        licensorName,
        royaltyRate: parseFloat(royaltyRate),
        printQuota: parseInt(printQuota, 10),
        advanceAmount: advanceAmount !== undefined ? parseFloat(advanceAmount) : 0,
        effectiveDate,
        expirationDate,
        // Chống mạo danh: strict ép người ký = session (bỏ createdBy client).
        createdBy: resolveActorId(session, createdBy),
        notes,
      });
      const effCreatedBy = resolveActorId(session, createdBy);
      await recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: effCreatedBy,
        resource: '/api/royalties',
        details: `Ký hợp đồng bản quyền ${contractNumber} (quota ${printQuota}, rate ${royaltyRate}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'terminate') {
      const { contractId, actorId, reason } = body;
      if (!contractId) {
        return NextResponse.json({ success: false, error: 'Thiếu mã hợp đồng (contractId).' }, { status: 400 });
      }
      // Chống mạo danh: strict ép người chấm dứt = session (bỏ actorId client).
      const effTerminateActor = resolveActorId(session, actorId);
      const result = await RoyaltyService.terminateContract(contractId, effTerminateActor, reason || '');
      await recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: effTerminateActor,
        resource: '/api/royalties',
        details: `Chấm dứt hợp đồng ${contractId}: ${reason}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}. Chỉ chấp nhận 'create', 'terminate'.` },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

