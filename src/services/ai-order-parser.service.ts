import { z } from 'zod';
import { CatalogRef, parseSmartOrder, SmartParseResult } from '@/lib/smart-order-parser';
import {
  callGeminiJsonRaw,
  callOpenAIJsonRaw,
  parseLlmJson,
  truncateCatalog,
  heuristicConfidence,
  ConfidenceSource,
} from './ai/llm-client';

export interface AIOrderParseRequest {
  text: string;
  source?: 'EMAIL' | 'FACEBOOK' | 'PASTE';
  catalog: CatalogRef[];
  forceFallback?: boolean;
}

export interface AIOrderParseResponse extends SmartParseResult {
  engineUsed: 'LLM_GEMINI' | 'LLM_OPENAI' | 'FALLBACK_RULE_BASED';
  confidence: number;
  confidenceSource?: ConfidenceSource;
  aiNote?: string;
}

const OrderParsedSchema = z.object({
  customerName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  items: z
    .array(
      z.object({
        editionId: z.string().default(''),
        code: z.string().default(''),
        title: z.string().default(''),
        quantity: z.coerce.number().int().positive().default(1),
      })
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
});

interface RawParsedOrder {
  customerName?: string;
  phone?: string;
  address?: string;
  items?: Array<{
    editionId?: string;
    code?: string;
    title?: string;
    quantity?: number;
  }>;
  warnings?: string[];
}

export class AIOrderParserService {
  static async parseOrder(params: AIOrderParseRequest): Promise<AIOrderParseResponse> {
    const { text, catalog, forceFallback = false } = params;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (forceFallback || (!geminiKey && !openaiKey)) {
      const fallbackResult = parseSmartOrder(text, catalog);
      return {
        ...fallbackResult,
        engineUsed: 'FALLBACK_RULE_BASED',
        confidence: fallbackResult.items.length > 0 ? 0.85 : 0.4,
        confidenceSource: 'heuristic',
        aiNote: !geminiKey && !openaiKey
          ? 'Chưa cấu hình API Key. Tự động dùng bộ phân tích dự phòng (Rule-based).'
          : 'Đã ép dùng bộ phân tích dự phòng nội bộ.',
      };
    }

    if (geminiKey) {
      try {
        return await this.parseWithGemini(text, catalog, geminiKey);
      } catch (err: any) {
        console.warn('⚠️ Gemini error, falling back:', err?.message || err);
      }
    }

    if (openaiKey) {
      try {
        return await this.parseWithOpenAI(text, catalog, openaiKey);
      } catch (err: any) {
        console.warn('⚠️ OpenAI error, falling back:', err?.message || err);
      }
    }

    const fallbackResult = parseSmartOrder(text, catalog);
    return {
      ...fallbackResult,
      engineUsed: 'FALLBACK_RULE_BASED',
      confidence: fallbackResult.items.length > 0 ? 0.85 : 0.4,
      confidenceSource: 'heuristic',
      aiNote: 'LLM không phản hồi kịp thời. Hệ thống đã kích hoạt bộ phân tích dự phòng an toàn.',
    };
  }

  private static validateAndMatchCatalog(
    parsed: RawParsedOrder,
    catalog: CatalogRef[]
  ) {
    const catalogMap = new Map(catalog.map((c) => [c.editionId, c]));
    const codeMap = new Map(catalog.map((c) => [c.code.toUpperCase(), c]));
    const validatedItems: Array<{ editionId: string; code: string; title: string; quantity: number }> = [];
    const extraWarnings: string[] = [];

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      const match = (item.editionId && catalogMap.get(item.editionId)) || (item.code && codeMap.get(item.code.toUpperCase()));
      if (match) {
        validatedItems.push({
          editionId: match.editionId,
          code: match.code,
          title: match.title,
          quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
        });
      } else {
        extraWarnings.push(`Ấn bản [${item.code || item.title || item.editionId || 'Không rõ'}] không khớp danh mục hệ thống.`);
      }
    }

    return { validatedItems, extraWarnings };
  }

  private static async parseWithGemini(
    text: string,
    catalog: CatalogRef[],
    apiKey: string
  ): Promise<AIOrderParseResponse> {
    const rawCatalogSummary = catalog
      .map((c) => '[' + c.code + '] ' + c.title + ' (ID: ' + c.editionId + ')')
      .join('\n');
    const catalogSummary = truncateCatalog(rawCatalogSummary);
    const systemPrompt =
      'Bạn là trợ lý AI chuyên bóc tách đơn hàng tiếng Việt cho Formapubli.\n' +
      'Trích xuất JSON chuẩn: { customerName, phone, address, items: [{editionId, code, title, quantity}], warnings: [] } khớp với danh mục:\n' +
      catalogSummary;

    const rawJson = await callGeminiJsonRaw({
      systemPrompt,
      userText: text,
      apiKey,
    });

    const parsed = parseLlmJson(rawJson, OrderParsedSchema, 'GeminiOrderParse');
    const { validatedItems, extraWarnings } = this.validateAndMatchCatalog(parsed, catalog);
    const rawItemsCount = parsed.items?.length || 1;
    const conf = heuristicConfidence(validatedItems.length, rawItemsCount);

    return {
      customerName: parsed.customerName || undefined,
      phone: parsed.phone || undefined,
      address: parsed.address || undefined,
      items: validatedItems,
      warnings: [...(parsed.warnings || []), ...extraWarnings],
      rawChat: text,
      engineUsed: 'LLM_GEMINI',
      confidence: conf.value,
      confidenceSource: conf.source,
      aiNote: 'Trích xuất tự động qua Google Gemini (đã kiểm chứng Zod schema).',
    };
  }

  private static async parseWithOpenAI(
    text: string,
    catalog: CatalogRef[],
    apiKey: string
  ): Promise<AIOrderParseResponse> {
    const rawCatalogSummary = catalog
      .map((c) => '[' + c.code + '] ' + c.title + ' (ID: ' + c.editionId + ')')
      .join('\n');
    const catalogSummary = truncateCatalog(rawCatalogSummary);
    const systemPrompt =
      'Bóc tách đơn hàng Formapubli. Trả về JSON: { customerName, phone, address, items: [{editionId, code, title, quantity}], warnings: [] } khớp danh mục:\n' +
      catalogSummary;

    const rawJson = await callOpenAIJsonRaw({
      systemPrompt,
      userText: text,
      apiKey,
    });

    const parsed = parseLlmJson(rawJson, OrderParsedSchema, 'OpenAIOrderParse');
    const { validatedItems, extraWarnings } = this.validateAndMatchCatalog(parsed, catalog);
    const rawItemsCount = parsed.items?.length || 1;
    const conf = heuristicConfidence(validatedItems.length, rawItemsCount);

    return {
      customerName: parsed.customerName || undefined,
      phone: parsed.phone || undefined,
      address: parsed.address || undefined,
      items: validatedItems,
      warnings: [...(parsed.warnings || []), ...extraWarnings],
      rawChat: text,
      engineUsed: 'LLM_OPENAI',
      confidence: conf.value,
      confidenceSource: conf.source,
      aiNote: 'Trích xuất tự động qua OpenAI (đã kiểm chứng Zod schema).',
    };
  }
}
