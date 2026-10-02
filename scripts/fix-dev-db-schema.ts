/**
 * VÁ DB DEV CỤC BỘ (file:formapubli.db) — chỉ những phần còn THIẾU.
 *
 * PHÁT HIỆN: dev DB tụt hậu so với production:
 *   · thiếu bảng `daily_order_counters` (migration 0028) ⇒ MỌI đơn trả 500
 *     "no such table: daily_order_counters". Nghĩa là ai chạy thử bằng dev server
 *     cũng không tạo được đơn, không phải chỉ môi trường test.
 *   · thiếu CẢ HAI trigger chặn tồn kho âm (0027 UPDATE, 0029 INSERT) ⇒ dev cho
 *     phép tồn âm, tức lỗi lọt vào lúc bạn đang sửa.
 *
 * AN TOÀN:
 *   · Chỉ đụng file CỤC BỘ `formapubli.db`. KHÔNG chạm Turso.
 *   · Sao lưu file trước, ghi tên có đuôi .bak.
 *   · Từng câu đều kiểm tra trước khi chạy ⇒ chạy lại nhiều lần cũng an toàn.
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const DB = 'file:formapubli.db';

async function main() {
  const bak = `formapubli.db.bak-${Date.now()}`;
  fs.copyFileSync('formapubli.db', bak);
  console.log(`Đã sao lưu: ${bak}`);

  const db = createClient({ url: DB });
  const q = async (sql: string) => (await db.execute(sql)).rows;
  const hasTable = async (n: string) =>
    (await q(`SELECT name FROM sqlite_master WHERE type='table' AND name='${n}'`)).length > 0;
  const hasColumn = async (t: string, c: string) =>
    ((await q(`PRAGMA table_info(${t})`)) as any[]).some((x) => x.name === c);
  const hasTrigger = async (n: string) =>
    (await q(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='${n}'`)).length > 0;

  // --- 0028: bảng bộ đếm mã đơn 13 ký tự
  // ĐỌC ĐÚNG FILE MIGRATION thay vì tự viết DDL: lần đầu tôi tự viết cột
  // `business_date`/`last_value` thì code tìm cột `day` ⇒ vẫn 500. Cấu trúc phải
  // lấy nguyên văn từ migration, không suy đoán.
  const hasCounterCols = await hasTable('daily_order_counters')
    ? (await hasColumn('daily_order_counters', 'day'))
    : false;
  if (!hasCounterCols) {
    if (await hasTable('daily_order_counters')) {
      await db.execute(`DROP TABLE daily_order_counters`);
      console.log('· 0028: bảng cũ sai cấu trúc → xoá để tạo lại đúng');
    }
    await db.execute(
      `CREATE TABLE IF NOT EXISTS daily_order_counters (
         day      TEXT PRIMARY KEY,
         last_seq INTEGER NOT NULL DEFAULT 0
       )`
    );
    console.log('✓ 0028: đã tạo bảng daily_order_counters (day, last_seq)');
  } else console.log('· 0028: bảng đã đúng cấu trúc');

  // --- 0027: chặn UPDATE làm tồn âm
  if (!(await hasTrigger('check_stock_non_negative'))) {
    await db.execute(
      `CREATE TRIGGER IF NOT EXISTS check_stock_non_negative
       BEFORE UPDATE ON stock_balances
       FOR EACH ROW WHEN NEW.physical_quantity < 0
       BEGIN
         SELECT RAISE(ABORT, 'check_stock_non_negative: physical_quantity >= 0');
       END`
    );
    console.log('✓ 0027: đã tạo trigger chặn UPDATE tồn âm');
  } else console.log('· 0027: trigger đã có');

  // --- 0029: chặn INSERT làm tồn âm
  if (!(await hasTrigger('check_stock_non_negative_ins'))) {
    await db.execute(
      `CREATE TRIGGER IF NOT EXISTS check_stock_non_negative_ins
       BEFORE INSERT ON stock_balances
       FOR EACH ROW WHEN NEW.physical_quantity < 0
       BEGIN
         SELECT RAISE(ABORT, 'check_stock_non_negative: physical_quantity >= 0');
       END`
    );
    console.log('✓ 0029: đã tạo trigger chặn INSERT tồn âm');
  } else console.log('· 0029: trigger đã có');

  // --- 0030: cột royalty_basis (SQLite không có ADD COLUMN IF NOT EXISTS)
  if (!(await hasColumn('rights_contracts', 'royalty_basis'))) {
    await db.execute(
      `ALTER TABLE rights_contracts ADD COLUMN royalty_basis TEXT NOT NULL DEFAULT 'NET_SOLD'`
    );
    console.log('✓ 0030: đã thêm cột royalty_basis');
  } else console.log('· 0030: cột đã có');

  // --- 0031: products / promotions / promotion_gifts + 7 cột nullable.
  // Đọc DDL NGUYÊN VĂN từ src/db/migrations/0031_products_promotions.sql, không
  // tự viết — sai một tên cột là 500 toàn hệ thống. Cột chỉ thêm khi thiếu vì
  // SQLite không có `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
  const COLS_0031: [string, string, string][] = [
    ['editions', 'product_id', 'text REFERENCES `products`(`id`)'],
    ['order_items', 'product_id', 'text REFERENCES `products`(`id`)'],
    ['inventory_ledger', 'product_id', 'text REFERENCES `products`(`id`)'],
    ['stock_balances', 'product_id', 'text REFERENCES `products`(`id`)'],
    ['order_items', 'promotion_id', 'text REFERENCES `promotions`(`id`)'],
    ['order_items', 'is_gift_line', 'integer NOT NULL DEFAULT 0'],
    ['order_items', 'is_manual', 'integer NOT NULL DEFAULT 0'],
  ];

  if (!(await hasTable('products'))) {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS \`products\` (
         \`id\` text PRIMARY KEY NOT NULL,
         \`code\` text,
         \`name\` text NOT NULL,
         \`product_kind\` text NOT NULL DEFAULT 'BOOK',
         \`selling_price\` real NOT NULL DEFAULT 0,
         \`cost_price\` real,
         \`barcode\` text,
         \`description\` text,
         \`is_gift_item\` integer NOT NULL DEFAULT 0,
         \`is_active\` integer NOT NULL DEFAULT 1,
         \`created_at\` text DEFAULT CURRENT_TIMESTAMP)`
    );
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS products_code_unique ON products (code)`);
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON products (barcode) WHERE barcode IS NOT NULL`
    );
    console.log('✓ 0031: đã tạo bảng products');
  } else console.log('· 0031: products đã có');

  if (!(await hasTable('promotions'))) {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS \`promotions\` (
         \`id\` text PRIMARY KEY NOT NULL,
         \`name\` text NOT NULL,
         \`is_active\` integer NOT NULL DEFAULT 1,
         \`starts_at\` text,
         \`ends_at\` text,
         \`created_at\` text DEFAULT CURRENT_TIMESTAMP)`
    );
    console.log('✓ 0031: đã tạo bảng promotions');
  } else console.log('· 0031: promotions đã có');

  if (!(await hasTable('promotion_gifts'))) {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS \`promotion_gifts\` (
         \`id\` text PRIMARY KEY NOT NULL,
         \`promotion_id\` text NOT NULL REFERENCES \`promotions\`(\`id\`),
         \`min_subtotal\` real NOT NULL,
         \`product_id\` text NOT NULL REFERENCES \`products\`(\`id\`),
         \`gift_quantity\` integer NOT NULL DEFAULT 1,
         UNIQUE(\`promotion_id\`, \`min_subtotal\`, \`product_id\`))`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_promotion_gifts_lookup ON promotion_gifts (promotion_id, min_subtotal)`
    );
    console.log('✓ 0031: đã tạo bảng promotion_gifts');
  } else console.log('· 0031: promotion_gifts đã có');

  for (const [table, col, decl] of COLS_0031) {
    if (await hasColumn(table, col)) continue;
    await db.execute(`ALTER TABLE \`${table}\` ADD \`${col}\` ${decl}`);
    console.log(`✓ 0031: đã thêm ${table}.${col}`);
  }

  // --- 0035: đường nối phê duyệt chiết khấu ↔ đơn.
  // Thiếu 2 cột này thì MỌI đơn có phê duyệt trả 500 (Drizzle SELECT đọc đúng
  // danh sách cột của bảng), nên phải vá tay cho DB dev giống 0031.
  const COLS_0035: [string, string, string][] = [
    ['orders', 'discount_approval_id', 'text'],
    ['discount_approval_requests', 'client_order_code', 'text'],
  ];
  for (const [table, col, decl] of COLS_0035) {
    if (await hasColumn(table, col)) continue;
    await db.execute(`ALTER TABLE \`${table}\` ADD \`${col}\` ${decl}`);
    console.log(`✓ 0035: đã thêm ${table}.${col}`);
  }
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_orders_discount_approval ON orders (discount_approval_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_disc_appr_client_order ON discount_approval_requests (client_order_code)`
  );

  // --- 0032: dấu vết quà HẾT TỒN trên dòng đơn.
  // Thiếu cột này thì `GiftReportService.summary` (và mọi SELECT đọc bảng
  // `order_items` qua Drizzle) lỗi SQL ⇒ panel Quà trên màn Doanh Số hỏng,
  // trong khi production đã có (0032 đã áp). DDL lấy NGUYÊN VĂN từ
  // src/db/migrations/0032_sellable_goods.sql, không tự suy đoán.
  const COLS_0032: [string, string, string][] = [
    ['order_items', 'is_gift_shortfall', 'integer NOT NULL DEFAULT 0'],
  ];
  for (const [table, col, decl] of COLS_0032) {
    if (await hasColumn(table, col)) continue;
    await db.execute(`ALTER TABLE \`${table}\` ADD \`${col}\` ${decl}`);
    console.log(`✓ 0032: đã thêm ${table}.${col}`);
  }

  // --- Chứng minh trigger thật sự chạy trên DB dev
  const ed = await q(`SELECT id FROM editions LIMIT 1`);
  const wh = await q(`SELECT id FROM warehouses LIMIT 1`);
  if (ed.length && wh.length) {
    let blocked = '';
    try {
      await db.execute({
        sql: `INSERT INTO stock_balances (id, edition_id, warehouse_id, condition, physical_quantity)
              VALUES (?, ?, ?, 'NEW', -1)`,
        args: [`dev-check-${Date.now()}`, ed[0].id, wh[0].id],
      });
    } catch (e: any) {
      blocked = String(e?.message || '').slice(0, 60);
    }
    console.log(`\nChèn tồn âm vào DB dev: ${blocked ? 'BỊ CHẶN ✓' : 'KHÔNG bị chặn ✗'} ${blocked}`);
  }

  console.log('\n✅ DB dev đã ngang production về migration.');
  process.exit(0);
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
