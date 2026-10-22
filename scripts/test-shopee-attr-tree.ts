import { getShopeeAttributes } from '../src/services/shopee/product';
import type { ShopeeSyncConfig } from '../src/services/shopee/order-sync';

async function main() {
  const cfg: ShopeeSyncConfig = {
    shopId: Number(process.env.SHOPEE_SHOP_ID || '0'),
    partnerId: Number(process.env.SHOPEE_PARTNER_ID || '0'),
    partnerKey: `${process.env.SHOPEE_PARTNER_KEY || ''}`,
    baseUrl: `${process.env.SHOPEE_BASE_URL || ''}`,
    warehouseId: 'wh-au-co',
  };
  const attrs = await getShopeeAttributes(cfg, 301543);
  console.log(`Category 301543 có ${attrs.length} attributes:`);
  for (const a of attrs) {
    console.log(`- [${a.is_mandatory ? 'BAT BUOC' : 'tuy chon'}] ${a.attribute_id}: ${a.original_attribute_name} (${a.input_type})`);
    if (a.attribute_value_list && a.attribute_value_list.length > 0) {
      for (const v of a.attribute_value_list.slice(0, 8)) {
        console.log(`    value_id=${v.value_id}: ${v.original_value_name}`);
      }
      if (a.attribute_value_list.length > 8) console.log(`    ... (${a.attribute_value_list.length} values)`);
    }
  }
}
main().catch((e) => { console.error('LOI:', e.message); process.exit(1); });
