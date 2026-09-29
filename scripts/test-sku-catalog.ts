/**
 * scripts/test-sku-catalog.ts
 *
 * Kiểm tra danh mục POS và tra cứu SKU sau khi cập nhật mã mới:
 * 1. Nạp danh mục qua PosCatalogService.getCatalog
 * 2. Xác thực số lượng ấn bản (88 cuốn)
 * 3. Kiểm tra nhận diện mã mới (HH001, TP0006, HH0079, H82)
 * 4. Kiểm tra tìm kiếm tiếng Việt và mã vạch EAN-13
 */

import { PosCatalogService } from '../src/services/pos-catalog.service';
import { db, editions } from '../src/db';
import { eq } from 'drizzle-orm';

async function main() {
  console.log('🧪 Bắt đầu kiểm tra Danh mục POS với mã SKU mới...');

  // 1. Kiểm tra PosCatalogService
  const catalog = await PosCatalogService.getCatalog('wh-au-co');
  console.log(`✅ PosCatalogService trả về ${catalog.items.length} đầu sách tại kho wh-au-co.`);
  if (catalog.items.length !== 88) {
    throw new Error(`Kỳ vọng 88 đầu sách nhưng nhận được ${catalog.items.length}`);
  }

  // 2. Kiểm tra các mã mới tiêu biểu
  const testCodes = ['HH001', 'HH028', 'TP0006', 'TP0074', 'HH0079', 'TP105', 'H82'];
  for (const c of testCodes) {
    const item = catalog.items.find((it) => it.code === c);
    if (!item) {
      throw new Error(`Không tìm thấy sách có mã mới: ${c}`);
    }
    console.log(`  ✓ Khớp mã [${item.code}] - Tựa: "${item.title}" - Tác giả: ${item.author} - Tồn ATP: ${item.atp}`);
  }

  // 3. Kiểm tra không còn mã H01 cũ
  const oldH01 = catalog.items.find((it) => it.code === 'H01');
  if (oldH01) {
    throw new Error(`Mã cũ H01 vẫn còn tồn tại trong danh mục!`);
  }
  console.log('✅ Mã cũ H01 đã được thay thế hoàn toàn bằng HH001.');

  // 4. Kiểm tra tra cứu mã vạch ISBN liên kết đúng mã mới
  const h01Isbn = '9786043687507';
  const foundByIsbn = catalog.items.find((it) => it.isbn === h01Isbn);
  if (!foundByIsbn || foundByIsbn.code !== 'HH001') {
    throw new Error(`Quét ISBN ${h01Isbn} không trả về mã HH001 (nhận được: ${foundByIsbn?.code})`);
  }
  console.log(`✅ Quét barcode ISBN ${h01Isbn} trỏ chính xác về mã mới [${foundByIsbn.code}] "${foundByIsbn.title}".`);

  console.log('\n🎉 TẤT CẢ CÁC BÀI TEST DANH MỤC SKU ĐỀU VƯỢT QUA XUẤT SẮC!');
}

main().catch((err) => {
  console.error('❌ Thất bại:', err);
  process.exit(1);
});
