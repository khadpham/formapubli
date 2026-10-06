/**
 * scripts/test-shopee-ui-hidden.ts — UI Shopee ẩn theo cờ server.
 *
 * VÌ SAO CẦN: UI làm sẵn nhưng chưa được lộ ra ngoài khi cờ tắt. Khóa 4 điều
 * bằng kiểm tra mã nguồn + hàm thuần (không cần trình duyệt):
 * 1. Đơn SHOPEE có nhãn "Shopee" và rơi vào nhóm Online của Sổ (không còn
 *    "Kênh khác" / biến mất khi lọc).
 * 2. Nút tab Shopee trong Cài Đặt chỉ hiện khi cờ server bật.
 * 3. Panel tự trả null khi cờ tắt; mục cấu hình chỉ chủ thấy.
 * 4. API status không rò secret (không có partnerKey/token trong response).
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-shopee-ui-hidden
 */
import fs from 'node:fs';
import path from 'node:path';
import { channelLabel } from '../src/lib/sales-view';

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

function src(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

function main() {
  // 1. Nhãn + nhóm slicer.
  eq2('nhãn kênh SHOPEE là "Shopee"', channelLabel('SHOPEE'), 'Shopee');
  eq2(
    'SHOPEE rơi vào nhóm Online của Sổ',
    src('src/components/sales/SalesLedgerView.tsx').includes("SHOPEE: 'ONLINE'"),
    true
  );

  // 2. Nút tab ẩn theo cờ.
  const settings = src('src/components/settings/SettingsRbacView.tsx');
  eq2('tab Shopee gắn cờ showShopee', settings.includes('showShopee && canSeeShopee'), true);
  eq2('cờ đọc từ API status', settings.includes('/api/shopee/status'), true);

  // 3. Panel tự ẩn + phân quyền (vận hành đã chuyển sang tab Shopee).
  const panel = src('src/components/settings/ShopeePanel.tsx');
  eq2('panel null khi cờ tắt', panel.includes('if (!status?.uiEnabled) return null'), true);
  eq2('cấu hình chỉ chủ thấy', panel.includes('isOwner &&'), true);
  const tab = src('src/components/shopee/ShopeeTab.tsx');
  eq2('nút giao hàng có nhãn thao tác rõ', tab.includes('Giao đơn Shopee'), true);

  // 4. API status không rò secret.
  const statusRoute = src('src/app/api/shopee/status/route.ts');
  eq2('status đọc cờ server', statusRoute.includes('SHOPEE_UI_ENABLED'), true);
  eq2('status không trả partnerKey', !statusRoute.includes('partnerKey'), true);
  eq2('status không trả refresh_token', !statusRoute.includes('refresh_token'), true);

  console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
  if (fail > 0) {
    console.error('\n❌ test-shopee-ui-hidden thất bại.');
    process.exit(1);
  }
  console.log('\n✅ UI SHOPEE ẨN ĐÚNG CỜ.');
  process.exit(0);
}

main();
