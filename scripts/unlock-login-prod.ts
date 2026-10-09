/**
 * Mở khóa đăng nhập bị khóa brute-force trên PRODUCTION.
 *
 * Xóa dòng khóa trong `login_attempt_buckets` (lớp DB bền vững — deploy lại
 * KHÔNG xóa được lớp này). Lớp in-memory theo isolate có thể còn giữ khóa tới
 * 15 phút: nếu sau khi chạy mà login vẫn 429 với thông điệp KHÁC (dạng
 * "Tài khoản X tạm thời bị khóa..." thay vì "Tài khoản hoặc IP...") thì đó là
 * lớp memory — deploy 1 bản mới để flush isolate, hoặc chờ hết 15 phút.
 *
 * CÁCH CHẠY (mặc định CHỈ XEM, không ghi):
 *   npx tsx scripts/unlock-login-prod.ts KHO-01
 * Thực hiện xóa (coordinator, đã có xác nhận của chủ):
 *   $env:ALLOW_PROD_WRITE='true'; $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/unlock-login-prod.ts KHO-01 --thuc-hien
 *
 * KHÔNG log PIN/giá trị secret. Chỉ in key + số fail + phút còn lại.
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const staffId = `${process.argv[2] || ''}`.trim();
if (!staffId) {
  console.error('Thiếu mã NV. Ví dụ: npx tsx scripts/unlock-login-prod.ts KHO-01');
  process.exit(1);
}
const DO_IT = process.argv.includes('--thuc-hien');
const targetUrl = env.TURSO_DATABASE_URL;

async function main() {
  requireExplicitTarget(targetUrl);
  const db = createClient({ url: targetUrl, authToken: env.TURSO_AUTH_TOKEN });
  const staffKey = `staff:${staffId.toLowerCase()}`;
  const now = Date.now();

  const staffRows = (
    await db.execute({ sql: 'SELECT `key`, fails, locked_until FROM login_attempt_buckets WHERE `key` = ?', args: [staffKey] })
  ).rows as any[];
  const ipRows = (
    await db.execute('SELECT `key`, fails, locked_until FROM login_attempt_buckets WHERE `key` LIKE \'ip:%\'')
  ).rows as any[];
  const lockedIp = ipRows.filter((r) => Number(r.locked_until) > now);

  console.log('\n════ KHÓA HIỆN TẠI ════');
  if (staffRows.length === 0) {
    console.log(`  ${staffKey}: không có dòng khóa (lớp DB đã mở)`);
  } else {
    for (const r of staffRows) {
      const leftMin = Math.max(0, Math.ceil((Number(r.locked_until) - now) / 60000));
      console.log(`  ${r.key}: fails=${r.fails}, còn ~${leftMin} phút`);
    }
  }
  console.log(`  IP đang khóa: ${lockedIp.length} key`);

  if (!DO_IT) {
    console.log('\n🧪 CHỈ XEM — chưa xóa gì. Thêm --thuc-hien (+ ALLOW_PROD_WRITE) để mở khóa.');
    try {
      (db as any).close?.();
    } catch {
      /* bỏ qua lỗi đóng client native trên Windows */
    }
    process.exit(0);
  }

  requireProdWriteConsent(`xóa khóa đăng nhập của ${staffId} trên production`);
  await db.execute({ sql: 'DELETE FROM login_attempt_buckets WHERE `key` = ?', args: [staffKey] });
  console.log(`\n✅ Đã xóa khóa tài khoản ${staffKey}`);
  for (const r of lockedIp) {
    await db.execute({ sql: 'DELETE FROM login_attempt_buckets WHERE `key` = ?', args: [`${r.key}`] });
    console.log(`✅ Đã xóa khóa IP ${r.key}`);
  }
  const after = (
    await db.execute({ sql: 'SELECT COUNT(*) n FROM login_attempt_buckets WHERE `key` = ?', args: [staffKey] })
  ).rows as any[];
  console.log(`  Kiểm lại ${staffKey}: còn ${after[0]?.n ?? '?'} dòng (phải = 0)`);
  console.log('\nNhớ: lớp in-memory theo isolate có thể còn giữ khóa tới 15 phút.');
  try {
    (db as any).close?.();
  } catch {
    /* bỏ qua lỗi đóng client native trên Windows */
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
