/**
 * Xóa khóa brute-force DB giữa các suite kiểm thử.
 *
 * Mỗi suite là một tiến trình mới (Map memory trước đây tự reset theo tiến
 * trình) — nhưng buckets DB dùng chung file nên fails/IP tích lũy qua các
 * suite và khóa oan suite chạy sau. Script này CHẠY TRONG TIẾN TRÌNH CON
 * RIÊNG (thoát ngay → handle file được giải phóng, an toàn Windows EBUSY),
 * đọc DATABASE_URL do runner truyền, không bao giờ làm fail chuỗi (exit 0).
 */
import { createClient } from '@libsql/client';

async function main() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes('formapubli_test')) {
    console.error('clear-login-buckets: chỉ chạy trên DB test.');
    process.exit(0);
  }
  try {
    const c = createClient({ url: dbUrl });
    try {
      await c.execute('DELETE FROM login_attempt_buckets');
    } catch {
      // Bảng chưa có → không có gì để xóa.
    }
    await (c.close() as unknown as Promise<void>);
  } catch {
    // Best-effort.
  }
  process.exit(0);
}

main();
