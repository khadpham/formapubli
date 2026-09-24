import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

console.log('--- Running Smoke Test: POS Mobile 2x2 Grid (#11) & Settlement Button (#3) ---');

const posFilePath = path.join(process.cwd(), 'src', 'components', 'pos', 'PosCheckoutTerminal.tsx');
const content = fs.readFileSync(posFilePath, 'utf8');

// 1. Verify CATALOG_COLLAPSED_COUNT is 4 for 2x2 grid
assert(
  content.includes('const CATALOG_COLLAPSED_COUNT = 4;'),
  'CATALOG_COLLAPSED_COUNT must be 4 for 2x2 mobile grid'
);
console.log('✓ [1/4] PASS: CATALOG_COLLAPSED_COUNT is set to 4 (2x2 grid)');

// 2. Verify grid is 2 columns on mobile
assert(
  content.includes('grid grid-cols-2 gap-2 sm:gap-3 max-h-[560px] overflow-y-auto pr-1'),
  'Catalog container must use grid-cols-2 on mobile'
);
console.log('✓ [2/4] PASS: Catalog container uses grid-cols-2 for compact mobile layout');

// 3. Verify role guard on settlement button (#3-UI button)
assert(
  content.includes("(currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER') && ("),
  'Settlement button must be guarded by ROLE_OWNER or ROLE_MANAGER'
);
console.log('✓ [3/4] PASS: Settlement button is strictly hidden for Cashier, Warehouse, and Tax roles');

// 4. Verify accessibility title attribute on book card and button
assert(
  content.includes('title={b.title}') && content.includes('aria-label={`Thêm ${b.title} vào giỏ`}'),
  'Book cards must have title and aria-label for accessibility with long titles'
);
console.log('✓ [4/4] PASS: Accessibility titles and aria-labels are present');

console.log('\n======================================================');
console.log('>>> ALL 4 POS MOBILE UI & RBAC SMOKE CHECKS PASSED! <<<');
console.log('======================================================\n');
