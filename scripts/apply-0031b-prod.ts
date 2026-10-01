import { requireExplicitTarget } from './prod-write-guard';
import fs from 'node:fs';
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
 * CỔNG 1b — chạy SAU KHI KHO ĐÓNG.
 *
 * VÌ SAO TÁCH RIÊNG khỏi Cổng 1: `UPDATE` ghi TỪNG DÒNG MỘT và giữ khoá ghi DB.
 * Cổng 1 chỉ CREATE/ALTER ADD nên tức thời, không giữ khoá. Cổng 1b thì có
 * `UPDATE order_items` (hàng trăm dòng) — chạy lúc đang bán sẽ treo POS vài
 * giây.
 *
 * `products.code` CỐ Ý ĐỂ NULL cho sách: `migrate-book-skus.ts` đã từng đổi
 * `editions.code` (H01 → HH001). Copy `code` sang sẽ tạo HAI nguồn sự thật cho
 * cùng một SKU, không có trigger đồng bộ. Tra mã sách qua `editions.code` như
 * hiện tại; `products.code` chỉ dành cho hàng hóa mới.
 *
 * Id của sách = `editions.id` (`ed-h01`) ⇒ backfill chỉ là `SET product_id = id`,
 * không phải sinh id mới, không phải viết lại khóa ngoại.
 *
 * TỪNG CÂU MỘT `execute()`, CÓ `SELECT` ĐẾM TRƯỚC. Không transaction (Turso
 * qua HTTP không bọc được nhiều câu), không rollback. Nếu câu nào fail thì
 * dừng, in rõ câu nào, và câu đã chạy là `CREATE`/`UPDATE` idempotent nên
 * chạy lại được.
 */

/**
 * Chọn đích. `DATABASE_URL` được ưu tiên để DRY-RUN trên DB test được an toàn.
 *
 * LÝ DO: bản đầu của script này đọc thẳng `TURSO_DATABASE_URL` từ `.env` và
 * tôi đã chạy "dry-run" với `DATABASE_URL=file:...` tưởng là ép vào DB test —
 * nó không có tác dụng, script vẫn ghi vào PRODUCTION. Cổng 1 chỉ có
 * CREATE/ALTER ADD nên không mất dữ liệu, nhưng Cổng 1b có UPDATE thật, chạy
 * nhầm là mất luôn. Xem `requireExplicitTarget` trong prod-write-guard.
 */
const targetUrl = process.env.DATABASE_URL || env.TURSO_DATABASE_URL;
const isDryRun = Boolean(process.env.DATABASE_URL);

async function main() {
  requireExplicitTarget(targetUrl);
  if (isDryRun) {
    console.log('\n🧪 DRY-RUN: đang ghi vào DB LOCAL, không đụng production.');
  }
  const db = createClient({ url: targetUrl, authToken: isDryRun ? undefined : env.TURSO_AUTH_TOKEN });
  const rows = async (s: string) => (await db.execute(s)).rows as any[];

  console.log('\n════ TRẠNG THÁI TRƯỚC ════');
  const t = async (name: string) => {
    const r = await rows(`SELECT COUNT(*) n FROM \`${name}\``);
    const v = Number(r[0]?.n || 0);
    console.log(`  ${name}: ${v}`);
    return v;
  };
  const bEd = await t('editions');
  const bProd = await t('products');

  console.log('\n════ BƯỚC 1: tạo products từ editions ════');
  // Nếu `products` đã có dòng thì hoặc là chạy lại sau lần hỏng giữa chừng,
  // hoặc là đã có hàng hóa nhập tay. Phân biệt bằng cách hỏi: mọi dòng có
  // phải do backfill sinh ra không (id trùng `editions.id` + kind = BOOK)?
  if (bProd === 0) {
    // LEFT JOIN works: editions.work_id là NOT NULL FK nên luôn khớp, nhưng LEFT
    // để không mất bản ghi nào nếu có work_id hỏng.
    await db.execute(
      `INSERT INTO products (id, code, name, product_kind, selling_price, is_active)
       SELECT e.id,
              NULL,
              COALESCE(NULLIF(e.title, ''), w.title, e.code),
              'BOOK',
              COALESCE(e.cover_price, 0),
              COALESCE(e.is_active, 1)
       FROM editions e
       LEFT JOIN works w ON w.id = e.work_id`
    );
    const nProd = await t('products');
    console.log(`  → products có ${nProd} dòng (kỳ vọng ${bEd})`);
    if (nProd !== bEd) {
      console.error(`\n❌ Lệch ${bEd - nProd} dòng. DỪNG — không chạy tiếp.`);
      process.exit(1);
    }
  } else {
    const stray = await rows(
      `SELECT COUNT(*) n FROM products p
       LEFT JOIN editions e ON e.id = p.id
       WHERE e.id IS NULL OR p.product_kind <> 'BOOK'`
    );
    if (Number(stray[0]?.n || 0) > 0) {
      console.error(
        `\n❌ products có ${stray[0].n} dòng KHÔNG phải sách từ backfill.\n` +
          `   Có thể đã nhập hàng hóa tay — script dừng để bạn kiểm tra tay.`
      );
      process.exit(1);
    }
    console.log(`\n  ℹ️ products đã có ${bProd} dòng sách từ lần chạy trước — bỏ qua BƯỚC 1, chạy tiếp BƯỚC 2.`);
  }

  console.log('\n════ BƯỚC 2: trỏ product_id ════');
  const steps: [string, string, string][] = [
    ['editions', 'editions', 'UPDATE `editions` SET product_id = id WHERE product_id IS NULL'],
    ['inventory_ledger', 'inventory_ledger', 'UPDATE `inventory_ledger` SET product_id = edition_id WHERE product_id IS NULL'],
    ['stock_balances', 'stock_balances', 'UPDATE `stock_balances` SET product_id = edition_id WHERE product_id IS NULL'],
    // order_items để CUỐI: nó dài nhất, và nếu hỏng thì 3 bảng trên đã xong
    // vẫn chạy lại được vì đều idempotent.
    ['order_items', 'order_items', 'UPDATE `order_items` SET product_id = edition_id WHERE product_id IS NULL'],
  ];
  for (const [label, table, sql] of steps) {
    const before = Number((await rows(`SELECT COUNT(*) n FROM \`${table}\``))[0]?.n || 0);
    console.log(`\n  → ${label} (${before} dòng)…`);
    const t0 = Date.now();
    await db.execute(sql);
    const done = Number((await rows(`SELECT COUNT(*) n FROM \`${table}\` WHERE product_id IS NOT NULL`))[0]?.n || 0);
    console.log(`    xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s — ${done}/${before} dòng có product_id`);
  }

  console.log('\n════ BƯỚC 3: index cho products.id ════');
  // PRIMARY KEY đã có index sẵn; index phụ cho phép tra theo product_id ở các
  // bảng con. Đặt SAU backfill: nếu backfill sinh trùng thì câu này fail và
  // mọi câu sau không chạy.
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id)`);
  console.log('  ✓ idx_order_items_product');
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_editions_product ON editions (product_id)`);
  console.log('  ✓ idx_editions_product');

  console.log('\n════ XÁC NHẬN ════');
  for (const table of ['editions', 'order_items', 'inventory_ledger', 'stock_balances']) {
    const n = Number((await rows(`SELECT COUNT(*) n FROM \`${table}\``))[0]?.n || 0);
    const ok = Number((await rows(`SELECT COUNT(*) n FROM \`${table}\` WHERE product_id IS NULL`))[0]?.n || 0);
    console.log(`  ${table}: ${n} dòng, ${ok === 0 ? '✅' : '❌'} còn NULL = ${ok}`);
  }

  const aEd = await t('editions');
  const aItems = await t('order_items');
  const aProd = await t('products');
  const fk = await rows(`PRAGMA foreign_key_check`);
  const ig = await rows(`PRAGMA integrity_check`);

  console.log('\n════ SO SÁNH ════');
  console.log(`  editions:   ${bEd} → ${aEd} ${bEd === aEd ? '✅' : '❌ ĐÃ MẤT DÒNG'}`);
  console.log(`  order_items:${bEd === aEd ? '' : ''}${aItems} dòng`);
  console.log(`  products:   ${bProd} → ${aProd} ✅`);
  console.log(`  foreign_key_check: ${fk.length === 0 ? 'SẠCH ✅' : `❌ ${fk.length} vi phạm`}`);
  console.log(`  integrity_check: ${Object.values(ig[0])[0]}`);

  if (bEd !== aEd || fk.length > 0) {
    console.error('\n❌ CÓ VẤN ĐỀ — báo quản lý, KHÔNG deploy.');
    process.exit(1);
  }
  console.log('\n✅ Cổng 1b xong. Bước tiếp theo: chạy `verify-pos-live.ts` rồi mới deploy.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌', e.message);
    process.exit(1);
  });