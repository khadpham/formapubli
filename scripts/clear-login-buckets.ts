/**
 * Xóa khóa brute-force DB + leases phiên giữa các suite kiểm thử.
 *
 * Mỗi suite là một tiến trình mới (Map memory trước đây tự reset theo tiến
 * trình) — nhưng buckets DB và active_sessions dùng chung file nên fails/IP
 * và lease 10 phút tích lũy qua các suite, khóa oan (429/403) suite chạy sau.
 * Script này CHẠY TRONG TIẾN TRÌNH CON RIÊNG (thoát ngay → handle file được
 * giải phóng, an toàn Windows EBUSY), đọc DATABASE_URL do runner truyền,
 * không bao giờ làm fail chuỗi (exit 0).
 * S-01: leases là cùng một loại state liên-suite nên dọn chung tại đây thay
 * vì bắt từng suite tự logout (vẫn giữ logout hygiene trong suite vì đó cũng
 * là hành vi nghiệp vụ cần kiểm).
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
    try {
      await c.execute('DELETE FROM active_sessions');
    } catch {
      // DB cũ chưa có migration S-01 → không có gì để xóa.
    }
    await (c.close() as unknown as Promise<void>);
  } catch {
    // Best-effort.
  }
  process.exit(0);
}

main();
