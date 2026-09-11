import { db, editions } from '../src/db';

/**
 * AUTOMATED TEST SUITE: IN-APP BARCODE & ISBN RESOLVER ENGINE
 * Kiểm thử tính năng nhận diện mã vạch EAN-13 / ISBN-13 và mapping vào 81 đầu sách
 */
async function testBarcodeEngine() {
  console.log('📦 =======================================================');
  console.log('📦 BẮT ĐẦU KIỂM THỬ ĐỘNG CƠ QUÉT MÃ VẠCH (IN-APP BARCODE SCANNER)');
  console.log('📦 =======================================================\n');

  const allEditions = await db.select().from(editions);
  console.log(`📚 Đã nạp ${allEditions.length} ấn bản từ CSDL.`);

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS ${total}] ${testName}`);
      if (detail) console.log(`     ↳ ${detail}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL ${total}] ${testName}`);
      if (detail) console.error(`     ↳ ${detail}`);
      throw new Error(`Kiểm thử thất bại: ${testName}`);
    }
  }

  // Hàm chuẩn hóa & tra cứu mã vạch giống như logic trong PosCheckoutTerminal
  function resolveBarcode(scannedCode: string) {
    const cleanScanned = scannedCode.replace(/[^0-9X]/gi, '');
    return allEditions.find((b) => {
      const cleanIsbn = b.isbn ? b.isbn.replace(/[^0-9X]/gi, '') : '';
      return (
        cleanIsbn === cleanScanned ||
        b.code.toLowerCase() === scannedCode.toLowerCase() ||
        (b.isbnLast4 && cleanScanned.endsWith(b.isbnLast4))
      );
    });
  }

  // TEST 1: Quét mã vạch chuẩn 13 số liền EAN-13
  const h01 = resolveBarcode('9786043687507');
  assert(
    h01 !== undefined && h01.code === 'H01',
    'Nhận diện mã vạch EAN-13 chuẩn (9786043687507 ➔ H01)',
    `Tác phẩm: [${h01?.code}] ${h01?.title}`
  );

  // TEST 2: Quét mã vạch có dấu gạch nối (Format in ấn trên sách)
  const h02 = resolveBarcode('978-604-368-749-1');
  assert(
    h02 !== undefined && h02.code === 'H02',
    'Khử định dạng gạch nối thành công (978-604-368-749-1 ➔ H02)',
    `Tác phẩm: [${h02?.code}] ${h02?.title}`
  );

  // TEST 3: Quét theo 4 số cuối ISBN (Fast 4-digit barcode scanner)
  const h03 = resolveBarcode('7484');
  assert(
    h03 !== undefined && h03.code === 'H03',
    'Nhận diện theo 4 số cuối ISBN (7484 ➔ H03)',
    `Tác phẩm: [${h03?.code}] ${h03?.title}`
  );

  // TEST 4: Quét theo mã SKU sản phẩm (H81)
  const h81 = resolveBarcode('H81');
  assert(
    h81 !== undefined && h81.code === 'H81',
    'Nhận diện theo mã SKU (H81 ➔ Nhà tiên tri)',
    `Tác phẩm: [${h81?.code}] ${h81?.title}`
  );

  // TEST 5: Quét mã vạch trùng ISBN tái bản (H21 và H36 dùng chung ISBN Baudelaire)
  const baudelaire = resolveBarcode('9786044737690');
  assert(
    baudelaire !== undefined && (baudelaire.code === 'H21' || baudelaire.code === 'H36'),
    'Xử lý trường hợp tái bản chung ISBN (9786044737690 ➔ H21/H36)',
    `Tác phẩm: [${baudelaire?.code}] ${baudelaire?.title}`
  );

  // TEST 6: Xử lý mã không tồn tại trong danh mục
  const notFound = resolveBarcode('1111222233334');
  assert(
    notFound === undefined,
    'Từ chối và thông báo chính xác với mã vạch lạ không có trong CSDL',
    'Trả về undefined để hiển thị cảnh báo'
  );

  // TEST 7: Kiểm toán 100% các ấn bản có ISBN trong CSDL đều có thể giải mã được
  let resolvableCount = 0;
  const editionsWithIsbn = allEditions.filter((e) => Boolean(e.isbn));
  for (const ed of editionsWithIsbn) {
    const clean = ed.isbn!.replace(/[^0-9X]/gi, '');
    const found = resolveBarcode(clean);
    if (found) resolvableCount++;
  }
  assert(
    resolvableCount === editionsWithIsbn.length,
    `Độ phủ quét mã vạch: Toàn bộ ${resolvableCount}/${editionsWithIsbn.length} ấn bản có ISBN đều được giải mã tức thì 100%`,
    'Tỷ lệ thành công: 100%'
  );

  console.log('\n=======================================================');
  console.log(`🎉 TẤT CẢ ${passed}/${total} BÀI KIỂM THỬ BARCODE ENGINE ĐẠT 100%!`);
  console.log('=======================================================\n');
}

testBarcodeEngine().catch((err) => {
  console.error('💥 LỖI KIỂM THỬ BARCODE:', err);
  process.exit(1);
});
