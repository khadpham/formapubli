/**
 * scripts/test-0032-preserves-data.ts — kiểm đoạn NGUY HIỂM NHẤT của 0032.
 *
 * 0032 dựng lại `stock_balances` và `order_items` bằng cách COPY sang bảng tạm
 * rồi DROP bảng cũ. Nếu câu `INSERT INTO ..._0032 SELECT` chép thiếu hoặc sai
 * thứ tự cột thì mất dữ liệu đơn hàng — thứ không thể phục hồi nếu chạy trên
 * production.
 *
 * Test này chèn dữ liệu THẬT vào `order_items` (kể cả dòng có `bundle_id`,
 * `bundle_qty`, `promotion_id`, `is_gift_line`, `is_manual`) rồi chạy đúng file
 * migration 0032 và so trước/sau TỪNG TRƯỜNG.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} ${extra}`);
  }
}

async function main() {
  assertIsolatedTestDb(DB);
  console.log('=== TEST: 0032 GIỮ NGUYÊN DỮ LIỆU ===\n');

  const db = createClient({ url: DB });
  const rows = async (s: string, a?: any[]) =>
    (await db.execute({ sql: s, args: a || [] })).rows as any[];

  // --- Chuẩn bị: một đơn có 2 dòng, đủ mọi cột đặc biệt.
  console.log('--- 1. Chuẩn bị dữ liệu phức tạp ---');
  // Lấy ấn bản thật. KHÔNG hard-code 'ed-h01': seed hiện dùng mã `HH001`…
  // (`migrate-book-skus.ts` đã đổi mã), id `ed-h01` không tồn tại ⇒ FK fail
  // và ta sẽ chẩn đoán nhầm là 0032 hỏng.
  const eds = await rows(`SELECT id FROM editions ORDER BY id LIMIT 2`);
  assert.ok(eds.length === 2, 'cần ít nhất 2 ấn bản trong DB test');
  const [edA, edB] = eds.map((e: any) => e.id);
  const key = Date.now().toString().slice(-7);

  await db.execute({
    sql: `INSERT INTO orders (id, order_code, warehouse_id, subtotal, discount_amount, final_amount, idempotency_key)
          VALUES (?, ?, 'wh-au-co', 300000, 0, 300000, ?)`,
    args: [`ord-32`, `ORD-T-${key}`, `IK-32-${key}`],
  });
  await db.execute({
    sql: `INSERT INTO order_items
            (id, order_id, edition_id, product_id, quantity, unit_cover_price,
             unit_discount_rate, unit_selling_price, total_amount, bundle_id, bundle_qty,
             promotion_id, is_gift_line, is_manual)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      'oi-32-a', 'ord-32', edA, edA, 2, 100000, 0, 100000, 200000,
      null, null, null, 0, 0,
    ],
  });
  await db.execute({
    sql: `INSERT INTO order_items
            (id, order_id, edition_id, product_id, quantity, unit_cover_price,
             unit_discount_rate, unit_selling_price, total_amount, bundle_id, bundle_qty,
             promotion_id, is_gift_line, is_manual)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      'oi-32-b', 'ord-32', edB, edB, 1, 100000, 1, 0, 0,
      null, null, null, 1, 1,
    ],
  });
  const snapBefore = await rows(`SELECT * FROM order_items WHERE order_id='ord-32' ORDER BY id`);
  const sbBefore = await rows(
    `SELECT id, edition_id, product_id, warehouse_id, condition, physical_quantity
     FROM stock_balances ORDER BY id LIMIT 5`
  );
  ok('chuẩn bị 2 dòng đơn + bảng tồn', snapBefore.length === 2 && sbBefore.length === 5);

  console.log('\n--- 2. Chạy đúng file migration 0032 ---');
  const sqlFile = path.resolve(process.cwd(), 'src/db/migrations/0032_sellable_goods.sql');
  const statements = fs
    .readFileSync(sqlFile, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));
  for (const s of statements) await db.execute(s);
  ok(`chạy ${statements.length} câu không lỗi`, true);

  console.log('\n--- 3. DỮ LIỆU ĐƠN HÀNG còn nguyên? ---');
  const snapAfter = await rows(`SELECT * FROM order_items WHERE order_id='ord-32' ORDER BY id`);
  ok('đủ 2 dòng', snapAfter.length === 2, `thực tế=${snapAfter.length}`);
  for (const b of snapBefore) {
    const a = snapAfter.find((x: any) => x.id === b.id);
    ok(`${b.id} còn tồn tại`, !!a);
    if (!a) continue;
    // So TỪNG TRƯỜNG. Đây là chỗ dễ hỏng nhất: câu INSERT khai 16 cột nhưng
    // danh sách SELECT phải khớp THỨ TỰ, lệch một cột là dữ liệu chạy sang
    // cột khác mà không có lỗi nào báo.
    for (const k of Object.keys(b)) {
      ok(`${b.id}.${k} không đổi`, String(a[k]) === String(b[k]), `${b[k]} → ${a[k]}`);
    }
  }

  console.log('\n--- 4. DÒNG QUÀ giữ nguyên cờ? ---');
  const gift = snapAfter.find((x: any) => x.id === 'oi-32-b');
  ok('is_gift_line = 1', gift?.is_gift_line === 1, `thực tế=${gift?.is_gift_line}`);
  ok('is_manual = 1', gift?.is_manual === 1, `thực tế=${gift?.is_manual}`);
  ok('unit_discount_rate = 1 (giá 0đ)', gift?.unit_discount_rate === 1);
  ok('is_gift_shortfall mặc định 0', gift?.is_gift_shortfall === 0);

  console.log('\n--- 5. Tồn kho còn nguyên? ---');
  const sbAfter = await rows(
    `SELECT id, edition_id, product_id, warehouse_id, condition, physical_quantity
     FROM stock_balances ORDER BY id LIMIT 5`
  );
  ok('đủ 5 dòng tồn', sbAfter.length === 5, `thực tế=${sbAfter.length}`);
  for (const b of sbBefore) {
    const a = sbAfter.find((x: any) => x.id === b.id);
    ok(`${b.id} giữ nguyên`, !!a && String(a.physical_quantity) === String(b.physical_quantity));
  }

  console.log('\n--- 6. Ràng buộc MỚI có đúng không? ---');
  // 0032 mục tiêu: hàng hóa (edition_id NULL) được ghi tồn và ghi đơn.
  //
  // Phải tạo sản phẩm HÀNG HÓA THẬT, không dùng lại `edA`: cuốn sách đó ĐÃ
  // có dòng tồn ở `wh-au-co`, nên UNIQUE (product_id, warehouse_id, condition)
  // chặn trùng — đúng hành vi, nhưng ta đang kiểm chứng chuyện khác.
  const goodsId = `pr-test-0032-${key}`;
  await db.execute({
    sql: `INSERT INTO products (id, code, name, product_kind, selling_price, is_active)
          VALUES (?, ?, 'Sản phẩm thử 0032', 'GOODS', 59000, 1)`,
    args: [goodsId, `SP-T${key}`],
  });

  let err = '';
  try {
    await db.execute({
      sql: `INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, condition, physical_quantity)
            VALUES ('sb-32-goods', NULL, ?, 'wh-au-co', 'NEW', 3)`,
      args: [goodsId],
    });
  } catch (e: any) {
    err = String(e?.message || e);
  }
  ok('hàng hóa (edition_id NULL) tạo được dòng tồn', err === '', err.slice(0, 70));

  let err2 = '';
  try {
    await db.execute({
      sql: `INSERT INTO order_items (id, order_id, edition_id, product_id, quantity,
              unit_cover_price, unit_selling_price, total_amount)
            VALUES ('oi-32-goods', 'ord-32', NULL, ?, 1, 0, 0, 0)`,
      args: [goodsId],
    });
  } catch (e: any) {
    err2 = String(e?.message || e);
  }
  ok('hàng hóa tạo được dòng đơn', err2 === '', err2.slice(0, 70));

  let err3 = '';
  try {
    await db.execute({
      sql: `INSERT INTO order_items (id, order_id, edition_id, product_id, quantity,
              unit_cover_price, unit_selling_price, total_amount)
            VALUES ('oi-32-bad', 'ord-32', ?, NULL, 1, 0, 0, 0)`,
      args: [edA],
    });
  } catch (e: any) {
    err3 = String(e?.message || e);
  }
  ok('thiếu product_id thì bị chặn (NOT NULL)', err3.includes('NOT NULL'), err3.slice(0, 60));

  console.log('\n--- 7. Trigger tồn âm còn chạy? ---');
  let trig = '';
  try {
    await db.execute(
      `UPDATE stock_balances SET physical_quantity = -1 WHERE id = 'sb-32-goods'`
    );
  } catch (e: any) {
    trig = String(e?.message || e);
  }
  ok('vẫn chặn tồn âm', trig.includes('check_stock_non_negative'), trig.slice(0, 60));

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ 0032 KHÔNG giữ được dữ liệu — KHÔNG chạy lên production.');
    process.exit(1);
  }
  console.log('\n✅ 0032 dựng lại bảng mà KHÔNG MẤT DỮ LIỆU.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});