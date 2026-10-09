/**
 * scripts/test-warehouse-labels.ts — tên hiển thị kho dùng chung.
 *
 * VÌ SAO CẦN: 8 địa chỉ ký gửi đối tác (warehouseType CONSIGNMENT) từng bị
 * gọi là "Kho Ký gửi - X" khắp UI ("14 kho", dropdown kho fulfill...), trong
 * khi chúng không phải kho vận hành. Khóa 3 điều:
 * 1. CONSIGNMENT không bao giờ hiện chữ "Kho".
 * 2. Tên cũ sót lại "Kho Ký gửi - X" tự thành "Đại lý X".
 * 3. Kho thật (PHYSICAL_MAIN/FAIR_EVENT) giữ nguyên tên.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-warehouse-labels
 */
import { displayWarehouseName, warehouseTypeLabel } from '../src/lib/warehouse-labels';

let pass = 0;
let fail = 0;
function eq2(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} — nhận ${String(actual)}, cần ${String(expected)}`);
  }
}

async function main() {
  eq2('type CONSIGNMENT → Đại lý', warehouseTypeLabel('CONSIGNMENT'), 'Đại lý');
  eq2('type PHYSICAL_MAIN → Kho', warehouseTypeLabel('PHYSICAL_MAIN'), 'Kho');
  eq2('type FAIR_EVENT → Hội chợ', warehouseTypeLabel('FAIR_EVENT'), 'Hội chợ');
  eq2('type lạ → Kho', warehouseTypeLabel('NOPE'), 'Kho');

  eq2(
    'tên cũ có gạch → Đại lý X',
    displayWarehouseName({ name: 'Kho Ký gửi - Bình bán Book', warehouseType: 'CONSIGNMENT' }),
    'Đại lý Bình bán Book'
  );
  eq2(
    'tên cũ không gạch → Đại lý X',
    displayWarehouseName({ name: 'Kho Ký gửi Đông Tây', warehouseType: 'CONSIGNMENT' }),
    'Đại lý Đông Tây'
  );
  eq2(
    'đã đúng thì giữ nguyên',
    displayWarehouseName({ name: 'Đại lý Hộp', warehouseType: 'CONSIGNMENT' }),
    'Đại lý Hộp'
  );
  eq2(
    'kho thật giữ nguyên tên',
    displayWarehouseName({ name: 'Kho Âu Cơ', warehouseType: 'PHYSICAL_MAIN' }),
    'Kho Âu Cơ'
  );
  eq2(
    'kho hội chợ giữ nguyên tên',
    displayWarehouseName({ name: 'Kho Hội chợ Hồ Gươm', warehouseType: 'FAIR_EVENT' }),
    'Kho Hội chợ Hồ Gươm'
  );

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-warehouse-labels thất bại.');
    process.exit(1);
  }
  console.log('\n✅ NHÃN KHO ĐÚNG.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-warehouse-labels crash:', err);
  process.exit(1);
});
