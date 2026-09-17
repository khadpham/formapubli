/**
 * 5.1 — SMART VOICE POS DISPATCHER (DB cách ly, KHÔNG gọi mạng thật).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-voice-order
 * 11 cases: STT stub, breaker, budget-config, filter SKU lạ, oversize,
 * RBAC route (401/403), text-only draft, multipart STT, audit log.
 */
import { db, auditLogs } from '../src/db';
import { desc } from 'drizzle-orm';
import {
  transcribeAudio,
  extractOrderEntities,
  parseVoiceOrder,
  VoiceConfigError,
  STT_MAX_AUDIO_BYTES,
} from '../src/services/ai/voice-order.service';
import {
  withLlmCircuit,
  resetLlmBreaker,
  LlmCircuitOpenError,
  LlmBudgetExceededError,
} from '../src/services/ai/llm-client';
import { POST as postVoice } from '../src/app/api/ai/parse-voice-order/route';
import { signSession, SESSION_COOKIE_NAME } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-voice-order');

// Môi trường test thuần nội bộ: xóa keys để ép fallback rule-based,
// trừ khi case cụ thể tự set + stub fetch.
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;

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

const FAKE_CATALOG = [
  { editionId: 'ed-hx', code: 'HX', title: 'Học X' },
  { editionId: 'ed-ty', code: 'TY', title: 'Toán Y' },
];

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

async function makeCookie(role: string, actorId: string): Promise<string> {
  const token = await signSession({
    role: role as 'ROLE_OWNER' | 'ROLE_MANAGER' | 'ROLE_CASHIER' | 'ROLE_TAX',
    actorId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function tinyAudio(): Blob {
  return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });
}

async function run() {
  console.log('🎙️ VOICE POS DISPATCHER 5.1 (stub mạng, DB cách ly)');

  // 1. STT thành công qua stub Groq.
  process.env.GROQ_API_KEY = 'test-groq-key';
  resetLlmBreaker('groq');
  stubFetch(async (url) => {
    if (url.includes('api.groq.com')) {
      return Response.json({ text: 'lấy 2 cuốn HX' });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  const stt = await transcribeAudio({ audio: tinyAudio() });
  ok(
    '1. STT stub trả transcript + engine STT_GROQ',
    stt.text === 'lấy 2 cuốn HX' && stt.engine === 'STT_GROQ',
    `text="${stt.text}"`
  );
  restoreFetch();

  // 2. Groq lỗi liên tiếp -> breaker mở, fail-fast không gọi mạng.
  resetLlmBreaker('groq');
  let fetchCalls = 0;
  stubFetch(async (url) => {
    if (url.includes('api.groq.com')) {
      fetchCalls++;
      return new Response('busy', { status: 500 });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  for (let i = 0; i < 5; i++) {
    try {
      await transcribeAudio({ audio: tinyAudio() });
    } catch {
      /* kỳ vọng lỗi provider */
    }
  }
  let opened = false;
  try {
    await transcribeAudio({ audio: tinyAudio() });
  } catch (err) {
    opened = err instanceof LlmCircuitOpenError;
  }
  ok('2. Breaker Groq mở sau 5 lỗi, lần 6 fail-fast', opened && fetchCalls === 5, `fetchCalls=${fetchCalls}`);
  restoreFetch();
  resetLlmBreaker('groq');

  // 3. Thiếu GROQ_API_KEY + có audio -> VoiceConfigError (route sẽ 503 nếu không có text).
  delete process.env.GROQ_API_KEY;
  let configErr = false;
  try {
    await transcribeAudio({ audio: tinyAudio() });
  } catch (err) {
    configErr = err instanceof VoiceConfigError;
  }
  ok('3. Thiếu GROQ_API_KEY ném VoiceConfigError', configErr);

  // 4. Text-only không key -> rule-based trích được item khớp catalog.
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const ruled = await extractOrderEntities('lấy 2 cuốn học x và 1 cuốn toán y', FAKE_CATALOG);
  ok(
    '4. Rule-based bóc đúng 2 dòng khớp catalog',
    ruled.engine === 'FALLBACK_RULE_BASED' &&
      ruled.checked.some((i) => i.editionId === 'ed-hx' && i.quantity === 2) &&
      ruled.checked.some((i) => i.editionId === 'ed-ty' && i.quantity === 1),
    `engine=${ruled.engine}`
  );

  // 5. LLM bịa SKU lạ -> bị lọc + warning (chống hallucination).
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'test-model-stubbed';
  resetLlmBreaker('gemini');
  stubFetch(async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    items: [
                      { editionId: 'ed-hx', code: 'HX', title: 'Học X', quantity: 1 },
                      { editionId: 'ed-MA-BIA', code: 'ZZZ', title: 'Sách bịa', quantity: 5 },
                    ],
                    warnings: [],
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  const filtered = await extractOrderEntities('lấy sách', FAKE_CATALOG);
  ok(
    '5. SKU lạ bị loại, giữ SKU thật, có warning',
    filtered.engine === 'LLM_GEMINI' &&
      filtered.checked.length === 1 &&
      filtered.checked[0].editionId === 'ed-hx' &&
      filtered.checkWarnings.length > 0,
    `kept=${filtered.checked.length}`
  );
  restoreFetch();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  resetLlmBreaker('gemini');

  // 6. Audio vượt 10MB -> từ chối ngay, không gọi mạng.
  const bigAudio = new Blob([new Uint8Array(STT_MAX_AUDIO_BYTES + 1)], { type: 'audio/webm' });
  let oversize = false;
  try {
    await transcribeAudio({ audio: bigAudio, apiKey: 'k' });
  } catch (err) {
    oversize = err instanceof VoiceConfigError;
  }
  ok('6. Audio vượt giới hạn bị từ chối trước khi gọi mạng', oversize);

  // 7. Route không cookie -> 401.
  const noAuth = (await postVoice(
    new Request('http://localhost/api/ai/parse-voice-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'lấy 1 cuốn HX' }),
    }) as never
  )) as Response;
  ok('7. Route thiếu session -> 401', noAuth.status === 401, `status=${noAuth.status}`);

  // 8. Route TAX -> 403.
  const taxCookie = await makeCookie('ROLE_TAX', 'tax-voice');
  const taxRes = (await postVoice(
    new Request('http://localhost/api/ai/parse-voice-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: taxCookie },
      body: JSON.stringify({ text: 'lấy 1 cuốn HX' }),
    }) as never
  )) as Response;
  ok('8. Route TAX -> 403', taxRes.status === 403, `status=${taxRes.status}`);

  // 9. Route cashier + text -> 200 giỏ nháp đúng shape + audit log.
  const cashCookie = await makeCookie('ROLE_CASHIER', 'nv-voice-01');
  const draftRes = (await postVoice(
    new Request('http://localhost/api/ai/parse-voice-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cashCookie },
      body: JSON.stringify({ text: 'khách lấy sách' }),
    }) as never
  )) as Response;
  const draftJson = (await draftRes.json()) as {
    success: boolean;
    data?: { items: unknown[]; warnings: unknown[]; engineUsed: string; transcriptSource: string; confidence: { source: string } };
  };
  const shapeOk =
    draftRes.status === 200 &&
    draftJson.success === true &&
    Array.isArray(draftJson.data?.items) &&
    Array.isArray(draftJson.data?.warnings) &&
    typeof draftJson.data?.engineUsed === 'string' &&
    draftJson.data?.transcriptSource === 'TEXT_INPUT' &&
    draftJson.data?.confidence?.source === 'heuristic';
  const audits = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(50);
  const auditHit = audits.some(
    (a) => a.action === 'VOICE_ORDER_PARSED' && a.actorId === 'nv-voice-01'
  );
  ok('9. Cashier text -> 200 giỏ nháp đúng shape + audit VOICE_ORDER_PARSED', shapeOk && auditHit);

  // 10. Route multipart oversize -> 413, chưa chạm STT.
  const bigForm = new FormData();
  bigForm.append('audio', bigAudio, 'big.webm');
  const bigRes = (await postVoice(
    new Request('http://localhost/api/ai/parse-voice-order', {
      method: 'POST',
      headers: { Cookie: cashCookie },
      body: bigForm,
    }) as never
  )) as Response;
  ok('10. Multipart audio vượt 10MB -> 413', bigRes.status === 413, `status=${bigRes.status}`);

  // 11. Route multipart audio + stub Groq -> 200 transcriptSource STT_GROQ.
  process.env.GROQ_API_KEY = 'test-groq-key';
  resetLlmBreaker('groq');
  stubFetch(async (url) => {
    if (url.includes('api.groq.com')) {
      return Response.json({ text: 'lấy 2 cuốn HX' });
    }
    throw new Error('unexpected fetch: ' + url);
  });
  const voiceForm = new FormData();
  voiceForm.append('audio', tinyAudio(), 'ca1.webm');
  const voiceRes = (await postVoice(
    new Request('http://localhost/api/ai/parse-voice-order', {
      method: 'POST',
      headers: { Cookie: cashCookie },
      body: voiceForm,
    }) as never
  )) as Response;
  const voiceJson = (await voiceRes.json()) as {
    success: boolean;
    data?: { transcript: string; transcriptSource: string };
  };
  ok(
    '11. Multipart audio -> 200 transcriptSource STT_GROQ',
    voiceRes.status === 200 && voiceJson.data?.transcriptSource === 'STT_GROQ',
    `source=${voiceJson.data?.transcriptSource}`
  );
  restoreFetch();
  delete process.env.GROQ_API_KEY;
  resetLlmBreaker('groq');

  // Toán tử withLlmCircuit/budget đã được eval-executive-ai bao phủ (CB-01..03) — không lặp lại ở đây.
  void withLlmCircuit;
  void LlmBudgetExceededError;

  console.log(`\n${passed === total ? '🎉' : '⚠️'} VOICE ORDER 5.1: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-voice-order thất bại:', err);
  process.exit(1);
});
