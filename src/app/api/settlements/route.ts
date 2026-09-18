import { NextRequest, NextResponse } from 'next/server';
import { SettlementService } from '@/services/settlement.service';
import { ConsignmentService } from '@/services/consignment.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole, resolveRequestIdentity, resolveActorId, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// GET /api/settlements?statementId=CS-... — dư nợ + lịch sử thu 1 kỳ
// GET /api/settlements?partnerId=... — lịch sử thu theo đại lý
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_TAX']
    );
    const userRole = session.role;

    const { searchParams } = new URL(req.url);
    const statementId = searchParams.get('statementId');
    if (statementId) {
      const balance = await SettlementService.getBalance(statementId);
      if (userRole === 'ROLE_TAX') {
        const stmt = await ConsignmentService.getStatement(statementId);
        if (stmt.fiscalScope !== 'OFFICIAL_TAX') {
          throw new AuthError(403, 'Kỳ đối soát nội bộ, kế toán thuế không được xem.');
        }
      }
      const payments = await SettlementService.listPayments({ statementId, includeVoided: true });
      return NextResponse.json({ success: true, data: { ...balance, payments } });
    }

    const partnerId = searchParams.get('partnerId') || undefined;
    const includeVoided = searchParams.get('includeVoided') === 'true';
    const list = await SettlementService.listPayments({ partnerId, includeVoided });
    // Kế toán thuế chỉ thấy phiếu thuộc kỳ OFFICIAL_TAX.
    if (userRole === 'ROLE_TAX') {
      const officialIds = new Set(
        (await ConsignmentService.listStatements(undefined, undefined, 500))
          .filter((s) => s.fiscalScope === 'OFFICIAL_TAX')
          .map((s) => s.id)
      );
      return NextResponse.json({
        success: true,
        data: list.filter((p) => officialIds.has(p.statementId)),
      });
    }
    return NextResponse.json({ success: true, data: list });
  } catch (error: any) {
    return handleApiError(error);
  }
}

// POST /api/settlements { action: 'record' | 'void', ... }
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']
    );
    const userRole = session.role;

    const body = await req.json();
    const { action } = body;

    if (action === 'record') {
      const { statementId, amount, paymentMethod, reference, paidAt, receivedBy, cashboxSessionId, notes } = body;
      // Chống mạo danh: strict ép người thu = session (bỏ receivedBy client).
      const effReceivedBy = resolveActorId(session, receivedBy);
      if (!statementId || amount === undefined || !paymentMethod || !effReceivedBy) {
        return NextResponse.json(
          { success: false, error: 'Thiếu kỳ đối soát, số tiền, hình thức hoặc người thu.' },
          { status: 400 }
        );
      }
      const result = await SettlementService.recordPayment({
        statementId,
        amount: parseFloat(amount),
        paymentMethod,
        reference: reference || '',
        paidAt,
        receivedBy: effReceivedBy,
        cashboxSessionId,
        notes,
      });
      await recordAuditLog({
        action: 'SETTLEMENT_RECORD',
        actorRole: userRole,
        actorId: effReceivedBy,
        resource: '/api/settlements',
        details: `Thu ${amount.toLocaleString('vi-VN')} đ (${paymentMethod}) kỳ ${statementId}, còn nợ ${result.remaining.toLocaleString('vi-VN')} đ.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'void') {
      const { paymentId, actorId, reason } = body;
      if (!paymentId) {
        return NextResponse.json({ success: false, error: 'Thiếu mã phiếu thu (paymentId).' }, { status: 400 });
      }
      if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
        throw new AuthError(403, 'Chỉ Quản lý/Chủ được VOID phiếu thu.');
      }
      // Chống mạo danh: strict ép người VOID = session (bỏ actorId client).
      const effVoidActor = resolveActorId(session, actorId);
      const result = await SettlementService.voidPayment(paymentId, effVoidActor, reason || '');
      await recordAuditLog({
        action: 'SETTLEMENT_VOID',
        actorRole: userRole,
        actorId: effVoidActor,
        resource: '/api/settlements',
        details: `VOID phiếu ${paymentId}: ${reason} (kỳ ${result.statementId} còn nợ ${result.remaining.toLocaleString('vi-VN')} đ).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}. Chỉ chấp nhận 'record', 'void'.` },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

