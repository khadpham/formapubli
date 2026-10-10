import { dailyOrderCounters } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Bộ cấp mã đơn - TÁCH RIÊNG khỏi `order.service.ts`.
 *
 * VÌ SAO tách: `discount-approval.service.ts` cũng phải cấp mã (mã của yêu cầu
 * duyệt CHÍNH LÀ mã của đơn sắp tạo - xem `createRequest`), mà
 * `order.service.ts` đã import `discount-approval.service.ts`. Gộp chung sẽ
 * thành vòng import, và vòng import trong ESM chỉ nổ khi đúng tầng - tức lúc
 * chạy thật chứ không phải lúc review.
 *
 * Hàm ở đây là CODE NGUYÊN VĂN từ `order.service.ts`, chuyển sang chứ không viết
 * lại: bản viết lại "gọn hơn" đã bỏ mất chốt tràn bề ngang và đổi thông báo lỗi.
 */

/** Ký tự base36: 0-9 rồi A-Z. Số thứ tự đơn trong ngày viết bằng hệ này. */
const BASE36_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Số nguyên → chuỗi base36 đệm `width` ký tự.
 *
 * Nhờ base36, số thứ tự tự động "tràn" sang chữ cái: 9999 = `23P`, 10000 = `23Q`.
 * Nên KHÔNG cần nhánh xử lý riêng cho giới hạn 9999 - 36^4 = 1.679.616 đơn/ngày.
 */
export function toBase36(n: number, width = 4): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`Số thứ tự đơn không hợp lệ: ${n}`);
  // TRÀN CHIỀU RỘNG: 36^4 = 1.679.616. Vượt mốc này thì chuỗi dài hơn `width` và mã
  // đơn vượt 13 ký tự - mà `order_code` là UNIQUE, nên lỗ hổng số ở đây còn hơn
  // là mã dài sai định dạng. Báo lỗi tường minh thay vì lặng lẽ sinh mã 14 ký tự.
  const cap = Math.pow(36, width);
  if (n >= cap) {
    throw new Error(
      `Vượt quá ${cap - 1} đơn/ngày (số thứ tự ${n}) - cần mở rộng bề ngang mã đơn.`
    );
  }
  let s = '';
  let v = Math.floor(n);
  while (v > 0) {
    s = BASE36_DIGITS[v % 36] + s;
    v = Math.floor(v / 36);
  }
  return s.padStart(width, '0');
}

/**
 * Cấp mã đơn 13 ký tự: `ORD` + `YYMMDD` + số thứ tự base36 4 ký tự.
 * Ví dụ `ORD2609290001`, và `ORD26092923P` khi vượt 9999.
 *
 * Số thứ tự lấy bằng MỘT câu `UPDATE ... RETURNING` ngay trong transaction đang
 * tạo đơn. Câu đó nguyên tử ở tầng DB nên hai máy POS ở hội chợ không thể nhận
 * trùng số - đây là lý do bộ đếm phải nằm ở DB chứ không đếm ở máy. Nếu insert
 * đơn sau đó hỏng (thiếu tồn, trùng idempotency) thì transaction rollback và số
 * đó được dùng lại, không để lại lỗ hổng.
 *
 * Phải giữ tiền tố `ORD`: `compactOrderCode` dùng nó để nhận diện mã và lấy 8
 * ký tự cuối cho nội dung QR chuyển khoản. Bỏ tiền tố thì nội dung đó rơi về
 * nhánh hash, đối soát tự động theo nội dung sẽ có nguy cơ trùng.
 */
export async function allocateOrderCode(tx: any, day: string): Promise<string> {
  const yymmdd = day.replace(/-/g, '').slice(2); // '2026-09-29' -> '260929'
  // `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` qua API bảng của Drizzle.
  // Câu lệnh này NGUYÊN TẢ ở tầng DB: hai phiên chạy song song không thể nhận
  // cùng một `last_seq` (giống `UPDATE ... RETURNING` nhưng tự tạo dòng ngày đầu).
  const rows = await tx
    .insert(dailyOrderCounters)
    .values({ day, lastSeq: 1 })
    .onConflictDoUpdate({
      target: dailyOrderCounters.day,
      set: { lastSeq: sql`${dailyOrderCounters.lastSeq} + 1` },
    })
    .returning({ lastSeq: dailyOrderCounters.lastSeq });

  const seq = Number(rows?.[0]?.lastSeq ?? 0);
  if (!seq || seq < 1) {
    throw new Error('Không cấp được số thứ tự đơn - kiểm tra bảng daily_order_counters.');
  }
  return `ORD${yymmdd}${toBase36(seq, 4)}`;
}

/**
 * Đúng 13 ký tự `ORD` + `YYMMDD` + base36 không?
 *
 * Dùng để KHÔNG lấy mã của yêu cầu duyệt CŨ (sinh ở máy thu ngân, 29 ký tự
 * `ORD-20261002-BFC3DCBC00CB7738`) làm `orders.order_code`. Yêu cầu cũ chỉ sống
 * 5 phút nên sau khi deploy gần như không còn, nhưng "gần như" không phải "không":
 * một yêu cầu treo đúng lúc deploy sẽ sinh ra đơn có mã 29 ký tự lọt vào cột
 * UNIQUE - và mọi báo cáo sau đó phải chịu hai định dạng mã.
 */
export function isPosOrderCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && /^ORD\d{6}[0-9A-Z]{4}$/.test(code);
}
