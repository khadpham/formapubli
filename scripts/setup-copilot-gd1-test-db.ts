/**
 * Dựng DB test cách ly cho test-copilot-gd1-tools (KHÔNG commit file này vào
 * quy trình test chính — chỉ dùng khi chạy suite copilot GĐ1 standalone).
 * Chạy: npx tsx scripts/setup-copilot-gd1-test-db.ts
 */
import { migrateFresh } from './migrate-fresh';

const targetUrl = process.env.COPILOT_GD1_TEST_DB || 'file:/tmp/formapubli_test_copilot_gd1.db';

async function main() {
  const { appliedFiles } = await migrateFresh({
    targetUrl,
    expectTables: ['contract_documents', 'contract_templates', 'partners'],
  });
  console.log(`✅ setup DB xong: ${appliedFiles.length} migrations → ${targetUrl}`);
}

main().catch((e) => {
  console.error('❌ setup DB thất bại:', e?.message || e);
  process.exit(1);
});
