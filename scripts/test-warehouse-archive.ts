/**
 * scripts/test-warehouse-archive.ts — kho ngưng = archive.
 *
 * VÌ SAO CẦN: kho Hồ Gươm ngưng vẫn hiện trong dropdown Cổng Portal
 * ("— đã ngưng" mà vẫn chọn được). Quy ước: kho isActive=false biến khỏi
 * MỌI chỗ chọn; chỉ màn quản trị (mở lại/xem lịch sử) xin rõ qua
 * ?includeInactive=true. Khóa 3 điều:
 * 1. Route /api/warehouses lọc inactive mặc định, chỉ mở khi có
 *    includeInactive=true + quyền quản lý.
 * 2. Màn quản trị (WarehouseManagerPanel, StaffManager, CampaignModal)
 *    truyền includeInactive=true.
 * 3. Mặt chọn kho nghiệp vụ (PortalSettingsPanel, ShopeePanel) KHÔNG
 *    truyền — luôn sạch.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-warehouse-archive
 */
import fs from 'node:fs';
import path from 'node:path';

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

const src = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

async function main() {
  const route = src('src/app/api/warehouses/route.ts');
  ok('route lọc inactive mặc định', /list\.filter\(/.test(route) && route.includes('isActive'));
  ok('route có cổng includeInactive', route.includes("includeInactive') === 'true'"));
  ok('cổng includeInactive gắn quyền quản lý', /includeInactive.*isPrivileged|isPrivileged.*includeInactive/.test(route));

  const mgr = src('src/components/inventory/WarehouseManagerPanel.tsx');
  ok('quản lý kho xin includeInactive', mgr.includes('includeInactive=true'));
  const staff = src('src/components/settings/StaffManager.tsx');
  ok('gán nhân sự xin includeInactive', staff.includes('includeInactive=true'));
  const camp = src('src/components/inventory/CampaignModal.tsx');
  ok('modal chiến dịch xin includeInactive', camp.includes('includeInactive=true'));

  const portal = src('src/components/settings/PortalSettingsPanel.tsx');
  ok('cổng portal không xin includeInactive', !portal.includes('includeInactive'));
  const shopee = src('src/components/settings/ShopeePanel.tsx');
  ok('panel Shopee không xin includeInactive', !shopee.includes('includeInactive'));

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-warehouse-archive thất bại.');
    process.exit(1);
  }
  console.log('\n✅ KHO NGƯNG ĐÃ ARCHIVE.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-warehouse-archive crash:', err);
  process.exit(1);
});
