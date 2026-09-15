import { CatalogRef, parseSmartOrder, SmartParseResult } from '@/lib/smart-order-parser';

export interface AIOrderParseRequest {
  text: string;
  source?: 'EMAIL' | 'FACEBOOK' | 'PASTE';
  catalog: CatalogRef[];
  forceFallback?: boolean;
}

export interface AIOrderParseResponse extends SmartParseResult {
  engineUsed: 'LLM_GEMINI' | 'LLM_OPENAI' | 'FALLBACK_RULE_BASED';
  confidence: number;
  aiNote?: string;
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
      aiNote: 'LLM không phản hồi kịp thời. Hệ thống đã kích hoạt bộ phân tích dự phòng an toàn.',
    };
  }

  private static async parseWithGemini(
    text: string,
    catalog: CatalogRef[],
    apiKey: string
  ): Promise<AIOrderParseResponse> {
    const catalogSummary = catalog.map((c) => '[' + c.code + '] ' + c.title + ' (ID: ' + c.editionId + ')').join('\n');
    const systemPrompt = 'Bạn là trợ lý AI chuyên bóc tách đơn hàng tiếng Việt cho Formapubli.\n' +
      'Trích xuất JSON chuẩn: { customerName, phone, address, items: [{editionId, code, title, quantity}], warnings: [] } khớp với danh mục:\n' + catalogSummary;

    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\nNỘI DUNG ĐƠN:\n' + text }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
      })
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('Gemini API HTTP ' + res.status);
    const data = await res.json();
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) throw new Error('Empty Gemini response');
    const parsed = JSON.parse(rawJson);

    return {
      customerName: parsed.customerName || undefined,
      phone: parsed.phone || undefined,
      address: parsed.address || undefined,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      rawChat: text,
      engineUsed: 'LLM_GEMINI',
      confidence: 0.98,
      aiNote: 'Trích xuất tự động qua Google Gemini 1.5 Flash.'
    };
  }

  private static async parseWithOpenAI(
    text: string,
    catalog: CatalogRef[],
    apiKey: string
  ): Promise<AIOrderParseResponse> {
    const catalogSummary = catalog.map((c) => '[' + c.code + '] ' + c.title + ' (ID: ' + c.editionId + ')').join('\n');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'Bóc tách đơn hàng Formapubli. Trả về JSON: { customerName, phone, address, items: [{editionId, code, title, quantity}], warnings: [] } khớp danh mục:\n' + catalogSummary },
          { role: 'user', content: text }
        ]
      })
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('OpenAI API HTTP ' + res.status);
    const data = await res.json();
    const rawJson = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(rawJson);

    return {
      customerName: parsed.customerName || undefined,
      phone: parsed.phone || undefined,
      address: parsed.address || undefined,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      rawChat: text,
      engineUsed: 'LLM_OPENAI',
      confidence: 0.95,
      aiNote: 'Trích xuất tự động qua OpenAI GPT-4o-mini.'
    };
  }
}
