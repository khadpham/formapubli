import { NextRequest, NextResponse } from 'next/server';
import { CashboxService } from '@/services/order.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);

    const { searchParams } = new URL(req.url);
    const cashierId = searchParams.get('cashierId');

    if (cashierId) {
      // Lấy phiên két tiền hiện đang mở của thu ngân
      const activeSession = await CashboxService.getActiveSession(cashierId);
      return NextResponse.json({
        success: true,
        data: activeSession,
      });
    }

    // Liệt kê danh sách các phiên cho quản lý
    const warehouseId = searchParams.get('warehouseId') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;

    const sessions = await CashboxService.listSessions({ warehouseId, limit });
    return NextResponse.json({
      success: true,
      data: sessions,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);

    const body = await req.json();
    const { action, warehouseId, cashierId, openingCash, sessionId, closingCashActual, notes } = body;
    const userRole = session.role;
    const effCashierId = cashierId || session.actorId;

    if (action === 'OPEN') {
      if (!warehouseId || !effCashierId) {
        return NextResponse.json(
          { success: false, error: 'Thiếu kho (warehouseId) hoặc thu ngân (cashierId).' },
          { status: 400 }
        );
      }

      const result = await CashboxService.openSession({
        warehouseId,
        cashierId: effCashierId,
        openingCash: openingCash ? parseFloat(openingCash) : 0,
        notes,
      });

      recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: effCashierId,
        resource: '/api/cashbox',
        details: `Mở két tiền ca làm việc: Thu ngân ${effCashierId}, tiền đầu ca: ${openingCash || 0} đ`,
      });

      return NextResponse.json({
        success: true,
        data: result.session,
        isExisting: result.isExisting,
      });
    }

    if (action === 'CLOSE') {
      if (!sessionId || closingCashActual === undefined) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã phiên (sessionId) hoặc số tiền thực đếm (closingCashActual).' },
          { status: 400 }
        );
      }

      const result = await CashboxService.closeSession({
        sessionId,
        closingCashActual: parseFloat(closingCashActual),
        notes,
      });

      recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: result.cashierId,
        resource: '/api/cashbox',
        details: `Chốt ca két tiền ${sessionId}: Thực đếm ${closingCashActual} đ, Kỳ vọng ${result.expectedCash} đ, Lệch: ${result.cashDiscrepancy} đ`,
      });

      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}. Chỉ chấp nhận 'OPEN' hoặc 'CLOSE'.` },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

