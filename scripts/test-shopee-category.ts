/**
 * Test lấy category sách trên Shopee sandbox.
 * Chạy: npx tsx scripts/test-shopee-category.ts (trên VPS dev, env sandbox)
 */
import { getShopeeCategories } from '../src/services/shopee/product';
import type { ShopeeSyncConfig } from '../src/services/shopee/order-sync';

async function main() {
  const cfg: ShopeeSyncConfig = {
    shopId: Number(process.env.SHOPEE_SHOP_ID || '0'),
    partnerId: Number(process.env.SHOPEE_PARTNER_ID || '0'),
    partnerKey: `${process.env.SHOPEE_PARTNER_KEY || ''}`,
    baseUrl: `${process.env.SHOPEE_BASE_URL || ''}`,
    warehouseId: 'wh-au-co',
  };
  console.log(`Shop: ${cfg.shopId}, Partner: ${cfg.partnerId}, Host: ${cfg.baseUrl}`);

  const roots = await getShopeeCategories(cfg, 0);
  console.log(`\nTổng ${roots.length} categories gốc:`);

  // Tìm sách
  const bookRoots = roots.filter(
    (c) =>
      c.display_category_name?.toLowerCase().includes('sách') ||
      c.category_name?.toLowerCase().includes('book')
  );
  for (const b of bookRoots) {
    console.log(`  ${b.category_id}: ${b.display_category_name} (has_children=${b.has_children})`);
    if (b.has_children) {
      const children = await getShopeeCategories(cfg, b.category_id);
      console.log(`    -> ${children.length} con:`);
      for (const ch of children.slice(0, 10)) {
        console.log(`       ${ch.category_id}: ${ch.display_category_name} (has_children=${ch.has_children})`);
      }
    }
  }
}

main().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
