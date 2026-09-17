import { z } from 'zod';

/**
 * Team B — LLM CLIENT DÙNG CHUNG (P3, docs/PHASE5_LANE_CONTRACT.md).
 *
 * Edge-safe: chỉ dùng native `fetch` + `AbortController`, không import
 * module Node (`https`, `fs`...). Tương thích Cloudflare Pages/Workers (V8 isolate).
 *
 * Quy tắc cấu hình:
 * - Tên model đọc từ env (`GEMINI_MODEL`, `OPENAI_MODEL`). KHÔNG default
 *   model Gemini cũ trong code — thiếu env mà có API key thì ném
 *   `LlmConfigError` để caller rơi về fallback, không âm thầm gọi model stale.
 */

export const LLM_DEFAULT_TIMEOUT_MS = 6000;
export const MAX_CATALOG_CHARS = 12000;

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

export class LlmSchemaError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'LlmSchemaError';
    this.details = details;
  }
}

export type LlmEngine = 'LLM_GEMINI' | 'LLM_OPENAI';

/**
 * Model Gemini bắt buộc cấu hình qua env — không default cứng model cũ.
 *
 * QUYẾT ĐỊNH SPRINT 0 + ĐO THẬT 17/09/2026 (Chủ dự án duyệt):
 * - gemini-1.5-flash-002: retired 24/09/2025. gemini-2.0-flash: retired 01/06/2026.
 * - gemini-2.5-flash: retirement 20/10/2026 (đã ghi nhận 404 sớm) — KHÔNG dùng.
 * - CHỐT: GEMINI_MODEL=gemini-3.5-flash-lite (đo thật: ~950ms, JSON chuẩn,
 *   đúng editionId + số lượng; bản full 3.5-flash chậm ~8.4s và 503 thất thường).
 * - Tầng Groq đo thật cùng prompt: gpt-oss-20b đúng (~1150ms), qwen3.8-27b
 *   nhanh (~420ms) nhưng bịa mã H01-001/H01-002 và chẻ số lượng — LOẠI khỏi chuỗi.
 * - Nếu chuyển sang 3.6+: Google đã bỏ temperature/top_p/top_k — phải cập nhật
 *   generationConfig trong file này trước (xóa temperature).
 */
export function resolveGeminiModel(): string {
  const model = (process.env.GEMINI_MODEL || '').trim();
  if (!model) {
    throw new LlmConfigError(
      'Thiếu cấu hình GEMINI_MODEL. Đặt GEMINI_MODEL=gemini-3.5-flash-lite ' +
        '(đã chốt + đo thật 17/09/2026) — không dùng model mặc định cũ.'
    );
  }
  return model;
}

export function resolveOpenAIModel(): string {
  return (process.env.OPENAI_MODEL || '').trim() || 'gpt-4o-mini';
}

/**
 * Model chat Groq (tầng 3 opt-in). Trả null khi chưa cấu hình -> caller BỎ QUA
 * tầng này, KHÔNG ném lỗi (tránh phá vỡ chuỗi fallback khi admin chưa bật).
 * Khuyến nghị: GROQ_CHAT_MODEL=openai/gpt-oss-20b (strict JSON schema, ~1000 tps).
 */
export function resolveGroqChatModel(): string | null {
  const model = (process.env.GROQ_CHAT_MODEL || '').trim();
  return model || null;
}

export function resolveGroqApiKey(): string {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) throw new LlmConfigError('Thiếu GROQ_API_KEY cho tầng chat Groq.');
  return key;
}

/** Chat JSON qua Groq (OpenAI-compatible endpoint, json_object mode). */
export async function callGroqChatJsonRaw(params: {
  systemPrompt: string;
  userText: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = params.apiKey ?? resolveGroqApiKey();
  const model = params.model ?? resolveGroqChatModel();
  if (!model) throw new LlmConfigError('Tầng chat Groq chưa bật (thiếu GROQ_CHAT_MODEL).');
  return withLlmCircuit('groq', async () => {
    const data = (await postJsonWithTimeout(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userText },
        ],
      },
      { Authorization: 'Bearer ' + apiKey },
      params.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS,
      'GroqChat'
    )) as { choices?: Array<{ message?: { content?: string } }> };
    const rawJson = data.choices?.[0]?.message?.content;
    if (!rawJson) throw new Error('Empty Groq chat response');
    return rawJson;
  });
}

/** Cắt catalog summary để kiểm soát token/chi phí gửi lên LLM. */
export function truncateCatalog(catalogSummary: string, maxChars = MAX_CATALOG_CHARS): string {
  if (catalogSummary.length <= maxChars) return catalogSummary;
  return catalogSummary.slice(0, maxChars) + '\n[... rút gọn để tiết kiệm token ...]';
}

async function postJsonWithTimeout(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  engine: string
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${engine} API HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${engine} timeout sau ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callGeminiJsonRaw(params: {
  systemPrompt: string;
  userText: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<string> {
  const model = resolveGeminiModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${params.apiKey}`;
  return withLlmCircuit('gemini', async () => {
    const data = (await postJsonWithTimeout(
      endpoint,
      {
        contents: [{ role: 'user', parts: [{ text: params.systemPrompt + '\n\nNỘI DUNG:\n' + params.userText }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      },
      {},
      params.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS,
      'Gemini'
    )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) throw new Error('Empty Gemini response');
    return rawJson;
  });
}

export async function callOpenAIJsonRaw(params: {
  systemPrompt: string;
  userText: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): Promise<string> {
  return withLlmCircuit('openai', async () => {
    const data = (await postJsonWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        model: params.model ?? resolveOpenAIModel(),
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userText },
        ],
      },
      { Authorization: 'Bearer ' + params.apiKey },
      params.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS,
      'OpenAI'
    )) as { choices?: Array<{ message?: { content?: string } }> };
    const rawJson = data.choices?.[0]?.message?.content;
    if (!rawJson) throw new Error('Empty OpenAI response');
    return rawJson;
  });
}

/**
 * Chuỗi optional chịu được null: LLM (đặc biệt Gemini) hay trả
 * `"phone": null` thay vì省略 trường — coi null như không có.
 */
export function nullableString(max: number): z.ZodType<string | undefined> {
  return z.preprocess(
    (v) => (v === null ? undefined : v),
    z.string().max(max).optional()
  ) as z.ZodType<string | undefined>;
}

/**
 * Parse JSON từ LLM qua Zod schema. Ném `LlmSchemaError` khi JSON vỡ
 * hoặc lệch schema — caller bắt và rơi về fallback, không crash.
 */
export function parseLlmJson<T>(rawJson: string, schema: z.ZodType<T, any, any>, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    throw new LlmSchemaError(`${label}: LLM trả về chuỗi không phải JSON hợp lệ`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new LlmSchemaError(`${label}: JSON lệch schema`, result.error.flatten());
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// CIRCUIT BREAKER + NGÂN SÁCH GỌI (Sprint 0, Team B).
// - Breaker: N lỗi liên tiếp -> mở mạch, fail-fast trong cooldownMs để không
//   đốt token/quota khi nhà cung cấp sập. Hết cooldown cho 1 trial (half-open).
// - Budget: chặn số lượt gọi/tháng (in-memory, theo process). Khi vượt, ném
//   LlmBudgetExceededError để caller rơi về fallback nội bộ.
// - GIỚI HẠN: in-memory reset khi restart/multi-instance. Muốn hạch toán
//   chuẩn theo tháng cần ledger DB (Team A, migration riêng — ngoài Sprint 0).
// - Edge-safe: chỉ dùng Date.now(), không dùng Timer thường trực.
// ---------------------------------------------------------------------------

export class LlmCircuitOpenError extends Error {
  constructor(engine: string) {
    super(`Mạch ${engine} đang mở (nhà cung cấp lỗi liên tiếp). Dùng fallback nội bộ.`);
    this.name = 'LlmCircuitOpenError';
  }
}

export class LlmBudgetExceededError extends Error {
  constructor(limit: number) {
    super(`Vượt ngân sách gọi LLM tháng này (${limit} lượt). Dùng fallback nội bộ.`);
    this.name = 'LlmBudgetExceededError';
  }
}

export type LlmEngineKey = 'gemini' | 'openai' | 'groq';

export interface LlmBreakerConfig {
  maxFailures: number;
  cooldownMs: number;
  monthlyBudget: number; // 0 = không giới hạn
}

export function llmBreakerConfig(): LlmBreakerConfig {
  const num = (v: string | undefined, fallback: number): number => {
    const n = parseInt(v || '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    maxFailures: num(process.env.LLM_MAX_CONSECUTIVE_FAILURES, 5),
    cooldownMs: num(process.env.LLM_CIRCUIT_COOLDOWN_MS, 60000),
    monthlyBudget: num(process.env.LLM_MONTHLY_CALL_BUDGET, 0),
  };
}

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number;
}

const breakerStates: Record<LlmEngineKey, BreakerState> = {
  gemini: { consecutiveFailures: 0, openedAt: 0 },
  openai: { consecutiveFailures: 0, openedAt: 0 },
  groq: { consecutiveFailures: 0, openedAt: 0 },
};

interface BudgetState {
  monthKey: string;
  calls: number;
}

const budgetState: BudgetState = { monthKey: '', calls: 0 };

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
}

export type CircuitStatus = 'CLOSED' | 'OPEN';

export function getLlmHealth(): Record<
  LlmEngineKey,
  { status: CircuitStatus; consecutiveFailures: number }
> & { budget: { monthKey: string; calls: number; limit: number } } {
  const cfg = llmBreakerConfig();
  const snap = (engine: LlmEngineKey) => {
    const s = breakerStates[engine];
    const open =
      s.consecutiveFailures >= cfg.maxFailures && Date.now() - s.openedAt < cfg.cooldownMs;
    return { status: (open ? 'OPEN' : 'CLOSED') as CircuitStatus, consecutiveFailures: s.consecutiveFailures };
  };
  return {
    gemini: snap('gemini'),
    openai: snap('openai'),
    groq: snap('groq'),
    budget: { monthKey: budgetState.monthKey || currentMonthKey(), calls: budgetState.calls, limit: cfg.monthlyBudget },
  };
}

/** Dùng cho test/eval — reset mạch và ngân sách về trạng thái sạch. */
export function resetLlmBreaker(engine?: LlmEngineKey): void {
  const keys: LlmEngineKey[] = engine ? [engine] : ['gemini', 'openai', 'groq'];
  for (const k of keys) breakerStates[k] = { consecutiveFailures: 0, openedAt: 0 };
  if (!engine) budgetState.monthKey = '';
  budgetState.calls = 0;
}

export async function withLlmCircuit<T>(engine: LlmEngineKey, fn: () => Promise<T>): Promise<T> {
  const cfg = llmBreakerConfig();
  const state = breakerStates[engine];

  // 1. Mạch đang mở trong cooldown -> fail-fast MIỄN PHÍ (không gọi mạng,
  //    KHÔNG trừ budget — vì không tốn quota nhà cung cấp).
  if (state.consecutiveFailures >= cfg.maxFailures) {
    if (Date.now() - state.openedAt < cfg.cooldownMs) {
      throw new LlmCircuitOpenError(engine);
    }
    // Hết cooldown: half-open — cho 1 trial bằng cách hạ failures xuống ngưỡng-1.
    state.consecutiveFailures = cfg.maxFailures - 1;
  }

  // 2. Ngân sách tháng (đếm lượt gọi thật, kể cả lỗi — vì lỗi vẫn có thể tốn quota).
  if (cfg.monthlyBudget > 0) {
    const key = currentMonthKey();
    if (budgetState.monthKey !== key) {
      budgetState.monthKey = key;
      budgetState.calls = 0;
    }
    if (budgetState.calls >= cfg.monthlyBudget) {
      throw new LlmBudgetExceededError(cfg.monthlyBudget);
    }
    budgetState.calls += 1;
  }

  // 3. Thực thi trial.
  try {
    const result = await fn();
    state.consecutiveFailures = 0;
    return result;
  } catch (err) {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= cfg.maxFailures) {
      state.openedAt = Date.now();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Độ tin cậy heuristic (thay số ghi cứng 0.98/0.95 cũ).
// Thang đo có định nghĩa, nguồn ghi rõ 'heuristic' — KHÔNG phải đo thực tế.
// - fallback không khớp item nào  -> 0.40 (không đủ cơ sở)
// - LLM parse + khớp catalog toàn bộ -> 0.90 (cao nhưng vẫn heuristic)
// - các trường hợp giữa            -> nội suy theo tỉ lệ khớp
// Khi có eval đo thực tế, thay bằng 'measured'.
// ---------------------------------------------------------------------------

export type ConfidenceSource = 'heuristic' | 'measured';

export interface ConfidenceScore {
  value: number;
  source: ConfidenceSource;
}

export function heuristicConfidence(matchedCount: number, totalCount: number): ConfidenceScore {
  if (totalCount <= 0) return { value: 0.4, source: 'heuristic' };
  const ratio = Math.max(0, Math.min(1, matchedCount / totalCount));
  const value = Math.round((0.4 + 0.5 * ratio) * 100) / 100;
  return { value, source: 'heuristic' };
}
