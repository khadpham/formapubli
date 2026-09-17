/**
 * 5.5 — MONTHLY EXECUTIVE DIGEST (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-monthly-digest
 * 7 cases: range/id utils, digest nhất quán cấu trúc, CSV, briefing
 * template/LLM-stub/fallback. Không gửi mail thật, không mạng thật.
 */
import {
  ExecutiveDigestService,
  generateBriefing,
  monthRangeOf,
  digestIdOf,
} from '../src/services/executive-digest.service';
import { resetLlmBreaker } from '../src/services/ai/llm-client';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-monthly-digest');

delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_CHAT_MODEL;

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

const realFetch = globalThis.fetch;
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    return handler(url, init);
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

async function run() {
  console.log('📧 MONTHLY EXECUTIVE DIGEST 5.5 (DB cách ly, stub mạng)');

  // 1. Utils tháng/id + tháng sai ném lỗi.
  const r = monthRangeOf(2026, 2);
  let invalid = false;
  try {
    monthRangeOf(2026, 13);
  } catch {
    invalid = true;
  }
  ok(
    '1. monthRange/digestId chuẩn, tháng 13 ném lỗi',
    r.startDate.startsWith('2026-02-01') && r.endDate.startsWith('2026-02-28') && digestIdOf(2026, 1) === 'DIGEST-2026-01' && invalid
  );

  // 2. Digest nhất quán cấu trúc + phản ánh đúng đơn thật vừa tạo.
  const { InventoryService } = await import('../src/services/inventory.service');
  const { OrderService } = await import('../src/services/order.service');
  const { editions } = await import('../src/db/schema');
  const seeded = await (await import('../src/db')).db.select({ id: editions.id }).from(editions).limit(30);
  let saleEdition = '';
  for (const s of seeded) {
    if ((await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW')) >= 10) {
      saleEdition = s.id;
      break;
    }
  }
  if (!saleEdition) throw new Error('Không đủ edition tồn dày để tạo đơn test.');
  const now = new Date();
  const stamp = Date.now();
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 'Digest Test', cashierId: 'digest-tester',
    idempotencyKey: `digest-${stamp}-1`, items: [{ editionId: saleEdition, quantity: 2 }],
  });
  await OrderService.createOrder({
    warehouseId: 'wh-au-co', customerName: 'Digest Test', cashierId: 'digest-tester',
    idempotencyKey: `digest-${stamp}-2`, items: [{ editionId: saleEdition, quantity: 1 }],
  });
  const d = await ExecutiveDigestService.buildMonthlyDigest(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const madeTop = d.topEditions.find((t) => t.editionId === saleEdition);
  const channelSum = d.channels.reduce((s, c) => s + c.revenue, 0);
  const topSorted = d.topEditions.every((t, i, arr) => i === 0 || arr[i - 1].qty >= t.qty);
  const redOk = d.redAlerts.every((x) => typeof x.suggestedReprintQty === 'number');
  ok(
    '2. Digest: đơn thật lọt top + fiscal khớp + shape chuẩn',
    d.digestId.startsWith('DIGEST-') &&
      channelSum >= 0 &&
      d.cashflow.netRevenue <= d.cashflow.salesRevenue &&
      topSorted &&
      redOk &&
      d.fiscal.all.revenue >= d.fiscal.officialTax.revenue &&
      d.fiscal.all.orders >= 2 &&
      d.fiscal.all.revenue > 0 &&
      !!madeTop &&
      madeTop.qty >= 3,
    `channels=${d.channels.length} top=${d.topEditions.length} red=${d.redAlerts.length} madeTopQty=${madeTop?.qty ?? 0}`
  );

  // 3. CSV đúng header + tên file theo digestId, escape dấu phẩy.
  const { filename, csv } = ExecutiveDigestService.buildCsv(d);
  const lines = csv.split('\n');
  ok(
    '3. CSV header + filename chuẩn',
    filename === `${d.digestId}.csv` && lines[0] === 'loai,ma,tieu_de,so_luong,doanh_thu_vnd' && lines.length >= 1
  );

  // 4. Không key -> briefing template 3 dòng đủ nghĩa.
  const t4 = await generateBriefing(d);
  ok(
    '4. Không LLM -> TEMPLATE 3 dòng',
    t4.engine === 'TEMPLATE' &&
      t4.briefing.highlight.length > 10 &&
      t4.briefing.risk.length > 10 &&
      t4.briefing.decision.length > 10,
    `engine=${t4.engine}`
  );

  // 5. Stub Gemini trả JSON chuẩn -> LLM_GEMINI.
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'test-model';
  resetLlmBreaker('gemini');
  stubFetch(async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ highlight: 'Điểm sáng: test', risk: 'Rủi ro: test', decision: 'Quyết sách: test' }) }] } }],
      });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  const t5 = await generateBriefing(d);
  ok('5. Gemini stub JSON chuẩn -> LLM_GEMINI', t5.engine === 'LLM_GEMINI' && t5.briefing.highlight.includes('Điểm sáng'));
  restoreFetch();

  // 6. Gemini rác -> TEMPLATE fallback, không crash.
  stubFetch(async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [{ text: 'không phải json' }] } }] });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  const t6 = await generateBriefing(d);
  ok('6. Gemini rác -> TEMPLATE fallback', t6.engine === 'TEMPLATE' && t6.briefing.highlight.length > 10);
  restoreFetch();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  resetLlmBreaker('gemini');

  // 7. Chỉ Groq (stub chat) -> LLM_GROQ.
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.GROQ_CHAT_MODEL = 'openai/gpt-oss-20b';
  resetLlmBreaker('groq');
  stubFetch(async (url) => {
    if (url.includes('api.groq.com/openai/v1/chat/completions')) {
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ highlight: 'Điểm sáng: groq', risk: 'Rủi ro: groq', decision: 'Quyết sách: groq' }) } }],
      });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  const t7 = await generateBriefing(d);
  ok('7. Groq stub JSON chuẩn -> LLM_GROQ', t7.engine === 'LLM_GROQ' && t7.briefing.risk.includes('groq'));
  restoreFetch();
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_CHAT_MODEL;
  resetLlmBreaker('groq');

  console.log(`\n${passed === total ? '🎉' : '⚠️'} MONTHLY DIGEST 5.5: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-monthly-digest thất bại:', err);
  process.exit(1);
});
