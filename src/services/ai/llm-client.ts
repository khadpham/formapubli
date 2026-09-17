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

/** Model Gemini bắt buộc cấu hình qua env — không default cứng model cũ. */
export function resolveGeminiModel(): string {
  const model = (process.env.GEMINI_MODEL || '').trim();
  if (!model) {
    throw new LlmConfigError(
      'Thiếu cấu hình GEMINI_MODEL. Đặt tên model Gemini (VD: GEMINI_MODEL=gemini-2.0-flash) ' +
        'sau khi Team B chốt model ở Sprint 0 — không dùng model mặc định cũ.'
    );
  }
  return model;
}

export function resolveOpenAIModel(): string {
  return (process.env.OPENAI_MODEL || '').trim() || 'gpt-4o-mini';
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
}

export async function callOpenAIJsonRaw(params: {
  systemPrompt: string;
  userText: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): Promise<string> {
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
