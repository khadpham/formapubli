import { db, customers, customerOwnedBooks, customerSubscriptions, customerTags, editions, orderItems, orders, works } from '../db';
import { and, desc, eq, sql } from 'drizzle-orm';

/**
 * 5.4 — READER PERSONA (nền dữ liệu, read-only, không migration).
 * - Hồ sơ 360°: đơn, chi tiêu, tủ sách, tag, thể loại ưa thích (từ lịch sử mua thật).
 * - Gợi ý độc giả cho ấn bản mới: chấm điểm giải thích được
 *   (cùng tác giả +3, cùng thể loại +2 theo số cuốn), loại người đã sở hữu.
 * Thuật toán embedding/clustering để đợt sau khi đủ dữ liệu.
 */

export interface ReaderProfile {
  customer: typeof customers.$inferSelect;
  tags: string[];
  ownedBooksCount: number;
  subscriptionCount: number;
  orders: { count: number; spent: number; booksQty: number; lastOrderAt: string | null };
  topCategories: Array<{ category: string; qty: number }>;
  topEditions: Array<{ editionId: string; code: string; title: string | null; qty: number }>;
}

export interface ReaderMatch {
  customerId: string;
  code: string;
  fullName: string;
  phone: string | null;
  score: number;
  reasons: string[];
}

export class ReaderProfileService {
  static async getReaderProfile(customerId: string): Promise<ReaderProfile> {
    const cust = (await db.select().from(customers).where(eq(customers.id, customerId)).limit(1))[0];
    if (!cust) throw new Error(`Không tìm thấy độc giả ${customerId}.`);

    const tags = (
      await db.select({ tag: customerTags.tag }).from(customerTags).where(eq(customerTags.customerId, customerId))
    ).map((r) => r.tag);

    const owned = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(customerOwnedBooks)
      .where(eq(customerOwnedBooks.customerId, customerId));
    const subs = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(customerSubscriptions)
      .where(eq(customerSubscriptions.customerId, customerId));

    const orderRows = await db
      .select({
        n: sql<number>`COUNT(*)`,
        spent: sql<number>`COALESCE(SUM(${orders.finalAmount}), 0)`,
        lastAt: sql<string | null>`MAX(${orders.createdAt})`,
      })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.status, 'COMPLETED')));

    const lines = await db
      .select({
        editionId: orderItems.editionId,
        code: editions.code,
        title: editions.title,
        category: works.category,
        qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(editions, eq(orderItems.editionId, editions.id))
      .leftJoin(works, eq(editions.workId, works.id))
      .where(and(eq(orders.customerId, customerId), eq(orders.status, 'COMPLETED')))
      .groupBy(orderItems.editionId);

    const booksQty = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
    const catMap = new Map<string, number>();
    for (const l of lines) {
      const cat = l.category || 'CHUA_PHAN_LOAI';
      catMap.set(cat, (catMap.get(cat) || 0) + Number(l.qty || 0));
    }
    const topCategories = Array.from(catMap.entries())
      .map(([category, qty]) => ({ category, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 3);
    const topEditions = lines
      .map((l) => ({ editionId: l.editionId, code: l.code, title: l.title, qty: Number(l.qty || 0) }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    return {
      customer: cust,
      tags,
      ownedBooksCount: Number(owned[0]?.n || 0),
      subscriptionCount: Number(subs[0]?.n || 0),
      orders: {
        count: Number(orderRows[0]?.n || 0),
        spent: Number(orderRows[0]?.spent || 0),
        booksQty,
        lastOrderAt: orderRows[0]?.lastAt || null,
      },
      topCategories,
      topEditions,
    };
  }

  /**
   * Gợi ý độc giả cho ấn bản mới/chuẩn bị ra mắt.
   * Điểm = 3×số cuốn cùng tác giả + 2×số cuốn cùng thể loại + 1×tổng cuốn đã mua.
   * Loại người đã sở hữu ấn bản (không chào hàng thứ họ có).
   */
  static async matchReadersForEdition(editionId: string, limit = 50): Promise<ReaderMatch[]> {
    const ed = (await db.select().from(editions).where(eq(editions.id, editionId)).limit(1))[0];
    if (!ed) throw new Error(`Không tìm thấy ấn bản ${editionId}.`);
    const work = (await db.select().from(works).where(eq(works.id, ed.workId)).limit(1))[0];
    const category = work?.category || null;
    const author = work?.author || null;

    const ownedIds = (
      await db.select({ customerId: customerOwnedBooks.customerId }).from(customerOwnedBooks).where(eq(customerOwnedBooks.editionId, editionId))
    ).map((r) => r.customerId);
    const ownedSet = new Set(ownedIds);

    const lines = await db
      .select({
        customerId: orders.customerId,
        editionId: orderItems.editionId,
        category: works.category,
        author: works.author,
        qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(editions, eq(orderItems.editionId, editions.id))
      .leftJoin(works, eq(editions.workId, works.id))
      .where(eq(orders.status, 'COMPLETED'))
      .groupBy(orders.customerId, orderItems.editionId);

    const acc = new Map<string, { score: number; reasons: string[] }>();
    for (const l of lines) {
      if (!l.customerId || ownedSet.has(l.customerId)) continue;
      const qty = Number(l.qty || 0);
      // Chỉ gợi ý khi khớp tác giả hoặc thể loại — mua thể loại khác không tính.
      const reasons: string[] = [];
      let add = 0;
      if (author && l.author === author) {
        add += 3 * qty;
        reasons.push(`cùng tác giả ${author}`);
      } else if (category && l.category === category) {
        add += 2 * qty;
        reasons.push(`cùng thể loại ${category}`);
      } else {
        continue;
      }
      add += qty; // +1 mỗi cuốn đã mua trong nhóm khớp
      const cur = acc.get(l.customerId) || { score: 0, reasons: [] };
      cur.score += add;
      for (const r of reasons) {
        if (!cur.reasons.includes(r)) cur.reasons.push(r);
      }
      acc.set(l.customerId, cur);
    }

    const ranked = Array.from(acc.entries())
      .filter(([, v]) => v.score > 0)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, Math.max(1, Math.min(200, limit)));

    const out: ReaderMatch[] = [];
    for (const [customerId, v] of ranked) {
      const cust = (await db.select().from(customers).where(eq(customers.id, customerId)).limit(1))[0];
      if (!cust) continue;
      out.push({
        customerId,
        code: cust.code,
        fullName: cust.fullName,
        phone: cust.phone,
        score: v.score,
        reasons: Array.from(v.reasons),
      });
    }
    return out;
  }
}
