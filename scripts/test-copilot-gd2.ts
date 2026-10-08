/**
 * Copilot GĐ2 — Task 1: vòng lặp planner nhiều lượt.
 * Task 2: tool ghi pilot prepare_transfer_draft.
 * Task 3: streaming live tool name (SSE).
 *
 * Chạy trên DB cách ly:
 *   DATABASE_URL=file:/tmp/formapubli_test_copilot_gd1.db npx tsx scripts/test-copilot-gd2.ts
 */
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-copilot-gd2');

// Ép heuristic path cho planQuery: không gọi LLM thật.
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.CF_ACCOUNT_ID;
delete process.env.WORKERS_AI_TOKEN;

import { CopilotGuardrails } from '../src/services/ai/copilot-guardrails';
import { ExecutiveQueryService } from '../src/services/executive-query.service';
import { eq } from 'drizzle-orm';
import { db, warehouses, works, products, editions, stockBalances, transferShipments } from '../src/db';

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const ACTOR = { staffId: 'test-staff', role: 'ROLE_OWNER' };

async function run() {
  // --- Task 1: vòng lặp planner nhiều lượt ---
  const origNext = (CopilotGuardrails as any).planNextStep;

  // Test 1: 2 lượt — lượt 1 query_agency_debt, lượt 2 (mock) query_stock_level, rồi FINISH.
  let nextCalls = 0;
  (CopilotGuardrails as any).planNextStep = async () => {
    nextCalls++;
    if (nextCalls === 1) {
      return { action: 'CALL_TOOL', toolCall: { toolName: 'query_stock_level', args: {} }, reason: 'test' };
    }
    return { action: 'FINISH', reason: 'test done' };
  };
  const r1: any = await CopilotGuardrails.runPlanLoop({
    question: 'test loop',
    initialPlan: { action: 'CALL_TOOL', toolCall: { toolName: 'query_agency_debt', args: { q: '' } }, reason: 'test' } as any,
    allowLoop: true,
    actor: ACTOR,
  });
  ok(r1.results.length === 2, `loop chạy 2 lượt (thấy ${r1.results.length})`);
  ok(r1.results[0].toolName === 'query_agency_debt', 'lượt 1 đúng tool');
  ok(r1.results[1].toolName === 'query_stock_level', 'lượt 2 đúng tool từ planNextStep');
  ok(r1.turns === 2, `dừng sau FINISH ở lượt 2 (turns=${r1.turns})`);

  // Test 2: heuristic (allowLoop=false) → single-shot, không gọi planNextStep.
  nextCalls = 0;
  const r2: any = await CopilotGuardrails.runPlanLoop({
    question: 'tồn kho HH001',
    initialPlan: { action: 'CALL_TOOL', toolCall: { toolName: 'query_stock_level', args: {} }, reason: 'test' } as any,
    allowLoop: false,
    actor: ACTOR,
  });
  ok(r2.results.length === 1, 'heuristic chỉ chạy 1 lượt');
  ok(nextCalls === 0, 'không gọi planNextStep khi allowLoop=false');

  // Test 3: guard chống gọi trùng tool+args.
  (CopilotGuardrails as any).planNextStep = async () => ({
    action: 'CALL_TOOL',
    toolCall: { toolName: 'query_agency_debt', args: { q: '' } },
    reason: 'test loop',
  });
  const r3: any = await CopilotGuardrails.runPlanLoop({
    question: 'test dedup',
    initialPlan: { action: 'CALL_TOOL', toolCall: { toolName: 'query_agency_debt', args: { q: '' } }, reason: 'test' } as any,
    allowLoop: true,
    actor: ACTOR,
    maxTurns: 3,
  });
  const debtRuns = r3.results.filter((r: any) => r.toolName === 'query_agency_debt').length;
  ok(debtRuns === 1, `tool trùng không chạy lại (chạy ${debtRuns} lần)`);
  ok(r3.turns <= 3, `vòng lặp không vượt maxTurns (turns=${r3.turns})`);

  (CopilotGuardrails as any).planNextStep = origNext;

  console.log(`✅ test-copilot-gd2 (task 1): ${checks} checks passed`);

  // --- Task 2: tool ghi pilot prepare_transfer_draft ---
  await seedTransfer();

  const d1: any = await (ExecutiveQueryService as any).prepareTransferDraft({
    q: 'chuyển 10 cuốn HH901 từ kho Test GĐ1 sang kho Quỳnh Mai',
  });
  ok(d1.fromWarehouseId === 'wh-gd1', `kho gửi đúng (thấy ${d1.fromWarehouseId})`);
  ok(d1.toWarehouseId === 'wh-gd1-qm', `kho nhận đúng (thấy ${d1.toWarehouseId})`);
  ok(d1.items.length === 1 && d1.items[0].quantity === 10, 'parse đúng 1 dòng × 10');
  ok(d1.items[0].availableStock === 50, `tồn kho gửi = 50 (thấy ${d1.items[0].availableStock})`);
  const shipments = await db.select({ id: transferShipments.id }).from(transferShipments);
  ok(shipments.length === 0, `draft KHÔNG tạo phiếu trong DB (thấy ${shipments.length})`);

  const d2: any = await (ExecutiveQueryService as any).prepareTransferDraft({ q: 'chuyển 5 cuốn HH901' });
  ok(!d2.toWarehouseId && d2.warnings.length > 0, 'thiếu kho nhận → warnings, không đoán');

  const d3: any = await (ExecutiveQueryService as any).prepareTransferDraft({
    q: 'chuyển 3 cuốn XX999 từ kho Test GĐ1 sang kho Quỳnh Mai',
  });
  ok(d3.items.length === 0 && d3.warnings.length > 0, 'sách không tồn tại → warnings');

  const p1: any = await CopilotGuardrails.planQuery('lập phiếu chuyển 5 cuốn HH901 sang kho Quỳnh Mai', {}, undefined, []);
  ok(p1?.toolCall?.toolName === 'prepare_transfer_draft', `route tạo phiếu → prepare_transfer_draft (thấy ${p1?.toolCall?.toolName})`);

  const p2: any = await CopilotGuardrails.planQuery('lịch sử chuyển kho gần đây', {}, undefined, []);
  ok(p2?.toolCall?.toolName === 'query_transfer_history', `tra cứu lịch sử không bị cướp (thấy ${p2?.toolCall?.toolName})`);

  console.log(`✅ test-copilot-gd2 (task 2): ${checks} checks passed`);

  // --- Task 3: streaming live tool name (SSE) ---
  const { runCopilotStream } = await import('../src/app/api/ai/copilot/route');

  // Test 1: thứ tự events chuẩn cho câu hỏi tool đơn.
  const events: Array<{ event: string; data: any }> = [];
  await runCopilotStream({
    question: 'tồn kho HH901',
    history: [],
    sessionPayload: { actorId: 'test', role: 'ROLE_OWNER' } as any,
    emit: (event: string, data: any) => { events.push({ event, data }); },
  });
  const seq = events.map((e) => e.event);
  ok(seq[0] === 'planner', `event đầu là planner (thấy ${seq[0]})`);
  const ti = seq.indexOf('tool_start');
  ok(ti > 0, 'có event tool_start');
  ok(events[ti].data.toolName === 'query_stock_level', `tool_start đúng tool (thấy ${events[ti].data.toolName})`);
  ok(typeof events[ti].data.label === 'string' && events[ti].data.label.length > 0, 'tool_start có label tiếng Việt');
  ok(seq.includes('tool_done'), 'có event tool_done');
  ok(seq.includes('synthesizing'), 'có event synthesizing');
  ok(seq[seq.length - 1] === 'done', `event cuối là done (thấy ${seq[seq.length - 1]})`);
  const doneData = events[events.length - 1].data;
  ok(typeof doneData.answer === 'string' && doneData.answer.length > 0, 'payload done có answer');

  // Test 2: tool throw giữa chừng → event error, không văng exception ra ngoài.
  const origExec = (CopilotGuardrails as any).executeToolSafely;
  (CopilotGuardrails as any).executeToolSafely = async () => { throw new Error('boom-test'); };
  const events2: Array<{ event: string; data: any }> = [];
  await runCopilotStream({
    question: 'tồn kho HH901',
    history: [],
    sessionPayload: { actorId: 'test', role: 'ROLE_OWNER' } as any,
    emit: (event: string, data: any) => { events2.push({ event, data }); },
  });
  (CopilotGuardrails as any).executeToolSafely = origExec;
  const seq2 = events2.map((e) => e.event);
  ok(seq2.includes('error'), 'tool lỗi → có event error');
  ok(seq2[seq2.length - 1] === 'error', 'error là event cuối (stream đóng sạch)');
  ok(!seq2.includes('done'), 'không có event done sau error');

  console.log(`✅ test-copilot-gd2 (task 3): ${checks} checks passed`);

  // --- Fix pass (reviewer Important #1): dialog data khi multi-tool ---
  const { getTransferDraftData } = await import('../src/components/copilot/CopilotDrawer');
  const single = getTransferDraftData('prepare_transfer_draft', { items: [{ code: 'HH901' }], fromWarehouseId: 'wh-a' });
  ok(single?.fromWarehouseId === 'wh-a', 'single-tool: dialog lấy đúng data');
  const multi = getTransferDraftData('query_stock_level + prepare_transfer_draft', {
    query_stock_level: { items: [] },
    prepare_transfer_draft: { items: [{ code: 'HH901' }], fromWarehouseId: 'wh-b' },
  });
  ok(multi?.fromWarehouseId === 'wh-b', 'multi-tool: dialog lấy đúng chunk prepare_transfer_draft');
  const none = getTransferDraftData('query_stock_level', { items: [] });
  ok(none === null, 'tool khác → null, không hiện dialog');

  console.log(`✅ test-copilot-gd2 (fix pass): ${checks} checks passed`);
}

async function seedTransfer() {
  const { partnerReceipts, deliveryOrders, partners, contractDocuments, contractTemplates } = await import('../src/db');
  for (const t of [partnerReceipts, deliveryOrders, transferShipments, stockBalances, editions, products, works, partners, contractDocuments, contractTemplates] as any[]) {
    try { await db.delete(t); } catch {}
  }
  try { await db.delete(warehouses); } catch {}
  await db.insert(warehouses).values([
    { id: 'wh-gd1', code: 'KHO_GD1', name: 'Kho Test GĐ1' },
    { id: 'wh-gd1-qm', code: 'KHO_QM', name: 'Kho Test Quỳnh Mai' },
  ]);
  await db.insert(works).values({ id: 'work-gd2', code: 'W-GD2', title: 'Sách Test GĐ2', author: 'Tác giả Test' });
  await db.insert(products).values({ id: 'prod-gd2', name: 'Sách Test GĐ2' });
  await db.insert(editions).values({
    id: 'ed-gd2', code: 'HH901', workId: 'work-gd2',
    isbn: '9780000000001', isbnLast4: '0001', coverPrice: 100000,
  });
  await db.insert(stockBalances).values({
    id: 'sb-gd2', editionId: 'ed-gd2', productId: 'prod-gd2',
    warehouseId: 'wh-gd1', physicalQuantity: 50,
  });
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
