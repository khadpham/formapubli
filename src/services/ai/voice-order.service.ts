import { z } from 'zod';
import {
  callGeminiJsonRaw,
  callOpenAIJsonRaw,
  callGroqChatJsonRaw,
  resolveGroqChatModels,
  nullableString,
  parseLlmJson,
  truncateCatalog,
  heuristicConfidence,
  withLlmCircuit,
  type ConfidenceScore,
} from './llm-client';
import { CatalogRef, ParsedItem, parseSmartOrder } from '@/lib/smart-order-parser';

/**
 * 5.1 — SMART VOICE POS DISPATCHER (backend).
 *
 * Luồng: audio thu ngân -> Groq Whisper STT (tiếng Việt) -> trích xuất thực thể
 * (Gemini -> OpenAI -> Rule-based) -> GIỎ NHÁP cho thu ngân xác nhận.
 * Service này KHÔNG tạo đơn, KHÔNG trừ kho — Human-in-the-loop bắt buộc ở UI.
 *
 * Edge-safe: native fetch/FormData/Blob/AbortController, không module Node.
 */

export const STT_DEFAULT_MODEL = 'whisper-large-v3';
export const STT_DEFAULT_TIMEOUT_MS = 15000;
export const STT_MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_ORDER_ITEMS = 50;

export class VoiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceConfigError';
  }
}

export function resolveGroqApiKey(): string {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) {
    throw new VoiceConfigError(
      'Thiếu GROQ_API_KEY. Chế độ giọng nói tắt — dùng nhập/dán text dự phòng.'
    );
  }
  return key;
}

export function resolveSttModel(): string {
  return (process.env.GROQ_STT_MODEL || '').trim() || STT_DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// 1. Speech-to-Text qua Groq Whisper (multipart, tiếng Việt).
// ---------------------------------------------------------------------------

export interface SttResult {
  text: string;
  engine: 'STT_GROQ';
  model: string;
}

export async function transcribeAudio(params: {
  audio: Blob;
  filename?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<SttResult> {
  const apiKey = params.apiKey ?? resolveGroqApiKey();
  const model = resolveSttModel();
  if (params.audio.size > STT_MAX_AUDIO_BYTES) {
    throw new VoiceConfigError(
      `File audio ${(params.audio.size / 1048576).toFixed(1)}MB vượt giới hạn ${STT_MAX_AUDIO_BYTES / 1048576}MB.`
    );
  }
  if (!params.audio.type.startsWith('audio/') && params.audio.type !== 'application/octet-stream') {
    throw new VoiceConfigError(`Định dạng không phải audio: ${params.audio.type || 'unknown'}.`);
  }

  return withLlmCircuit('groq', async () => {
    const form = new FormData();
    form.append('file', params.audio, params.filename || 'pos-voice.webm');
    form.append('model', model);
    form.append('language', 'vi');
    form.append('response_format', 'json');

    const controller = new AbortController();
    const timeoutMs = params.timeoutMs ?? STT_DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey },
        signal: controller.signal,
        body: form,
      });
      if (!res.ok) throw new Error(`Groq STT HTTP ${res.status}`);
      const data = (await res.json()) as { text?: string };
      const text = (data.text || '').trim();
      if (!text) throw new Error('Groq STT trả về rỗng');
      return { text, engine: 'STT_GROQ' as const, model };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Groq STT timeout sau ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Trích xuất thực thể đơn hàng từ transcript (LLM -> Rule-based).
// ---------------------------------------------------------------------------

const VoiceOrderItemSchema = z.object({
  editionId: z.string().min(1),
  code: z.string(),
  title: z.string(),
  quantity: z.number().int().min(1).max(999),
});

const VoiceOrderSchema = z.object({
  customerName: nullableString(200),
  phone: nullableString(20),
  address: nullableString(500),
  items: z.array(VoiceOrderItemSchema).max(MAX_ORDER_ITEMS),
  warnings: z.array(z.string().max(300)).max(20).default([]),
});

export type VoiceOrderEntities = z.output<typeof VoiceOrderSchema>;

function buildExtractionPrompt(catalog: CatalogRef[]): string {
  const summary = truncateCatalog(
    catalog.map((c) => '[' + c.code + '] ' + c.title + ' (ID: ' + c.editionId + ')').join('\n')
  );
  return (
    'Bạn là trợ lý POS bóc tách đơn sách nói tiếng Việt cho Formapubli.\n' +
    'Trả về JSON chuẩn: { customerName?, phone?, address?, ' +
    'items: [{editionId, code, title, quantity}], warnings: [] }.\n' +
    'QUY TẮC: editionId PHẢI lấy từ danh mục dưới đây, cấm bịa mã. ' +
    'Số lượng 1-999; không chắc thì quantity=1 và ghi warnings.\n' +
    'DANH MỤC:\n' + summary
  );
}

/** Đối chiếu item với catalog: lạ -> loại + warning (chống bịa SKU). */
function crossCheckCatalog(
  items: VoiceOrderEntities['items'],
  catalog: CatalogRef[]
): { items: ParsedItem[]; warnings: string[] } {
  const byId = new Map(catalog.map((c) => [c.editionId, c]));
  const kept: ParsedItem[] = [];
  const warnings: string[] = [];
  for (const it of items) {
    const ref = byId.get(it.editionId);
    if (!ref) {
      warnings.push(`Loại dòng lạ không có trong danh mục: ${it.code || it.editionId} — thu ngân kiểm tra tay.`);
      continue;
    }
    const qty = Math.max(1, Math.min(999, it.quantity));
    if (qty !== it.quantity) warnings.push(`Số lượng ${it.code} vượt chuẩn, đã chuẩn hóa về ${qty}.`);
    kept.push({ editionId: ref.editionId, code: ref.code, title: ref.title, quantity: qty });
  }
  return { items: kept, warnings };
}

export async function extractOrderEntities(
  transcript: string,
  catalog: CatalogRef[]
): Promise<{ entities: VoiceOrderEntities; checked: ParsedItem[]; checkWarnings: string[]; engine: 'LLM_GEMINI' | 'LLM_OPENAI' | 'LLM_GROQ' | 'FALLBACK_RULE_BASED' }> {
  const prompt = buildExtractionPrompt(catalog);
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const tryParse = async (raw: string, label: string): Promise<VoiceOrderEntities | null> => {
    try {
      return parseLlmJson(raw, VoiceOrderSchema, label);
    } catch {
      return null;
    }
  };

  // Tầng Groq (khi admin bật, thử từng model theo thứ tự GROQ_CHAT_MODEL).
  // Tầng 2: Gemini. Tầng 3: OpenAI. Cuối: rule-based nội bộ.
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  for (const groqModel of resolveGroqChatModels()) {
    if (!groqKey) break;
    try {
      const raw = await callGroqChatJsonRaw({ systemPrompt: prompt, userText: transcript, apiKey: groqKey, model: groqModel });
      const entities = await tryParse(raw, `VoiceGroq(${groqModel})`);
      if (entities) {
        const { items, warnings } = crossCheckCatalog(entities.items, catalog);
        return { entities, checked: items, checkWarnings: [...entities.warnings, ...warnings], engine: 'LLM_GROQ' };
      }
    } catch (err) {
      console.warn(`⚠️ Voice Groq (${groqModel}) lỗi, thử tầng tiếp theo:`, (err as Error)?.message || err);
    }
  }

  if (geminiKey) {
    try {
      const raw = await callGeminiJsonRaw({ systemPrompt: prompt, userText: transcript, apiKey: geminiKey });
      const entities = await tryParse(raw, 'VoiceGemini');
      if (entities) {
        const { items, warnings } = crossCheckCatalog(entities.items, catalog);
        return { entities, checked: items, checkWarnings: [...entities.warnings, ...warnings], engine: 'LLM_GEMINI' };
      }
    } catch (err) {
      console.warn('⚠️ Voice Gemini lỗi, thử tầng tiếp theo:', (err as Error)?.message || err);
    }
  }

  if (openaiKey) {
    try {
      const raw = await callOpenAIJsonRaw({ systemPrompt: prompt, userText: transcript, apiKey: openaiKey });
      const entities = await tryParse(raw, 'VoiceOpenAI');
      if (entities) {
        const { items, warnings } = crossCheckCatalog(entities.items, catalog);
        return { entities, checked: items, checkWarnings: [...entities.warnings, ...warnings], engine: 'LLM_OPENAI' };
      }
    } catch (err) {
      console.warn('⚠️ Voice OpenAI lỗi, thử tầng Groq:', (err as Error)?.message || err);
    }
  }

  const fallback = parseSmartOrder(transcript, catalog);
  return {
    entities: {
      customerName: fallback.customerName,
      phone: fallback.phone,
      address: fallback.address,
      items: fallback.items,
      warnings: fallback.warnings,
    },
    checked: fallback.items,
    checkWarnings: [...fallback.warnings, 'LLM không khả dụng — dùng bộ phân tích nội bộ, thu ngân kiểm tra kỹ.'],
    engine: 'FALLBACK_RULE_BASED',
  };
}

// ---------------------------------------------------------------------------
// 3. Hàm tổng hợp: audio?/text -> transcript -> thực thể -> GIỎ NHÁP.
// ---------------------------------------------------------------------------

export interface VoiceOrderDraft {
  transcript: string;
  transcriptSource: 'STT_GROQ' | 'TEXT_INPUT';
  sttModel?: string;
  customerName?: string;
  phone?: string;
  address?: string;
  items: ParsedItem[];
  warnings: string[];
  engineUsed: 'LLM_GEMINI' | 'LLM_OPENAI' | 'LLM_GROQ' | 'FALLBACK_RULE_BASED';
  confidence: ConfidenceScore;
  aiNote?: string;
}

export async function parseVoiceOrder(params: {
  audio?: Blob;
  filename?: string;
  text?: string;
  catalog: CatalogRef[];
}): Promise<VoiceOrderDraft> {
  let transcript = (params.text || '').trim();
  let transcriptSource: VoiceOrderDraft['transcriptSource'] = 'TEXT_INPUT';
  let sttModel: string | undefined;

  if (params.audio && params.audio.size > 0) {
    const stt = await transcribeAudio({ audio: params.audio, filename: params.filename });
    transcript = stt.text;
    transcriptSource = 'STT_GROQ';
    sttModel = stt.model;
  }

  if (!transcript) {
    throw new VoiceConfigError('Không có nội dung để bóc tách (audio rỗng và không có text dự phòng).');
  }

  const { entities, checked, checkWarnings, engine } = await extractOrderEntities(transcript, params.catalog);
  const confidence = heuristicConfidence(checked.length, Math.max(entities.items.length, checked.length, 1));

  return {
    transcript,
    transcriptSource,
    sttModel,
    customerName: entities.customerName,
    phone: entities.phone,
    address: entities.address,
    items: checked,
    warnings: checkWarnings,
    engineUsed: engine,
    confidence,
    aiNote:
      engine === 'FALLBACK_RULE_BASED'
        ? 'LLM không khả dụng — giỏ nháp từ bộ phân tích nội bộ, thu ngân kiểm tra từng dòng trước khi chốt.'
        : 'Giỏ nháp do AI đề xuất — thu ngân kiểm tra và bấm xác nhận (Human-in-the-loop).',
  };
}
