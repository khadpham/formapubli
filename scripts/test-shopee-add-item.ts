/**
 * Test đăng COMBO11 lên Shopee SANDBOX.
 * Chạy: npx tsx scripts/test-shopee-add-item.ts (trên VPS dev, env sandbox)
 * KHÔNG đụng production.
 */
import { uploadImageToShopee } from '../src/services/shopee/media';
import { addShopeeItem } from '../src/services/shopee/product';
import type { ShopeeSyncConfig } from '../src/services/shopee/order-sync';

// COMBO11 từ spreadsheet (dòng 96)
const COMBO11 = {
  sku: 'COMBO11',
  name: '[Combo] Truyện ngắn Faulkner - Đốt kho & Lá đỏ',
  description: `GIỚI THIỆU COMBO: TRUYỆN NGẮN FAULKNER

Bộ đôi tuyển tập truyện ngắn tiêu biểu của đại văn hào William Faulkner - chủ nhân giải Nobel Văn chương năm 1949.

THÔNG TIN BỘ SÁCH (2 CUỐN):
1. Đốt kho (Ngắn 1) - William Faulkner
2. Lá đỏ - William Faulkner

Đơn vị phát hành: FORMApubli`,
  price: 278000,
  stock: 100,
  imageUrl: 'https://i.ibb.co/TBdz33s2/5.png', // Ảnh trực tiếp từ ibb.co/FbCGTTF3
  weight: 0.5, // kg (ước tính 2 cuốn)
};

/** Category Adult's Books (leaf) trên sandbox. */
const CATEGORY_ID = 301543;

async function main() {
  const cfg: ShopeeSyncConfig = {
    shopId: Number(process.env.SHOPEE_SHOP_ID || '0'),
    partnerId: Number(process.env.SHOPEE_PARTNER_ID || '0'),
    partnerKey: `${process.env.SHOPEE_PARTNER_KEY || ''}`,
    baseUrl: `${process.env.SHOPEE_BASE_URL || ''}`,
    warehouseId: 'wh-au-co',
  };
  console.log(`Shop: ${cfg.shopId} | Host: ${cfg.baseUrl}`);
  console.log(`\n=== ${COMBO11.sku}: ${COMBO11.name} ===`);

  // 1. Tải ảnh
  console.log('\n1. Tải ảnh từ URL...');
  const imgRes = await fetch(COMBO11.imageUrl);
  if (!imgRes.ok) throw new Error(`Tải ảnh thất bại: ${imgRes.status}`);
  const imageBuffer = Buffer.from(await imgRes.arrayBuffer());
  console.log(`   OK: ${imageBuffer.length} bytes`);

  // 2. Upload lên Shopee
  console.log('\n2. Upload ảnh lên Shopee sandbox...');
  const imageId = await uploadImageToShopee(cfg, imageBuffer, 'combo11.png');
  console.log(`   OK: image_id=${imageId}`);

  // 3. Tạo sản phẩm
  console.log('\n3. Tạo sản phẩm trên Shopee sandbox...');
  const itemId = await addShopeeItem(cfg, {
    name: COMBO11.name,
    description: COMBO11.description,
    price: COMBO11.price,
    stock: COMBO11.stock,
    itemSku: COMBO11.sku,
    imageIdList: [imageId],
    categoryId: CATEGORY_ID,
    weight: COMBO11.weight,
  });
  console.log(`   OK: item_id=${itemId}`);

  console.log('\n=== THÀNH CÔNG ===');
  console.log(`COMBO11 đã tạo trên sandbox với item_id=${itemId}`);
}

main().catch((e) => {
  console.error('\nLỖI:', e.message);
  process.exit(1);
});
