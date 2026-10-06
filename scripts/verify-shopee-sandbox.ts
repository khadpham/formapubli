/**
 * NGHIỆM THU SANDBOX SHOPEE — tầng 3 (HTTP thật, API Shopee thật).
 *
 * Chạy từng GIAI ĐOẠN vì đơn sandbox không thể đi hết luồng trong 1 lệnh
 * (ship xong phải đợi trạng thái DELIVERED trên sàn mô phỏng):
 *
 *   Kiểm cấu hình + token:
 *     npx tsx scripts/verify-shopee-sandbox.ts env
 *   Kéo đơn sandbox về + trừ kho:
 *     npx tsx scripts/verify-shopee-sandbox.ts sync
 *   Giao hàng + lấy mã vận đơn (cần orderSn từ bước sync):
 *     npx tsx scripts/verify-shopee-sandbox.ts ship --orderSn=XXXX
 *   Đơn đã DELIVERED → đối soát escrow từng đồng:
 *     npx tsx scripts/verify-shopee-sandbox.ts escrow --orderSn=XXXX
 *
 * AN TOÀN:
 *  · KHÔNG BAO GIỜ in partner_key/token ra log.
 *  · Chạy trên DB dev (formapubli.db) — đây là nghiệm thu sandbox, không phải
 *    suite cô lập. Sai số sẽ thấy ngay trong từng bước.
 *  · Thiếu env → dừng ngay với hướng dẫn, không thử gọi API mù.
 */
import { db, orders, orderItems, inventoryLedger, stockBalances } from '../src/db';
import { and, eq } from 'drizzle-orm';
import { pullShopeeOrders, type ShopeeSyncConfig } from '../src/services/shopee/order-sync';
import { shipShopeeOrder, getAwbPdf } from '../src/services/shopee/shipment';
import { syncEscrow } from '../src/services/shopee/escrow-sync';
import { TursoTokenStorage } from '../src/services/shopee/token-store';
import { getShopeeConfig } from '../src/services/shopee/shop-config';
import { generateShopeeSign } from '../src/services/shopee/sign';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function readCfg(): ShopeeSyncConfig {
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
  const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
  const shopId = Number(process.env.SHOPEE_SHOP_ID || '0');
  const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.test-stable.shopeemobile.com'}`.replace(/\/$/, '');
  const missing: string[] = [];
  if (!partnerId) missing.push('SHOPEE_PARTNER_ID');
  if (!partnerKey) missing.push('SHOPEE_PARTNER_KEY');
  if (!shopId) missing.push('SHOPEE_SHOP_ID');
  if (missing.length) {
    console.error('\n❌ Thiếu biến môi trường: ' + missing.join(', '));
    console.error('   Xem docs/shopee/12-nghiem-thu-sandbox.md — mục "Biến môi trường".');
    process.exit(1);
  }
  return { shopId, partnerId, partnerKey, baseUrl, warehouseId: '', codEnabled: false };
}

function argOrderSn(): string {
  const a = process.argv.find((x) => x.startsWith('--orderSn='));
  const sn = a ? a.slice('--orderSn='.length).trim() : '';
  if (!sn) {
    console.error('❌ Thiếu --orderSn=<mã đơn Shopee> (lấy từ bước sync).');
    process.exit(1);
  }
  return sn;
}

async function stageEnv() {
  console.log('\n=== GIAI ĐOẠN 1: cấu hình + token ===');
  const cfg = readCfg();
  ok('Base URL sandbox', cfg.baseUrl.includes('test-stable'), cfg.baseUrl);
  const shopCfg = await getShopeeConfig();
  ok('Kho xuất đã cấu hình (DB/env)', !!shopCfg.warehouseId, shopCfg.warehouseId || '(trống — cấu hình trong tab Cài Đặt → Shopee)');
  const token = await new TursoTokenStorage(cfg.shopId).get();
  ok('Token đã lưu trong DB', !!token?.access_token, token ? `hết hạn ${new Date(token.expired_at).toLocaleString('vi-VN')}` : 'chưa ủy quyền');
  if (!token?.access_token) {
    const apiPath = '/api/v2/shop/auth_partner';
    const { timestamp, sign } = generateShopeeSign({ partnerId: cfg.partnerId, partnerKey: cfg.partnerKey, apiPath });
    console.log('\n→ Chưa có token. Mở app → Cài Đặt → Shopee → "Ủy Quyền Ngay",');
    console.log('  hoặc mở trực tiếp URL (đăng nhập Chủ trước):');
    console.log(`  ${cfg.baseUrl}${apiPath}?partner_id=${cfg.partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent('http://localhost:3000/api/shopee/callback')}`);
  }
}

async function stageSync() {
  console.log('\n=== GIAI ĐOẠN 2: kéo đơn sandbox + trừ kho ===');
  const cfg = readCfg();
  const shopCfg = await getShopeeConfig();
  if (!shopCfg.warehouseId) {
    console.error('❌ Chưa cấu hình kho xuất. Vào app → Cài Đặt → Shopee → chọn kho, rồi chạy lại.');
    process.exit(1);
  }
  const full: ShopeeSyncConfig = { ...cfg, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled };
  // Cửa sổ 15 ngày: giới hạn get_order_list của Shopee.
  const timeTo = Date.now() / 1000;
  const timeFrom = timeTo - 14 * 86400;
  const r = await pullShopeeOrders(full, timeFrom, timeTo);
  ok('Kéo đơn không ném lỗi', true);
  console.log(`  → pulled=${r.pulled} skipped=${r.skipped} quarantined=${r.quarantined.length}`);
  if (r.quarantined.length) {
    for (const q of r.quarantined) console.log(`    Cách ly: #${q.orderSn} SKU ${q.sku} — ${q.reason}`);
  }
  if (r.pulled === 0) {
    console.log('  (Chưa có đơn mới — vào Seller Center sandbox đặt 1 đơn test rồi chạy lại.)');
    return;
  }
  const shopeeOrders = await db
    .select({ id: orders.id, sn: orders.idempotencyKey, shipping: orders.shippingStatus })
    .from(orders)
    .where(eq(orders.channel, 'SHOPEE'));
  for (const o of shopeeOrders) {
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    for (const ln of lines) {
      const bal = await db
        .select({ q: stockBalances.physicalQuantity })
        .from(stockBalances)
        .where(and(eq(stockBalances.productId, ln.productId), eq(stockBalances.warehouseId, shopCfg.warehouseId)))
        .limit(1);
      const ledger = await db
        .select({ id: inventoryLedger.id })
        .from(inventoryLedger)
        .where(and(eq(inventoryLedger.productId, ln.productId), eq(inventoryLedger.documentRef, `SHOPEE_${(o.sn || '').replace('shopee-', '')}`)))
        .limit(1);
      ok(`#${o.sn} ${ln.productId}: có bút toán DISPATCH_SALE`, ledger.length > 0);
      ok(`#${o.sn} ${ln.productId}: tồn còn ${bal[0]?.q ?? 0} ≥ 0`, (bal[0]?.q ?? 0) >= 0);
    }
    console.log(`  → Đơn #${(o.sn || '').replace('shopee-', '')} (${o.shipping}) — dùng mã này cho bước ship/escrow.`);
  }
}

async function stageShip() {
  console.log('\n=== GIAI ĐOẠN 3: giao hàng + vận đơn ===');
  const cfg = readCfg();
  const shopCfg = await getShopeeConfig();
  const full: ShopeeSyncConfig = { ...cfg, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled };
  const sn = argOrderSn();
  const out = await shipShopeeOrder(full, sn, 'ROLE_OWNER', 'sandbox-verify');
  ok(`Giao #${sn} → tracking ${out.trackingCode}`, !!out.trackingCode, `carrier ${out.carrier || '?'}`);
  const pdf = await getAwbPdf(full, sn);
  ok('Tải PDF vận đơn A6', pdf.length > 1000, `${(pdf.length / 1024).toFixed(1)} KB`);
  const after = await db
    .select({ shipping: orders.shippingStatus, tracking: orders.trackingCode })
    .from(orders)
    .where(eq(orders.idempotencyKey, `shopee-${sn}`))
    .limit(1);
  ok('shippingStatus → PICKED_UP', after[0]?.shipping === 'PICKED_UP', after[0]?.shipping || '?');
  ok('trackingCode đã lưu', !!after[0]?.tracking);
}

async function stageEscrow() {
  console.log('\n=== GIAI ĐOẠN 4: đối soát escrow (đơn đã DELIVERED) ===');
  const cfg = readCfg();
  const shopCfg = await getShopeeConfig();
  const full: ShopeeSyncConfig = { ...cfg, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled };
  const sn = argOrderSn();
  const b = await syncEscrow(full, sn);
  console.log(`  #${sn}`);
  console.log(`  Khách trả:      ${b.buyerTotal.toLocaleString('vi-VN')}đ`);
  console.log(`  Phí sàn:        hoa hồng ${(b.commissionFee).toLocaleString('vi-VN')}đ + giao dịch ${(b.transactionFee).toLocaleString('vi-VN')}đ + dịch vụ ${(b.serviceFee).toLocaleString('vi-VN')}đ`);
  console.log(`  Trợ giá sàn:    ${b.shopeeDiscount.toLocaleString('vi-VN')}đ`);
  console.log(`  ESCROW VỀ:      ${b.escrowAmount.toLocaleString('vi-VN')}đ`);
  console.log(`  COGS:           ${b.cogs === null ? '(thiếu giá vốn — null, không bịa)' : b.cogs.toLocaleString('vi-VN') + 'đ'}`);
  console.log(`  LÃI RÒNG:       ${b.netProfit === null ? '(chưa đủ dữ liệu)' : b.netProfit.toLocaleString('vi-VN') + 'đ'}`);
  ok('escrowAmount > 0', b.escrowAmount > 0);
  ok('escrow = khách trả − phí − trợ giá (±1đ sai số làm tròn sàn)', Math.abs(b.buyerTotal - b.commissionFee - b.transactionFee - b.serviceFee - b.shopeeDiscount - b.escrowAmount) <= 1);
}

async function main() {
  const stage = (process.argv[2] || '').toLowerCase();
  if (stage === 'env') await stageEnv();
  else if (stage === 'sync') await stageSync();
  else if (stage === 'ship') await stageShip();
  else if (stage === 'escrow') await stageEscrow();
  else {
    console.error('Dùng: npx tsx scripts/verify-shopee-sandbox.ts <env|sync|ship|escrow> [--orderSn=...]');
    console.error('Xem docs/shopee/12-nghiem-thu-sandbox.md cho trình tự đầy đủ.');
    process.exit(1);
  }
  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ verify-shopee-sandbox crash:', e?.message || e);
  process.exit(1);
});
