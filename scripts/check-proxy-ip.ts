// Script CHI ĐỌC — không dùng requireProdWriteGuard vì không ghi gì cả.
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  })
);

async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

  const cols = (await db.execute(`PRAGMA table_info(login_attempt_buckets)`)).rows;
  console.log('Cot bang:', (cols as any[]).map((c) => c.name).join(', '));

  const rows = (await db.execute(`SELECT * FROM login_attempt_buckets`)).rows;
  console.log(`Tong so bucket dang luu: ${rows.length}`);
  if (!rows.length) {
    console.log('(Chua co bucket nao -> chua co ai thu dang nhap sai tren production)');
    console.log('\n=> KHONG the ket luan tu du lieu bucket. Can kiem bang request that.');
    return;
  }
  // KHONG in goc: khoa co the chua ten nguoi dung. Chi tach phan IP de kiem.
  const ips = new Set<string>();
  for (const r of rows as any[]) {
    const k = String(r.key);
    const m = k.match(/(ip[:|_-]?)(\d+\.\d+\.\d+\.\d+)/i) || k.match(/(\d+\.\d+\.\d+\.\d+)/);
    ips.add(m ? m[1] : 'KHONG-TIM-THAY-IP');
  }
  console.log(`So IP phan biet duoc: ${ips.size}`);
  console.log('Gia tri IP tim thay:', Array.from(ips).join(', '));
  if (ips.has('127.0.0.1')) {
    console.log('\nCo bucket 127.0.0.1. Kiem tra xem no CO PHAI LICH SU (cu) hay dang xay ra:');
    const loopback = (await db.execute(
      `SELECT updated_at FROM login_attempt_buckets WHERE key LIKE '%127.0.0.1%' ORDER BY updated_at DESC LIMIT 3`
    )).rows;
    const real = (await db.execute(
      `SELECT updated_at FROM login_attempt_buckets WHERE key NOT LIKE '%127.0.0.1%' ORDER BY updated_at DESC LIMIT 3`
    )).rows;
    const fmt = (r: any) => (r && r.updated_at ? String(r.updated_at) : '(khong co)');
    console.log('  127.0.0.1       :', (loopback as any[]).map(fmt).join(' | ') || '(khong co)');
    console.log('  IP that         :', (real as any[]).map(fmt).join(' | ') || '(khong co)');
    console.log('  => Neu IP that MOI HON 127.0.0.1 thi 127.0.0.1 la lich su, hien tai van OK.');
  } else {
    console.log('\n✅ IP that duoc ghi => TRUST_PROXY hoat dong dung, khong co IP dung chung.');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
