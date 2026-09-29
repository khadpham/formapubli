import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { CashboxService, OrderService } from '@/services/order.service';
import { DailySettlementService } from '@/services/daily-settlement.service';
import { db, warehouses, idempotencyKeys, orders, cashboxSessions } from '@/db';
import { eq, like, sql } from 'drizzle-orm';

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

  // P2 sửa 2026-09-29: SO NGÀY CHƯA CHỐT. Ngày lỡ trôt sẽ trượt khỏi cửa sổ
  // BACK_DAYS sau 7 đêm rồi không ai hỏi nữa ⇒ workflow chuyển XANH trong khi
  // ngày đó chưa từng được chốt. Mất dữ liệu mặc áo thành công. Endpoint này
  // trả về MỌI ngày đã qua chưa có bản chốt, độc lập cửa sổ quét, để bên gọi
  // fail thật thay vì im lặng.
  if (url.searchParams.get('unclosed') === '1') {
    return listUnclosed(Number(url.searchParams.get('days') || 30));
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
 * Liệt kê mọi (kho × ngày) đã qua nhưng CHƯA có bản chốt trong N ngày gần nhất.
 * Bản chốt được ghi ở `idempotency_keys` với key `day-close:<kho>:<ngày>`.
 *
 * P2 sửa 2026-09-29: đây là chốt chặn chống "xanh giả". Một ngày lỡ trôt sẽ
 * trượt khỏi cửa sổ BACK_DAYS của workflow sau 7 đêm và không còn ai hỏi tới —
 * workflow xanh, ngày chưa từng được chốt. Danh sách này độc lập cửa sổ quét.
 *
 * Ngày tính theo giờ VN để khớp `settleDate` mà closeDay dùng. Cố tình không
 * lọc kho hội chợ: kho vật lý cũng phải chốt, và bỏ sót kho nào cũng là hỏng.
 */
async function listUnclosed(days: number) {
  const span = Math.max(1, Math.min(365, Math.trunc(days) || 30));
  const now = Date.now();
  // Cùng cách tính với settleDate: trừ N ngày rồi định dạng theo giờ VN.
  const d = (back: number) =>
    new Date(now - back * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const firstDay = d(span);
  const lastDay = d(1);

  const all = await db
    .select({ id: warehouses.id, code: warehouses.code, createdAt: warehouses.createdAt })
    .from(warehouses);
  const closedKeys = await db
    .select({ key: idempotencyKeys.key })
    .from(idempotencyKeys)
    .where(like(idempotencyKeys.key, 'day-close:%'));
  const closed = new Set(closedKeys.map((r) => r.key));

  // Ngày KHÔNG có phát sinh thì không cần chốt. Trước đây hàm này liệt kê mọi
  // (kho x ngày) nên kho tạo ngày 20 vẫn bị bắt chốt cho ngày 19, và ngày không
  // ai bán gì vẫn phải "chốt" — tức báo cáo xanh giả rồi lại đỏ.
  //
  // "Có phát sinh" = ngày đó kho đó có ít nhất MỘT dòng dữ liệu vận động:
  //   · orders.created_at        (bán, kể cả đơn chuyển khoản đang chờ tiền)
  //   · cashbox_sessions.opened_at (mở ca = có dòng tiền, kể cả 0 đơn)
  // substr(...,1,10) an toàn vì created_at có hai họ trong DB: 'YYYY-MM-DD HH:MM:SS'
  // (SQLite CURRENT_TIMESTAMP) và ISO 'YYYY-MM-DDTHH:MM:SSZ' — 10 ký tự đầu là
  // ngày ở cả hai, cùng lý do dùng LIKE 'YYYY-MM-DD%' ở daily-settlement.
  // Đây là endpoint chẩn đoán, gọi tay bằng ?unclosed=1, KHÔNG nằm trong
  // workflow nhiệm vụ tự động nên thêm 2 truy vấn là không đáng kể.
  const active = new Set<string>();
  const dayRange = (col: any) =>
    sql`${col} >= ${`${firstDay} 00:00:00`} AND ${col} <= ${`${lastDay} 23:59:59`}`;
  const orderDays = await db
    .select({ wh: orders.warehouseId, day: sql<string | null>`substr(${orders.createdAt}, 1, 10)` })
    .from(orders)
    .where(dayRange(orders.createdAt));
  const shiftDays = await db
    .select({ wh: cashboxSessions.warehouseId, day: sql<string | null>`substr(${cashboxSessions.openedAt}, 1, 10)` })
    .from(cashboxSessions)
    .where(dayRange(cashboxSessions.openedAt));
  for (const r of [...orderDays, ...shiftDays]) {
    if (r.wh && r.day) active.add(`${r.wh}::${r.day}`);
  }

  const unclosed: { warehouse: string; date: string }[] = [];
  let skippedNoActivity = 0;
  for (let back = span; back >= 1; back--) {
    const day = d(back);
    for (const w of all) {
      if (closed.has(`day-close:${w.id}:${day}`)) continue;
      // Kho chưa tồn tại vào ngày đó thì không thể có phát sinh.
      const born = w.createdAt ? String(w.createdAt).slice(0, 10) : null;
      if (born && born > day) { skippedNoActivity++; continue; }
      if (!active.has(`${w.id}::${day}`)) { skippedNoActivity++; continue; }
      unclosed.push({ warehouse: w.code, date: day });
    }
  }

  return NextResponse.json({
    // Còn ngày chưa chốt = CHƯA xong. Bên gọi fail thật, không báo xanh.
    success: unclosed.length === 0,
    data: {
      windowDays: span,
      firstDay,
      lastDay,
      warehouses: all.length,
      unclosed,
      // Số (kho x ngày) bị bỏ qua vì không có phát sinh — để nhìn thấy ngay
      // tại sao con số nhỏ hơn tổng, không phải quét thiếu.
      skippedNoActivity,
    },
  });
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
  // Số đơn PENDING hết hạn đã dọn ở bước 0 (báo ra để không im lặng).
  let pendingCleaned = 0;


  for (const wh of target) {
    // --- Bước 0: dọn đơn PENDING_CONFIRMATION đã HẾT HẠN (P2 sửa 2026-09-29) ---
    // Không có bước này thì một đơn chuyển khoản quầy hết hạn sau 30 phút
    // vẫn giữ dòng PENDING ⇒ chặn autoCloseSession (bước 1) ⇒ ca vẫn OPEN
    // ⇒ chặn closeDay (bước 2). Một đơn kẹt tê cả đường ống của kho này.
    try {
      const cleaned = await OrderService.cleanupExpiredPending();
      if (cleaned > 0) pendingCleaned += cleaned;
    } catch (e: any) {
      errors.push({ warehouse: wh.code, step: 'CLEANUP_PENDING', error: e?.message || String(e) });
    }

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
      // Số đơn PENDING hết hạn đã dọn — có thay đổi dữ liệu thật, báo ra.
      pendingCleaned,
      truncated,
      errors,
    },
  });
}
