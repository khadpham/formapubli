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

    // CHECK CHỐT CA QUÁ GIỜ — rẻ, chỉ đọc, idempotent, KHÔNG ghi gì.
    // POS gọi mỗi lần mở app: GET /api/cashbox?check=stale-shifts&warehouseId=...
    // Câu hỏi: ca nào còn mở quá giờ chốt ngày, cần ai làm gì.
    //
    // TRIỂN KHAI (repo KHÔNG có cron/scheduler/instrumentation — không tự bịa):
    //   1) POS: gọi endpoint này mỗi lần mở app (và sau mỗi lần đóng app /
    //      quay lại foreground) cho từng kho bán tại quầy.
    //   2) Hằng ngày SAU cutoff, một cron/job của hạ tầng gọi, mỗi kho 1 lần:
    //        GET  /api/cashbox?check=stale-shifts&warehouseId=<id>   (để cảnh báo/kiểm tra)
    //        POST /api/cashbox  {action:'AUTO_CLOSE', sessionId}    (chỉ khi thật sự cần)
    //        POST /api/pos/daily-settlement {warehouseId, date, autoCloseOpenShifts:true}
    //      → chốt ngày idempotent, tự chốt các ca quá giờ (tiền mặt KHÔNG đếm,
    //        chênh lệch KHÔNG xác minh), từ chối nếu còn đơn chờ thanh toán.
    //   Job KHÔNG cần chạy đúng phút: endpoint tự tính quá giờ theo cutoff của
    //   từng kho, chạy muộn vẫn đúng.
    if (searchParams.get('check') === 'stale-shifts') {
      const data = await CashboxService.getStaleOpenShiftCheck({
        warehouseId,
        cashierId: cashierId || undefined,
        cutoff: searchParams.get('cutoff') || undefined,
      });
      return NextResponse.json({ success: true, data });
    }

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

    if (action === 'AUTO_CLOSE') {
      // Chỉ quản lý được chốt tự động. KHÔNG yêu cầu closingCashActual: nếu bắt
      // buộc nhập số tiền thì người dùng sẽ bịa ra một con số để qua chỗ này.
      if (userRole === 'ROLE_CASHIER') {
        return NextResponse.json(
          { success: false, code: 'FORBIDDEN', error: 'Chỉ quản lý mới được chốt ca tự động. Bạn cần đếm tiền thực tế và chốt ca của chính mình.' },
          { status: 403 }
        );
      }
      if (!sessionId) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã phiên (sessionId).' },
          { status: 400 }
        );
      }
      const result = await CashboxService.autoCloseSession({
        sessionId,
        notes,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        actorRole: userRole,
        actorId: session.actorId,
      });
      return NextResponse.json({ success: true, data: result });
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
      { success: false, error: `Hành động không hợp lệ: ${action}. Chỉ chấp nhận 'OPEN', 'CLOSE' hoặc 'AUTO_CLOSE'.` },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

