import { z } from 'zod';
import { db, editions, orderItems, orders } from '../db';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { AnalyticsService } from './analytics.service';
import { OrderService } from './order.service';
import { ForecastService } from './forecast.service';
import {
  callGeminiJsonRaw,
  callGroqChatJsonRaw,
  resolveGroqChatModels,
  parseLlmJson,
} from './ai/llm-client';

/**
 * 5.5 — MONTHLY EXECUTIVE DIGEST (tầng dữ liệu + briefing).
 * Read-only. Không gửi mail (Worker + Resend ở tầng deploy riêng).
 * Mọi số liệu từ service nghiệp vụ hiện có — digest không tự tính lại.
 */

export interface MonthRange {
  year: number;
  month: number; // 1-12
  startDate: string;
  endDate: string;
}

export function monthRangeOf(year: number, month: number): MonthRange {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Tháng không hợp lệ: ${year}-${month}`);
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  return { year, month, startDate: start.toISOString(), endDate: end.toISOString() };
}

/** Idempotency theo tháng cho Worker cron (chống gửi trùng). */
export function digestIdOf(year: number, month: number): string {
  return `DIGEST-${year}-${String(month).padStart(2, '0')}`;
}

export interface TopEditionRow {
  editionId: string;
  code: string;
  title: string | null;
  qty: number;
  revenue: number;
}

export interface MonthlyDigest {
  digestId: string;
  year: number;
  month: number;
  channels: Awaited<ReturnType<typeof AnalyticsService.byChannel>>;
  cashflow: Awaited<ReturnType<typeof AnalyticsService.cashflow>>;
  fiscal: {
    all: { revenue: number; orders: number };
    officialTax: { revenue: number; orders: number };
    internal: { revenue: number; orders: number };
  };
  topEditions: TopEditionRow[];
  redAlerts: Array<{ editionId: string; code: string; title: string | null; doi: number | null; suggestedReprintQty: number }>;
  yellowCount: number;
}

async function topEditions(range: { startDate: string; endDate: string }, topN = 5): Promise<TopEditionRow[]> {
  const rows = await db
    .select({
      editionId: orderItems.editionId,
      qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
      revenue: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.status, 'COMPLETED'),
        gte(orders.createdAt, range.startDate),
        lte(orders.createdAt, range.endDate)
      )
    )
    .groupBy(orderItems.editionId)
    .orderBy(desc(sql`COALESCE(SUM(${orderItems.quantity}), 0)`))
    .limit(Math.max(1, Math.min(20, topN)));
  const out: TopEditionRow[] = [];
  for (const r of rows) {
    const meta = (
      await db.select({ code: editions.code, title: editions.title }).from(editions).where(eq(editions.id, r.editionId)).limit(1)
    )[0];
    out.push({
      editionId: r.editionId,
      code: meta?.code || '?',
      title: meta?.title || null,
      qty: Number(r.qty || 0),
      revenue: Number(r.revenue || 0),
    });
  }
  return out;
}

export class ExecutiveDigestService {
  static async buildMonthlyDigest(year: number, month: number): Promise<MonthlyDigest> {
    const range = monthRangeOf(year, month);
    const [channels, cashflow, allSum, taxSum, internalSum, top, forecast] = await Promise.all([
      AnalyticsService.byChannel(range),
      AnalyticsService.cashflow(range),
      OrderService.getSalesSummary({ fiscalScope: 'ALL', startDate: range.startDate, endDate: range.endDate }),
      OrderService.getSalesSummary({ fiscalScope: 'OFFICIAL_TAX', startDate: range.startDate, endDate: range.endDate }),
      OrderService.getSalesSummary({ fiscalScope: 'INTERNAL_MANAGEMENT', startDate: range.startDate, endDate: range.endDate }),
      topEditions(range, 5),
      ForecastService.forecastAll(30, undefined, undefined, 200),
    ]);
    const redAlerts = forecast.items
      .filter((i) => i.level === 'RED_ALERT')
      .slice(0, 5)
      .map((i) => ({ editionId: i.editionId, code: i.code, title: i.title, doi: i.doi, suggestedReprintQty: i.suggestedReprintQty }));
    return {
      digestId: digestIdOf(year, month),
      year,
      month,
      channels,
      cashflow,
      fiscal: {
        all: { revenue: Number(allSum.totalRevenue || 0), orders: Number(allSum.totalOrders || 0) },
        officialTax: { revenue: Number(taxSum.totalRevenue || 0), orders: Number(taxSum.totalOrders || 0) },
        internal: { revenue: Number(internalSum.totalRevenue || 0), orders: Number(internalSum.totalOrders || 0) },
      },
      topEditions: top,
      redAlerts,
      yellowCount: forecast.summary.YELLOW_WARNING,
    };
  }

  /** CSV đính kèm mail (UTF-8 BOM do caller thêm khi gửi). */
  static buildCsv(digest: MonthlyDigest): { filename: string; csv: string } {
    const esc = (v: unknown): string => {
      const s = `${v ?? ''}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['loai,ma,tieu_de,so_luong,doanh_thu_vnd'];
    for (const t of digest.topEditions) {
      lines.push(['top_ban_chay', t.code, t.title || '', t.qty, t.revenue].map(esc).join(','));
    }
    for (const c of digest.channels) {
      lines.push(['kenh', c.channel, '', c.orders, c.revenue].map(esc).join(','));
    }
    for (const r of digest.redAlerts) {
      lines.push(['can_kho_do', r.code, r.title || '', '', r.suggestedReprintQty].map(esc).join(','));
    }
    return { filename: `${digest.digestId}.csv`, csv: lines.join('\n') };
  }
}

// ---------------------------------------------------------------------------
// AI Executive Briefing: 3 dòng Điểm sáng - Rủi ro - Quyết sách.
// Mọi số PHẢI từ digest (prompt + Zod). Fallback template khi không có LLM.
// ---------------------------------------------------------------------------

const BriefingSchema = z.object({
  highlight: z.string().min(1).max(500),
  risk: z.string().min(1).max(500),
  decision: z.string().min(1).max(500),
});

export type ExecutiveBriefing = z.output<typeof BriefingSchema>;

function briefingPrompt(digest: MonthlyDigest): string {
  return (
    'Bạn là trợ lý điều hành. Từ số liệu tháng sau, viết đúng 3 dòng tiếng Việt, ' +
    'mỗi dòng ≤ 200 ký tự, MỌI CON SỐ lấy nguyên văn từ số liệu, cấm bịa:\n' +
    `Doanh thu: ${digest.fiscal.all.revenue} đ (${digest.fiscal.all.orders} đơn). ` +
    `Top: ${digest.topEditions.map((t) => `${t.code} x${t.qty}`).join(', ') || 'không có'}. ` +
    `Cạn kho đỏ: ${digest.redAlerts.map((r) => r.code).join(', ') || 'không có'}. ` +
    `Vàng: ${digest.yellowCount} đầu sách.\n` +
    'Trả JSON: { highlight: "Điểm sáng: ...", risk: "Rủi ro: ...", decision: "Quyết sách: ..." }'
  );
}

function templateBriefing(digest: MonthlyDigest): ExecutiveBriefing {
  const top = digest.topEditions[0];
  return {
    highlight: `Điểm sáng: tháng ${digest.month} đạt ${digest.fiscal.all.revenue} đ từ ${digest.fiscal.all.orders} đơn${top ? `, dẫn đầu ${top.code} x${top.qty}` : ''}.`,
    risk: digest.redAlerts.length > 0
      ? `Rủi ro: ${digest.redAlerts.length} đầu sách báo đỏ cạn kho (${digest.redAlerts.map((r) => r.code).join(', ')}).`
      : 'Rủi ro: không có đầu sách báo đỏ cạn kho.',
    decision: digest.redAlerts.length > 0
      ? `Quyết sách: duyệt in bù ${digest.redAlerts[0].code} SL ${digest.redAlerts[0].suggestedReprintQty} theo chính sách 105 ngày.`
      : 'Quyết sách: giữ nhịp nhập hàng hiện tại, theo dõi nhóm vàng.',
  };
}

export async function generateBriefing(digest: MonthlyDigest): Promise<{ briefing: ExecutiveBriefing; engine: 'LLM_GEMINI' | 'LLM_GROQ' | 'TEMPLATE' }> {
  const prompt = briefingPrompt(digest);
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const groqModels = (process.env.GROQ_CHAT_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);

  const tryParse = (raw: string): ExecutiveBriefing | null => {
    try {
      return parseLlmJson(raw, BriefingSchema, 'Briefing');
    } catch {
      return null;
    }
  };

  if (geminiKey) {
    try {
      const raw = await callGeminiJsonRaw({ systemPrompt: prompt, userText: 'Viết briefing.', apiKey: geminiKey });
      const b = tryParse(raw);
      if (b) return { briefing: b, engine: 'LLM_GEMINI' };
    } catch (err) {
      console.warn('⚠️ Briefing Gemini lỗi, thử tầng tiếp theo:', (err as Error)?.message || err);
    }
  }

  if (groqKey && groqModels.length > 0) {
    try {
      // Groq json_object mode bắt prompt chứa chữ "json" — đã có trong prompt bên dưới.
      const raw = await callGroqChatJsonRaw({ systemPrompt: prompt + ' (tra JSON: {"highlight","risk","decision"})', userText: 'Viết briefing.', apiKey: groqKey, model: groqModels[0] });
      const b = tryParse(raw);
      if (b) return { briefing: b, engine: 'LLM_GROQ' };
    } catch (err) {
      console.warn('⚠️ Briefing Groq lỗi, dùng template:', (err as Error)?.message || err);
    }
  }

  return { briefing: templateBriefing(digest), engine: 'TEMPLATE' };
}
