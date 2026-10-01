/**
 * Chốt an toàn cho script GHI vào production.
 *
 * Nhiều script trong `scripts/` đọc thẳng `TURSO_*` từ `.env` nên CHẠY LÀ GHI
 * VÀO PRODUCTION, không cần làm gì thêm. Chạy nhầm là hỏng dữ liệu thật — đã có
 * một lần tôi gọi nhầm endpoint chốt ca và xoá mất dữ liệu trong ngày.
 *
 * Quy ước chung với `migrate-fresh.ts` (`ALLOW_REMOTE_MIGRATE`) và
 * `migrate-book-skus.ts` (`ALLOW_REMOTE_SKU_MIGRATION`): phải CỐ TÌNH bật cờ.
 * Thiếu cờ ⇒ script dừng ngay, chưa đụng gì.
 */

/** Đọc biến môi trường, không log giá trị bí mật. */
function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === 'true' || v === '1';
}

/**
 * Gọi ở ĐẦU mọi script ghi production. Ném lỗi nếu chưa bật cờ.
 * @param việc mô tả ngắn để người vô tình chạy hiểu mình đang làm gì.
 */
export function requireProdWriteConsent(việc: string) {
  if (!envFlag('ALLOW_PROD_WRITE')) {
    throw new Error(
      `TỪ CHỐI ghi vào production.\n` +
        `Việc sắp làm: ${việc}\n` +
        `Muốn thực hiện thì đặt: ALLOW_PROD_WRITE=true\n` +
        `Chỉ cần xem thì chạy với cờ XEM_TRUOC nếu script hỗ trợ.`
    );
  }
  console.log(`⚠️  ĐANG GHI VÀO PRODUCTION: ${việc}`);
  console.log('⚠️  Thao tác này không hoàn tác được.');
}

/**
 * Bắt buộc phải CHỈ ĐÍCH DATABASE trước khi ghi. Gọi SAU `requireProdWriteConsent`.
 *
 * VÌ SAO CẦN: các script đọc thẳng `TURSO_DATABASE_URL` từ `.env`, KHÔNG đọc
 * `process.env.DATABASE_URL`. Đã xảy ra đúng lỗi đó: tôi chạy "dry-run" với
 * `DATABASE_URL=file:formapubli_test.db`, tưởng script ép vào DB test, nhưng
 * `.env` vẫn trỏ `libsql://…` production ⇒ migration chạy lên production thật.
 * May là migration chỉ có CREATE/ALTER ADD nên không mất dữ liệu.
 *
 * `ALLOW_PROD_WRITE=true` KHÔNG đủ — bật cờ lúc muốn dry-run là cách tự lừa
 * mình dễ nhất. Thêm cờ thứ hai, phải gõ tay, và IN RA đích trước khi ghi.
 */
export function requireExplicitTarget(url: string) {
  const isLocal = url.startsWith('file:') || url.includes('.db');
  if (isLocal) {
    console.log(`🎯 Đích: DB LOCAL — ${url}`);
    return;
  }
  let host = '(không rõ)';
  try {
    host = new URL(url).host;
  } catch {
    /* giữ nguyên '(không rõ)' */
  }
  console.log(`\n🎯 Đích: DB TỪ XA — ${host}`);
  if (process.env.ALLOW_REMOTE_TARGET !== host) {
    throw new Error(
      `TỪ CHỐI: đích là DB từ xa (${host}), chưa xác nhận.\n` +
        `Đặt đúng tên host để chạy: ALLOW_REMOTE_TARGET=${host}\n` +
        `Kiểm tra lại bằng: ALLOW_REMOTE_TARGET=??? node scripts/<ten-script>.ts\n` +
        `Nếu bạn CHỈ ĐỊNH dry-run trên DB local, KHÔNG dùng cờ này — hãy sửa script để đọc DATABASE_URL.`
    );
  }
  console.log(`✅ Đã xác nhận đích từ xa: ${host}`);
}
