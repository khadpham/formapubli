/**
 * Copilot: 4 bug sếp bắt tận tay (06/10/2026, ảnh chụp màn hình).
 *
 * 1. "hiện tại" không được hiểu → planner/LLM suy date sai (hôm nay vs 30 ngày).
 * 2. Grounded check MÙ SỐ 0: synth bịa "0 đồng từ 0 đơn" lọt ra UI dù tool có 221 đơn.
 * 3. Câu không nhắc kho nào nhưng dính kho của CÂU TRƯỚC trong history.
 * 4. Ép model 120B chết → im lặng rơi về 20B/nội bộ, không báo sếp biết.
 *
 * TDD: test đỏ trước, vá sau.
 */
import assert from 'node:assert/strict';
import { POST as postCopilot } from '../src/app/api/ai/copilot/route';
import { SESSION_COOKIE_NAME, signSession } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';
import { CopilotGuardrails } from '../src/services/ai/copilot-guardrails';

assertIsolatedTestDb('test-copilot-grounding-fixes');

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.CF_ACCOUNT_ID;

  const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  // --- Bug 1: "hiện tại" = hôm nay ---
  ok(
    CopilotGuardrails.parseVnDay('ở kho hồ gươm hiện tại có doanh thu không?') === todayVn,
    `"hiện tại" phải ra hôm nay (${todayVn})`
  );
  ok(
    CopilotGuardrails.parseVnDay('doanh thu sáng hôm nay, hiện tại') === todayVn,
    '"sáng hôm nay, hiện tại" phải ra hôm nay'
  );
  ok(
    CopilotGuardrails.parseVnDay('bây giờ tình hình sao?') === todayVn,
    '"bây giờ" phải ra hôm nay'
  );

  // --- Bug 2: claim "0 đơn" sai khi tool có số thật ---
  const contradiction = (CopilotGuardrails as any).findZeroClaimContradiction(
    'Dạ, trong 30 ngày qua chưa phát sinh doanh thu nào sếp ạ (0 đồng từ 0 đơn hàng).',
    { totalOrders: 221, totalRevenue: 49054900, totalQty: 611 }
  );
  ok(contradiction === true, 'đáp claim 0 trong khi tool có 221 đơn → phải báo mâu thuẫn');
  const noContradiction = (CopilotGuardrails as any).findZeroClaimContradiction(
    'Hôm nay chưa phát sinh đơn nào sếp ạ (0 đồng từ 0 đơn hàng).',
    { totalOrders: 0, totalRevenue: 0, totalQty: 0 }
  );
  ok(noContradiction === false, 'tool đúng là 0 thì claim 0 là trung thực, không báo');

  // --- Bug 3: câu không nhắc kho + history có kho → KHÔNG được dính kho cũ ---
  const plan: any = await CopilotGuardrails.planQuery(
    'doanh thu sáng hôm nay',
    undefined,
    'local',
    [{ role: 'user', content: 'tồn kho âu cơ còn bao nhiêu?' }]
  );
  ok(plan.action === 'CALL_TOOL', `phải gọi tool, thật: ${plan.action}`);
  ok(
    plan.toolCall?.args?.warehouseId === undefined,
    `câu hiện tại không nhắc kho → không gắn kho câu trước, thật: ${plan.toolCall?.args?.warehouseId}`
  );
  // Nhưng có đại từ "kho đó" thì ĐƯỢC nhớ từ history.
  const plan2: any = await CopilotGuardrails.planQuery(
    'doanh thu sáng hôm nay ở kho đó thế nào?',
    undefined,
    'local',
    [{ role: 'user', content: 'tồn kho âu cơ còn bao nhiêu?' }]
  );
  ok(
    plan2.toolCall?.args?.warehouseId === 'wh-au-co',
    `có "kho đó" thì nhớ kho câu trước, thật: ${plan2.toolCall?.args?.warehouseId}`
  );

  // --- Bug 4: ép model chết → đáp phải nói rõ đã đổi bộ não ---
  const session = await signSession({
    role: 'ROLE_OWNER', actorId: 'ADMIN-01', fullName: 'Grounding Fixes',
    issuedAt: Date.now(), expiresAt: Date.now() + 60_000,
  });
  const cookie = `${SESSION_COOKIE_NAME}=${session}`;
  const res: any = await postCopilot(
    new Request('http://localhost/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ question: 'doanh số hôm nay?', model: 'cf/gpt-oss-120b' }),
    }) as any
  );
  const body = await res.json();
  ok(body.success === true, 'API success');
  ok(
    typeof body.data?.answer === 'string' && body.data.answer.includes('không gọi được'),
    `đáp phải báo model được chọn không gọi được, thật: ${String(body.data?.answer || '').slice(0, 120)}`
  );

  console.log(`\n✅ test-copilot-grounding-fixes: ${checks} assertions PASSED`);
}

run().catch((err) => {
  console.error(`\n❌ test-copilot-grounding-fixes FAILED sau ${checks} checks:`, err);
  process.exit(1);
});
