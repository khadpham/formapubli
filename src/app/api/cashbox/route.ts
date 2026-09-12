import { NextRequest, NextResponse } from 'next/server';
import { CashboxService } from '@/services/order.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cashierId = searchParams.get('cashierId');
    const userRole = extractUserRole(req);

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
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi truy vấn két tiền' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, warehouseId, cashierId, openingCash, sessionId, closingCashActual, notes } = body;
    const userRole = extractUserRole(req);

    if (action === 'OPEN') {
      if (!warehouseId || !cashierId) {
        return NextResponse.json(
          { success: false, error: 'Thiếu kho (warehouseId) hoặc thu ngân (cashierId).' },
          { status: 400 }
        );
      }

      const result = await CashboxService.openSession({
        warehouseId,
        cashierId,
        openingCash: openingCash ? parseFloat(openingCash) : 0,
        notes,
      });

      recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: cashierId,
        resource: '/api/cashbox',
        details: `Mở két tiền ca làm việc: Thu ngân ${cashierId}, tiền đầu ca: ${openingCash || 0} đ`,
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
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi xử lý phiên két tiền' },
      { status: 400 }
    );
  }
}
