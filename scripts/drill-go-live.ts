/**
 * DRILL GO-LIVE: diễn tập production trên staging, KHÔNG động vào prod.
 * Chạy: npx tsx scripts/drill-go-live.ts
 * 1. Xác nhận formapubli.db prod nguyên vẹn (chỉ đọc size/mtime).
 * 2. Dựng staging DB mới 100% từ migrate-fresh (chứng minh chuỗi migration sạch).
 * 3. Verify fail-closed production (thiếu secret, token lạ, token quá tuổi).
 * 4. Không gửi mail, không gọi LLM, không ghi prod.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { migrateFresh } from './migrate-fresh';
import { getAuthSecret, verifySession, signSession } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('drill-go-live');

let passed = 0;
let total = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) {
    passed++;
    console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  }
};

async function run() {
  console.log('🚀 DRILL GO-LIVE (staging only, prod read-only)');

  // 1. Prod DB tồn tại và không bị động vào (chỉ stat, không mở ghi).
  const prodPath = path.resolve(process.cwd(), 'formapubli.db');
  const st = fs.statSync(prodPath);
  const mtimeBefore = st.mtimeMs;
  ok('1. Prod DB tồn tại, readable', st.size > 100000, `${Math.round(st.size / 1024)}KB`);

  // 2. Staging fresh từ migration chain.
  const stagingPath = path.resolve(process.cwd(), 'formapubli_staging.db');
  if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
  const { appliedFiles } = await migrateFresh({ targetUrl: `file:${stagingPath}` });
  const client = createClient({ url: `file:${stagingPath}` });
  const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  const names = (tables.rows as Array<Record<string, unknown>>).map((r) => `${r.name}`);
  const mustHave = ['orders', 'order_items', 'inventory_ledger', 'stock_balances', 'staff_accounts', 'audit_logs', 'editions', 'works'];
  const missing = mustHave.filter((t) => !names.includes(t));
  ok(
    '2. Migrate-fresh dựng staging đủ bảng lõi',
    appliedFiles.length >= 10 && missing.length === 0,
    `${appliedFiles.length} files, ${names.length} tables`
  );

  // 3. Fail-closed production.
  const envRec = process.env as Record<string, string | undefined>;
  const savedNodeEnv = envRec.NODE_ENV;
  const savedSecret = envRec.AUTH_SECRET;
  const savedStrict = envRec.AUTH_STRICT;
  envRec.NODE_ENV = 'production';
  delete envRec.AUTH_SECRET;
  delete envRec.AUTH_STRICT;
  let threw = false;
  try {
    getAuthSecret();
  } catch {
    threw = true;
  }
  ok('3. Production thiếu AUTH_SECRET -> từ chối khởi động', threw);
  envRec.NODE_ENV = savedNodeEnv;
  if (savedSecret === undefined) delete envRec.AUTH_SECRET;
  else envRec.AUTH_SECRET = savedSecret;
  if (savedStrict === undefined) delete envRec.AUTH_STRICT;
  else envRec.AUTH_STRICT = savedStrict;

  // 4. Token lạ + token quá tuổi bị từ chối (không cần DB).
  const now = Date.now();
  const garbage = await verifySession('khong-phai-token');
  const oldToken = await signSession({ role: 'ROLE_OWNER', actorId: 'x', issuedAt: now, expiresAt: now + 25 * 3600 * 1000 });
  const oldRes = await verifySession(oldToken);
  ok('4. Token rác + token 25h đều null', garbage === null && oldRes === null);

  // 5. Prod DB không suy suyển sau drill.
  const stAfter = fs.statSync(prodPath);
  ok('5. Prod DB nguyên vẹn sau drill', stAfter.mtimeMs === mtimeBefore && stAfter.size === st.size);

  // Dọn staging.
  try {
    fs.unlinkSync(stagingPath);
  } catch {
    /* bỏ qua */
  }

  console.log(`\n${passed === total ? '🎉' : '⚠️'} DRILL GO-LIVE: ${passed}/${total} ${passed === total ? 'PASS' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ drill-go-live thất bại:', err);
  process.exit(1);
});
