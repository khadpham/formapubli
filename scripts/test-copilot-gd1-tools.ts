/**
 * Copilot GĐ1 — Task 3/4: tools mới query_contracts / query_agency_debt.
 *
 * Chạy trên DB cách ly (dựng 1 lần):
 *   npx tsx scripts/setup-copilot-gd1-test-db.ts
 *   DATABASE_URL=file:/tmp/formapubli_test_copilot_gd1.db npx tsx scripts/test-copilot-gd1-tools.ts
 *
 * Dữ liệu test TỰ TẠO trong test (idempotent: xóa trước khi insert).
 */
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-copilot-gd1-tools');

// Ép heuristic path: không gọi LLM thật.
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.CF_ACCOUNT_ID;
delete process.env.WORKERS_AI_TOKEN;

import { eq } from 'drizzle-orm';
import { db, contractDocuments, contractTemplates, partners, warehouses, deliveryOrders, partnerReceipts } from '../src/db';
import { ExecutiveQueryService } from '../src/services/executive-query.service';
import { CopilotGuardrails } from '../src/services/ai/copilot-guardrails';

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function seedContracts() {
  // Idempotent: dọn dữ liệu test cũ trước (theo thứ tự FK).
  await db.delete(contractDocuments);
  await db.delete(contractTemplates);
  await db.delete(partnerReceipts);
  await db.delete(deliveryOrders);
  await db.delete(partners);
  await db.delete(warehouses);

  await db.insert(contractTemplates).values({
    id: 'tpl-gd1-test',
    code: 'TPL-GD1',
    title: 'Mẫu test GĐ1',
    templateFilename: 'tpl-gd1.docx',
    templateData: '{}',
    schemaFields: '[]',
  });
  await db.insert(partners).values({
    id: 'partner-gd1-test',
    code: 'DL-GD1',
    name: 'Đại lý Test GĐ1',
    type: 'WHOLESALE',
  });
  await db.insert(contractDocuments).values([
    {
      id: 'doc-gd1-1',
      contractNumber: 'HD-BQ-2026-901',
      templateId: 'tpl-gd1-test',
      title: 'Hợp đồng test 1',
      partnerId: 'partner-gd1-test',
      status: 'DRAFT', // giá trị thật từ contract.service.ts
      payloadData: '{}',
      totalAmount: 1500000,
      createdBy: 'test',
    },
    {
      id: 'doc-gd1-2',
      contractNumber: 'HD-BQ-2026-902',
      templateId: 'tpl-gd1-test',
      title: 'Hợp đồng test 2',
      status: 'SIGNED', // giá trị thật từ contract.service.ts
      payloadData: '{}',
      totalAmount: 2500000,
      createdBy: 'test',
    },
  ]);
}

async function run() {
  await seedContracts();

  // --- Task 3: queryContracts ---
  const res: any = await ExecutiveQueryService.queryContracts({ q: 'HD-BQ-2026' });
  ok(Array.isArray(res.items), 'queryContracts trả về items là mảng');
  ok(res.items.length === 2, `tìm đúng 2 hợp đồng (thấy ${res.items.length})`);
  for (const it of res.items) {
    ok(typeof it.contractNumber === 'string' && it.contractNumber.startsWith('HD-BQ-2026'), `contractNumber hợp lệ: ${it.contractNumber}`);
    ok(typeof it.totalAmount === 'number', `totalAmount là number: ${it.contractNumber}`);
    ok(typeof it.status === 'string', `status là string: ${it.contractNumber}`);
  }
  const withPartner = res.items.find((it: any) => it.contractNumber === 'HD-BQ-2026-901');
  ok(withPartner?.partnerName === 'Đại lý Test GĐ1', 'join ra tên đối tác');

  const resDraft: any = await ExecutiveQueryService.queryContracts({ status: 'DRAFT' });
  ok(resDraft.items.length === 1 && resDraft.items[0].contractNumber === 'HD-BQ-2026-901', 'lọc theo status DRAFT');

  // --- Routing: câu hỏi hợp đồng → query_contracts ---
  const plan: any = await CopilotGuardrails.planQuery('hợp đồng còn hiệu lực', {}, undefined, []);
  ok(plan?.toolCall?.toolName === 'query_contracts', `route "hợp đồng còn hiệu lực" → query_contracts (thấy ${plan?.toolCall?.toolName})`);

  // --- Guard: câu công nợ không được lái sang query_contracts ---
  const plan2: any = await CopilotGuardrails.planQuery('công nợ đại lý', {}, undefined, []);
  ok(plan2?.toolCall?.toolName !== 'query_contracts', 'câu công nợ không lái sang query_contracts');

  console.log(`✅ test-copilot-gd1-tools (task 3): ${checks} checks passed`);

  // --- Task 4: query_agency_debt ---
  await seedDebt();
  const debt: any = await ExecutiveQueryService.queryAgencyDebt({});
  ok(Array.isArray(debt.items), 'queryAgencyDebt trả về items là mảng');
  const debtor = debt.items.find((it: any) => it.partnerId === 'partner-gd1-debt');
  ok(!!debtor, 'tìm thấy đại lý nợ test');
  ok(typeof debtor.balance === 'number' && typeof debtor.overdue === 'number', 'balance/overdue là number');
  ok(debtor.balance === 7000000, `dư nợ = 10M - 3M = 7M (thấy ${debtor.balance})`);
  ok(debtor.overdue === 7000000, `quá hạn 7M (phiếu 40 ngày trước, hạn 30 ngày)`);
  ok(debtor.overdueCount === 1, 'quá hạn 1 phiếu');
  ok(debtor.oldestOverdueDays >= 9 && debtor.oldestOverdueDays <= 12, `số ngày quá hạn lâu nhất ~10 (phiếu 40 ngày trước, hạn 30 ngày; thấy ${debtor.oldestOverdueDays})`);

  const debtCapped: any = await ExecutiveQueryService.queryAgencyDebt({ limit: 999 });
  ok(debtCapped.items.length <= 10, `limit 999 bị chặn còn ≤ 10 (thấy ${debtCapped.items.length})`);

  const planDebt: any = await CopilotGuardrails.planQuery('công nợ đại lý', {}, undefined, []);
  ok(planDebt?.toolCall?.toolName === 'query_agency_debt', `route "công nợ đại lý" → query_agency_debt (thấy ${planDebt?.toolCall?.toolName})`);

  const planCash: any = await CopilotGuardrails.planQuery('két tiền ca quầy', {}, undefined, []);
  ok(planCash?.toolCall?.toolName === 'query_cashbox_reconciliation', `két tiền không bị cướp sang công nợ (thấy ${planCash?.toolCall?.toolName})`);

  console.log(`✅ test-copilot-gd1-tools (task 4): ${checks} checks passed`);

  // --- Fix pass (reviewer Important #1): câu hỏi tự nhiên end-to-end ---
  await db.insert(partners).values({ id: 'partner-gd1-anphat', code: 'DL-AP', name: 'An Phát', type: 'WHOLESALE' });

  const nq1: any = await ExecutiveQueryService.queryContracts({ q: 'hợp đồng còn hiệu lực' });
  ok(nq1.items.length === 2, `câu tự nhiên "hợp đồng còn hiệu lực" tìm thấy hợp đồng (thấy ${nq1.items.length})`);

  const nq2: any = await ExecutiveQueryService.queryAgencyDebt({ q: 'Công nợ các đại lý hiện tại ra sao?' });
  ok(nq2.items.length > 0, 'chip công nợ (câu tự nhiên) không còn not-found');

  const nq3: any = await ExecutiveQueryService.queryAgencyDebt({ q: 'công nợ của đại lý An Phát' });
  ok(nq3.items.some((it: any) => it.partnerName === 'An Phát'), 'tìm đúng đại lý An Phát');

  const nq4: any = await ExecutiveQueryService.queryContracts({ q: 'hop dong HD-BQ-2026-901' });
  ok(nq4.items.some((it: any) => it.contractNumber === 'HD-BQ-2026-901'), 'không dấu + mã HĐ tìm đúng');

  console.log(`✅ test-copilot-gd1-tools (fix pass): ${checks} checks passed`);
}

async function seedDebt() {
  const fortyDaysAgo = new Date(Date.now() - 40 * 86400000).toISOString();
  await db.insert(warehouses).values({ id: 'wh-gd1', code: 'KHO_GD1', name: 'Kho Test GĐ1' });
  await db.insert(partners).values({
    id: 'partner-gd1-debt',
    code: 'DL-NO',
    name: 'Đại lý Nợ Test',
    type: 'WHOLESALE',
    paymentDueDays: 30,
  });
  await db.insert(deliveryOrders).values({
    id: 'pxk-gd1-1',
    code: 'PXK-2026-9001',
    partnerId: 'partner-gd1-debt',
    fromWarehouseId: 'wh-gd1',
    subtotal: 10000000,
    finalAmount: 10000000,
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    status: 'DISPATCHED_LOCKED',
    dispatchedAt: fortyDaysAgo,
    createdBy: 'test',
  });
  await db.insert(partnerReceipts).values({
    id: 'rc-gd1-1',
    partnerId: 'partner-gd1-debt',
    amount: 3000000,
    paymentMethod: 'BANK_TRANSFER',
    reference: 'REF-GD1',
    paidAt: new Date().toISOString().slice(0, 10),
    receivedBy: 'test',
    status: 'ACTIVE',
    idempotencyKey: 'gd1-key-1',
  });
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
