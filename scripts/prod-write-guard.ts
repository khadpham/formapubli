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
