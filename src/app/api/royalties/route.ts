import { NextRequest, NextResponse } from 'next/server';
import { RoyaltyService } from '@/services/royalty.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

// GET /api/royalties — danh sách (?lifecycle=ACTIVE)
// GET /api/royalties?id=<contractId> — chi tiết + quota + bảng nhuận bút
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userRole = extractUserRole(req);

    if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
      return NextResponse.json(
        { success: false, error: 'Chỉ Quản lý/Chủ được xem sổ bản quyền & nhuận bút.' },
        { status: 403 }
      );
    }

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
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi truy vấn sổ bản quyền' },
      { status: 400 }
    );
  }
}

// POST /api/royalties { action: 'create' | 'terminate', ... }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const userRole = extractUserRole(req);
    const actorHeader = req.headers.get('x-formapubli-actor') || userRole;

    if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
      return NextResponse.json(
        { success: false, error: 'Chỉ Quản lý/Chủ được quản trị hợp đồng bản quyền.' },
        { status: 403 }
      );
    }

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
        createdBy: createdBy || actorHeader,
        notes,
      });
      recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: createdBy || actorHeader,
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
      const result = await RoyaltyService.terminateContract(contractId, actorId || actorHeader, reason || '');
      recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: actorId || actorHeader,
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
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi xử lý hợp đồng bản quyền' },
      { status: 400 }
    );
  }
}
