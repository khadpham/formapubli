import { db, cashboxSessions, warehouses, editions, orders, works, orderItems, stockBalances } from '@/db';
import { ForecastService, RunoutLevel } from './forecast.service';
import { OrderService } from './order.service';
import { InventoryService } from './inventory.service';
import { removeAccents } from '@/lib/vietnamese';
import { eq, desc, sql, and, gte, inArray, ne } from 'drizzle-orm';

export interface QueryStockParams {
  editionId?: string;
  warehouseId?: string;
  /** Ten hoac ma sach nguoi dung nhac trong cau hoi (vd "H01", "Benh tuong") — server tu phan giai. */
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
  /** Cau hoi nguyen van — server tu phan tich y dinh (tac gia, chu cai dau, top, liet ke). */
  q?: string;
  author?: string;
  titleStartsWith?: string;
  titleContains?: string;
  topAuthors?: boolean;
  topEditionsBySales?: boolean;
  windowDays?: number;
    limit?: number;
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

export class ExecutiveQueryService {
  /**
   * Phan giai kho tu cau hoi ("kho Au Co", "Quynh Mai", "hoi cho") → warehouseId.
   * Alias cum tu uu tien truoc (tranh "Au Co" bi loai vi ngan), sau do tu khoa dai
   * co loai tru tu nghiep vu chung chung (xuat/nhap/ban/tong/luu).
   */
  static async resolveWarehouseFromText(text: string): Promise<{ warehouseId: string; name: string } | null> {
    const norm = removeAccents((text || '').toLowerCase());
    if (!norm.trim()) return null;
    const ALIASES: Record<string, string[]> = {
      'wh-au-co': ['au co', 'au-co'],
      'wh-quynh-mai': ['quynh mai', 'quynh-mai'],
      'wh-du-phong': ['hoi cho', 'du phong', 'hoi-cho'],
    };
    const STOP = new Set(['kho', 'xuat', 'nhap', 'chuyen', 'ban', 'tong', 'luu', 'dong', 'phong', 'van', 'chinh', 'phu', 'su', 'kien']);
    const allWh = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
    const byId = new Map(allWh.map((w) => [w.id, w]));
    // 1. Alias cum tu.
    for (const [id, phrases] of Object.entries(ALIASES)) {
      const w = byId.get(id);
      if (!w || w.id === 'wh-in-transit') continue;
      if (phrases.some((p) => norm.includes(p))) {
        return { warehouseId: w.id, name: w.name || w.id };
      }
    }
    // 2. Tu khoa dac trung trong ten kho.
    let best: { warehouseId: string; name: string } | null = null;
    let bestLen = 0;
    for (const w of allWh) {
      if (w.id === 'wh-in-transit') continue;
      const wNorm = removeAccents((w.name || '').toLowerCase());
      const keywords = wNorm.split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t));
      for (const kw of keywords) {
        if (norm.includes(kw) && kw.length > bestLen) {
          best = { warehouseId: w.id, name: w.name || w.id };
          bestLen = kw.length;
        }
      }
    }
    return best;
  }

  /**
   * Phan giai mot dau sach cu the tu cau hoi tu nhien (ma "H01" hoac ten "Benh tuong").
   * Khong dau, khong phan biet hoa thuong; uu tien khop ma chinh xac, sau do ten dai nhat.
   */
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
    // 2. Khop ten sach: cau hoi chua toan bo ten (khong dau); chon ten dai nhat.
    let best: { editionId: string; code: string; title: string | null } | null = null;
    let bestLen = 0;
    for (const ed of catalog) {
      const titleNorm = removeAccents((ed.title || '').toLowerCase()).trim();
      if (titleNorm.length >= 4 && norm.includes(titleNorm) && titleNorm.length > bestLen) {
        best = { editionId: ed.id, code: ed.code, title: ed.title };
        bestLen = titleNorm.length;
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
    // chinh xac tuyet doi — khong con map ti le gay lech. SDT chap nhan cach so
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
      // Khong co ten cu the nhung co cum xuat don ("cho khach:", "ban cho em") — cat luon
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
        warnings.push(`[${it.code}] ${it.title} chỉ còn ${it.availableStock} cuốn — POS sẽ chặn ở mức tồn, kiểm tra lại số lượng.`);
      }
    }
    if (items.length === 0) {
      warnings.push('Không nhận diện được tên/mã sách nào — thử nói rõ mã (H01) hoặc tên đầy đủ.');
    }
    const stray = scanQ.match(/\b\d{2,}\b/g) || [];
    if (stray.length > 0 && items.every((it) => it.quantity === 1)) {
      warnings.push(`Có con số chưa rõ nghĩa (${stray.slice(0, 3).join(', ')}) — kiểm tra lại số lượng từng dòng.`);
    }

    return { customerName, phone, note: `[COPILOT] ${q.slice(0, 300)}`, items, warnings };
  }

  /**
   * 5. query_catalog: Truy van danh muc — sach cua 1 tac gia, tua bat dau bang chu X,
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
    // Cutoff dang SPACE (SQLite CURRENT_TIMESTAMP) — ISO 'T' se lech mat don trong ngay.
    // Loai tang/tai tro/0d nhu salesByEdition de bestseller khong bi thoi phong.
    const cutoff = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
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
          gte(orders.createdAt, cutoff),
          sql`${orders.discountRate} < 1`,
          sql`${orders.channel} != 'SPONSORSHIP'`,
          sql`${orders.finalAmount} > 0`
        )
      )
      .groupBy(orderItems.editionId);
    const salesMap = new Map(salesRows.map((r) => [r.editionId, { qty: Number(r.qty || 0), revenue: Number(r.revenue || 0) }]));

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
    // "nhieu dau sach nhat" — khong doi cum tu lien tuc).
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
    totalOrders: number;
    totalRevenue: number;
    totalDiscount: number;
    officialTax: { ordersCount: number; revenue: number };
    internalManagement: { ordersCount: number; revenue: number };
    channelBreakdown: Record<string, { count: number; revenue: number }>;
  }> {
    const windowDays = clampInt(params.windowDays, 30, 1, 365);
    const fiscalScope = params.fiscalScope ?? 'ALL';

    const cutoff = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
    const summary = await OrderService.getSalesSummary({
      startDate: cutoff,
    });

    // Lấy chi tiết kênh bán
    const orderRows = await db
      .select({
        channel: orders.channel,
        finalAmount: orders.finalAmount,
        fiscalScope: orders.fiscalScope,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'COMPLETED'),
          gte(orders.createdAt, cutoff)
        )
      );

    const channelBreakdown: Record<string, { count: number; revenue: number }> = {};
    for (const row of orderRows) {
      if (fiscalScope !== 'ALL' && row.fiscalScope !== fiscalScope) continue;
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

    return {
      windowDays,
      fiscalScope,
      totalOrders: reportedOrders,
      totalRevenue: reportedRevenue,
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
      discrepancyStatus: 'BALANCED' | 'OVER' | 'SHORT' | 'OPEN';
    }>;
    reconciliationNotice: string;
  }> {
    const { sessionId, date } = params;

    let query = db.select().from(cashboxSessions);
    let rows = await query.orderBy(desc(cashboxSessions.openedAt)).limit(20);

    if (sessionId) {
      rows = rows.filter((r) => r.id === sessionId);
    } else if (date) {
      rows = rows.filter((r) => r.openedAt?.startsWith(date));
    }

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
      const disc = r.cashDiscrepancy ?? 0;
      let discrepancyStatus: 'BALANCED' | 'OVER' | 'SHORT' | 'OPEN' = 'BALANCED';
      if (r.status === 'OPEN') {
        discrepancyStatus = 'OPEN';
      } else if (disc > 0) {
        discrepancyStatus = 'OVER';
      } else if (disc < 0) {
        discrepancyStatus = 'SHORT';
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
}
