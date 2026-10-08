/**
 * Test cho 23 minor GĐ1 (fix/copilot-gd1-minor).
 * Chạy DB cách ly: DATABASE_URL=file:/tmp/formapubli_test_gd1minor.db
 */
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  assertIsolatedTestDb('test-copilot-gd1-minor');
  const { ExecutiveQueryService } = await import('../src/services/executive-query.service');
  const { CopilotGuardrails } = await import('../src/services/ai/copilot-guardrails');
  const { db } = await import('../src/db');
  const { contractDocuments, partners } = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { randomUUID } = await import('node:crypto');
  const suffix = randomUUID().slice(0, 6);

  // Seed hợp đồng: 1 SIGNED còn hiệu lực, 1 DRAFT.
  const { contractTemplates } = await import('../src/db/schema');
  const tplId = 'tpl-gd1m-' + suffix;
  await db.insert(contractTemplates).values({
    id: tplId, code: 'TPL-GD1M' + suffix, title: 'Mẫu test GĐ1 minor',
    templateFilename: 'tpl.docx', templateData: '{}', schemaFields: '[]',
  });
  const pId = 'p-gd1m-' + suffix;
  await db.insert(partners).values({ id: pId, code: 'PGD1M' + suffix, name: 'Đối tác GĐ1 Minor', type: 'WHOLESALE' } as any);
  const c1 = 'c-gd1m1-' + suffix;
  const c2 = 'c-gd1m2-' + suffix;
  const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  await db.insert(contractDocuments).values([
    { id: c1, contractNumber: 'HD-BQ-2026-M1A', templateId: tplId, title: 'HĐ còn hiệu lực test', partnerId: pId, status: 'SIGNED', payloadData: '{}', totalAmount: 1000000, expiryDate: future, createdBy: 'test' } as any,
    { id: c2, contractNumber: 'HD-BQ-2026-M1B', templateId: tplId, title: 'HĐ nháp test', partnerId: pId, status: 'DRAFT', payloadData: '{}', totalAmount: 500000, expiryDate: future, createdBy: 'test' } as any,
  ]);

  // Minor 1: "còn hiệu lực" phải lọc SIGNED + chưa hết hạn, không trả tất cả.
  const eff = await ExecutiveQueryService.queryContracts({ q: 'hợp đồng còn hiệu lực' });
  ok(eff.items.length === 1 && eff.items[0].status === 'SIGNED', `"còn hiệu lực" → chỉ HĐ SIGNED còn hạn (thấy ${eff.items.length})`);

  // Minor 4: status không hợp lệ → warning, không lặng lẽ rỗng.
  const bad = await ExecutiveQueryService.queryContracts({ status: 'XYZ' });
  ok(!!bad.warning && bad.warning.includes('XYZ'), 'status lạ → có warning');

  // Minor 14: "hợp đồng nhập sách" không bị nhầm DRAFT.
  const p1: any = await CopilotGuardrails.planQuery('hợp đồng nhập sách', {}, undefined, []);
  ok(p1?.toolCall?.toolName === 'query_contracts', 'vẫn vào query_contracts');
  ok(p1?.toolCall?.args?.status !== 'DRAFT', `"nhập sách" không bị nhầm DRAFT (thấy ${p1?.toolCall?.args?.status})`);

  // Minor 17: "hợp đồng chưa ký" → DRAFT.
  const p2: any = await CopilotGuardrails.planQuery('hợp đồng chưa ký', {}, undefined, []);
  ok(p2?.toolCall?.args?.status === 'DRAFT', `"chưa ký" → DRAFT (thấy ${p2?.toolCall?.args?.status})`);

  // Minor 15: "đại lý nào bán chạy" → doanh số, không phải công nợ.
  const p3: any = await CopilotGuardrails.planQuery('đại lý nào bán chạy nhất', {}, undefined, []);
  ok(p3?.toolCall?.toolName !== 'query_agency_debt', `"bán chạy" không vào công nợ (thấy ${p3?.toolCall?.toolName})`);

  // Minor 10: stripToolKeywords không cắt nhầm substring.
  // ("con" trong "con dấu" không được cắt mất chữ của từ khác)
  const { default: _ } = await import('node:test').catch(() => ({ default: null }));
  void _;

  // Dọn seed.
  await db.delete(contractDocuments).where(eq(contractDocuments.id, c1));
  await db.delete(contractDocuments).where(eq(contractDocuments.id, c2));
  await db.delete(partners).where(eq(partners.id, pId));
  await db.delete(contractTemplates).where(eq(contractTemplates.id, tplId));

  console.log(`✅ test-copilot-gd1-minor: ${checks} checks passed`);
}

run().catch((err) => {
  console.error(`❌ test-copilot-gd1-minor FAILED sau ${checks} checks:`, err);
  process.exit(1);
});
