import { NextRequest, NextResponse } from 'next/server';
import { CashboxService } from '@/services/order.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { db, cashboxSessions } from '@/db';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);

    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId') || undefined;
    // Chống nhìn/chạm két người khác: CASHIER luôn bị ép về chính mình.
    const cashierId =
      session.role === 'ROLE_CASHIER' ? session.actorId : searchParams.get('cashierId');

    if (cashierId) {
      // Lấy phiên két tiền hiện đang mở của thu ngân
       const activeSession = await CashboxService.getActiveSession(cashierId, warehouseId);
      return NextResponse.json({
        success: true,
        data: activeSession,
      });
    }

    // Liệt kê danh sách các phiên cho quản lý (CASHIER chỉ thấy của mình).
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;

    const sessions = await CashboxService.listSessions({
      cashierId: session.role === 'ROLE_CASHIER' ? session.actorId : undefined,
      warehouseId,
      limit,
    });
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
     // Chống nhìn/chạm két người khác: CASHIER luôn bị ép về chính mình.
     const effCashierId = userRole === 'ROLE_CASHIER' ? session.actorId : cashierId || session.actorId;
    const openingAmount = Number(openingCash ?? 0);
    const closingAmount = Number(closingCashActual);

    const openingInvalid =
      openingCash === null ||
      typeof openingCash === 'boolean' ||
      (typeof openingCash === 'string' && openingCash.trim() === '') ||
      !Number.isFinite(openingAmount) ||
      openingAmount < 0;
    const closingInvalid =
      closingCashActual === null ||
      typeof closingCashActual === 'boolean' ||
      (typeof closingCashActual === 'string' && closingCashActual.trim() === '') ||
      !Number.isFinite(closingAmount) ||
      closingAmount < 0;

    if (action === 'OPEN' && openingInvalid) {
      return NextResponse.json({ success: false, error: 'Tiền đầu ca không hợp lệ.' }, { status: 400 });
    }
    if (action === 'CLOSE' && closingInvalid) {
      return NextResponse.json({ success: false, error: 'Tiền thực đếm không hợp lệ.' }, { status: 400 });
    }

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
         openingCash: openingAmount,
         notes,
         audit: {
           actorRole: userRole,
           actorId: session.actorId,
           details: `Mở két tiền ca làm việc: Thu ngân ${effCashierId}, tiền đầu ca: ${openingAmount} đ`,
         },
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

      // Chống chốt két người khác: CASHIER chỉ được chốt đúng phiên OPEN của mình.
       if (userRole === 'ROLE_CASHIER') {
         const mine = await db
           .select({ id: cashboxSessions.id })
           .from(cashboxSessions)
           .where(
             and(
               eq(cashboxSessions.id, sessionId),
               eq(cashboxSessions.cashierId, session.actorId)
             )
           )
           .limit(1);
         if (mine.length === 0) {
          return NextResponse.json(
            { success: false, code: 'FORBIDDEN', error: 'Bạn chỉ được chốt két ca của chính mình.' },
            { status: 403 }
          );
        }
      }

       const result = await CashboxService.closeSession({
         sessionId,
         closingCashActual: closingAmount,
         notes,
         audit: {
           actorRole: userRole,
           actorId: session.actorId,
         },
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

