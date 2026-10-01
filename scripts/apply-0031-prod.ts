import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

requireProdWriteConsent(
  'migration 0031: tạo bảng products/promotions/promotion_gifts + 7 cột nullable (CHỈ THÊM, KHÔNG UPDATE)'
);

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
 * Mỗi bước là MỘT `execute()` riêng, có `PRAGMA` kiểm trước, và chạy đúng một
 * lần. `migrate-fresh.ts` KHÔNG dùng ở đây: nó không transaction, không
 * rollback, và production không có bảng `__drizzle_migrations` nên chạy lại
 * không resume được — chết ngay ở câu không idempotent đầu tiên.
 *
 * `CREATE ... IF NOT EXISTS` cho bảng và index (chạy lại được vô hại).
 * `ALTER TABLE ADD COLUMN` cố ý KHÔNG có `IF NOT EXISTS`: SQLite không có câu
 * đó, thêm vào sẽ biến lỗi thành im lặng. Cột đã tồn tại thì script báo và bỏ
 * qua — chạy lại vẫn an toàn.
 */
type Step = {
  label: string;
  /** Danh sách bảng cần kiểm cột đã có hay chưa. */
  guard?: { table: string; column: string }[];
  sql: string;
  /** Chạy khi `guard` cho thấy đã tồn tại. */
  skipIfGuarded?: boolean;
};

const TABLE_STEPS: Step[] = [
  {
    label: 'CREATE TABLE products',
    sql: `CREATE TABLE IF NOT EXISTS \`products\` (
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
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP
)`,
  },
  {
    label: 'CREATE UNIQUE INDEX products_code_unique',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS `products_code_unique` ON `products` (`code`)',
  },
  {
    label: 'CREATE UNIQUE INDEX products_barcode_unique',
    sql:
      'CREATE UNIQUE INDEX IF NOT EXISTS `products_barcode_unique` ON `products` (`barcode`) WHERE `barcode` IS NOT NULL',
  },
  {
    label: 'CREATE TABLE promotions',
    sql: `CREATE TABLE IF NOT EXISTS \`promotions\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`is_active\` integer NOT NULL DEFAULT 1,
  \`starts_at\` text,
  \`ends_at\` text,
  \`created_at\` text DEFAULT CURRENT_TIMESTAMP
)`,
  },
  {
    label: 'CREATE TABLE promotion_gifts',
    sql: `CREATE TABLE IF NOT EXISTS \`promotion_gifts\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`promotion_id\` text NOT NULL REFERENCES \`promotions\`(\`id\`),
  \`min_subtotal\` real NOT NULL,
  \`product_id\` text NOT NULL REFERENCES \`products\`(\`id\`),
  \`gift_quantity\` integer NOT NULL DEFAULT 1,
  UNIQUE(\`promotion_id\`, \`min_subtotal\`, \`product_id\`)
)`,
  },
  {
    label: 'CREATE INDEX idx_promotion_gifts_lookup',
    sql:
      'CREATE INDEX IF NOT EXISTS `idx_promotion_gifts_lookup` ON `promotion_gifts` (`promotion_id`, `min_subtotal`)',
  },
];

const COLUMN_STEPS: Step[] = [
  {
    label: 'ALTER TABLE editions ADD product_id',
    guard: [{ table: 'editions', column: 'product_id' }],
    sql: 'ALTER TABLE `editions` ADD `product_id` text REFERENCES `products`(`id`)',
    skipIfGuarded: true,
  },
  {
    label: 'ALTER TABLE order_items ADD product_id',
    guard: [{ table: 'order_items', column: 'product_id' }],
    sql: 'ALTER TABLE `order_items` ADD `product_id` text REFERENCES `products`(`id`)',
    skipIfGuarded: true,
  },
  {
    label: 'ALTER TABLE inventory_ledger ADD product_id',
    guard: [{ table: 'inventory_ledger', column: 'product_id' }],
    sql: 'ALTER TABLE `inventory_ledger` ADD `product_id` text REFERENCES `products`(`id`)',
    skipIfGuarded: true,
  },
  {
    label: 'ALTER TABLE stock_balances ADD product_id',
    guard: [{ table: 'stock_balances', column: 'product_id' }],
    sql: 'ALTER TABLE `stock_balances` ADD `product_id` text REFERENCES `products`(`id`)',
    skipIfGuarded: true,
  },
  {
    label: 'ALTER TABLE order_items ADD promotion_id',
    guard: [{ table: 'order_items', column: 'promotion_id' }],
    sql: 'ALTER TABLE `order_items` ADD `promotion_id` text REFERENCES `promotions`(`id`)',
    skipIfGuarded: true,
  },
  {
    label: 'ALTER TABLE order_items ADD is_gift_line',
    guard: [{ table: 'order_items', column: 'is_gift_line' }],
    sql: 'ALTER TABLE `order_items` ADD `is_gift_line` integer NOT NULL DEFAULT 0',
    skipIfGuarded: true,
  },
  {
    label: 'ALTER TABLE order_items ADD is_manual',
    guard: [{ table: 'order_items', column: 'is_manual' }],
    sql: 'ALTER TABLE `order_items` ADD `is_manual` integer NOT NULL DEFAULT 0',
    skipIfGuarded: true,
  },
];

async function hasColumn(
  db: ReturnType<typeof createClient>,
  table: string,
  column: string
): Promise<boolean> {
  const rows = (await db.execute(`PRAGMA table_info(\`${table}\`)`)).rows as any[];
  return rows.map((r) => r.name).includes(column);
}

async function main() {
  const url = env.TURSO_DATABASE_URL;
  requireExplicitTarget(url);
  const db = createClient({ url, authToken: env.TURSO_AUTH_TOKEN });

  const before = (await db.execute(
    `SELECT COUNT(*) n FROM editions`
  )).rows as any[];
  const editionCount = Number(before[0]?.n || 0);
  console.log(`Trước khi áp: ${editionCount} ấn bản trong editions.`);

  console.log('\n── Bước 1: tạo bảng + index ──');
  for (const step of TABLE_STEPS) {
    await db.execute(step.sql);
    console.log(`  ✓ ${step.label}`);
  }

  console.log('\n── Bước 2: thêm cột nullable ──');
  for (const step of COLUMN_STEPS) {
    const guards = step.guard || [];
    let alreadyThere = false;
    for (const g of guards) {
      if (await hasColumn(db, g.table, g.column)) alreadyThere = true;
    }
    if (alreadyThere && step.skipIfGuarded) {
      console.log(`  = ${step.label} — cột đã tồn tại, bỏ qua`);
      continue;
    }
    await db.execute(step.sql);
    console.log(`  ✓ ${step.label}`);
  }

  console.log('\n── Xác nhận ──');
  const tables = (await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('products','promotions','promotion_gifts') ORDER BY name`
  )).rows as any[];
  console.log('Bảng mới:', tables.map((t) => t.name).join(', ') || '(không có)');

  for (const table of ['editions', 'order_items', 'inventory_ledger', 'stock_balances']) {
    const cols = (await db.execute(`PRAGMA table_info(\`${table}\`)`)).rows as any[];
    const added = cols.map((c) => c.name).filter((n) =>
      ['product_id', 'promotion_id', 'is_gift_line', 'is_manual'].includes(n)
    );
    console.log(`  ${table}: ${added.length ? added.join(', ') : '(chưa có cột mới)'}`);
  }

  const after = (await db.execute(`SELECT COUNT(*) n FROM editions`)).rows as any[];
  const afterCount = Number(after[0]?.n || 0);
  if (afterCount !== editionCount) {
    console.error(
      `\n❌ editions đổi số dòng: ${editionCount} → ${afterCount}. DỪNG, báo quản lý.`
    );
    process.exit(1);
  }

  console.log(
    `\n✅ Xong Cổng 1. editions vẫn ${editionCount} dòng (không đổi).`
  );
  console.log(
    'Backfill `product_id` KHÔNG nằm trong script này — đó là Cổng 1b, chạy lúc kho đóng.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌', e.message);
    process.exit(1);
  });