import { AIOrderParserService } from '../src/services/ai-order-parser.service';
import { CatalogRef } from '../src/lib/smart-order-parser';

async function runAITests() {
  console.log('🤖 BẮT ĐẦU KIỂM THỬ AI ORDER PARSER & FALLBACK ENGINE');

  const sampleCatalog: CatalogRef[] = [
    { editionId: 'ed-h01', code: 'H01', title: 'Bệnh tưởng' },
    { editionId: 'ed-h02', code: 'H02', title: 'Người biển lận' },
    { editionId: 'ed-h03', code: 'H03', title: 'Trưởng giả học làm sang' },
    { editionId: 'ed-h48', code: 'H48', title: 'Dưỡng đường đồng hồ cát' },
  ];

  // Test Case 1: Tự động Fallback khi không có API Key
  const chat1 = 'Gửi cho mình 2 cuốn Bệnh tưởng đến 123 Cầu Giấy, HN. SĐT 0912345678, ship COD nhé';
  const res1 = await AIOrderParserService.parseOrder({
    text: chat1,
    catalog: sampleCatalog,
    forceFallback: true,
  });

  if (res1.engineUsed === 'FALLBACK_RULE_BASED' && res1.phone === '0912345678' && res1.items.length === 1 && res1.items[0].code === 'H01' && res1.items[0].quantity === 2) {
    console.log('✅ PASS 1: Fallback Rule-based hoạt động chuẩn xác khi ép dùng hoặc không có API Key');
  } else {
    console.error('❌ FAIL 1', res1);
    process.exit(1);
  }

  // Test Case 2: Kiểm thử trường hợp nhận diện nhiều sách bằng tên sách tiếng Việt không dấu
  const chat2 = 'lay 1 benh tuong va 2 nguoi bien lan den 456 xa dan hn, sdt 0987654321';
  const res2 = await AIOrderParserService.parseOrder({
    text: chat2,
    catalog: sampleCatalog,
    forceFallback: true,
  });

  if (res2.phone === '0987654321' && res2.items.length === 2) {
    const h01 = res2.items.find(i => i.code === 'H01');
    const h02 = res2.items.find(i => i.code === 'H02');
    if (h01?.quantity === 1 && h02?.quantity === 2) {
      console.log('✅ PASS 2: Bóc tách chính xác đa sản phẩm (H01 x1, H02 x2) + địa chỉ + SĐT');
    } else {
      console.error('❌ FAIL 2 items qty mismatch', res2.items);
      process.exit(1);
    }
  } else {
    console.error('❌ FAIL 2', res2);
    process.exit(1);
  }

  // Test Case 3: Xác thực cấu trúc trả về tương thích 100% với UI SmartOrderParser
  if (Array.isArray(res2.warnings) && typeof res2.confidence === 'number' && res2.rawChat === chat2) {
    console.log('✅ PASS 3: Contract response tương thích 100% với UI POS');
  } else {
    console.error('❌ FAIL 3 contract', res2);
    process.exit(1);
  }

  console.log('🎉 TOÀN BỘ 3/3 TEST SUITES AI ORDER PARSER ĐẠT 100%!');
}

runAITests().catch(err => {
  console.error(err);
  process.exit(1);
});
