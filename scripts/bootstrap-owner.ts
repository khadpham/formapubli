/**
 * BOOTSTRAP OWNER MỘT LẦN — tạo tài khoản OWNER đầu tiên cho DB trống.
 *
 * Vấn đề: DB production mới (Turso/file mới) chưa có staff nào, strict mode
 * chặn mọi fallback -> không ai đăng nhập được. Script này lấp đúng lỗ đó.
 *
 * Chạy (KHÔNG commit PIN vào git, truyền qua env shell):
 *   # PowerShell
 *   $env:DATABASE_URL="libsql://...turso.io"; $env:DATABASE_AUTH_TOKEN="..."; $env:BOOTSTRAP_OWNER_PIN="..."; npx tsx scripts/bootstrap-owner.ts
 *   # bash
 *   DATABASE_URL="libsql://..." DATABASE_AUTH_TOKEN="..." BOOTSTRAP_OWNER_PIN="..." npx tsx scripts/bootstrap-owner.ts
 *
 * Fail-closed:
 * - Thiếu DATABASE_URL hoặc BOOTSTRAP_OWNER_PIN (4-64 ký tự) -> từ chối.
 * - Đã có BẤT KỲ staff nào -> từ chối (dùng UI reset PIN thay vì chạy lại).
 * - Xong việc PHẢI unset BOOTSTRAP_OWNER_PIN khỏi shell/env.
 */
import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import { hashStaffPasscodeV2 } from '../src/lib/auth-session';

async function main() {
  const dbUrl = `${process.env.DATABASE_URL || ''}`.trim();
  const pin = `${process.env.BOOTSTRAP_OWNER_PIN || ''}`.trim();
  const staffId = `${process.env.BOOTSTRAP_OWNER_ID || 'ADMIN-01'}`.trim();
  const fullName = `${process.env.BOOTSTRAP_OWNER_NAME || 'Chủ Quản Lý'}`.trim();

  if (!dbUrl) {
    console.error('REFUSED: thiếu DATABASE_URL (vd: libsql://...turso.io hoặc file:formapubli.db).');
    process.exit(1);
  }
  if (pin.length < 4 || pin.length > 64) {
    console.error('REFUSED: BOOTSTRAP_OWNER_PIN phải 4-64 ký tự (đồng chuẩn PIN quầy).');
    process.exit(1);
  }
  if (!staffId) {
    console.error('REFUSED: BOOTSTRAP_OWNER_ID trống.');
    process.exit(1);
  }

  const client = createClient({ url: dbUrl, authToken: process.env.DATABASE_AUTH_TOKEN });

  const existing = await client.execute('SELECT COUNT(*) AS n FROM staff_accounts');
  const count = Number((existing.rows[0] as Record<string, unknown>)?.n || 0);
  if (count > 0) {
    console.error(`REFUSED: DB đã có ${count} tài khoản — dùng UI Cài đặt để reset PIN, không chạy bootstrap.`);
    process.exit(1);
  }

  const salt = crypto.randomUUID();
  const passcodeHash = await hashStaffPasscodeV2(pin, salt);
  await client.execute({
    sql: 'INSERT INTO staff_accounts (staff_id, full_name, role, passcode_hash, salt, is_active, session_version) VALUES (?, ?, ?, ?, ?, 1, 1)',
    args: [staffId, fullName, 'ROLE_OWNER', passcodeHash, salt],
  });

  console.log(`OK: đã tạo OWNER ${staffId} (${fullName}).`);
  console.log('1. UNSET ngay BOOTSTRAP_OWNER_PIN khỏi shell/env.');
  console.log('2. Đăng nhập bằng PIN vừa đặt, vào Cài đặt tạo thêm tài khoản.');
  console.log('3. Đổi PIN OWNER sang mã riêng sau lần đăng nhập đầu.');
}

main().catch((err) => {
  console.error('Bootstrap thất bại:', err?.message || err);
  process.exit(1);
});
