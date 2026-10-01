import { requireExplicitTarget } from './prod-write-guard';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

/**
 * CỔNG 3 — migration 0032: dựng lại `stock_balances` và `order_items`.
 *
 * ⚠️ ⚠️ CHƯA ĐƯỢC CHẠY. Chỉ chạy khi CẦN THẬT và có backup đã kiểm mở được.
 *
 * VÌ SAO NGUY HIỂM HƠN CÁC CỔNG TRƯỚC:
 * 0031 và 0031b chỉ CREATE/ALTER/UPDATE — hỏng thì chạy lại được, không mất
 * bảng. 0032 thì `DROP TABLE` rồi `RENAME`, 24 câu, KHÔNG transaction (Turso qua
 * HTTP không bọc được nhiều câu). Hỏng giữa chừng = mất bảng tồn kho / bảng đơn.
 *
 * ĐỦ ĐIỀU KIỆN TRƯỚC KHI CHẠY:
 *   1. Kho đóng, không ai đang bán.
 *   2. `scripts/backup-prod.ts` đã chạy và file backup MỞ ĐƯỢC kiểm thật.
 *   3. `apply-0031b-prod.ts` đã chạy xong (product_id đã có trên cả 4 bảng).
 *   4. Toàn bộ test suite xanh.
 *   5. Bạn đã duyệt riêng cho lần chạy này.
 *
 * CÁCH ĐỤT PHÒNG SỰ CỐ: file SQL để sẵn ở
 * `src/db/migrations/0032_sellable_goods.sql`. Nếu hỏng giữa chừng, câu lệnh
 * tiếp theo sẽ báo bảng `stock_balances__0032` không tồn tại ⇒ chạy lại script
 * an toàn, chỉ mất dữ liệu những bảng đã DROP.
 */

const SQL_FILE = path.resolve(process.cwd(), 'src/db/migrations/0032_sellable_goods.sql');

/** Tách theo `--> statement-breakpoint`, bỏ chunk comment-only. */
function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));
}

const targetUrl = process.env.DATABASE_URL || env.TURSO_DATABASE_URL;
const isDryRun = Boolean(process.env.DATABASE_URL);

async function main() {
  requireExplicitTarget(targetUrl);
  if (isDryRun) console.log('\n🧪 DRY-RUN: DB LOCAL, không đụng production.');

  const db = createClient({ url: targetUrl, authToken: isDryRun ? undefined : env.TURSO_AUTH_TOKEN });
  const rows = async (s: string, a?: any[]) =>
    (await db.execute({ sql: s, args: a || [] })).rows as any[];

  const count = async (t: string) => {
    try {
      return Number((await rows(`SELECT COUNT(*) n FROM \`${t}\``))[0]?.n || 0);
    } catch {
      return -1;
    }
  };

  console.log('\n════ TRẠNG THÁI TRƯỚC ════');
  const before = {
    stock_balances: await count('stock_balances'),
    order_items: await count('order_items'),
    editions: await count('editions'),
    orders: await count('orders'),
    inventory_ledger: await count('inventory_ledger'),
  };
  for (const [k, v] of Object.entries(before)) console.log(`  ${k}: ${v}`);

  // Điều kiện tiên quyết: phải chạy 0031b trước. Không có product_id thì câu
  // `COALESCE(product_id, edition_id)` vẫn chạy được, nhưng `product_id NOT
  // NULL` sẽ đúng vì COALESCE lấp. Vẫn kiểm để chắc không bỏ sót ý nghĩa.
  const nullProduct = await rows(
    `SELECT COUNT(*) n FROM \`order_items\` WHERE product_id IS NULL`
  );
  console.log(
    `  order_items thiếu product_id: ${nullProduct[0]?.n ?? 0}` +
      (Number(nullProduct[0]?.n || 0) > 0 ? '  ⚠️ chưa chạy 0031b' : '  ✅')
  );

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = splitStatements(sql);
  console.log(`\n════ CHẠY ${statements.length} CÂU ════`);

  for (let i = 0; i < statements.length; i++) {
    const s = statements[i];
    const head = s.replace(/\s+/g, ' ').slice(0, 62);
    try {
      await db.execute(s);
      console.log(`  ✓ ${i + 1}/${statements.length}  ${head}`);
    } catch (e: any) {
      console.error(`\n❌ DỪNG Ở CÂU ${i + 1}/${statements.length}: ${head}`);
      console.error(`   Lỗi: ${e?.message || e}`);
      console.error(
        `\n   Nếu bảng đã bị DROP thì dữ liệu cần khôi phục từ backup.\n` +
          `   Chạy lại script này sau khi khôi phục — các câu đã chạy là idempotent.`
      );
      process.exit(1);
    }
  }

  console.log('\n════ XÁC NHẬN ════');
  const after = {
    stock_balances: await count('stock_balances'),
    order_items: await count('order_items'),
    editions: await count('editions'),
    orders: await count('orders'),
    inventory_ledger: await count('inventory_ledger'),
  };
  for (const [k, v] of Object.entries(after)) {
    const b = (before as any)[k];
    console.log(`  ${k}: ${b} → ${v} ${v === b ? '✅' : '❌ ĐÃ ĐỔI'}`);
  }

  const nulls = await rows(
    `SELECT
       (SELECT COUNT(*) FROM order_items WHERE product_id IS NULL) a,
       (SELECT COUNT(*) FROM stock_balances WHERE product_id IS NULL) b`
  );
  console.log(`\n  order_items.product_id NULL    : ${nulls[0]?.a} ${Number(nulls[0]?.a || 0) === 0 ? '✅' : '❌'}`);
  console.log(`  stock_balances.product_id NULL : ${nulls[0]?.b} ${Number(nulls[0]?.b || 0) === 0 ? '✅' : '❌'}`);

  const fk = await rows(`PRAGMA foreign_key_check`);
  const ig = await rows(`PRAGMA integrity_check`);
  const triggers = await rows(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'check_stock%'`
  );
  console.log(`  foreign_key_check : ${fk.length === 0 ? 'SẠCH ✅' : `❌ ${fk.length}`}`);
  console.log(`  integrity_check   : ${Object.values(ig[0])[0]}`);
  console.log(`  trigger tồn âm    : ${triggers.map((t) => t.name).join(', ') || '(mất — phải có 2)'}`);

  const bad = Object.keys(before).filter(
    (k) => (before as any)[k] !== (after as any)[k]
  );
  if (bad.length || fk.length > 0) {
    console.error(`\n❌ CÓ VẤN ĐỀ (${bad.join(', ') || 'fk'}) — KHÔNG deploy.`);
    process.exit(1);
  }
  console.log('\n✅ Cổng 3 (0032) xong. Chạy verify-pos-live.ts rồi mới deploy.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌', e?.message || e);
    process.exit(1);
  });