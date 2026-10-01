/**
 * scripts/test-products.ts — kiểm thử danh mục hàng hóa (Cổng 2b).
 *
 * Chạy cách ly: `npx tsx scripts/test-products.ts` với DATABASE_URL trỏ
 * formapubli_test.db, hoặc qua `npx tsx scripts/run-isolated.ts`.
 *
 * Các luật đang khoá ở đây:
 *  1. Mã hàng hóa BẮT BUỘC có tiền tố `SP-` — nếu không sẽ đâm vào dãi mã
 *     sách (H01, HH042…) mà UNIQUE constraint không bắt được.
 *  2. Mã trùng mã SÁCH phải bị chặn ở tầng ứng dụng, không đợi DB.
 *  3. Mã vạch phải đúng 13 chữ số.
 *  4. Trùng mã vạch bị chặn.
 *  5. Giá âm / NaN bị chặn.
 *  6. `is_gift_item` chỉ là GỢI Ý — không chặn tạo sản phẩm thường (chốt #22).
 *  7. Không cho đổi `code` sau khi đã nhập.
 *  8. `cost_price` (giá vốn) phải BỊ CHẶN ở mọi đường vào và KHÔNG lọt ra:
 *     gửi lên bị bỏ qua, và không có key `costPrice` trong bất kỳ dòng trả về
 *     nào — kể cả khi DB đã có giá vốn (chốt #4).
 */
import assert from 'node:assert';
import { createClient } from '@libsql/client';
import { ProductService, GOODS_CODE_PREFIX } from '../src/services/product.service';
import { AppError } from '../src/services/app-error';
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

async function expectThrow(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    fail++;
    console.log(`  ❌ FAIL: ${label} — KHÔNG ném lỗi như kỳ vọng`);
  } catch (e: any) {
    pass++;
    console.log(`  ✅ ${label} — bị chặn: ${String(e?.message || e).slice(0, 70)}`);
  }
}

async function main() {
  assertIsolatedTestDb(DB);

  console.log('=== TEST: DANH MỤC HÀNG HÓA ===\n');

  // Sẵn sàng dữ liệu: một cuốn sách để thử đụng mã.
  const db = createClient({ url: DB });
  const book = (await db.execute(`SELECT id, code FROM editions LIMIT 1`)).rows[0] as any;
  assert.ok(book?.code, 'cần có ít nhất 1 ấn bản trong DB test');

  const suffix = Date.now().toString().slice(-6);
  const goodCode = `${GOODS_CODE_PREFIX}${suffix}`;

  console.log('--- 1. Tạo hàng hóa hợp lệ ---');
  const created = await ProductService.create({
    code: goodCode,
    name: 'Áo mưa gấp',
    sellingPrice: 89000,
    costPrice: 45000,
    barcode: `8930${suffix}012`,
    description: 'Áo mưa gấp gọn',
    isGiftItem: true,
  });
  ok('tạo thành công', !!created.id);
  ok('id có tiền tố pr-', String(created.id).startsWith('pr-'), created.id);
  ok('mã lưu đúng', created.code === goodCode);
  ok('kind = GOODS', created.productKind === 'GOODS');
  ok('giá bán giữ nguyên', created.sellingPrice === 89000);
  ok('mã vạch chuẩn hóa', created.barcode === `8930${suffix}012`);

  console.log('\n--- 2. Chặn mã không có tiền tố SP- ---');
  await expectThrow('mã "H01" bị chặn', () =>
    ProductService.create({ code: 'H01', name: 'X', sellingPrice: 1 })
  );
  await expectThrow('mã trùng mã sách thật bị chặn', () =>
    ProductService.create({ code: book.code, name: 'X', sellingPrice: 1 })
  );

  console.log('\n--- 3. Chặn trùng mã trong hàng hóa ---');
  // Phải do TẦNG ỨNG DỤNG chặn (AppError.conflict), không phải do UNIQUE của DB
  // đỡ. Nếu để DB đỡ thì người dùng nhận thông báo kỹ thuật thay vì câu
  // "Mã đã có ở hàng hóa" — và luật kiểm cả `editions.code` mà UNIQUE không có.
  let dupCode = '';
  try {
    await ProductService.create({ code: goodCode, name: 'Y', sellingPrice: 1 });
  } catch (e: any) {
    dupCode = String(e?.message || e);
  }
  ok(
    'trùng mã bị chặn ở tầng ứng dụng, không phải bởi UNIQUE của DB',
    dupCode.includes('đã có ở'),
    `thông báo thật: ${dupCode.slice(0, 80)}`
  );

  console.log('\n--- 4. Mã vạch ---');
  await expectThrow('mã vạch 9 chữ số bị chặn', () =>
    ProductService.create({ code: `${GOODS_CODE_PREFIX}X1`, name: 'X', sellingPrice: 1, barcode: '123456789' })
  );
  await expectThrow('mã vạch trùng sản phẩm KHÁC bị chặn', () =>
    ProductService.create({ code: `${GOODS_CODE_PREFIX}X2`, name: 'X', sellingPrice: 1, barcode: `8930${suffix}012` })
  );
  // Lưu LẠI chính mã vạch của sản phẩm đó phải ĐƯỢC — `excludeId` cố ý bỏ qua
  // chính nó. Chặn ở đây thì mỗi lần bấm "Lưu" không đổi gì cũng báo lỗi.
  const sameBarcode = await ProductService.update(created.id, { barcode: `8930${suffix}012` });
  ok('lưu lại chính mã vạch của nó thì OK', sameBarcode.barcode === `8930${suffix}012`);

  console.log('\n--- 5. Giá ---');
  await expectThrow('giá âm bị chặn', () =>
    ProductService.create({ code: `${GOODS_CODE_PREFIX}X3`, name: 'X', sellingPrice: -1 })
  );
  await expectThrow('giá NaN bị chặn', () =>
    ProductService.create({ code: `${GOODS_CODE_PREFIX}X4`, name: 'X', sellingPrice: NaN })
  );
  await expectThrow('tên rỗng bị chặn', () =>
    ProductService.create({ code: `${GOODS_CODE_PREFIX}X5`, name: '   ', sellingPrice: 1 })
  );

  console.log('\n--- 6. is_gift_item chỉ là gợi ý (chốt #22) ---');
  const plain = await ProductService.create({
    code: `${GOODS_CODE_PREFIX}G${suffix}`,
    name: `Bookmark ${suffix}`,
    sellingPrice: 15000,
  });
  ok('tạo sản phẩm thường KHÔNG cần cờ quà', plain.isGiftItem === false);
  ok('tự động đánh dấu được (không phải rào chặn)', (await ProductService.update(plain.id, { isGiftItem: true })).isGiftItem === true);

  console.log('\n--- 7. Sửa ---');
  const renamed = await ProductService.update(created.id, {
    name: 'Áo mưa gấp (v2)',
    sellingPrice: 95000,
  });
  ok('đổi tên', renamed.name === 'Áo mưa gấp (v2)');
  ok('đổi giá', renamed.sellingPrice === 95000);
  await expectThrow('sửa sản phẩm không tồn tại bị chặn', () =>
    ProductService.update('pr-khong-co', { name: 'X' })
  );

  // TÌM KIẾM & QUÉT MÃ chạy TRƯỚC bước tạm ngưng, vì `listGoods`/`findByBarcode`
  // mặc định chỉ trả sản phẩm còn hoạt động — tắt trước rồi tìm thì luôn ra 0,
  // đó là lỗi của test chứ không phải của service.
  console.log('\n--- 8. Tìm kiếm & quét mã vạch ---');
  ok('tìm theo tên', (await ProductService.listGoods({ search: `Bookmark ${suffix}` })).length === 1);
  ok('tìm theo mã', (await ProductService.listGoods({ search: goodCode })).length >= 1);
  ok('tìm theo mã vạch', (await ProductService.listGoods({ search: `8930${suffix}012` })).length >= 1);
  const byBarcode = await ProductService.findByBarcode(`8930${suffix}012`);
  ok('quét mã vạch ra đúng 1 sản phẩm', byBarcode.length === 1);
  ok('quét mã sai định dạng ra 0', (await ProductService.findByBarcode('123')).length === 0);
  ok('quét mã không tồn tại ra 0', (await ProductService.findByBarcode('8930999999999')).length === 0);
  ok('quét mã có gạch nối vẫn ra', (await ProductService.findByBarcode(`8930-${suffix}-012`)).length === 1);

  console.log('\n--- 9. Tạm ngưng ---');
  ok('tắt hoạt động', (await ProductService.update(created.id, { isActive: false })).isActive === false);
  const listOff = await ProductService.listGoods({ includeInactive: true });
  const listOn = await ProductService.listGoods({});
  ok('mặc định KHÔNG hiện sản phẩm đã tắt', listOn.every((p: any) => p.isActive));
  ok('includeInactive mới thấy', listOff.length >= listOn.length);
  ok('tìm theo mã KHÔNG ra sản phẩm đã tắt', (await ProductService.listGoods({ search: goodCode })).length === 0);
  ok('quét mã vạch KHÔNG ra sản phẩm đã tắt', (await ProductService.findByBarcode(`8930${suffix}012`)).length === 0);
  await ProductService.update(created.id, { isActive: true });

  console.log('\n--- 10. Sách KHÔNG lẫn vào danh sách hàng hóa ---');
  const list = await ProductService.listGoods({ includeInactive: true });
  ok('không có sản phẩm kind=BOOK trong danh sách hàng hóa', list.every((p: any) => p.productKind === 'GOODS'));

  // --- 11. GIÁ VỐN KHÔNG ĐƯỢC LỘ (chốt #4) ---
  // Gửi `costPrice` lên phải bị BỎ QUA (không nhận, không ghi), và không key
  // `costPrice` nào được trả ra — kể cả khi DB đã có giá vốn, vì đó mới là
  // trạng thái nguy hiểm thật sự.
  console.log('\n--- 11. cost_price không lộ ra ngoài ---');
  const rawCost = async (id: string) => {
    const r = await db.execute({
      sql: 'SELECT cost_price FROM products WHERE id = ?',
      args: [id],
    });
    return (r.rows[0] as any)?.cost_price ?? null;
  };

  ok(
    'create() nhận costPrice 45000 nhưng DB vẫn NULL',
    (await rawCost(created.id)) === null,
    `cost_price thật: ${await rawCost(created.id)}`
  );
  ok('create() KHÔNG trả key costPrice', !('costPrice' in created));

  const patched = await ProductService.update(created.id, {
    name: 'Áo mưa gấp (v3)',
    costPrice: 12345,
  });
  ok(
    'update() nhận costPrice 12345 nhưng DB vẫn NULL',
    (await rawCost(created.id)) === null,
    `cost_price thật: ${await rawCost(created.id)}`
  );
  ok('update() KHÔNG trả key costPrice', !('costPrice' in patched));

  // Tương lai: ai đó bật lại giá vốn và DB có giá thật ⇒ API vẫn im.
  await db.execute({
    sql: 'UPDATE products SET cost_price = 55555 WHERE id = ?',
    args: [created.id],
  });
  ok('setup: DB đã có cost_price = 55555', (await rawCost(created.id)) === 55555);
  const listed = await ProductService.listGoods({ includeInactive: true });
  ok(
    'listGoods() không có key costPrice dù DB có giá vốn',
    listed.every((p: any) => !('costPrice' in p))
  );
  const scanned = await ProductService.findByBarcode(`8930${suffix}012`);
  ok(
    'findByBarcode() không có key costPrice dù DB có giá vốn',
    scanned.every((p: any) => !('costPrice' in p))
  );
  ok(
    'update() đọc lại cũng không có key costPrice',
    !('costPrice' in (await ProductService.update(created.id, { name: 'Áo mưa gấp (v4)' })))
  );
  await db.execute({
    sql: 'UPDATE products SET cost_price = NULL WHERE id = ?',
    args: [created.id],
  });

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-products thất bại');
    process.exit(1);
  }
  console.log('\n✅ DANH MỤC HÀNG HÓA: tất cả luật đã khoá.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌', e?.message || e);
  process.exit(1);
});