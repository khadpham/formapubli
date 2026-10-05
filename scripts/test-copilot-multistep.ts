/**
 * Copilot: câu hỏi NHIỀU Ý (CALL_MANY) — tách lớp, tra từng ý, hợp kết quả.
 * Không cần key LLM: chạy heuristic path trên DB cách ly.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db, editions, orders, orderItems, warehouses } from '../src/db';
import { POST as postCopilot } from '../src/app/api/ai/copilot/route';
import { SESSION_COOKIE_NAME, signSession } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-copilot-multistep');

const readSrc = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  // --- 1. Source: schema CALL_MANY + vòng lặp resolve dùng chung ---
  const guard = readSrc('src/services/ai/copilot-guardrails.ts');
  ok(/'CALL_MANY'/.test(guard), 'plan schema phải có action CALL_MANY');
  ok(/steps:\s*z\s*$|steps: z/.test(guard), 'plan schema phải có mảng steps');
  ok(/const targets: Array/.test(guard), 'wrapper phải lặp qua mọi bước (không chỉ toolCall)');
  ok(!/plan\.toolCall\.args = \{ \.\.\.args, editionId/.test(guard), 'không gán thẳng vào plan.toolCall khi đa bước');

  const route = readSrc('src/app/api/ai/copilot/route.ts');
  ok(/plan\.steps\.slice\(0, 4\)/.test(route), 'route phải chạy tối đa 4 bước');
  ok(/executeToolSafely\([\s\S]{0,120}for \(const step of steps\)|for \(const step of steps\)/.test(route),
    'route phải chạy từng bước qua executeToolSafely');
  ok(/Object\.fromEntries\(results\.map/.test(route), 'kết quả nhiều bước phải gom theo tên tool');
  // KHÔNG dùng tên CF_API_TOKEN: wrangler tự đọc làm credential deploy (hỏng deploy).
  ok(/WORKERS_AI_TOKEN/.test(route), 'synth phải biết Cloudflare Workers AI');
  ok(!/process\.env\.CF_API_TOKEN/.test(readSrc('src/services/ai/llm-client.ts')),
    'llm-client không được đụng CF_API_TOKEN (wrangler sẽ hỏng deploy)');

  // --- 2. Runtime: tồn kho cuốn X + doanh số hôm nay → 2 tool ---
  const eds: any[] = await db
    .select({ id: editions.id, code: editions.code, title: editions.title })
    .from(editions)
    .limit(2);
  assert.ok(eds.length >= 1, 'DB test phải có ấn bản');
  const whs: any[] = await db.select({ id: warehouses.id }).from(warehouses).limit(1);
  const wh = whs[0]?.id || 'wh-au-co';

  const stamp = Date.now();
  const orderId = `ord-cms-${stamp}`;
  await db.insert(orders).values({
    id: orderId,
    orderCode: `CPM${stamp}`,
    idempotencyKey: `idem-cms-${stamp}`,
    warehouseId: wh,
    customerName: 'Khách nhiều ý',
    subtotal: 30000,
    discountRate: 0,
    discountAmount: 0,
    finalAmount: 30000,
    paymentMethod: 'CASH',
    status: 'COMPLETED' as const,
    cashierId: 'staff-admin',
    createdAt: new Date().toISOString(),
  } as any);
  await db.insert(orderItems).values({
    id: `oi-cms-${stamp}`,
    orderId,
    editionId: eds[0].id,
    productId: eds[0].id,
    quantity: 3,
    unitCoverPrice: 10000,
    unitSellingPrice: 10000,
    totalAmount: 30000,
    isGiftLine: false,
  } as any);

  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.WORKERS_AI_TOKEN;
  delete process.env.CF_ACCOUNT_ID;

  const session = await signSession({
    role: 'ROLE_OWNER',
    actorId: 'ADMIN-01',
    fullName: 'Copilot Multi',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  const cookie = `${SESSION_COOKIE_NAME}=${session}`;

  const question = `Tồn kho cuốn ${eds[0].code} và doanh số hôm nay?`;
  const res: any = await postCopilot(
    new Request('http://localhost/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ question, modelOverride: 'local' }),
    }) as any
  );
  const body = await res.json();
  ok(body.success === true, 'API phải trả success: HTTP ' + res.status + ' ' + JSON.stringify(body).slice(0, 400));
  ok(typeof body.data?.answer === 'string' && body.data.answer.length > 10, 'phải có câu trả lời');
  ok(!body.data.answer.includes('{"'), 'đáp không dính JSON thô');
  ok(!body.data.answer.includes('},'), 'đáp không dính JSON thô (nhánh)');

  // --- 3. CALL_MANY thật: ép planner Gemini trả 2 bước, phải chạy cả 2 ---
  const { CopilotPlanSchema } = await import('../src/services/ai/copilot-guardrails');
  const parsed = CopilotPlanSchema.parse({
    action: 'CALL_MANY',
    steps: [
      { toolName: 'query_stock_level', args: {} },
      { toolName: 'query_sales_summary', args: {} },
    ],
  });
  ok(parsed.action === 'CALL_MANY', 'schema phải nhận CALL_MANY');
  ok(Array.isArray(parsed.steps) && parsed.steps.length === 2, 'schema giữ đủ 2 bước');
  ok(parsed.steps![0].toolName === 'query_stock_level', 'bước 1 đúng tool');

  // Wrapper phải resolve cho TỪNG bước (trước đây chỉ sửa plan.toolCall).
  const guardMod: any = await import('../src/services/ai/copilot-guardrails');
  const plan: any = {
    action: 'CALL_MANY',
    steps: [
      { toolName: 'query_product_flow', args: {} },
      { toolName: 'query_sales_summary', args: {} },
    ],
  };
  const origInner = guardMod.CopilotGuardrails.planQueryInner;
  (guardMod.CopilotGuardrails as any).planQueryInner = async () => plan;
  try {
    const out = await guardMod.CopilotGuardrails.planQuery(`doanh sách ${eds[0].code} tồn kho?`);
    ok(out.action === 'CALL_MANY', 'wrapper giữ CALL_MANY');
    const flowStep = out.steps?.find((s: any) => s.toolName === 'query_product_flow');
    const salesStep = out.steps?.find((s: any) => s.toolName === 'query_sales_summary');
    ok(!!flowStep && !!salesStep, 'wrapper phải giữ cả 2 bước');
    // Bước product_flow phải được điền productId, BƯỚC KHÁC KHÔNG bị dính.
    ok(flowStep && (flowStep.args.productId || flowStep.args.q),
      'bước query_product_flow phải được resolve từ câu hỏi');
    ok(!salesStep?.args?.productId, 'không dán productId nhầm sang bước khác');
  } finally {
    (guardMod.CopilotGuardrails as any).planQueryInner = origInner;
  }

  // --- 4. "hôm nay" phải ra date hôm nay, KHÔNG rơi về windowDays 30 ---
  const { CopilotGuardrails: CG } = await import('../src/services/ai/copilot-guardrails');
  const today = CG.parseVnDay('hôm nay');
  ok(!!today, 'parseVnDay("hôm nay") phải ra ngày');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(String(today)), 'parseVnDay trả YYYY-MM-DD');
  const { ExecutiveQueryService: EQS } = await import('../src/services/executive-query.service');
  let capturedArgs: any = null;
  const origSales = (EQS as any).querySalesSummary;
  (EQS as any).querySalesSummary = async (a: any) => { capturedArgs = a; return { itemsCount: 0 }; };
  try {
    await CG.executeToolSafely(
      'query_sales_summary',
      { q: 'doanh số hôm nay?' },
      { staffId: 'ADMIN-01', role: 'ROLE_OWNER' }
    );
  } finally {
    (EQS as any).querySalesSummary = origSales;
  }
  ok(capturedArgs?.date === today, `server phải tự suy date hôm nay (${today}), nhận ${capturedArgs?.date}`);

  // Wrapper phải gắn q cho bước đa ý — không có q thì mất ngày.
  const plan2: any = { action: 'CALL_MANY', steps: [{ toolName: 'query_sales_summary', args: {} }] };
  const origInner2 = (guardMod.CopilotGuardrails as any).planQueryInner;
  (guardMod.CopilotGuardrails as any).planQueryInner = async () => plan2;
  try {
    const out2 = await (guardMod.CopilotGuardrails as any).planQuery('doanh số hôm nay?');
    ok(out2.steps?.[0]?.args?.q === 'doanh số hôm nay?',
      'wrapper phải gắn câu hỏi gốc vào args.q để suy ngày');
  } finally {
    (guardMod.CopilotGuardrails as any).planQueryInner = origInner2;
  }

  // --- 5. Formatter KHÔNG BAO GIỜ in JSON thô, kể cả đa bước ---
  const routeSrc = readSrc('src/app/api/ai/copilot/route.ts');
  ok(!/return JSON\.stringify\(data, null, 2\)/.test(routeSrc),
    'formatter cuối không được in JSON thô cho lãnh đạo');
  ok(/toolName\.includes\(' \+ '\)/.test(routeSrc), 'formatter phải xử lý câu nhiều ý (toolName "a + b")');
  ok(/LABEL_BY_TOOL/.test(routeSrc), 'đa bước phải gắn nhãn tiếng Việt cho từng ý');

  // --- 6. Workers AI: errors=[] KHÔNG được coi là lỗi ---
  const llmSrc = readSrc('src/services/ai/llm-client.ts');
  ok(/Array\.isArray\(errs\) && errs\.length > 0/.test(llmSrc),
    'mảng errors rỗng phải được coi là KHÔNG lỗi ([] là truthy trong JS)');

  console.log(`=== COPILOT MULTISTEP: PASS — ${checks} assertions ===`);
  console.log(`cau hoi: ${question}`);
  console.log(`tool: ${body.data.toolUsed || 'n/a'} | engine: ${body.data.engine}`);
  console.log(`--- dap ---\n${String(body.data.answer).slice(0, 400)}`);
}

run().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Copilot multistep test failed:', e?.message || e);
  process.exit(1);
});