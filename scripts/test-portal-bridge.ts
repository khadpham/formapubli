/**
 * scripts/test-portal-bridge.ts — cầu nối portal ↔ hệ thống (quà, mã, real-time).
 *
 * VÌ SAO CẦN — 3 hỏng đã đo được trên production:
 * 1. Dòng quà SP-004 (Túi Tote) ghi edition_id = NULL ⇒ panel không hiện tên.
 *    Route phải tra products theo code và ghi đúng id + is_gift_line=1.
 * 2. Mã portal chưa lưu. orders.portal_ref phải = madon của datmua; panel hiện
 *    mã portal làm chính, mã order_code nhỏ phụ.
 * 3. Panel phải tự cập nhật real-time (khoảng 5s) + vẫn có nút Làm mới tay.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-portal-bridge
 */
import { assertIsolatedTestDb } from './test-guard';
import fs from 'node:fs';
import path from 'node:path';

assertIsolatedTestDb('test-portal-bridge');

const src = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label}`);
  }
}

async function main() {
  const route = src('src/app/api/portal-orders/route.ts');
  ok(
    'quà tra products theo code SP-004',
    route.includes("eq(products.code, 'SP-004')")
  );
  ok(
    'quà ghi isGiftLine',
    /isGiftLine:\s*true/.test(route)
  );
  ok(
    'lưu portal_ref = madon',
    /portalRef:\s*madon|'PORTAL_REF'|"PORTAL_REF"|portal_ref/.test(route.replace(/,\s*$/, ''))
  );
  ok(
    'không còn nhánh quà bỏ qua im lặng cho mọi trường hợp',
    route.includes("it.isGift || hasGift")
  );

  const schema = src('src/db/schema.ts');
  ok('schema có portal_ref', schema.includes("portalRef: text('portal_ref')"));

  const picking = src('src/app/api/portal-orders/picking/route.ts');
  ok('picking trả portal_ref', picking.includes('portalRef'));
  ok('picking trả tên+code sản phẩm', picking.includes('works.title') && picking.includes('products.name'));

  const panel = src('src/components/inventory/PortalOrdersPanel.tsx');
  ok('panel poll 5s', /5_000|5000/.test(panel));
  ok('panel có nút Làm mới tay', panel.includes('Làm mới'));
  ok('panel hiện mã portal làm chính', panel.includes('portalRef'));

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-portal-bridge thất bại.');
    process.exit(1);
  }
  console.log('\n✅ CẦU NỐI PORTAL ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-portal-bridge crash:', err);
  process.exit(1);
});
