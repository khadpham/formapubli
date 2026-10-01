/**
 * scripts/test-goods-in-pos-catalog.ts — C2c: hàng hóa phải hiện và BÁN ĐƯỢC
 * trong danh mục POS, không chỉ tồn tại trong bảng `products`.
 *
 * Bối cảnh: trước C2c, `PosCatalogService` lấy `FROM editions INNER JOIN works`
 * ⇒ hàng hóa không có dòng `editions` nên BIẾN MẤT khỏi lưới quét mã. Loại
 * lỗi nguy hiểm nhất: không báo lỗi, chỉ thiếu dòng.
 *
 * Các luật khoá ở đây:
 *  1. Sách vẫn ra y như cũ (code/giá/tác giả từ `editions` + `works`).
 *  2. Hàng hóa có mặt trong danh mục, đúng giá bán.
 *  3. Không có ô trống nào ở dạng null: author/isbn là '' chứ không phải null
 *     (UI POS in thẳng, in "null" ra giữa quầy là lỗi hiển thị).
 *  4. ATP lấy đúng từ `stock_balances.product_id` — có tồn thì ATP > 0.
 *  5. ATP khớp giữa catalog và `OrderService.getATP` (đây là nơi chốt chặn
 *     bán vượt tồn, hai bên lệch nhau là lệch tiền).
 *  6. Sản phẩm đã tạm ngưng không hiện.
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { PosCatalogService } from '../src/services/pos-catalog.service';
import { OrderService } from '../src/services/order.service';
import { ProductService } from '../src/services/product.service';
import { assertIsolatedTestDb } from './test-guard';

const DB = process.env.DATABASE_URL || 'file:formapubli_test.db';
const WH = 'wh-au-co';

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
  console.log('=== TEST: HÀNG HÓA TRONG DANH MỤC POS (C2c) ===\n');

  const db = createClient({ url: DB });
  const suffix = Date.now().toString().slice(-6);

  // --- Chuẩn bị: 1 sản phẩm hàng hóa có tồn thật trong kho Âu Cơ.
  console.log('--- 1. Chuẩn bị dữ liệu ---');
  const goods = await ProductService.create({
    code: `SP-C2C${suffix}`,
    name: 'Túi vải FORMA',
    sellingPrice: 59000,
    barcode: `8940${suffix}001`,
  });
  await db.execute({
    sql: `INSERT INTO stock_balances (id, edition_id, product_id, warehouse_id, condition, physical_quantity)
          VALUES (?, NULL, ?, ?, 'NEW', ?)`,
    args: [`sb-goods-${goods.id}-${WH}`, goods.id, WH, 7],
  });
  ok('tạo hàng hóa + nhập tồn 7', true);

  const cat = await PosCatalogService.getCatalog(WH);
  const line = cat.items.find((i) => i.editionId === goods.id);

  console.log('\n--- 2. Hàng hóa CÓ trong danh mục ---');
  ok('tìm thấy hàng hóa trong catalog', !!line);
  assert.ok(line, 'phải tìm thấy hàng hóa trong danh mục POS');
  ok('kind = GOODS', line.productKind === 'GOODS');
  ok('đúng tên', line.title === 'Túi vải FORMA');
  ok('đúng mã', line.code === `SP-C2C${suffix}`);
  ok('đúng giá bán', line.coverPrice === 59000);
  ok('có mã vạch để quét', line.barcode === `8940${suffix}001`);

  console.log('\n--- 3. Không có ô null (UI in thẳng) ---');
  ok('author = "" chứ không phải null', line.author === '' && line.author !== null);
  ok('isbn = "" chứ không phải null', line.isbn === '' && line.isbn !== null);
  ok('isbnLast4 = "" chứ không phải null', line.isbnLast4 === '' && line.isbnLast4 !== null);

  console.log('\n--- 4. Sách KHÔNG bị hỏng ---');
  const book = cat.items.find((i) => i.productKind === 'BOOK');
  ok('vẫn có sách trong danh mục', !!book);
  assert.ok(book, 'phải còn sách trong danh mục');
  ok('sách có mã riêng (không rỗng)', book.code.length > 0);
  ok('sách có tác giả', book.author.length > 0);
  ok('sách có ISBN', book.isbn.length > 0);
  ok('sách có giá > 0', book.coverPrice > 0);
  ok('sách có ATP', book.atp > 0, `atp=${book.atp}`);
  const bookCount = cat.items.filter((i) => i.productKind === 'BOOK').length;
  ok('toàn bộ 88 cuốn sách vẫn có mặt', bookCount === 88, `thực tế=${bookCount}`);

  console.log('\n--- 5. ATP hàng hóa đúng tồn ---');
  ok('ATP = 7 (không trừ giữ chỗ vì kho Âu Cơ không phải hội chợ)', line.atp === 7, `atp=${line.atp}`);

  console.log('\n--- 6. Catalog KHỚP OrderService.getATP (chốt chặn bán vượt tồn) ---');
  // Đây là phép so quan trọng nhất: catalog và đường chốt đơn phải cùng một con
  // số. Lệch ở đây = bán vượt tồn hoặc chặn oan.
  const atpDirect = await OrderService.getATP(goods.id, WH);
  ok('getATP hàng hóa = 7', atpDirect === 7, `getATP=${atpDirect}`);
  ok('catalog.atp === getATP', line.atp === atpDirect, `${line.atp} vs ${atpDirect}`);
  const bookAtpDirect = await OrderService.getATP(book.editionId, WH);
  ok('sách: catalog.atp === getATP', book.atp === bookAtpDirect, `${book.atp} vs ${bookAtpDirect}`);

  console.log('\n--- 7. Tạm ngưng thì không hiện ---');
  await ProductService.update(goods.id, { isActive: false });
  const cat2 = await PosCatalogService.getCatalog(WH);
  ok('sản phẩm đã tắt không có trong catalog', !cat2.items.some((i) => i.editionId === goods.id));
  await ProductService.update(goods.id, { isActive: true });

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-goods-in-pos-catalog thất bại');
    process.exit(1);
  }
  console.log('\n✅ HÀNG HÓA ĐÃ LÊN ĐƯỢC DANH MỤC POS.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});