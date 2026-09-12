/**
 * Chốt chặn an toàn dùng chung cho mọi script test.
 *
 * Mọi suite test PHẢI gọi assertIsolatedTestDb() trước khi chạm DB.
 * Nếu DATABASE_URL không trỏ vào formapubli_test.db -> thoát ngay,
 * để không một dòng test nào lọt vào formapubli.db production.
 */
export function assertIsolatedTestDb(suiteName: string): void {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes('formapubli_test')) {
    console.error(
      `⛔ REFUSED [${suiteName}]: chỉ chạy trên formapubli_test.db ` +
        `(DATABASE_URL hiện tại: '${dbUrl || '(trống -> formapubli.db production)'}'). ` +
        `Hãy chạy qua npm run test:isolated.`
    );
    process.exit(2);
  }
}
