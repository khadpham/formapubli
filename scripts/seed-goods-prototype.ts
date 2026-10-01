/**
 * scripts/seed-goods-prototype.ts — Nạp 4 sản phẩm hàng hóa TƯỢNG TRƯNG và
 * 100 cái/món ở 2 kho (Hồ Gươm + ĐH Hà Nội).
 *
 * Chạy NHƯ PROD THẬT:
 *   ALLOW_PROD_WRITE=true ALLOW_REMOTE_TARGET=<host> npx tsx scripts/seed-goods-prototype.ts
 *
 * An toàn:
 *  - requireProdWriteConsent + requireExplicitTarget (như mọi script prod).
 *  - Bỏ qua sản phẩm đã tồn tại (idempotent theo `code`).
 *  - Tồn nhập bằng bút toán OPENING_BALANCE (sổ kho và bảng cân đối khớp nhau —
 *    bài học mục 7.4: nạp tồn mà thiếu ledger ⇒ audit Balance==LedgerSum đỏ).
 */
import 'dotenv/config';
import fs from 'node:fs';
import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
// `src/db` đọc `DATABASE_URL`/`DATABASE_AUTH_TOKEN` — trỏ thẳng vào Turso prod
// (đúng quy ước: ghi prod phải bọc requireProdWriteConsent + requireExplicitTarget).
process.env.DATABASE_URL = env.TURSO_DATABASE_URL;
process.env.DATABASE_AUTH_TOKEN = env.TURSO_AUTH_TOKEN;

requireProdWriteConsent('Nạp 4 sản phẩm SP-001..SP-004 + tồn 100×2 kho');
requireExplicitTarget(env.TURSO_DATABASE_URL || '');

async function main() {
  const { ProductService } = await import('../src/services/product.service');
  const { InventoryService } = await import('../src/services/inventory.service');
  const { createClient } = await import('@libsql/client');

const WAREHOUSES = ['wh-kho-hoi-cho-ho-guom', 'wh-kho-dh-ha-noi-thang-10-2026'];

const PRODUCTS = [
  { code: 'SP-001', name: 'Bookmark', sellingPrice: 5000, isGiftItem: false },
  { code: 'SP-002', name: 'Móc khoá', sellingPrice: 15000, isGiftItem: false },
  { code: 'SP-003', name: 'Gói quà Bất ngờ', sellingPrice: 50000, isGiftItem: true },
  { code: 'SP-004', name: 'Túi Tote', sellingPrice: 150000, isGiftItem: false },
];

  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });

  for (const p of PRODUCTS) {
    const exist = await client.execute({ sql: 'SELECT id FROM products WHERE code = ?', args: [p.code] });
    let id: string;
    if (exist.rows.length) {
      id = String((exist.rows[0] as any).id);
      console.log(`· Đã có ${p.code} (${id}) — bỏ qua tạo mới.`);
    } else {
      const created = await ProductService.create({
        code: p.code,
        name: p.name,
        sellingPrice: p.sellingPrice,
        isGiftItem: p.isGiftItem,
      });
      id = created.id!;
      console.log(`· Tạo ${p.code} — ${p.name} — ${Number(p.sellingPrice).toLocaleString('vi-VN')}đ (${id})`);
    }

    for (const wh of WAREHOUSES) {
      const bal = await client.execute({
        sql: 'SELECT physical_quantity FROM stock_balances WHERE product_id = ? AND warehouse_id = ? AND `condition` = ?',
        args: [id, wh, 'NEW'],
      });
      if (bal.rows.length > 0) {
        console.log(`  · Kho ${wh}: đã có tồn ${Number((bal.rows[0] as any).physical_quantity)} — bỏ qua.`);
        continue;
      }
      await InventoryService.recordMovement({
        editionId: id,
        isBook: false, // hàng hóa: ledger.edition_id = NULL
        warehouseId: wh,
        eventType: 'OPENING_BALANCE',
        quantityDelta: 100,
        condition: 'NEW',
        documentRef: 'NHAP-SP-PROTO-100',
        note: 'Nạp thử 100 cái — dữ liệu tượng trưng',
        idempotencyKey: `idem-open-${id}-${wh}-${Date.now()}`,
        actorId: 'system',
      });
      console.log(`  · Kho ${wh}: +100 (OPENING_BALANCE)`);
    }
  }
  console.log('\n✅ Xong. 4 sản phẩm, 2 kho × 100 cái.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
