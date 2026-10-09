/**
 * Đổi tên hiển thị các kho ký gửi đối tác → "Đại lý ..." (CHỮA DỨT ĐIỂM
 * việc gọi nhầm "kho" cho địa chỉ ký gửi).
 *
 * Mặc định CHỈ XEM (liệt kê id/code/name/type). Thực hiện đổi tên:
 *   $env:ALLOW_PROD_WRITE='true'; $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/rename-consignment-prod.ts --thuc-hien
 *
 * Quy tắc đổi tên (chỉ cột `name`, id/code/type giữ nguyên):
 *   "Kho Ký Gửi X" / "Kho ký gửi X" → "Đại lý X"
 *   Tên nào không khớp mẫu thì IN RA để chủ quyết tay, không đoán.
 *
 * KHÔNG log PIN/secret. Chỉ in tên kho.
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

const DO_IT = process.argv.includes('--thuc-hien');

function newNameFor(old: string): string | null {
  const trimmed = old.trim();
  if (/^đại lý\s+/i.test(trimmed)) return null; // đã đúng, giữ nguyên
  if (!/^kho\s+/i.test(trimmed)) return null; // mẫu lạ → chủ quyết tay
  // Bóc "Kho" rồi bóc "Ký gửi" (+ gạch nối): "Kho Ký gửi - X" → "Đại lý X".
  const rest = trimmed
    .replace(/^kho\s+/i, '')
    .replace(/^k[ýy]\s*g[ửửi]i?\s*-?\s*/i, '')
    .trim();
  if (!rest) return null;
  return `Đại lý ${rest}`;
}

async function main() {
  requireExplicitTarget(env.TURSO_DATABASE_URL);
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    const rows = (
      await db.execute(
        "SELECT id, code, name, warehouse_type FROM warehouses WHERE warehouse_type='CONSIGNMENT' OR id LIKE 'wh-consign-%' ORDER BY id"
      )
    ).rows as any[];

    console.log(`\n════ KHO KÝ GỬI (${rows.length}) ════`);
    const planned: Array<{ id: string; from: string; to: string }> = [];
    const manual: Array<{ id: string; name: string }> = [];
    for (const r of rows) {
      const to = newNameFor(`${r.name || ''}`);
      if (to) {
        planned.push({ id: `${r.id}`, from: `${r.name}`, to });
        console.log(`  ${r.id} [${r.warehouse_type}] "${r.name}" → "${to}"`);
      } else if (/^đại lý\s+/i.test(`${r.name || ''}`.trim())) {
        console.log(`  ${r.id} [${r.warehouse_type}] "${r.name}" (đã đúng)`);
      } else {
        manual.push({ id: `${r.id}`, name: `${r.name}` });
        console.log(`  ${r.id} [${r.warehouse_type}] "${r.name}" (MẪU LẠ — cần chủ quyết)`);
      }
    }

    if (!DO_IT) {
      console.log('\n🧪 CHỈ XEM — chưa đổi gì. Thêm --thuc-hien (+ ALLOW_PROD_WRITE) để thực hiện.');
      return;
    }
    requireProdWriteConsent(`đổi tên ${planned.length} kho ký gửi → "Đại lý ..." trên production`);
    for (const p of planned) {
      await db.execute({ sql: 'UPDATE warehouses SET name = ? WHERE id = ?', args: [p.to, p.id] });
      console.log(`  ✅ ${p.id} → "${p.to}"`);
    }
    const after = (
      await db.execute(
        "SELECT COUNT(*) n FROM warehouses WHERE (warehouse_type='CONSIGNMENT' OR id LIKE 'wh-consign-%') AND name LIKE 'Kho ký gửi%'"
      )
    ).rows as any[];
    console.log(`\n  Còn tên cũ "Kho ký gửi%": ${after[0]?.n ?? '?'} (phải = 0 trừ mẫu lạ)`);
    if (manual.length > 0) {
      console.log('  Mẫu lạ cần chủ quyết tay:');
      for (const m of manual) console.log(`    - ${m.id}: "${m.name}"`);
    }
  } finally {
    try {
      (db as any).close?.();
    } catch {
      /* bỏ qua lỗi đóng client native trên Windows */
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
