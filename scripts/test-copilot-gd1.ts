/**
 * Copilot GĐ1 — revamp: tên hiển thị tiếng Việt + tên người thật,
 * làm đẹp UI drawer, tools mới (hợp đồng, công nợ đại lý).
 *
 * Task 1: không còn mã ROLE_* lộ ra UI Copilot; USER_ROLES có label tiếng Việt.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { USER_ROLES } from '../src/lib/roles';

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  const drawerPath = path.join(__dirname, '..', 'src', 'components', 'copilot', 'CopilotDrawer.tsx');
  const src = fs.readFileSync(drawerPath, 'utf8');
  const lines = src.split('\n');

  // 1. Không còn literal ROLE_ trong chuỗi hiển thị cho user.
  //    Cho phép: comment, và so sánh 'ROLE_X' === (logic phân quyền).
  const bad: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('ROLE_')) continue;
    const trimmed = line.trim();
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    const isComparison = /===\s*['"]ROLE_|['"]ROLE_[A-Z_]+['"]\s*===|!==\s*['"]ROLE_|['"]ROLE_[A-Z_]+['"]\s*!==/.test(line);
    if (!isComment && !isComparison) bad.push(`${i + 1}: ${trimmed.slice(0, 120)}`);
  }
  ok(bad.length === 0, `ROLE_ lộ ra UI Copilot: ${bad.join(' | ')}`);

  // 2. Drawer phải render label tiếng Việt từ USER_ROLES (không in mã role thô).
  ok(src.includes('USER_ROLES[currentRole]'), 'drawer dùng USER_ROLES[currentRole] để hiện tên vai trò');

  // 3. USER_ROLES có label tiếng Việt cho 2 vai trò được dùng Copilot.
  for (const role of ['ROLE_OWNER', 'ROLE_MANAGER'] as const) {
    const label = USER_ROLES[role]?.label;
    ok(typeof label === 'string' && label.length > 0, `${role} có label`);
    ok(!label.includes('ROLE_'), `${role} label không chứa mã ROLE_: ${label}`);
  }

  console.log(`✅ test-copilot-gd1 (task 1): ${checks} checks passed`);

  // --- Task 2: làm đẹp UI drawer ---
  const loadingHits = ['Đang phân tích', 'Đang tra cứu', 'Đang tổng hợp'].filter((s) => src.includes(s)).length;
  ok(loadingHits >= 2, `loading theo giai đoạn (thấy ${loadingHits}/3 mốc)`);
  ok(src.includes('<details'), 'model picker thu gọn trong <details>');

  console.log(`✅ test-copilot-gd1 (task 2): ${checks} checks passed`);
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
