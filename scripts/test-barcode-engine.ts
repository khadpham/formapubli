import { db, editions } from '../src/db';
import { resolveScan } from '../src/lib/scan-resolve';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-barcode-engine');

/**
 * AUTOMATED TEST SUITE: IN-APP BARCODE & ISBN RESOLVER ENGINE
 * Kiểm thử tính năng nhận diện mã vạch EAN-13 / ISBN-13 và mapping vào toàn bộ đầu sách
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

  // Dùng ĐÚNG hàm của production (`src/lib/scan-resolve.ts`), không chép lại.
  // Bản chép trước đây còn dùng `endsWith` vô điều kiện — khác hẳn code POS —
  // nên có thể xanh trên code sai (đúng cái lỗi AGENTS.md cấm).
  // `stockOf` giả: bộ test này chỉ hỏi "mã này tra ra được ấn bản nào", tồn kho
  // không thuộc phạm vi (xem `test-duplicate-isbn-pos.ts` cho phần tồn).
  const stockOf = () => 1;
  const resolveBarcode = (scannedCode: string) => {
    const r = resolveScan(scannedCode, allEditions, stockOf);
    return r.kind === 'none' ? undefined : r.kind === 'single' ? r.book : r.all[0];
  };

  // TEST 1: Quét mã vạch chuẩn 13 số liền EAN-13
  // ISBN là giá trị CỐ ĐỊNH của bản in (không đổi khi đổi mã SKU) → giữ nguyên,
  // chỉ đổi phần assert mã/tên sang mã hiện hành trong danh mục.
  const benhTuong = resolveBarcode('9786043687507');
  assert(
    benhTuong !== undefined && benhTuong.title === 'Bệnh tưởng',
    'Nhận diện mã vạch EAN-13 chuẩn (9786043687507 ➔ Bệnh tưởng)',
    `Tác phẩm: [${benhTuong?.code}] ${benhTuong?.title}`
  );

  // TEST 2: Quét mã vạch có dấu gạch nối (Format in ấn trên sách)
  const nguoiBienLan = resolveBarcode('978-604-368-749-1');
  assert(
    nguoiBienLan !== undefined && nguoiBienLan.title === 'Người biển lận',
    'Khử định dạng gạch nối thành công (978-604-368-749-1 ➔ Người biển lận)',
    `Tác phẩm: [${nguoiBienLan?.code}] ${nguoiBienLan?.title}`
  );

  // TEST 3: Quét theo 4 số cuối ISBN (Fast 4-digit barcode scanner)
  const truongGia = resolveBarcode('7484');
  assert(
    truongGia !== undefined && truongGia.title === 'Trưởng giả học làm sang',
    'Nhận diện theo 4 số cuối ISBN (7484 ➔ Trưởng giả học làm sang)',
    `Tác phẩm: [${truongGia?.code}] ${truongGia?.title}`
  );

  // TEST 4: Quét theo mã SKU sản phẩm — lấy 1 ấn bản thật trong danh mục
  // rồi quét chính mã đó (mã SKU đổi theo từng đợt nên không hardcode).
  const skuTarget = allEditions[allEditions.length - 1];
  const bySku = resolveBarcode(skuTarget.code);
  assert(
    bySku !== undefined && bySku.id === skuTarget.id,
    `Nhận diện theo mã SKU (${skuTarget.code} ➔ ${skuTarget.title})`,
    `Tác phẩm: [${bySku?.code}] ${bySku?.title}`
  );

  // TEST 5: Quét mã vạch trùng ISBN tái bản (2 bản "Le Spleen de Paris" dùng
  // chung ISBN 9786044737690). Mã SKU đã đổi nên tra tập mã từ chính CSDL.
  const sharedIsbn = '9786044737690';
  const sharedEditions = allEditions.filter((e) => e.isbn === sharedIsbn);
  const baudelaire = resolveBarcode(sharedIsbn);
  assert(
    sharedEditions.length === 2 &&
      baudelaire !== undefined &&
      sharedEditions.some((e) => e.id === baudelaire.id),
    `Xử lý trường hợp tái bản chung ISBN (${sharedIsbn} ➔ ${sharedEditions.map((e) => e.code).join(' / ')})`,
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
