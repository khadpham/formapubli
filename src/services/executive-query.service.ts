import { db, cashboxSessions, warehouses, editions, orders, works, orderItems, stockBalances, products, transferShipments, transferShipmentItems, returnOrders, contractDocuments, contractTemplates, partners } from '@/db';
import { ForecastService, RunoutLevel } from './forecast.service';
import { OrderService, createdAtBetween } from './order.service';
import { InventoryService } from './inventory.service';
import { shopeeDeliveredOnly } from './shopee/revenue-guard';
import { removeAccents } from '@/lib/vietnamese';
import { eq, desc, sql, and, inArray, ne, or } from 'drizzle-orm';

export interface QueryStockParams {
  editionId?: string;
  warehouseId?: string;
  /** Ten hoac ma sach nguoi dung nhac trong cau hoi (vd "H01", "Benh tuong") - server tu phan giai. */
  codeOrTitle?: string;
}

export interface StockLevelItem {
  editionId: string;
  code: string;
  title: string | null;
  availableStock: number;
  warehouseBreakdown?: Record<string, number>;
}

export interface QuerySalesParams {
  windowDays?: number;
  fiscalScope?: 'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
  /** 1 ngày VN 'YYYY-MM-DD' (vd "ngày 4/10 ở kho..."): thay windowDays. */
  date?: string;
  /** Loc 1 kho (vd "kho hồ gươm"). Khong truyen = toan he thong. */
  warehouseId?: string;
}

export interface QueryForecastParams {
  level?: RunoutLevel;
  limit?: number;
  windowDays?: number;
}

export interface QueryCashboxParams {
  sessionId?: string;
  date?: string;
}

export interface QueryCatalogParams {
  /** Cau hoi nguyen van - server tu phan tich y dinh (tac gia, chu cai dau, top, liet ke). */
  q?: string;
  author?: string;
  titleStartsWith?: string;
  titleContains?: string;
  topAuthors?: boolean;
  topEditionsBySales?: boolean;
  windowDays?: number;
    limit?: number;
  /** Loc top theo 1 kho (vd "ban chay kho ho guom"). Khong truyen = toan he thong. */
  warehouseId?: string;
  }

  /** Clamp so kieu limit/window: NaN/Infinity tu caller → default an toan. */
  function clampInt(v: unknown, def: number, min: number, max: number): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.floor(n)));
  }

export interface CatalogItem {
  code: string;
  title: string;
  author: string | null;
  coverPrice: number;
  status: string | null;
  availableStock: number;
  soldQty?: number;
}

export interface SaleDraftLine {
  editionId: string;
  code: string;
  title: string;
  quantity: number;
  coverPrice: number;
  availableStock: number;
}

export interface SaleDraft {
  customerName?: string;
  phone?: string;
  address?: string;
  note: string;
  items: SaleDraftLine[];
  warnings: string[];
}

export interface TransferDraftLine {
  editionId: string;
  code: string;
  title: string;
  quantity: number;
  /** Tồn khả dụng tại kho gửi (0 nếu chưa rõ kho gửi). */
  availableStock: number;
}

export interface TransferDraft {
  fromWarehouseId?: string;
  fromWarehouseName?: string;
  toWarehouseId?: string;
  toWarehouseName?: string;
  items: TransferDraftLine[];
  warnings: string[];
}

export class ExecutiveQueryService {
  /**
   * Phan giai kho tu cau hoi ("kho Au Co", "Quynh Mai", "hoi cho") → warehouseId.
   * Alias cum tu uu tien truoc (tranh "Au Co" bi loai vi ngan), sau do tu khoa dai
   * co loai tru tu nghiep vu chung chung (xuat/nhap/ban/tong/luu).
   */
  static async resolveWarehouseFromText(text: string): Promise<{ warehouseId: string; name: string } | null> {
    // Khớp theo DỮ LIỆU (không alias cứng): "kho hồ gươm" phải ra "Hội chợ Hồ
    // Gươm", còn "hội chợ" chung chung hay "kho sách" thì KHÔNG được đoán bừa
    // 1 kho nào (đã dính: alias 'hội chợ' cướp hết về Kho Dự phòng).
    const norm = removeAccents((text || '').toLowerCase());
    if (!norm.trim()) return null;
    const STOP = new Set([
      'kho', 'hoi', 'cho', 'gian', 'hang', 'xuat', 'nhap', 'chuyen', 'ban',
      'tong', 'luu', 'dong', 'si', 'le', 'van', 'chinh', 'phu', 'va', 'o',
      'tai', 'cac', 'khu', 'vuc', 'chi', 'nhanh', 'quay', 'su', 'kien',
    ]);
    const allWh = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
    const qWords = new Set(norm.split(/[^a-z0-9]+/).filter(Boolean));
    let best: { warehouseId: string; name: string } | null = null;
    let bestScore = 0;
    for (const w of allWh) {
      if (w.id === 'wh-in-transit') continue;
      // Chi lay ten chinh (truoc ngoac): "Kho 1 - Âu Cơ (Văn phòng...)" → "Kho 1 - Âu Cơ".
      const core = removeAccents((w.name || '').toLowerCase()).split('(')[0];
      const coreWords = core.split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
      if (coreWords.length === 0) continue;
      const hit = coreWords.filter((t) => qWords.has(t));
      // Ngưỡng: ≥2 từ lõi, hoặc 1 từ mạnh (số kho / từ dài đặc trưng như "quynh").
      const strong = hit.filter((t) => /^\d+$/.test(t) || t.length >= 5);
      if (!(hit.length >= 2 || strong.length >= 1)) continue;
      const score = hit.length * 10 + hit.join('').length;
      if (score > bestScore) {
        best = { warehouseId: w.id, name: w.name || w.id };
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * Điểm khớp tên sách/sản phẩm với câu hỏi (không dấu, chữ thường cả 2 vế).
   * Hiểu cách gọi TẮT tự nhiên: "nữ công tước", "ba lối", "con chó" (cụm ≥2 từ
   * của tên), hay tên ngắn 1–2 từ kèm ngữ cảnh sách ("cuốn Khách").
   * Trả về số từ khớp (0 = không khớp). Cụm càng dài càng chắc.
   */
  private static titleMatchScore(normQ: string, titleNorm: string): number {
    const t = (titleNorm || '').trim();
    if (!t || t.length < 4) return 0;
    const tWords = t.split(/[^a-z0-9]+/).filter(Boolean);
    if (tWords.length === 0) return 0;
    const q = ` ${normQ} `;
    // Tên 1 từ ("Khách", "Ondine"): bắt buộc ngữ cảnh sách - nếu không từ
    // "khách hàng" sẽ bắt nhầm cuốn "Khách".
    if (tWords.length === 1) {
      const bookCtx = /cuon|sach|tua|quyen|tap|tac pham|dau sach|ban chay|ton kho|nhip ban|gio vang|ma [a-z]{0,4}\d/.test(normQ);
      return bookCtx && q.includes(` ${t} `) ? 1 : 0;
    }
    // Tên đầy đủ nằm trong câu hỏi (ranh giới từ, chắc nhất).
    if (q.includes(` ${t} `)) return tWords.length + 10;
    // Cụm dài nhất của tên (≥2 từ) xuất hiện trong câu hỏi: "nữ công tước",
    // "ba lối", "con chó" - đủ đặc trưng nên không cần ngữ cảnh thêm.
    let run = 0;
    for (let i = 0; i < tWords.length; i++) {
      for (let j = i + 2; j <= tWords.length; j++) {
        if (q.includes(' ' + tWords.slice(i, j).join(' ') + ' ')) run = Math.max(run, j - i);
      }
    }
    return run;
  }

  static async resolveProductFromText(text: string): Promise<{ productId: string; code: string | null; title: string | null } | null> {
    const norm = removeAccents((text || '').toLowerCase());
    if (!norm.trim()) return null;
    const catalog = await db
      .select({ id: products.id, code: products.code, name: products.name })
      .from(products);
    const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
    // 1. Khop ma san pham / ma an ban chinh xac theo token.
    const edCodes: any[] = await db.select({ id: editions.id, code: editions.code }).from(editions);
    const codeToProduct = new Map<string, string>();
    const regCode = (code: string | null | undefined, pid: string) => {
      const c = removeAccents((code || '').toLowerCase()).trim();
      if (c && !codeToProduct.has(c)) codeToProduct.set(c, pid);
    };
    catalog.forEach((p) => regCode(p.code, p.id));
    edCodes.forEach((e) => regCode(e.code, e.id));
    let codeHit: { productId: string } | null = null;
    tokens.forEach((t) => {
      if (!codeHit && codeToProduct.has(t)) codeHit = { productId: codeToProduct.get(t) as string };
    });
    if (codeHit) {
      const pid = (codeHit as { productId: string }).productId;
      const found = catalog.find((p) => p.id === pid);
      const ed = edCodes.find((e) => e.id === pid);
      return { productId: pid, code: found?.code || ed?.code || null, title: found?.name || null };
    }
    // 2. Khop ten (ca ten day du lan goi tat nhu "nu cong tuoc", "ba loi").
    let best: { productId: string; code: string | null; title: string | null } | null = null;
    let bestScore = 0;
    for (const p of catalog) {
      const s = ExecutiveQueryService.titleMatchScore(norm, removeAccents((p.name || '').toLowerCase()));
      if (s > bestScore) {
        best = { productId: p.id, code: p.code, title: p.name };
        bestScore = s;
      }
    }
    return best;
  }

  /**
   * query_product_flow: Nhịp Bán 1 món trong N ngày (giờ vàng, ngày đỉnh).
   * Tái dùng AnalyticsService.productTimeline (SSOT với drawer Nhịp Bán).
   */
  static async queryProductFlow(params: { productId?: string; codeOrTitle?: string; windowDays?: number; warehouseId?: string } = {}): Promise<{
    product: { id: string; code: string | null; title: string | null } | null;
    totals: { qty: number; revenue: number; orders: number; activeDays: number };
    peakDay: { date: string; qty: number; revenue: number } | null;
    peakHour: number | null;
    warning?: string;
    note?: string;
  }> {
    let pid = `${params.productId || ''}`.trim();
    let meta: { code: string | null; title: string | null } = { code: null, title: null };
    let pickedNote = '';
    if (!pid && params.codeOrTitle) {
      const resolved = await this.resolveProductFromText(params.codeOrTitle);
      if (resolved) {
        pid = resolved.productId;
        meta = { code: resolved.code, title: resolved.title };
      } else {
        // Câu hỏi theo ý ("cuốn bán chạy nhất...") không chứa tên món: tìm món
        // bán chạy nhất kỳ rồi xem nhịp của chính nó (2 bước trong 1 tool).
        const normQ = removeAccents((params.codeOrTitle || '').toLowerCase());
        const wantsBest = /ban chay nhat|ban nhieu nhat|ban tot nhat|ban manh nhat/.test(normQ);
        if (wantsBest) {
          const days = Math.min(92, Math.max(1, Math.floor(Number((params as any).windowDays) || 30)));
          const nowVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
          const startVn = new Date(Date.parse(`${nowVn}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
          const { AnalyticsService: AS } = await import('./analytics.service');
          const top: any = await AS.topEditions(
            { startDate: startVn, endDate: nowVn },
            1,
            (params as any).warehouseId,
            true,
            undefined
          );
          const first = top?.items?.[0];
          const bestPid = first?.productId || first?.editionId;
          if (bestPid) {
            pid = String(bestPid);
            meta = { code: first.code || null, title: first.title || null };
            pickedNote = ` (đang xem món bán chạy nhất: ${first.code || ''} ${first.title || ''})`;
          }
        }
      }
      if (!pid) {
        return {
          product: null,
          totals: { qty: 0, revenue: 0, orders: 0, activeDays: 0 },
          peakDay: null,
          peakHour: null,
          warning: `Không tìm thấy sản phẩm khớp với "${params.codeOrTitle}" trong danh mục.`,
        };
      }
    }
    if (!pid) {
      return {
        product: null,
        totals: { qty: 0, revenue: 0, orders: 0, activeDays: 0 },
        peakDay: null,
        peakHour: null,
        warning: 'Cần chỉ rõ 1 món (mã hoặc tên) để xem nhịp bán.',
      };
    }
    const days = Math.min(92, Math.max(1, Math.floor(Number(params.windowDays) || 30)));
    const nowVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const startVn = new Date(Date.parse(`${nowVn}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const { AnalyticsService } = await import('./analytics.service');
    const tl: any = await AnalyticsService.productTimeline(pid, { startDate: startVn, endDate: nowVn }, params.warehouseId);
    if (!tl) {
      return {
        product: { id: pid, ...meta },
        totals: { qty: 0, revenue: 0, orders: 0, activeDays: 0 },
        peakDay: null,
        peakHour: null,
        warning: 'Không có dữ liệu bán món này trong kỳ.',
      };
    }
    // Giờ vàng: gom cuốn theo giờ VN từ sự kiện (mới nhất 200 sự kiện).
    const byHour = new Array<number>(24).fill(0);
    for (const e of (tl.events || []) as any[]) {
      const d = e?.createdAt ? new Date(e.createdAt) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      byHour[(d.getUTCHours() + 7) % 24] += Number(e.qty || 0);
    }
    let peakHour: number | null = null;
    byHour.forEach((q, h) => {
      if (q > 0 && (peakHour == null || q > byHour[peakHour])) peakHour = h;
    });
    let peakDay: { date: string; qty: number; revenue: number } | null = null;
    for (const b of (tl.buckets || []) as any[]) {
      if (!peakDay || b.qty > peakDay.qty) peakDay = { date: b.date, qty: b.qty, revenue: b.revenue };
    }
    if (peakDay && peakDay.qty <= 0) peakDay = null;
    return {
      product: { id: pid, code: tl.product?.code ?? meta.code, title: tl.product?.name ?? meta.title },
      totals: { qty: tl.totals.qty, revenue: tl.totals.revenue, orders: tl.totals.orders, activeDays: tl.totals.activeDays },
      peakDay,
      peakHour,
      note: pickedNote || undefined,
    };
  }
  static async resolveEditionFromText(text: string): Promise<{ editionId: string; code: string; title: string | null } | null> {
    const norm = removeAccents((text || '').toLowerCase());
    if (!norm.trim()) return null;
    const catalog = await db
      .select({ id: editions.id, code: editions.code, title: editions.title })
      .from(editions);
    // 1. Khop ma sach chinh xac theo token (vd "h01", "h22").
    const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
    for (const ed of catalog) {
      const codeNorm = removeAccents((ed.code || '').toLowerCase()).trim();
      if (codeNorm && tokens.includes(codeNorm)) {
        return { editionId: ed.id, code: ed.code, title: ed.title };
      }
    }
    // 2. Khop ten sach (ca ten day du lan goi tat nhu "nu cong tuoc", "ba loi").
    let best: { editionId: string; code: string; title: string | null } | null = null;
    let bestScore = 0;
    for (const ed of catalog) {
      const s = ExecutiveQueryService.titleMatchScore(norm, removeAccents((ed.title || '').toLowerCase()));
      if (s > bestScore) {
        best = { editionId: ed.id, code: ed.code, title: ed.title };
        bestScore = s;
      }
    }
    return best;
  }

  /**
   * 1. query_stock_level: Tồn khả dụng NEW (tổng + theo kho)
   * Mặc định server-side khi thiếu param: toàn hệ thống trừ wh-in-transit.
   * Neu cau hoi chi 1 dau sach (editionId/codeOrTitle): chi tra ve dung 1 muc
   * de LLM khong doan mo tu ca danh muc.
   */
  static async queryStockLevel(params: QueryStockParams = {}): Promise<{
    warehouseScope: string;
    totalAvailable: number;
    itemsCount: number;
    items: StockLevelItem[];
    resolved?: { editionId: string; code: string; title: string | null } | null;
    warning?: string;
  }> {
    const { warehouseId } = params;
    let { editionId } = params;
    let resolved: { editionId: string; code: string; title: string | null } | null = null;
    let warning: string | undefined;
    // Hoi 1 cuon cu the nhung khong phan giai duoc → tra rong + warning,
    // TUYET DOI khong do ca danh muc cho LLM (nguon goc so lieu sai).
    const askedSpecific = !!(params.editionId || params.codeOrTitle);

    // Tu phan giai ma/ten sach khi planner chi truyen codeOrTitle hoac khi can doi chieu.
    if (!editionId && params.codeOrTitle) {
      try {
        resolved = await this.resolveEditionFromText(params.codeOrTitle);
        if (resolved) editionId = resolved.editionId;
        else warning = `Không tìm thấy đầu sách khớp với "${params.codeOrTitle}" trong danh mục.`;
      } catch {
        warning = 'Không tra được danh mục để đối chiếu tên sách.';
      }
    }

    const allWh = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
    const validWh = allWh.filter((w) => w.id !== 'wh-in-transit');
    const targetWhs = warehouseId ? validWh.filter((w) => w.id === warehouseId) : validWh;

    if (askedSpecific && !editionId) {
      // Cau tong quat ("quy mo ton kho the nao") vo tinh roi vao day vi wrapper
      // truyen nguyen van cau hoi: nhan dien menh de sach cu the, neu khong co
      // thi tra ve bao cao chung thay vi rong + warning sai.
      // Bo doan trong ngoac kep truoc ("chinh sach" chua "sach" nhung khong phai sach).
      // Loai "chinh sach"/"sach luoc" (Nghia policy/strategy). "ma h" chi tinh khi kem so.
      const unquoted = (params.codeOrTitle || '').replace(/["“”][^"“”]*["“”]/g, ' ');
      const t = removeAccents(unquoted.toLowerCase()).replace(/chinh sach/g, ' ').replace(/sach luoc/g, ' ');
      const SPEC_RE = /(cuon|sach|dau sach|ma sach|tua de|tieu de|an ban|an pham|tac pham)/;
      const looksSpecific = SPEC_RE.test(t) || /ma\s*h\s*\d/i.test(t);
      if (looksSpecific) {
        return {
          warehouseScope: warehouseId ? (targetWhs[0]?.name || warehouseId) : 'Toàn hệ thống (trừ In-Transit)',
          totalAvailable: 0,
          itemsCount: 0,
          items: [],
          resolved,
          warning: warning || 'Không xác định được đầu sách được hỏi.',
        };
      }
      // Cau tong quat: xoa warning phan giai thua de LLM khong hieu nham.
      warning = undefined;
    }
    const editionsQuery = db
      .select({ id: editions.id, code: editions.code, title: editions.title })
      .from(editions);

    const editionList = editionId
      ? await editionsQuery.where(eq(editions.id, editionId))
      : await editionsQuery;

    // Hoi 1 cuon cu the nhung khong ton tai trong danh muc: bao ro, khong doan mo.
    if (editionId && editionList.length === 0) {
      return {
        warehouseScope: warehouseId ? (targetWhs[0]?.name || warehouseId) : 'Toàn hệ thống (trừ In-Transit)',
        totalAvailable: 0,
        itemsCount: 0,
        items: [],
        resolved,
        warning: warning || `Không tìm thấy đầu sách (editionId=${editionId}) trong danh mục.`,
      };
    }

    let totalAvailable = 0;
    const items: StockLevelItem[] = [];

    // Batch 1 query duy nhat thay vi editions×warehouses query (N+1).
    const balMap = new Map<string, number>();
    if (editionList.length > 0 && targetWhs.length > 0) {
      const balRows = await db
        .select({
          editionId: stockBalances.editionId,
          warehouseId: stockBalances.warehouseId,
          qty: stockBalances.physicalQuantity,
        })
        .from(stockBalances)
        .where(
          and(
            inArray(stockBalances.editionId, editionList.map((e) => e.id)),
            inArray(stockBalances.warehouseId, targetWhs.map((w) => w.id)),
            eq(stockBalances.condition, 'NEW')
          )
        );
      for (const r of balRows) balMap.set(`${r.editionId}|${r.warehouseId}`, r.qty ?? 0);
    }

    for (const ed of editionList) {
      const breakdown: Record<string, number> = {};
      let itemTotal = 0;
      for (const wh of targetWhs) {
        const bal = balMap.get(`${ed.id}|${wh.id}`) ?? 0;
        breakdown[wh.name || wh.id] = bal;
        itemTotal += bal;
      }
      totalAvailable += itemTotal;
      items.push({
        editionId: ed.id,
        code: ed.code,
        title: ed.title,
        availableStock: itemTotal,
        warehouseBreakdown: breakdown,
      });
    }

    return {
      warehouseScope: warehouseId ? (targetWhs[0]?.name || warehouseId) : 'Toàn hệ thống (trừ In-Transit)',
      totalAvailable,
      itemsCount: items.length,
      items: items.slice(0, 100), // An toàn chống tràn token
      resolved,
      warning,
    };
  }

  /**
   * 6. prepare_sale_draft: Ngon ngu tu nhien → DON NHAP (khong tao don, khong tru kho).
   * Nhan ma sach (H01), ten sach, so luong ("lay 2 cuon", "x3"), ten/SDT khach.
   * Dung cho nut "Ap vao POS": nguoi dung van tu bam thanh toan (Ctrl+Enter),
   * server giu guard ton kho / tran CK / PIN nhu don tay.
   */
  static async prepareSaleDraft(params: { q?: string; limit?: number } = {}): Promise<SaleDraft> {
    const q = (params.q || '').trim();
    const limit = clampInt(params.limit, 10, 1, 20);
    const warnings: string[] = [];
    if (!q) return { note: '', items: [], warnings: ['Chưa có nội dung yêu cầu lên đơn.'] };

    const catalog = await db
      .select({
        editionId: editions.id,
        code: editions.code,
        editionTitle: editions.title,
        workTitle: works.title,
        coverPrice: editions.coverPrice,
      })
      .from(editions)
      .leftJoin(works, eq(editions.workId, works.id));

    const normQ = removeAccents(q.toLowerCase());
    // Chuẩn hóa gọn (bỏ dấu câu) để "Middlemarch Tap 1" khớp "Middlemarch - Tập 1".
    const normQc = normQ.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const compact = (s: string) => removeAccents((s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const merged = new Map<string, SaleDraftLine>();

    const nearbyQty = (text: string, idx: number, len: number): number => {
      const before = text.slice(Math.max(0, idx - 16), idx);
      const mB = before.match(/(\d+)\s*(cuon|cuốn|quyen|quyển|q|c|ban|bản)?\s*$/i);
      if (mB) {
        const n = parseInt(mB[1], 10);
        if (n > 0 && n <= 999) return n;
      }
      const after = text.slice(idx + len, idx + len + 8);
      const mA = after.match(/^\s*[x×:]\s*(\d+)/i) || after.match(/^\s*(\d+)\s*(cuon|quyen)/i);
      if (mA) {
        const n = parseInt(mA[1], 10);
        if (n > 0 && n <= 999) return n;
      }
      return 1;
    };

    // c. Ten + SDT khach TRUOC, tren CUNG 1 chuoi chuan hoa (scanQ) de span cat
    // chinh xac tuyet doi - khong con map ti le gay lech. SDT chap nhan cach so
    // ("0912 345 678") bang cach dan so lien nhau truoc khi do.
    const ROLE_WORDS = /^(khach|anh|chi|em|co|chu|bac|ban|minh|shop)$/;
    // SDT chiu cach so ("0912 345 678"): scanQ giu nguyen, tach SDT bang pattern
    // khoan dung khoang trang (dung 8 so + bien gioi tu, khong an so luong ke ben).
    let scanQ = normQc;
    let customerName: string | undefined;
    const nameMatch = q.match(/(?:cho|gửi|gui|giao|bán|ban)\s+(?:cho\s+)?(?:khách|khach|anh|chị|chi|em|cô|co|chú|chu|bác|bac)?\s*([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ ]{1,24})/i);
    // Tu vai tro tran ("Anh", "Em") van co the la TEN that ("ban cho Anh 2 H01"):
    // giu lai neu ngay sau la so luong/ma sach/het cau.
    const afterName = nameMatch && nameMatch.index !== undefined
      ? q.slice(nameMatch.index + nameMatch[0].length, nameMatch.index + nameMatch[0].length + 10)
      : '';
    const loneRoleAsName = nameMatch !== null && ROLE_WORDS.test(compact(nameMatch[1])) && /^\s*(\d|$)/.test(afterName);
    if (nameMatch && nameMatch.index !== undefined && (!ROLE_WORDS.test(compact(nameMatch[1])) || loneRoleAsName) && !/cuon|sach|don|hang/i.test(compact(nameMatch[1]))) {
      customerName = nameMatch[1].trim();
      const hit = scanQ.indexOf(compact(nameMatch[1]));
      if (hit >= 0) scanQ = scanQ.slice(0, hit) + ' '.repeat(compact(nameMatch[1]).length) + scanQ.slice(hit + compact(nameMatch[1]).length);
    }
    if (customerName === undefined) {
      // Khong co ten cu the nhung co cum xuat don ("cho khach:", "ban cho em") - cat luon
      // de tu vai tro (khach/em/anh/chi) khong khop nham tua sach.
      const rolePrefix = scanQ.match(/(cho|gui|giao|ban)\s+(cho\s+)?(khach|anh|chi|em|co|chu|bac)\b[:\s]*/);
      if (rolePrefix && rolePrefix.index !== undefined) {
        scanQ = scanQ.slice(0, rolePrefix.index) + ' '.repeat(rolePrefix[0].length) + scanQ.slice(rolePrefix.index + rolePrefix[0].length);
      }
    }
    let phone: string | undefined;
    const phoneMatch = scanQ.match(/(?:\+84|0)\s*(?:3|5|7|8|9)(?:\s*\d){8}\b/);
    if (phoneMatch && phoneMatch.index !== undefined) {
      const digits = phoneMatch[0].replace(/\s+/g, '');
      if (/^(?:\+84|0)(?:3|5|7|8|9)\d{8}$/.test(digits)) {
        phone = digits.startsWith('+84') ? '0' + digits.slice(3) : digits;
        scanQ = scanQ.slice(0, phoneMatch.index) + ' '.repeat(phoneMatch[0].length) + scanQ.slice(phoneMatch.index + phoneMatch[0].length);
      }
    }

    // a. Khop MA sach chinh xac theo token (H01, H22...) tren van ban da cat ten/SDT.
    // Ghi lai span da tieu thu de ten sach nhac lai o cho khac van cong so luong.
    // Quet MOI lan xuat hien ("2 H01 va them 3 H01" → 5, khong mat 3).
    const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const consumed: Array<[number, number]> = [];
    for (const ed of catalog) {
      const codeNorm = removeAccents((ed.code || '').toLowerCase()).trim();
      if (!codeNorm) continue;
      const re = new RegExp(`(^|[^a-z0-9])${escRe(codeNorm)}(?![a-z0-9])`, 'gi');
      let m: RegExpExecArray | null;
      let total = 0;
      while ((m = re.exec(scanQ)) !== null) {
        const at = m.index + m[1].length;
        total += nearbyQty(scanQ, at, codeNorm.length);
        consumed.push([at, codeNorm.length]);
        if (m[0].length === 0) re.lastIndex++;
      }
      if (total <= 0) continue;
      const title = ed.editionTitle || ed.workTitle || ed.code;
      const cur = merged.get(ed.editionId);
      if (cur) cur.quantity = Math.min(999, cur.quantity + total);
      else merged.set(ed.editionId, { editionId: ed.editionId, code: ed.code, title, quantity: Math.min(999, total), coverPrice: ed.coverPrice ?? 0, availableStock: 0 });
    }

    // b. Khop TEN sach (dai nhat thang), bo qua sach da khop ma. Dung ban compact
    // (bo dau cau) de "Middlemarch Tap 1" khop "Middlemarch - Tap 1".
    const byLen = [...catalog].sort(
      (a, b) => (b.editionTitle || b.workTitle || '').length - (a.editionTitle || a.workTitle || '').length
    );
    for (const ed of byLen) {
      const title = ed.editionTitle || ed.workTitle || '';
      const tNorm = compact(title);
      if (tNorm.length < 4) continue;
      // Quet moi lan xuat hien, cong don so luong.
      let from = 0;
      let total = 0;
      const firstSpans: Array<[number, number]> = [];
      if (tNorm.length >= 8) {
        let idx = scanQ.indexOf(tNorm, from);
        while (idx >= 0) {
          total += nearbyQty(scanQ, idx, tNorm.length);
          firstSpans.push([idx, tNorm.length]);
          from = idx + tNorm.length;
          idx = scanQ.indexOf(tNorm, from);
        }
      } else {
        const re = new RegExp(`(^|[^a-z0-9])${tNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(scanQ)) !== null) {
          const at = m.index + m[1].length;
          total += nearbyQty(scanQ, at, tNorm.length);
          firstSpans.push([at, tNorm.length]);
          if (m[0].length === 0) re.lastIndex++;
        }
      }
      if (total <= 0) continue;
      // Bo qua cac span trung voi ma sach da tieu thu.
      const fresh = firstSpans.filter(([s, l]) => !consumed.some(([cs, cl]) => s < cs + cl && cs < s + l));
      if (fresh.length === 0) continue;
      const cur = merged.get(ed.editionId);
      if (cur) cur.quantity = Math.min(999, cur.quantity + total);
      else merged.set(ed.editionId, { editionId: ed.editionId, code: ed.code, title, quantity: Math.min(999, total), coverPrice: ed.coverPrice ?? 0, availableStock: 0 });
      for (const sp of fresh) consumed.push(sp);
    }

    // d. Doi chieu ton kha dung toan he thong + canh bao vuot ton.
    let items = Array.from(merged.values()).slice(0, limit);
    for (const it of items) {
      it.availableStock = await ForecastService.availableStock(it.editionId);
      if (it.quantity > it.availableStock) {
        warnings.push(`[${it.code}] ${it.title} chỉ còn ${it.availableStock} cuốn - POS sẽ chặn ở mức tồn, kiểm tra lại số lượng.`);
      }
    }
    if (items.length === 0) {
      warnings.push('Không nhận diện được tên/mã sách nào - thử nói rõ mã (H01) hoặc tên đầy đủ.');
    }
    const stray = scanQ.match(/\b\d{2,}\b/g) || [];
    if (stray.length > 0 && items.every((it) => it.quantity === 1)) {
      warnings.push(`Có con số chưa rõ nghĩa (${stray.slice(0, 3).join(', ')}) - kiểm tra lại số lượng từng dòng.`);
    }

    return { customerName, phone, note: `[COPILOT] ${q.slice(0, 300)}`, items, warnings };
  }

  /**
   * GĐ2 - prepare_transfer_draft: ngôn ngữ tự nhiên → PHIẾU CHUYỂN KHO NHÁP.
   * CHỈ chuẩn bị draft, TUYỆT ĐỐI không ghi DB, không gọi dispatch.
   * Người dùng xem lại trong dialog xác nhận và bấm "Xác nhận tạo phiếu"
   * mới gọi API dispatch thật (có idempotency-key chống double-click).
   */
  static async prepareTransferDraft(params: { q?: string } = {}): Promise<TransferDraft> {
    const q = (params.q || '').trim();
    const warnings: string[] = [];
    if (!q) return { items: [], warnings: ['Chưa có nội dung yêu cầu chuyển kho.'] };

    const normQ = removeAccents(q.toLowerCase());
    const normQc = normQ.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. Kho gửi / kho nhận: "từ ... sang/đến/tới ...".
    let fromWh: { warehouseId: string; name: string } | null = null;
    let toWh: { warehouseId: string; name: string } | null = null;
    const m = normQ.match(/tu\s+(.+?)\s+(sang|den|toi|qua)\s+(.+)/);
    if (m) {
      fromWh = await this.resolveWarehouseFromText(m[1]);
      toWh = await this.resolveWarehouseFromText(m[3]);
    }
    if (!fromWh) warnings.push('Chưa xác định được kho gửi - cho xin tên kho gửi (vd "kho Âu Cơ").');
    if (!toWh) warnings.push('Chưa xác định được kho nhận - cho xin tên kho nhận.');
    if (fromWh && toWh && fromWh.warehouseId === toWh.warehouseId) {
      warnings.push('Kho gửi và kho nhận đang trùng nhau - kiểm tra lại.');
    }

    // 2. Sách + số lượng: quét mã sách theo token, số lượng kề bên.
    const catalog = await db
      .select({
        editionId: editions.id,
        code: editions.code,
        editionTitle: editions.title,
        workTitle: works.title,
      })
      .from(editions)
      .leftJoin(works, eq(editions.workId, works.id));
    const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nearbyQty = (text: string, idx: number, len: number): number => {
      const cap = (n: number, raw: string): number => {
        if (n > 999) {
          warnings.push(`Số lượng ${raw} vượt quá 999 - đã giới hạn ở 999, kiểm tra lại giúp.`);
          return 999;
        }
        return n;
      };
      const before = text.slice(Math.max(0, idx - 16), idx);
      const mB = before.match(/(\d+)\s*(cuon|quyen|q|c|ban)?\s*$/i);
      if (mB) {
        const n = parseInt(mB[1], 10);
        if (n > 0) return cap(n, mB[1]);
      }
      const after = text.slice(idx + len, idx + len + 8);
      const mA = after.match(/^\s*[x×:]\s*(\d+)/i) || after.match(/^\s*(\d+)\s*(cuon|quyen)/i);
      if (mA) {
        const n = parseInt(mA[1], 10);
        if (n > 0) return cap(n, mA[1]);
      }
      return 1;
    };
    const merged = new Map<string, TransferDraftLine>();
    for (const ed of catalog) {
      const codeNorm = removeAccents((ed.code || '').toLowerCase()).trim();
      if (!codeNorm) continue;
      const re = new RegExp(`(^|[^a-z0-9])${escRe(codeNorm)}(?![a-z0-9])`, 'gi');
      let mm: RegExpExecArray | null;
      let total = 0;
      while ((mm = re.exec(normQc)) !== null) {
        const at = mm.index + mm[1].length;
        total += nearbyQty(normQc, at, codeNorm.length);
      }
      if (total <= 0) continue;
      const title = ed.editionTitle || ed.workTitle || ed.code;
      const cur = merged.get(ed.editionId);
      if (cur) cur.quantity = Math.min(999, cur.quantity + total);
      else merged.set(ed.editionId, { editionId: ed.editionId, code: ed.code, title, quantity: Math.min(999, total), availableStock: 0 });
    }

    // 3. Đối chiếu tồn tại kho gửi + cảnh báo vượt tồn.
    // ponytail: N+1 query stockBalances (1 query/kho cho mỗi dòng sách). Ceiling:
    // draft thường chỉ vài dòng nên ổn; nếu catalog lớn hoặc draft nhiều dòng,
    // batch thành 1 query với `inArray(editionId)` + warehouseId.
    const items = Array.from(merged.values());
    for (const it of items) {
      if (fromWh) {
        const bal = await db
          .select({ qty: stockBalances.physicalQuantity })
          .from(stockBalances)
          .where(and(eq(stockBalances.editionId, it.editionId), eq(stockBalances.warehouseId, fromWh.warehouseId)));
        it.availableStock = Number(bal[0]?.qty || 0);
        if (it.quantity > it.availableStock) {
          warnings.push(`[${it.code}] xin chuyển ${it.quantity} nhưng kho gửi chỉ còn ${it.availableStock} - giảm số lượng hoặc chọn kho khác.`);
        }
      }
    }
    if (items.length === 0) {
      warnings.push('Chưa nhận diện được sách nào - cho xin mã sách (vd HH001) kèm số lượng.');
    }

    return {
      ...(fromWh ? { fromWarehouseId: fromWh.warehouseId, fromWarehouseName: fromWh.name } : {}),
      ...(toWh ? { toWarehouseId: toWh.warehouseId, toWarehouseName: toWh.name } : {}),
      items,
      warnings,
    };
  }

  /**
   * 5. query_catalog: Truy van danh muc - sach cua 1 tac gia, tua bat dau bang chu X,
   * top tac gia / top sach ban chay, liet ke. Tach khoi 4 tool so lieu de khong doan mo.
   */
  static async queryCatalog(params: QueryCatalogParams = {}): Promise<{
    mode: 'author' | 'title-prefix' | 'title-contains' | 'top-authors' | 'top-editions' | 'list';
    query: string;
    total: number;
    items: CatalogItem[];
    authors?: Array<{ author: string; titlesCount: number; soldQty: number; revenue: number }>;
    warning?: string;
  }> {
    const limit = clampInt(params.limit, 20, 1, 50);
    const windowDays = clampInt(params.windowDays, 30, 1, 365);

    // Tai danh muc (works + editions) 1 lan duy nhat.

    // Tai danh muc (works + editions) 1 lan duy nhat.
    const catalog = await db
      .select({
        editionId: editions.id,
        code: editions.code,
        editionTitle: editions.title,
        workTitle: works.title,
        author: works.author,
        coverPrice: editions.coverPrice,
        status: editions.status,
      })
      .from(editions)
      .leftJoin(works, eq(editions.workId, works.id));

    const norm = (s: string | null | undefined) => removeAccents((s || '').toLowerCase()).trim();
    const titleOf = (r: (typeof catalog)[number]) => r.editionTitle || r.workTitle || '';

    // Doanh so 30 ngay theo edition (cho top tac gia / top sach).
    // So sanh qua `datetime()` (chuan hoa ca hai ho timestamp: ISO 'T' do app ghi
    // va ' ' do SQLite CURRENT_TIMESTAMP ghi) thay vi so CHUOI thuan.
    // Loi truoc: cutoff dang ' ' ma don dang 'T' thi moi dong ISO cung NGAY voi
    // cutoff deu lon hon cutoff (vi 'T' > ' ') ⇒ don 30 ngay 8 gio tuoi van
    // loot vao bao cao "30 ngay"; cua so lech toi da 24 gio.
    const cutoff = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
    // Loc kho cho top theo kho (vd "ban chay kho ho guom"). Khong truyen = toan he thong.
    const whConds =
      params.warehouseId && typeof params.warehouseId === 'string' && params.warehouseId.trim()
        ? [eq(orders.warehouseId, params.warehouseId.trim())]
        : [];
    // Loai tang/tai tro/0d nhu salesByEdition de bestseller khong bi thoi phong.
    const salesRows = await db
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
          shopeeDeliveredOnly(),
          sql`datetime(${orders.createdAt}) >= datetime(${cutoff})`,
          sql`${orders.discountRate} < 1`,
          sql`${orders.channel} != 'SPONSORSHIP'`,
          sql`${orders.finalAmount} > 0`,
          eq(orderItems.isGiftLine, false),
          sql`${orderItems.totalAmount} > 0`,
          ...whConds
        )
      )
      .groupBy(orderItems.editionId);
    const salesMap = new Map<string, { qty: number; revenue: number }>(
      salesRows
        .filter((r): r is typeof r & { editionId: string } => r.editionId !== null)
        .map((r) => [r.editionId, { qty: Number(r.qty || 0), revenue: Number(r.revenue || 0) }])
    );

    const stockRows = await db
      .select({
        editionId: stockBalances.editionId,
        qty: sql<number>`COALESCE(SUM(${stockBalances.physicalQuantity}), 0)`,
      })
      .from(stockBalances)
      .where(and(eq(stockBalances.condition, 'NEW'), ne(stockBalances.warehouseId, 'wh-in-transit')))
      .groupBy(stockBalances.editionId);
    const stockMap = new Map(stockRows.map((r) => [r.editionId, Number(r.qty || 0)]));

    const toItem = (r: (typeof catalog)[number]): CatalogItem => {
      const availableStock = stockMap.get(r.editionId) ?? 0;
      return {
        code: r.code,
        title: titleOf(r),
        author: r.author,
        coverPrice: r.coverPrice ?? 0,
        status: availableStock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
        availableStock,
        soldQty: salesMap.get(r.editionId)?.qty ?? 0,
      };
    };

    // --- Che do tuong minh tu planner ---
    if (params.topAuthors) {
      return { mode: 'top-authors', query: `Top tác giả bán chạy ${windowDays} ngày`, ...this.rankAuthors(catalog, salesMap, limit) };
    }
    if (params.topEditionsBySales) {
      const items = catalog.map(toItem).sort((a, b) => (b.soldQty || 0) - (a.soldQty || 0));
      return { mode: 'top-editions', query: `Top sách bán chạy ${windowDays} ngày`, total: items.length, items: items.slice(0, limit) };
    }
    if (params.author) {
      const aNorm = norm(params.author);
      const items = catalog.filter((r) => norm(r.author).includes(aNorm)).map(toItem);
      if (items.length === 0) {
        return { mode: 'author', query: params.author, total: 0, items: [], warning: `Không tìm thấy tác giả khớp với "${params.author}" trong danh mục.` };
      }
      return { mode: 'author', query: params.author, total: items.length, items: items.slice(0, limit) };
    }
    if (params.titleStartsWith) {
      const p = norm(params.titleStartsWith);
      const items = catalog.filter((r) => norm(titleOf(r)).startsWith(p)).map(toItem);
      return { mode: 'title-prefix', query: params.titleStartsWith, total: items.length, items: items.slice(0, limit) };
    }
    if (params.titleContains) {
      const p = norm(params.titleContains);
      const items = catalog.filter((r) => norm(titleOf(r)).includes(p)).map(toItem);
      return { mode: 'title-contains', query: params.titleContains, total: items.length, items: items.slice(0, limit) };
    }

    // --- Tu phan tich cau hoi tu nhien ---
    const q = params.q || '';
    const n = norm(q);

    // a. Top tac gia / top sach ban chay (chiu cach noi long vong: "ban cung chay",
    // "nhieu dau sach nhat" - khong doi cum tu lien tuc).
    const hasTopSignal =
      /(yeu thich|pho bien|hang dau)/.test(n) ||
      (n.includes('nhieu') && n.includes('nhat')) ||
      (n.includes('ban') && n.includes('chay'));
    if (/(tac gia|tac pham|sach|cuon|dau sach)/.test(n) && hasTopSignal) {
      if (/(tac gia)/.test(n)) {
        return { mode: 'top-authors', query: q.slice(0, 200), ...this.rankAuthors(catalog, salesMap, limit) };
      }
      const items = catalog.map(toItem).sort((a, b) => (b.soldQty || 0) - (a.soldQty || 0));
      return { mode: 'top-editions', query: q.slice(0, 200), total: items.length, items: items.slice(0, limit) };
    }
    // Top ma khong goi ro chu the ("Ket qua ban chay tuan nay?") → mac dinh top sach.
    if (hasTopSignal) {
      const items = catalog.map(toItem).sort((a, b) => (b.soldQty || 0) - (a.soldQty || 0));
      return { mode: 'top-editions', query: q.slice(0, 200), total: items.length, items: items.slice(0, limit) };
    }

    // b. Tuc gia cu the: doi chieu ten tac gia co trong danh muc.
    const authors = Array.from(new Set(catalog.map((r) => r.author).filter(Boolean) as string[]));
    let bestAuthor: string | null = null;
    let bestLen = 0;
    for (const a of authors) {
      const aNorm = norm(a);
      if (aNorm.length >= 4 && n.includes(aNorm) && aNorm.length > bestLen) {
        bestAuthor = a;
        bestLen = aNorm.length;
      }
    }
    if (bestAuthor) {
      const items = catalog.filter((r) => r.author === bestAuthor).map(toItem);
      return { mode: 'author', query: bestAuthor, total: items.length, items: items.slice(0, limit) };
    }

    // c. Tua bat dau bang chu cai X: "bat dau bang chu M", "chu cai B".
    const prefixMatch = n.match(/bat dau bang chu\s*([a-z0-9])/) || n.match(/chu cai\s*([a-z0-9])/) || n.match(/tua de.*bat dau\s*([a-z0-9])/) || n.match(/^([a-z])\b.*(sach|tac pham)/);
    if (prefixMatch) {
      const p = prefixMatch[1];
      const items = catalog.filter((r) => norm(titleOf(r)).startsWith(p)).map(toItem);
      return { mode: 'title-prefix', query: `chữ "${p.toUpperCase()}"`, total: items.length, items: items.slice(0, limit) };
    }

    // d. Mac dinh: liet ke co gioi han + tong so.
    const items = catalog.map(toItem);
    return { mode: 'list', query: q.slice(0, 200) || 'Toàn bộ danh mục', total: items.length, items: items.slice(0, limit) };
  }

  private static rankAuthors(
    catalog: Array<{ editionId: string; author: string | null; code: string; editionTitle: string | null; workTitle: string | null; coverPrice: number | null; status: string | null }>,
    salesMap: Map<string, { qty: number; revenue: number }>,
    limit: number
  ): { total: number; items: CatalogItem[]; authors: Array<{ author: string; titlesCount: number; soldQty: number; revenue: number }> } {
    const byAuthor = new Map<string, { titles: Set<string>; soldQty: number; revenue: number }>();
    for (const r of catalog) {
      const a = (r.author || '').trim();
      if (!a) continue;
      let g = byAuthor.get(a);
      if (!g) {
        g = { titles: new Set(), soldQty: 0, revenue: 0 };
        byAuthor.set(a, g);
      }
      g.titles.add(r.editionId);
      const s = salesMap.get(r.editionId);
      if (s) {
        g.soldQty += s.qty;
        g.revenue += s.revenue;
      }
    }
    const authors = Array.from(byAuthor.entries())
      .map(([author, g]) => ({ author, titlesCount: g.titles.size, soldQty: g.soldQty, revenue: g.revenue }))
      .sort((x, y) => y.soldQty - x.soldQty || y.revenue - x.revenue);
    return { total: authors.length, items: [], authors: authors.slice(0, limit) };
  }

  /**
   * 2. query_sales_summary: Doanh thu thực, thuế, số đơn, kênh bán.
   * Cả OWNER và MANAGER đều xem được cả 2 sổ (v1 read-only).
   */
  static async querySalesSummary(params: QuerySalesParams = {}): Promise<{
    windowDays: number;
    fiscalScope: 'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
    scopeLabel: string;
    totalOrders: number;
    totalRevenue: number;
    totalQty: number;
    totalDiscount: number;
    officialTax: { ordersCount: number; revenue: number };
    internalManagement: { ordersCount: number; revenue: number };
    channelBreakdown: Record<string, { count: number; revenue: number }>;
  }> {
    const windowDays = clampInt(params.windowDays, 30, 1, 365);
    const fiscalScope = params.fiscalScope ?? 'ALL';
    // 1 ngày cụ thể ("ngày 4/10", "hôm qua"): start=end=ngày đó, thay windowDays.
    const singleDay = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : undefined;
    const warehouseId = typeof params.warehouseId === 'string' && params.warehouseId.trim()
      ? params.warehouseId.trim()
      : undefined;

    const cutoff = singleDay || new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
    const summary = await OrderService.getSalesSummary({
      startDate: cutoff,
      ...(singleDay ? { endDate: singleDay } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    });

    // Chi tiet kenh ban. Phai dung DUNG bo loc cua OrderService.getSalesSummary
    // (status COMPLETED + created_at >= cutoff + bo SPONSORSHIP) roi them loc
    // fiscalScope. Truoc day thieu `channel != 'SPONSORSHIP'` nen tong cac kenh
    // KHONG khop tong bao cao dinh kem no: 1 don tai tro lam lech 1 don so voi
    // totalOrders (va lech tien neu don do co doanh thu).
    const breakdownConds = [
      eq(orders.status, 'COMPLETED'),
      shopeeDeliveredOnly(),
      // Dùng CHUNG helper ngày với getSalesSummary (chuẩn hoá qua datetime())
      // thay vì so chuỗi thô - nếu không, breakdown lệch tổng summary khi cột
      // có timestamp họ 'YYYY-MM-DD HH:MM:SS'.
      ...createdAtBetween(orders.createdAt, cutoff, singleDay || undefined),
      sql`${orders.channel} != 'SPONSORSHIP'`,
    ];
    if (warehouseId) breakdownConds.push(eq(orders.warehouseId, warehouseId));
    if (fiscalScope !== 'ALL') breakdownConds.push(eq(orders.fiscalScope, fiscalScope));
    const orderRows = await db
      .select({
        channel: orders.channel,
        finalAmount: orders.finalAmount,
      })
      .from(orders)
      .where(and(...breakdownConds));

    const channelBreakdown: Record<string, { count: number; revenue: number }> = {};
    for (const row of orderRows) {
      const ch = row.channel || 'OTHER';
      if (!channelBreakdown[ch]) channelBreakdown[ch] = { count: 0, revenue: 0 };
      channelBreakdown[ch].count += 1;
      channelBreakdown[ch].revenue += row.finalAmount ?? 0;
    }

    let reportedRevenue = summary.totalRevenue;
    let reportedOrders = summary.totalOrders;

    if (fiscalScope === 'OFFICIAL_TAX') {
      reportedRevenue = summary.officialTax.revenue;
      reportedOrders = summary.officialTax.ordersCount;
    } else if (fiscalScope === 'INTERNAL_MANAGEMENT') {
      reportedRevenue = summary.internalManagement.revenue;
      reportedOrders = summary.internalManagement.ordersCount;
    }

    // Tổng cuốn bán (kênh hỏi "bán được bao nhiêu cuốn"): 1 query GROUP trên
    // đúng tập đơn của summary (COMPLETED + không tài trợ + cùng kỳ/kho).
    const qtyConds = [
      eq(orders.status, 'COMPLETED'),
      sql`${orders.channel} != 'SPONSORSHIP'`,
      ...createdAtBetween(orders.createdAt, cutoff, singleDay || undefined),
    ];
    if (warehouseId) qtyConds.push(eq(orders.warehouseId, warehouseId));
    const qtyRows: any[] = await db
      .select({ q: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(...qtyConds));
    const totalQty = Number(qtyRows[0]?.q || 0);

    let warehouseName: string | null = null;
    if (warehouseId) {
      const wh: any[] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
      warehouseName = wh[0]?.name || warehouseId;
    }

    return {
      windowDays,
      fiscalScope,
      scopeLabel: `${singleDay ? `ngày ${singleDay}` : `${windowDays} ngày qua`} · ${warehouseName || 'toàn hệ thống'}`,
      totalOrders: reportedOrders,
      totalRevenue: reportedRevenue,
      totalQty,
      totalDiscount: summary.totalDiscount,
      officialTax: summary.officialTax,
      internalManagement: summary.internalManagement,
      channelBreakdown,
    };
  }

  /**
   * 3. query_reprint_forecast: Vsale, DoI, số lượng in đề xuất 105 ngày.
   */
  static async queryReprintForecast(params: QueryForecastParams = {}): Promise<{
    windowDays: number;
    summary: Record<RunoutLevel, number>;
    items: Array<{
      code: string;
      title: string | null;
      vSale: number;
      totalStock: number;
      doi: number | null;
      level: RunoutLevel;
      suggestedReprintQty: number;
      policyNote: string;
    }>;
  }> {
    const windowDays = clampInt(params.windowDays, 30, 1, 365);
    const limit = clampInt(params.limit, 50, 1, 200);

    const result = await ForecastService.forecastAll(windowDays, undefined, params.level, limit);

    return {
      windowDays,
      summary: result.summary,
      items: result.items.map((it) => ({
        code: it.code,
        title: it.title,
        vSale: Math.round(it.vSale * 100) / 100,
        totalStock: it.totalStock,
        doi: it.doi !== null ? Math.round(it.doi * 10) / 10 : null,
        level: it.level,
        suggestedReprintQty: it.suggestedReprintQty,
        policyNote: 'Số lượng in đề xuất theo chính sách bù tồn 105 ngày (Lead 30 + Buffer 15 + Safety 60).',
      })),
    };
  }

  /**
   * 4. query_cashbox_reconciliation: Đọc phiên mở, tiền kỳ vọng, thực đếm, số lệch.
   * TUYỆT ĐỐI READ-ONLY: Không mở, không đóng, không sửa số liệu két.
   */
  static async queryCashboxReconciliation(params: QueryCashboxParams = {}): Promise<{
    activeSession: {
      id: string;
      warehouseId: string;
      cashierId: string;
      openingCash: number;
      totalCashSales: number;
      totalTransferSales: number;
      totalOrdersCount: number;
      openedAt: string | null;
    } | null;
    recentSessions: Array<{
      id: string;
      warehouseId: string;
      cashierId: string;
      status: string;
      openingCash: number;
      expectedCash: number | null;
      closingCashActual: number | null;
      cashDiscrepancy: number | null;
      openedAt: string | null;
      closedAt: string | null;
      discrepancyStatus: 'BALANCED' | 'OVER' | 'SHORT' | 'OPEN' | 'UNVERIFIED';
    }>;
    reconciliationNotice: string;
  }> {
    const { sessionId, date } = params;

    // `date` là ngày nghiệp vụ (người dùng hỏi copilot bằng tiếng Việt: "hôm
    // nay", "ngày 28/9"), còn `opened_at` là UTC. Điều kiện PHẢI nằm trong SQL:
    // trước đây lấy 20 ca mới nhất RỒI MỚI lọc tay trong JS, nên hỏi một ngày
    // cũ (ngoài 20 ca gần nhất) trả về rỗng - im lặng báo "không có ca nào"
    // trong khi ca đó có thật. `datetime()` đọc được cả ISO lẫn CURRENT_TIMESTAMP.
    const conds = [];
    if (sessionId) {
      conds.push(eq(cashboxSessions.id, sessionId));
    } else if (date) {
      conds.push(sql`substr(datetime(${cashboxSessions.openedAt}, '+7 hours'), 1, 10) = ${date}`);
    }
    const rows = await db
      .select()
      .from(cashboxSessions)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(cashboxSessions.openedAt))
      .limit(20);

    const openRow = rows.find((r) => r.status === 'OPEN');
    const activeSession = openRow
      ? {
          id: openRow.id,
          warehouseId: openRow.warehouseId,
          cashierId: openRow.cashierId,
          openingCash: openRow.openingCash,
          totalCashSales: openRow.totalCashSales ?? 0,
          totalTransferSales: openRow.totalTransferSales ?? 0,
          totalOrdersCount: openRow.totalOrdersCount ?? 0,
          openedAt: openRow.openedAt,
        }
      : null;

    const recentSessions = rows.map((r) => {
      // Ca chốt TỰ ĐỘNG ghi cash_discrepancy = NULL vì KHÔNG ai đếm két
      // (xem CashboxService.autoCloseSession: closingCashActual = NULL,
      // discrepancyVerified = false). Báo "Cân bằng" cho ca đó là khẳng định
      // một sự thật chưa ai kiểm chứng - cấm. Không đọc được số thì báo chưa
      // xác minh, không suy diễn thành khớp / không khớp.
      let discrepancyStatus: 'BALANCED' | 'OVER' | 'SHORT' | 'OPEN' | 'UNVERIFIED';
      if (r.status === 'OPEN') {
        discrepancyStatus = 'OPEN';
      } else if (r.cashDiscrepancy == null) {
        discrepancyStatus = 'UNVERIFIED';
      } else if (r.cashDiscrepancy > 0) {
        discrepancyStatus = 'OVER';
      } else if (r.cashDiscrepancy < 0) {
        discrepancyStatus = 'SHORT';
      } else {
        discrepancyStatus = 'BALANCED';
      }

      return {
        id: r.id,
        warehouseId: r.warehouseId,
        cashierId: r.cashierId,
        status: r.status,
        openingCash: r.openingCash,
        expectedCash: r.expectedCash,
        closingCashActual: r.closingCashActual,
        cashDiscrepancy: r.cashDiscrepancy,
        openedAt: r.openedAt,
        closedAt: r.closedAt,
        discrepancyStatus,
      };
    });

    return {
      activeSession,
      recentSessions,
      reconciliationNotice:
        'Số liệu đối soát thuần túy từ sổ két. Hệ thống không đưa ra suy diễn hay kết luận pháp lý về chênh lệch két.',
    };
  }

  /**
   * 7. query_shift_split: Sáng (<12h VN) vs Chiều (≥12h VN) trong N ngày.
   * Trả lời "tuần trước sáng hay chiều mạnh hơn". Mạnh = nhiều cuốn hơn
   * (hoà thì so tiền). Logic giờ VN giống hệt Nhịp Bán (giờ vàng).
   */
  static async queryShiftSplit(params: { date?: string; windowDays?: number; warehouseId?: string } = {}): Promise<{
    scopeLabel: string;
    from: string;
    to: string;
    morning: { orders: number; qty: number; revenue: number };
    afternoon: { orders: number; qty: number; revenue: number };
    stronger: 'sang' | 'chieu' | 'hoa';
  }> {
    const days = clampInt(params.windowDays, 7, 1, 92);
    const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const endDay = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date! : todayVn;
    const from = new Date(Date.parse(`${endDay}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const warehouseId = typeof params.warehouseId === 'string' && params.warehouseId.trim()
      ? params.warehouseId.trim()
      : undefined;
    const conds = [
      eq(orders.status, 'COMPLETED'),
      sql`${orders.channel} != 'SPONSORSHIP'`,
      ...createdAtBetween(orders.createdAt, from, endDay),
    ];
    if (warehouseId) conds.push(eq(orders.warehouseId, warehouseId));
    // 1 query: dòng bán + giờ đơn (giờ VN = UTC+7, giống queryProductFlow).
    const lines: any[] = await db
      .select({
        qty: orderItems.quantity,
        revenue: orderItems.totalAmount,
        createdAt: orders.createdAt,
        orderId: orders.id,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(...conds));
    const split = {
      morning: { orders: new Set<string>(), qty: 0, revenue: 0 },
      afternoon: { orders: new Set<string>(), qty: 0, revenue: 0 },
    };
    for (const l of lines) {
      const d = l?.createdAt ? new Date(l.createdAt) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const h = (d.getUTCHours() + 7) % 24;
      const half = h < 12 ? split.morning : split.afternoon;
      half.qty += Number(l.qty || 0);
      half.revenue += Number(l.revenue || 0);
      if (l.orderId) half.orders.add(String(l.orderId));
    }
    const morning = { orders: split.morning.orders.size, qty: split.morning.qty, revenue: split.morning.revenue };
    const afternoon = { orders: split.afternoon.orders.size, qty: split.afternoon.qty, revenue: split.afternoon.revenue };
    const stronger =
      morning.qty !== afternoon.qty
        ? morning.qty > afternoon.qty ? 'sang' : 'chieu'
        : morning.revenue !== afternoon.revenue
          ? morning.revenue > afternoon.revenue ? 'sang' : 'chieu'
          : 'hoa';
    let warehouseName: string | null = null;
    if (warehouseId) {
      const wh: any[] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
      warehouseName = wh[0]?.name || warehouseId;
    }
    return {
      scopeLabel: `${from} → ${endDay} · ${warehouseName || 'toàn hệ thống'}`,
      from,
      to: endDay,
      morning,
      afternoon,
      stronger,
    };
  }

  /**
   * 8. query_period_compare: So kỳ này vs kỳ trước (cùng độ dài N ngày).
   * Trả lời "tăng bao nhiêu % so với tháng trước". % = (nay-trước)/trước*100,
   * kỳ trước = 0 thì % = null (không chia cho 0, báo thẳng).
   */
  static async queryPeriodCompare(params: { windowDays?: number; warehouseId?: string } = {}): Promise<{
    windowDays: number;
    current: { from: string; to: string; orders: number; qty: number; revenue: number };
    previous: { from: string; to: string; orders: number; qty: number; revenue: number };
    change: { ordersPct: number | null; qtyPct: number | null; revenuePct: number | null };
  }> {
    const n = clampInt(params.windowDays, 30, 1, 92);
    const warehouseId = typeof params.warehouseId === 'string' && params.warehouseId.trim()
      ? params.warehouseId.trim()
      : undefined;
    const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const shift = (day: string, back: number) =>
      new Date(Date.parse(`${day}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    const ranges = [
      { from: shift(todayVn, n - 1), to: todayVn },
      { from: shift(todayVn, 2 * n - 1), to: shift(todayVn, n) },
    ];
    const one = async (r: { from: string; to: string }) => {
      const summary = await OrderService.getSalesSummary({
        startDate: r.from,
        endDate: r.to,
        ...(warehouseId ? { warehouseId } : {}),
      });
      const qtyConds = [
        eq(orders.status, 'COMPLETED'),
        sql`${orders.channel} != 'SPONSORSHIP'`,
        ...createdAtBetween(orders.createdAt, r.from, r.to),
      ];
      if (warehouseId) qtyConds.push(eq(orders.warehouseId, warehouseId));
      const qtyRows: any[] = await db
        .select({ q: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)` })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(...qtyConds));
      return {
        from: r.from,
        to: r.to,
        orders: summary.totalOrders,
        qty: Number(qtyRows[0]?.q || 0),
        revenue: summary.totalRevenue,
      };
    };
    const current = await one(ranges[0]);
    const previous = await one(ranges[1]);
    const pct = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
    return {
      windowDays: n,
      current,
      previous,
      change: {
        ordersPct: pct(current.orders, previous.orders),
        qtyPct: pct(current.qty, previous.qty),
        revenuePct: pct(current.revenue, previous.revenue),
      },
    };
  }

  /**
   * 9. query_transfer_history: Phiếu luân chuyển kho (ai gửi, ai nhận, đi đâu
   * về đâu, hao hụt). warehouseId khớp cả kho đi lẫn kho đến.
   */
  static async queryTransferHistory(params: { windowDays?: number; warehouseId?: string; limit?: number } = {}): Promise<{
    windowDays: number;
    total: number;
    items: Array<{
      id: string;
      fromWarehouse: string;
      toWarehouse: string;
      status: string;
      dispatchedQty: number;
      receivedQty: number;
      lostQty: number;
      dispatchedAt: string | null;
      receiverId: string | null;
    }>;
  }> {
    const days = clampInt(params.windowDays, 30, 1, 92);
    const limit = clampInt(params.limit, 20, 1, 50);
    const warehouseId = typeof params.warehouseId === 'string' && params.warehouseId.trim()
      ? params.warehouseId.trim()
      : undefined;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const conds = [sql`datetime(${transferShipments.dispatchedAt}) >= datetime(${cutoff})`];
    if (warehouseId) {
      conds.push(
        or(eq(transferShipments.fromWarehouseId, warehouseId), eq(transferShipments.toWarehouseId, warehouseId))!
      );
    }
    const ships: any[] = await db
      .select()
      .from(transferShipments)
      .where(and(...conds))
      .orderBy(desc(transferShipments.dispatchedAt))
      .limit(limit);
    const whRows: any[] = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
    const whName = new Map(whRows.map((w) => [w.id, w.name || w.id]));
    const agg = new Map<string, { disp: number; recv: number; lost: number }>();
    if (ships.length > 0) {
      const rows: any[] = await db
        .select({
          shipmentId: transferShipmentItems.shipmentId,
          disp: sql<number>`COALESCE(SUM(${transferShipmentItems.dispatchedQty}), 0)`,
          recv: sql<number>`COALESCE(SUM(${transferShipmentItems.receivedQty}), 0)`,
          lost: sql<number>`COALESCE(SUM(${transferShipmentItems.lostQty}), 0)`,
        })
        .from(transferShipmentItems)
        .where(inArray(transferShipmentItems.shipmentId, ships.map((s) => s.id)))
        .groupBy(transferShipmentItems.shipmentId);
      for (const r of rows) {
        agg.set(String(r.shipmentId), {
          disp: Number(r.disp || 0),
          recv: Number(r.recv || 0),
          lost: Number(r.lost || 0),
        });
      }
    }
    return {
      windowDays: days,
      total: ships.length,
      items: ships.map((s) => ({
        id: s.id,
        fromWarehouse: whName.get(s.fromWarehouseId) || s.fromWarehouseId,
        toWarehouse: whName.get(s.toWarehouseId) || s.toWarehouseId,
        status: s.status,
        dispatchedQty: agg.get(s.id)?.disp || 0,
        receivedQty: agg.get(s.id)?.recv || 0,
        lostQty: agg.get(s.id)?.lost || 0,
        dispatchedAt: s.dispatchedAt,
        receiverId: s.receiverId,
      })),
    };
  }

  /**
   * 10. query_gift_return: Quà đã xuất (dòng isGiftLine) + phiếu trả hàng
   * (hoàn tiền) trong N ngày. Tách khỏi doanh số để không thổi phồng số bán.
   */
  static async queryGiftReturn(params: { windowDays?: number; warehouseId?: string } = {}): Promise<{
    windowDays: number;
    from: string;
    to: string;
    gifts: { qty: number; orders: number; top: Array<{ code: string; title: string; qty: number }> };
    returns: { count: number; refundAmount: number; byStatus: Record<string, number> };
  }> {
    const days = clampInt(params.windowDays, 30, 1, 92);
    const warehouseId = typeof params.warehouseId === 'string' && params.warehouseId.trim()
      ? params.warehouseId.trim()
      : undefined;
    const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const from = new Date(Date.parse(`${todayVn}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const gConds = [
      eq(orders.status, 'COMPLETED'),
      sql`${orders.channel} != 'SPONSORSHIP'`,
      ...createdAtBetween(orders.createdAt, from, todayVn),
      eq(orderItems.isGiftLine, true),
    ];
    if (warehouseId) gConds.push(eq(orders.warehouseId, warehouseId));
    const gRows: any[] = await db
      .select({
        pid: orderItems.productId,
        code: sql<string | null>`COALESCE(${editions.code}, ${products.code})`,
        title: sql<string | null>`COALESCE(${editions.title}, ${products.name})`,
        qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        orders: sql<number>`COUNT(DISTINCT ${orderItems.orderId})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(editions, eq(orderItems.editionId, editions.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(and(...gConds))
      .groupBy(orderItems.productId);
    const gifts = gRows
      .map((r) => ({ code: r.code || '?', title: r.title || '-', qty: Number(r.qty || 0), orders: Number(r.orders || 0) }))
      .filter((r) => r.qty > 0)
      .sort((a, b) => b.qty - a.qty);
    const rConds = [...createdAtBetween(returnOrders.createdAt, from, todayVn)];
    if (warehouseId) rConds.push(eq(returnOrders.targetWarehouseId, warehouseId));
    const rRows: any[] = await db
      .select({ status: returnOrders.status, refund: returnOrders.refundAmount })
      .from(returnOrders)
      .where(and(...rConds));
    const byStatus: Record<string, number> = {};
    let refundAmount = 0;
    for (const r of rRows) {
      byStatus[r.status || '?'] = (byStatus[r.status || '?'] || 0) + 1;
      refundAmount += Number(r.refund || 0);
    }
    return {
      windowDays: days,
      from,
      to: todayVn,
      gifts: {
        qty: gifts.reduce((s, g) => s + g.qty, 0),
        orders: gifts.reduce((s, g) => s + g.orders, 0),
        top: gifts.slice(0, 20),
      },
      returns: { count: rRows.length, refundAmount, byStatus },
    };
  }

  /**
   * 11. query_order_lookup: Tra 1 đơn theo mã (ORD-.../CPM...). Hỏi mã nào
   * trả đúng mã đó + dòng hàng; không thấy thì báo rõ, không đoán.
   */
  static async queryOrderLookup(params: { orderCode?: string; q?: string } = {}): Promise<{
    found: boolean;
    orderCode: string | null;
    order?: {
      status: string;
      warehouse: string;
      channel: string | null;
      paymentMethod: string | null;
      cashierId: string | null;
      customerName: string | null;
      subtotal: number;
      discountAmount: number;
      finalAmount: number;
      createdAt: string | null;
    };
    items?: Array<{ code: string; title: string; qty: number; price: number; total: number; isGift: boolean }>;
    warning?: string;
  }> {
    let code = `${params.orderCode || ''}`.trim();
    if (!code && params.q) {
      // Mã đơn: ORD-... / CPM+digits (seed POS: CPM<timestamp>) / XX-...có năm+số
      // (HH001 của sách KHÔNG khớp vì thiếu gạch nối + ít hơn 4 số).
      const m = String(params.q).match(/(ord-[a-z0-9-]+|cpm-?\d+|[a-z]{2,4}-\d{4,}[\da-z-]*)/i);
      if (m) code = m[1].trim();
    }
    if (!code) {
      return { found: false, orderCode: null, warning: 'Chưa rõ mã đơn cần tra - cho xin mã đơn (vd ORD-...).' };
    }
    let row: any = (await db.select().from(orders).where(eq(orders.orderCode, code)).limit(1))[0];
    if (!row && code.toUpperCase() !== code) {
      row = (await db.select().from(orders).where(eq(orders.orderCode, code.toUpperCase())).limit(1))[0];
      if (row) code = code.toUpperCase();
    }
    if (!row) {
      return { found: false, orderCode: code, warning: `Không tìm thấy đơn mã "${code}".` };
    }
    const wh: any[] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, row.warehouseId)).limit(1);
    const lines: any[] = await db
      .select({
        qty: orderItems.quantity,
        price: orderItems.unitSellingPrice,
        total: orderItems.totalAmount,
        isGift: orderItems.isGiftLine,
        code: sql<string | null>`COALESCE(${editions.code}, ${products.code})`,
        title: sql<string | null>`COALESCE(${editions.title}, ${products.name})`,
      })
      .from(orderItems)
      .leftJoin(editions, eq(orderItems.editionId, editions.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, row.id));
    return {
      found: true,
      orderCode: row.orderCode,
      order: {
        status: row.status,
        warehouse: wh[0]?.name || row.warehouseId,
        channel: row.channel,
        paymentMethod: row.paymentMethod,
        cashierId: row.cashierId,
        customerName: row.customerName,
        subtotal: Number(row.subtotal || 0),
        discountAmount: Number(row.discountAmount || 0),
        finalAmount: Number(row.finalAmount || 0),
        createdAt: row.createdAt,
      },
      items: lines.map((l) => ({
        code: l.code || '?',
        title: l.title || '-',
        qty: Number(l.qty || 0),
        price: Number(l.price || 0),
        total: Number(l.total || 0),
        isGift: !!l.isGift,
      })),
    };
  }

  /**
   * Tra cứu HỢP ĐỒNG (read-only): theo số HĐ / tiêu đề / trạng thái.
   * Trạng thái hợp lệ đọc từ contract.service.ts: DRAFT | FINALIZED | SIGNED | CANCELLED.
   *
   * Server TỰ PHÂN TÍCH câu hỏi tự nhiên (đúng như prompt catalog hứa):
   * bóc mã HĐ (HD-BQ-...) trước, rồi lược bỏ từ khóa tool và so khớp không dấu.
   */
  static async queryContracts(params: { q?: string; status?: string; limit?: number } = {}): Promise<{
    items: Array<{
      contractNumber: string;
      title: string;
      partnerName: string | null;
      status: string;
      totalAmount: number;
      signedDate: string | null;
      effectiveDate: string | null;
      expiryDate: string | null;
    }>;
    total: number;
    warning?: string;
  }> {
    const limit = Math.min(20, Math.max(1, Math.floor(Number(params.limit) || 10)));
    const rawQ = `${params.q || ''}`.trim();
    // ponytail: fetch toàn bộ contractDocuments rồi lọc in-memory (so khớp không dấu).
    // Ceiling: bảng hợp đồng nhỏ (NXB, vài trăm dòng) nên ổn; nếu lớn lên hàng nghìn,
    // đẩy điều kiện ilike xuống DB cho nhánh codeHit (khớp chính xác), giữ in-memory
    // cho nhánh fuzzy (SQL không so khớp không dấu được).
    const rawStatus = `${params.status || ''}`.trim().toUpperCase();
    // Minor 4: validate status ở tầng service - gọi trực tiếp với status lạ
    // thì báo warning, không lặng lẽ trả rỗng.
    const status = VALID_CONTRACT_STATUSES.includes(rawStatus) ? rawStatus : '';
    const statusWarning = rawStatus && !status ? `Trạng thái "${rawStatus}" không hợp lệ - bỏ qua lọc trạng thái.` : '';
    const rows = await db
      .select({
        contractNumber: contractDocuments.contractNumber,
        title: contractDocuments.title,
        partnerName: partners.name,
        status: contractDocuments.status,
        totalAmount: contractDocuments.totalAmount,
        signedDate: contractDocuments.signedDate,
        effectiveDate: contractDocuments.effectiveDate,
        expiryDate: contractDocuments.expiryDate,
      })
      .from(contractDocuments)
      .leftJoin(partners, eq(contractDocuments.partnerId, partners.id))
      .orderBy(desc(contractDocuments.createdAt));
    // Bóc mã HĐ trước - chính xác nhất ("hợp đồng HD-BQ-2026-901").
    const codeHit = rawQ.match(CONTRACT_CODE_RE);
    let filtered = rows;
    if (codeHit) {
      const needle = codeHit[0].toLowerCase();
      filtered = rows.filter((r) => (r.contractNumber || '').toLowerCase().includes(needle));
    } else {
      // Minor 1: "còn hiệu lực" là filter ngữ nghĩa, không phải từ khóa tìm kiếm.
      // Phát hiện trước khi strip - strip sẽ xóa "còn"/"hiệu lực" thành rỗng.
      const normRaw = removeAccents(rawQ.toLowerCase());
      const wantsEffective = /\bcon hieu luc\b/.test(normRaw);
      const stripped = stripToolKeywords(rawQ, [
        'hop dong', 'hieu luc', 'con', 'danh sach', 'liet ke', 'cho toi', 'cho xem',
        'cua', 'hien tai', 'ban quyen', 'tac quyen',
      ]);
      if (stripped) {
        const needle = removeAccents(stripped.toLowerCase());
        filtered = rows.filter(
          (r) =>
            removeAccents(r.contractNumber || '').toLowerCase().includes(needle) ||
            removeAccents(r.title || '').toLowerCase().includes(needle)
        );
      }
      if (wantsEffective) {
        const today = new Date().toISOString().slice(0, 10);
        filtered = filtered.filter((r) => r.status === 'SIGNED' && (!r.expiryDate || r.expiryDate >= today));
      }
    }
    if (status) filtered = filtered.filter((r) => r.status === status);
    const total = filtered.length;
    const items = filtered.slice(0, limit).map((r) => ({
      contractNumber: r.contractNumber,
      title: r.title,
      partnerName: r.partnerName,
      status: r.status,
      totalAmount: Number(r.totalAmount || 0),
      signedDate: r.signedDate,
      effectiveDate: r.effectiveDate,
      expiryDate: r.expiryDate,
    }));
    if (items.length === 0) {
      const w = `Không tìm thấy hợp đồng${rawQ ? ` khớp "${rawQ.slice(0, 80)}"` : ''}${status ? ` trạng thái ${status}` : ''}.`;
      return {
        items: [],
        total: 0,
        warning: statusWarning ? `${statusWarning} ${w}` : w,
      };
    }
    return { items, total, ...(statusWarning ? { warning: statusWarning } : {}) };
  }

  /**
   * CÔNG NỢ ĐẠI LÝ (read-only): dư nợ, quá hạn, hạn mức theo đối tác.
   * Tái dùng PartnerDebtService.summary (FIFO tiền về trừ phiếu cũ trước).
   * Giới hạn tối đa 10 đối tác/lượt để tránh N+1 nặng.
   *
   * Server TỰ PHÂN TÍCH câu hỏi tự nhiên: lược bỏ từ khóa công nợ, so khớp
   * tên/mã đối tác không dấu; không khớp tên nào thì fallback liệt kê top nợ.
   */
  static async queryAgencyDebt(params: { q?: string; limit?: number } = {}): Promise<{
    items: Array<{
      partnerId: string;
      partnerName: string;
      balance: number;
      overdue: number;
      overdueCount: number;
      oldestOverdueDays: number;
      creditLimit: number;
      paymentDueDays: number;
    }>;
    total: number;
    warning?: string;
  }> {
    const limit = Math.min(10, Math.max(1, Math.floor(Number(params.limit) || 10)));
    const rawQ = `${params.q || ''}`.trim();
    const allPartners = await db
      .select({ id: partners.id, name: partners.name, code: partners.code, paymentDueDays: partners.paymentDueDays })
      .from(partners)
      .orderBy(partners.name);
    const stripped = stripToolKeywords(rawQ, [
      'cong no', 'dai ly', 'du no', 'qua han', 'hien tai', 'hien nay', 'ra sao',
      'the nao', 'cua', 'cac', 'cho toi', 'cho xem', 'xem', 'danh sach', 'liet ke',
    ]);
    let matched = allPartners;
    let usedFallback = false;
    if (stripped) {
      const needle = removeAccents(stripped.toLowerCase());
      const hits = allPartners.filter(
        (p) =>
          removeAccents(p.name).toLowerCase().includes(needle) ||
          p.code.toLowerCase().includes(needle)
      );
      if (hits.length > 0) {
        matched = hits;
      } else {
        // Không khớp tên đối tác nào - liệt kê top nợ thay vì "not found".
        usedFallback = true;
      }
    }
    // Import động để tránh cycle giữa các service (theo pattern query_sales_lines).
    const { PartnerDebtService } = await import('./partner-debt.service');
    // ponytail: N+1 PartnerDebtService.summary (1 query/đối tác, tối đa `limit`).
    // Ceiling: limit ≤ 10 nên ổn; nếu cần nhiều đối tác hơn, batch summary theo danh sách id.
    const DEFAULT_PAYMENT_DUE_DAYS = 30;
    const items = [];
    let skipped = 0;
    for (const p of matched.slice(0, limit)) {
      try {
        const s = await PartnerDebtService.summary(p.id);
        items.push({
          partnerId: p.id,
          partnerName: p.name,
          balance: Number(s.balance || 0),
          overdue: Number(s.overdue || 0),
          overdueCount: Number(s.overdueCount || 0),
          oldestOverdueDays: Number(s.oldestOverdueDays || 0),
          creditLimit: Number(s.creditLimit || 0),
          paymentDueDays: Number(p.paymentDueDays ?? DEFAULT_PAYMENT_DUE_DAYS),
        });
      } catch {
        // Bỏ qua đối tác lỗi lẻ, không sập cả tool - nhưng phải báo số lượng.
        skipped++;
      }
    }
    items.sort((a, b) => b.balance - a.balance);
    if (items.length === 0) {
      return { items: [], total: 0, warning: 'Không tìm thấy đối tác nào.' };
    }
    const warnings: string[] = [];
    if (usedFallback) warnings.push(`Không tìm thấy đối tác khớp "${rawQ.slice(0, 80)}" - hiển thị các đối tác nợ nhiều nhất.`);
    if (skipped > 0) warnings.push(`Bỏ qua ${skipped} đối tác do lỗi tính toán.`);
    return {
      items,
      total: matched.length,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    };
  }
}

/**
 * Lược bỏ từ khóa tool/stopwords khỏi câu hỏi tự nhiên, giữ lại phần cần tìm.
 * Chuẩn hóa không dấu + lowercase để so khớp sau đó.
 */
function stripToolKeywords(q: string, stopwords: string[]): string {
  let s = removeAccents(q.toLowerCase()).replace(/[?.!,;:()"“”]/g, ' ');
  for (const kw of stopwords) {
    // Word-boundary: không cắt nhầm substring trong từ khác ("con" trong "con dấu").
    s = s.replace(new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Pattern bóc mã hợp đồng trong câu hỏi - format "HD-BQ-..." (dùng trong test/seed). */
const CONTRACT_CODE_RE = /HD-BQ-[\w-]+/i;

/** Trạng thái hợp đồng hợp lệ (giá trị thật từ contract.service.ts). */
const VALID_CONTRACT_STATUSES = ['DRAFT', 'FINALIZED', 'SIGNED', 'CANCELLED'];
