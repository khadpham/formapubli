import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { CashboxService } from '@/services/order.service';
import { DailySettlementService } from '@/services/daily-settlement.service';
import { db, warehouses } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * SAFEGUARD — chốt ca + chốt ngày TỰ ĐỘNG, không phụ thuộc thu ngân nhớ.
 *
 * VÌ SAO CẦN: trước đây cơ chế chốt tự động chỉ chạy khi có người MỞ app
 * (POS tự gọi GET /api/cashbox?check=stale-shifts rồi POST AUTO_CLOSE).
 * Thu ngân quên chốt ca rồi đóng máy = ca treo vô hạn, ngày không chốt, số
 * liệu sai. Endpoint này là đường gọi KHÔNG CẦN NGƯỜI.
 *
 * AN TOÀN:
 * - Chỉ chạy khi có `Authorization: Bearer <CRON_SECRET>`; so sánh constant-time.
 *   Thiếu secret trong môi trường thì fail-closed (401), KHÔNG mở cửa.
 * - Idempotent: chốt lại trả về bản ghi cũ, không ghi thêm. Ca đã chốt tay
 *   thì không ghi đè (autoCloseSession tự chặn).
 * - KHÔNG bịa tiền: ca không ai đếm thì closingCashActual = NULL và bản ghi đánh
 *   dấu cashVerification = 'UNVERIFIED' — đúng nguyên tắc đã chốt trước đây.
 * - Lỗi của một kho KHÔNG được làm hỏng các kho khác: báo cáo theo từng kho.
 */
function authorized(req: NextRequest): boolean {
  const secret = `${process.env.CRON_SECRET || ''}`.trim();
  if (!secret) return false; // fail-closed
  const header = `${req.headers.get('authorization') || ''}`.trim();
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  const given = header.slice(7).trim();
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'Không được phép gọi safeguard.' },
      { status: 401 }
    );
  }
  return runSafeguard();
}

// Cron services thường chỉ gọi được GET cho nên hỗ trợ cả hai.
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'Không được phép gọi safeguard.' },
      { status: 401 }
    );
  }
  return runSafeguard();
}

async function runSafeguard() {
  const now = new Date();
  // Ngày nghiệp vụ hôm qua (theo giờ VN): chốt ngày QUÁ KHỎI, không phải hôm nay.
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

  const all = await db.select().from(warehouses);
  const shiftsClosed: string[] = [];
  const daysClosed: string[] = [];
  const errors: { warehouse: string; step: string; error: string }[] = [];

  for (const wh of all) {
    // --- Bước 1: chốt các ca quá giờ của kho này ---
    try {
      const check = await CashboxService.getStaleOpenShiftCheck({
        warehouseId: wh.id,
        now,
      });
      for (const s of check.shifts || []) {
        try {
          await CashboxService.autoCloseSession({
            sessionId: s.sessionId,
            reason: 'CRON_SAFEGUARD',
            actorRole: 'ROLE_OWNER',
            actorId: 'CRON_SAFEGUARD',
            notes: 'Chốt tự động bởi safeguard theo lịch. Tiền mặt chưa được kiểm đếm.',
          });
          shiftsClosed.push(`${wh.code}:${s.sessionId}`);
        } catch (e: any) {
          errors.push({ warehouse: wh.code, step: 'AUTO_CLOSE_SHIFT', error: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      errors.push({ warehouse: wh.code, step: 'CHECK_STALE', error: e?.message || String(e) });
    }

    // --- Bước 2: chốt ngày nghiệp vụ đã qua nếu chưa có bản chốt ---
    try {
      const existing = await DailySettlementService.getDayCloseRecord(wh.id, yesterday);
      if (!existing) {
        await DailySettlementService.closeDay({
          warehouseId: wh.id,
          date: yesterday,
          actorRole: 'ROLE_OWNER',
          actorId: 'CRON_SAFEGUARD',
          notes: 'Chốt ngày tự động bởi safeguard theo lịch.',
          autoCloseOpenShifts: true,
        });
        daysClosed.push(`${wh.code}:${yesterday}`);
      }
    } catch (e: any) {
      errors.push({ warehouse: wh.code, step: 'CLOSE_DAY', error: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    data: {
      ranAt: now.toISOString(),
      businessDaySettled: yesterday,
      warehouses: all.length,
      shiftsClosed,
      daysClosed,
      errors,
    },
  });
}
