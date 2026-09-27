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
  return handle(req);
}

// Cron services thường chỉ gọi được GET cho nên hỗ trợ cả hai.
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { success: false, code: 'FORBIDDEN', error: 'Không được phép gọi safeguard.' },
      { status: 401 }
    );
  }
  return handle(req);
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  // Danh sách kho để bên gọi quét từng kho (xem giải thích giới hạn bên dưới).
  if (url.searchParams.get('list') === '1') {
    const all = await db.select({ code: warehouses.code, id: warehouses.id }).from(warehouses);
    return NextResponse.json({ success: true, data: { warehouses: all } });
  }

  // Ngày cần chốt. Mặc định = hôm qua giờ VN. Bên gọi truyền vào để quét được
  // cả những ngày đã LỠ TRÔT (cron chết mấy ngày), không chỉ hôm qua.
  const raw = (url.searchParams.get('date') || '').trim();
  if (raw && !isRealDate(raw)) {
    return NextResponse.json({
      success: false,
      code: 'BAD_DATE',
      error: `Ngày "${raw}" không hợp lệ. Cần dạng YYYY-MM-DD.`,
      // Phải là 4xx chứ không phải 200: bên gọi chỉ fail khi HTTP >= 400, nên trả
      // 200 kèm mã lỗi sẽ bị nuốt im lặng.
    },
    { status: 400 }
  );
  }

  return runSafeguard(url.searchParams.get('warehouse'), raw || undefined);
}

/** Ngày ở ranh giới tin cậy: đúng dạng VÀ là ngày có thật (chặn 2026-02-30). */
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * GIỚI HẠN CLOUDFLARE (đã gặp thật, không phải phỏng đoán): Worker chỉ được
 * dùng một hạn mức subrequest mỗi lần gọi. Lặp N kho trong một lần gọi
 * thì kho thứ vài trở đi sẽ chết với "Too many subrequests by single Worker
 * invocation" — và Local/Node KHÔNG có giới hạn này nên test ở máy vẫn xanh.
 *
 * Vì vậy: mỗi lần gọi chỉ xử lý MỘT kho MỘT ngày (`?warehouse=CODE&date=`),
 * còn vòng lặp quét hết kho × hết ngày do workflow đảm nhiệm (mỗi vòng là
 * một lần gọi riêng nên hết hạn mức mỗi vòng). Không có `warehouse` thì vẫn
 * quét hết — chỉ dùng khi chạy local.
 */
async function runSafeguard(onlyWarehouse?: string | null, onlyDate?: string) {
  const now = new Date();
  // Ngày nghiệp vụ hôm qua (theo giờ VN): chốt ngày QUÁ KHỎI, không phải hôm nay.
  // Giờ VN cố định UTC+7, không DST, nên trừ 24h rồi định dạng lại tương đương
  // trừ đúng một ngày lịch.
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const settleDate = onlyDate || yesterday;

  // Trừ 24h ra khỏi ngày đang chốt: hôm nay chưa xong, không được chốt hôm nay.
  const todayVN = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (settleDate >= todayVN) {
    return NextResponse.json({
      success: false,
      code: 'FUTURE_DATE',
      error: `Ngày "${settleDate}" chưa kết thúc (hôm nay giờ VN là ${todayVN}). Chỉ chốt ngày đã qua.`,
    },
    { status: 400 }
  );
  }

  const all = await db.select().from(warehouses);
  const target = onlyWarehouse
    ? all.filter((w) => w.code === onlyWarehouse || w.id === onlyWarehouse)
    : all;
  if (onlyWarehouse && target.length === 0) {
    return NextResponse.json({
      success: false,
      code: 'NOT_FOUND',
      error: `Không tìm thấy kho "${onlyWarehouse}".`,
    },
    { status: 404 }
  );
  }

  const shiftsClosed: string[] = [];
  const daysClosed: string[] = [];
  const errors: { warehouse: string; step: string; error: string }[] = [];
  // Ca quá giờ tồn đọng nhiều (cron chết lâu, sự cố DB) thì một lần gọi không
  // chịu nổi. ponytail: trần mỗi lần gọi; vì idempotent nên lần sau chạy tiếp,
  // và `truncated` báo ra để KHÔNG im lặng bỏ sót. Nâng lên nếu thực tế gặp.
  const MAX_SHIFTS = 5;
  const truncated: string[] = [];


  for (const wh of target) {
    // --- Bước 1: chốt các ca quá giờ của kho này ---
    try {
      const check = await CashboxService.getStaleOpenShiftCheck({
        warehouseId: wh.id,
        now,
      });
      for (const s of check.shifts || []) {
        if (shiftsClosed.length >= MAX_SHIFTS) {
          truncated.push(`${wh.code}:${s.sessionId}`);
          continue;
        }
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
      const existing = await DailySettlementService.getDayCloseRecord(wh.id, settleDate);
      if (!existing) {
        await DailySettlementService.closeDay({
          warehouseId: wh.id,
          date: settleDate,
          actorRole: 'ROLE_OWNER',
          actorId: 'CRON_SAFEGUARD',
          notes: 'Chốt ngày tự động bởi safeguard theo lịch.',
          autoCloseOpenShifts: true,
        });
        daysClosed.push(`${wh.code}:${settleDate}`);
      }
    } catch (e: any) {
      errors.push({ warehouse: wh.code, step: 'CLOSE_DAY', error: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    // Còn ca bị bỏ sót vì chạm trần = CHƯA xong. Báo hỏng thay vì báo xanh.
    success: errors.length === 0 && truncated.length === 0,
    data: {
      ranAt: now.toISOString(),
      businessDaySettled: settleDate,
      warehouses: target.length,
      // Cờ cho bên gọi biết đã quét HẾT kho hay mới một phần, để tự quét tiếp.
      partial: Boolean(onlyWarehouse),
      shiftsClosed,
      daysClosed,
      truncated,
      errors,
    },
  });
}
