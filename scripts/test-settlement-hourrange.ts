/**
 * Báo cáo chốt ngày — KHUNG GIỜ ĐỘNG của dải giờ (`hourWindow`).
 *
 * Dải 24 cột giờ trên bản in từng in ra cả 24h với 16+ cột rỗng (quầy hội chợ
 * mở 9h đóng 18h thì 0h–8h và 19h–23h đều không có gì). Nay chỉ in khoảng có
 * việc thật, và nhịp ấy KHÔNG được hard-code: ngày hội chợ khác ngày thường.
 *
 * Bẫy chính của hàm này là MÚI GIỜ. Mọi cột thời gian trong DB là UTC, người
 * đọc dùng giờ Việt Nam (UTC+7, không DST). Ba cách làm sai, mỗi cái một bẫy:
 * lấy thẳng giờ UTC, cắt chuỗi `…[T ]HH:MM:SS` (họ ISO lẫn họ SQLite đều ra
 * giờ UTC), và so CHUỖI timestamp với nhau (DB có HAI họ nên so chuỗi ra sai
 * thứ tự). Bắt buộc đi qua `parseDbTimestamp` rồi mới cộng 7h — Case 1 cố tình
 * dùng chuỗi họ SQLite (có dấu cách, không `Z`) để bắt đúng lỗi này.
 *
 * Ngày nghiệp vụ = ngày VN: cùng quy ước với `test-settlement-hourly.ts`.
 * `now` luôn được truyền vào cố định để lần chạy nào cũng ra cùng kết quả.
 */
import assert from 'node:assert/strict';
import { hourWindow } from '../src/components/pos/DailyFairSettlementModal';

let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  assert.ok(cond, msg);
}

/** Timestamp họ SQLite (UTC, dấu cách, không `Z`) của mốc `vnHour` giờ VN trong `vnDay`. */
function sqliteStamp(vnDay: string, vnHour: number): string {
  return dbStamp(vnDay, vnHour).replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** Timestamp họ app (ISO) của mốc `vnHour` giờ Việt Nam trong ngày `vnDay`. */
function dbStamp(vnDay: string, vnHour: number): string {
  const utcHour = vnHour - 7; // giờ VN = giờ UTC + 7
  const d = new Date(`${vnDay}T00:00:00.000Z`);
  if (utcHour < 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    d.setUTCHours(utcHour + 24, 0, 0, 0);
  } else {
    d.setUTCHours(utcHour, 0, 0, 0);
  }
  return d.toISOString();
}

/** Dải 24 mốc giờ VN, chỉ các giờ trong `hours` có đơn. */
function hourlyWith(hours: number[], ordersEach = 3): { hour: number; orders: number; sales: number }[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: hours.includes(hour) ? ordersEach : 0,
    sales: hours.includes(hour) ? ordersEach * 100000 : 0,
  }));
}

const TODAY = '2026-10-01';
const PAST = '2026-09-30';

console.log('--- TEST BÁO CÁO NGÀY: KHUNG GIỜ ĐỘNG (hourWindow) ---');

// Trước hết: hai helper của test phải tự đúng, nếu không mọi assert dưới đây
// chỉ chứng minh test sai chứ không chứng minh code sai.
ok(
  sqliteStamp(TODAY, 9) === '2026-10-01 02:00:00',
  `helper sqliteStamp sai: ${sqliteStamp(TODAY, 9)} (phải là 02:00:00 UTC = 09:00 giờ VN)`
);
ok(
  dbStamp(TODAY, 6) === '2026-09-30T23:00:00.000Z',
  `helper dbStamp sai: ${dbStamp(TODAY, 6)} (phải là 23:00 UTC hôm trước = 06:00 giờ VN)`
);

// --- Case 1: GIỮA NGÀY, ca mở 9h chưa đóng, đơn 12h-13h, giờ hiện tại 14h ------
// Timestamp họ SQLite (dấu cách): đọc bằng `new Date()` thẳng sẽ ra 02:00, đọc
// giờ UTC sẽ ra 02 ⇒ start=2 ⇒ dải in sai 7 tiếng. Đây là bẫy chính.
{
  const w = hourWindow({
    sessions: [{ openedAt: sqliteStamp(TODAY, 9), closedAt: null }],
    hourly: hourlyWith([12, 13]),
    reportDate: TODAY,
    now: dbStamp(TODAY, 14),
  });
  ok(
    w.start === 9,
    `ca mở 09:00 giờ VN thì dải phải bắt đầu từ 9h, nhận start=${w.start} (2 = đọc nhầm giờ UTC)`
  );
  ok(
    w.end === 14,
    `đang bán (giờ hiện tại 14h, đơn tới 13h) thì dải phải kết thúc ở 14h, nhận end=${w.end}`
  );
  ok(w.end > w.start, `khung phải có ít nhất 1 cột: ${w.start}–${w.end}`);
}

// --- Case 2: NGÀY QUÁ KHỨ, ca 8h-20h, đơn tới 17h ⇒ kết thúc 21h --------------
{
  const w = hourWindow({
    sessions: [{ openedAt: dbStamp(PAST, 8), closedAt: dbStamp(PAST, 20) }],
    hourly: hourlyWith([10, 17]),
    reportDate: PAST,
    now: dbStamp(TODAY, 9), // "hiện tại" là hôm sau, không liên quan ngày in
  });
  ok(w.start === 8, `ngày quá khứ, ca mở 08:00 thì start=8, nhận ${w.start}`);
  ok(
    w.end === 21,
    `ngày quá khứ phải kéo tới 21h (giờ đóng ca 20h không phải mốc chặn), nhận end=${w.end}`
  );
}

// --- Case 3: KHÔNG CA KHÔNG ĐƠN ⇒ dải mặc định 8h-21h --------------------------
{
  const w = hourWindow({
    sessions: [],
    hourly: hourlyWith([]),
    reportDate: PAST,
    now: dbStamp(TODAY, 9),
  });
  ok(w.start === 8, `không có hoạt động nào thì start mặc định 8h, nhận ${w.start}`);
  ok(w.end === 21, `không có hoạt động nào thì end mặc định 21h, nhận ${w.end}`);
}

// --- Case 4: ĐƠN SỚM 6h ⇒ dải phải bắt đầu từ 6h, không cắt mất hoạt động ------
{
  const w = hourWindow({
    sessions: [{ openedAt: dbStamp(PAST, 6), closedAt: dbStamp(PAST, 11) }],
    hourly: hourlyWith([6, 7]),
    reportDate: PAST,
    now: dbStamp(TODAY, 9),
  });
  ok(w.start === 6, `bán từ 06:00 thì dải phải bắt đầu 6h, nhận ${w.start} (8 = cắt mất 2 cột có đơn)`);
  ok(w.end === 21, `ngày quá khứ, ca đóng 11h ⇒ end=21, nhận ${w.end}`);
}

// --- Case 5: HÔM NAY, chưa bán được gì ⇒ kết thúc ở giờ hiện tại -----------------
{
  const w = hourWindow({
    sessions: [],
    hourly: hourlyWith([]),
    reportDate: TODAY,
    now: dbStamp(TODAY, 14),
  });
  ok(w.start === 8, `hôm nay chưa bán gì thì start mặc định 8h, nhận ${w.start}`);
  ok(
    w.end === 14,
    `hôm nay chưa bán gì thì dải kết thúc ở giờ hiện tại (14h), nhận ${w.end}`
  );
}

// --- Case 6: end LUÔN LỚN HƠN start (ca mở 6h, đơn 6h, giờ hiện tại 6h) -----------
{
  const w = hourWindow({
    sessions: [{ openedAt: dbStamp(TODAY, 6), closedAt: null }],
    hourly: hourlyWith([6]),
    reportDate: TODAY,
    now: dbStamp(TODAY, 6),
  });
  ok(w.start === 6, `start=6, nhận ${w.start}`);
  ok(
    w.end === 7,
    `khi giờ hiện tại trùng giờ bắt đầu thì end phải = start + 1 (ít nhất 1 cột), nhận end=${w.end}`
  );
}

// --- Case 7: dữ liệu rác / thiếu không được làm hỏng dải in ---------------------
{
  const w = hourWindow({
    sessions: [{ openedAt: 'không-phải-ngày' }, null as any, { openedAt: null, closedAt: null }],
    hourly: [null as any, { hour: 0, orders: 'x' } as any],
    reportDate: TODAY,
    now: dbStamp(TODAY, 10),
  });
  ok(
    Number.isInteger(w.start) && Number.isInteger(w.end) && w.end > w.start,
    `timestamp hỏng và số đơn không phải số vẫn phải ra khung hợp lệ, nhận ${JSON.stringify(w)}`
  );
}

console.log(`\n=== KHUNG GIỜ ĐỘNG: ${checks} assertions PASS ===`);
