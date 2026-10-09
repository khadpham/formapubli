/**
 * scripts/test-campaign-modal.ts — luật 1 modal/lúc cho Kho + Chiến dịch.
 *
 * VÌ SAO CẦN: panel "Quản Lý Kho Hàng" từng mở modal "Mở kho mới" đè lên
 * chính nó (2 lớp modal chồng nhau); CampaignPanel chiếm chỗ thường trực
 * trong tab Kho. Khóa 4 điều:
 * 1. Không còn file/khai báo CreateWarehouseModal trong src (form tạo kho
 *    nằm gấp gọn trong WarehouseManagerPanel).
 * 2. WarehouseManagerPanel không còn prop onOpenCreate.
 * 3. MasterAppShell không nhúng CampaignPanel inline (nút + CampaignModal).
 * 4. CampaignModal chỉ Chủ/Quản lý (render null với role khác).
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-campaign-modal
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
  ok(
    'không còn file CreateWarehouseModal',
    !fs.existsSync(path.resolve(process.cwd(), 'src/components/inventory/CreateWarehouseModal.tsx'))
  );

  const matrix = src('src/components/StockOverviewMatrix.tsx');
  ok('matrix không nhắc CreateWarehouseModal', !matrix.includes('CreateWarehouseModal'));

  const mgr = src('src/components/inventory/WarehouseManagerPanel.tsx');
  ok('manager không còn prop onOpenCreate', !mgr.includes('onOpenCreate'));
  ok('manager có form tạo kho inline', mgr.includes('aria-label="Mở kho mới"'));

  const shell = src('src/components/layout/MasterAppShell.tsx');
  ok('shell dùng CampaignModal', shell.includes('CampaignModal'));
  ok('shell không nhúng CampaignPanel inline', !shell.includes('<CampaignPanel'));

  const modal = src('src/components/inventory/CampaignModal.tsx');
  ok(
    'modal chặn role phi quản lý',
    modal.includes("currentRole !== 'ROLE_OWNER'") && modal.includes("currentRole !== 'ROLE_MANAGER'")
  );
  ok(
    'view chuyển hàng thay shell (không chồng modal)',
    /if \(transferFor\?\.warehouseId\) \{/.test(modal)
  );

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-campaign-modal thất bại.');
    process.exit(1);
  }
  console.log('\n✅ MODAL KHO + CHIẾN DỊCH ĐÚNG LUẬT.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ test-campaign-modal crash:', err);
  process.exit(1);
});
