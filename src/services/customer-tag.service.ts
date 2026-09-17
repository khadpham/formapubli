import { db, customers, customerTags } from '../db';
import { eq, and, inArray, sql } from 'drizzle-orm';

// Bước 3 — Tag chuẩn hóa tệp CRM (allowlist server-side, không cho tag tự do)
export const VALID_CUSTOMER_TAGS = [
  'TAG_SUBSCRIPTION',
  'TAG_NEWSLETTER',
  'SOURCE_CAMPAIGN',
  'SOURCE_EVENT',
  'PARTNER_REFERRED',
] as const;
export type CustomerTag = (typeof VALID_CUSTOMER_TAGS)[number];

export class CustomerTagService {
  static assertValidTag(tag: string): asserts tag is CustomerTag {
    if (!VALID_CUSTOMER_TAGS.includes(tag as CustomerTag)) {
      throw new Error(`Tag không hợp lệ: ${tag} (chỉ nhận: ${VALID_CUSTOMER_TAGS.join(', ')}).`);
    }
  }

  static async assign(customerId: string, tag: string, actorRole = 'ROLE_OWNER') {
    if (actorRole === 'ROLE_TAX') throw new Error('Kế toán thuế không được gắn tag khách hàng.');
    this.assertValidTag(tag);
    const cust = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (cust.length === 0) throw new Error('Khách hàng không tồn tại.');
    const existing = await db.select().from(customerTags).where(
      and(eq(customerTags.customerId, customerId), eq(customerTags.tag, tag))
    ).limit(1);
    if (existing.length > 0) return { customerId, tag, already: true };
    await db.insert(customerTags).values({ customerId, tag });
    return { customerId, tag, already: false };
  }

  static async unassign(customerId: string, tag: string, actorRole = 'ROLE_OWNER') {
    if (actorRole === 'ROLE_TAX') throw new Error('Kế toán thuế không được gỡ tag khách hàng.');
    this.assertValidTag(tag);
    await db.delete(customerTags).where(
      and(eq(customerTags.customerId, customerId), eq(customerTags.tag, tag))
    );
    return { customerId, tag, removed: true };
  }

  static async listTags(customerId: string): Promise<string[]> {
    const rows = await db.select({ tag: customerTags.tag }).from(customerTags).where(eq(customerTags.customerId, customerId));
    return rows.map((r) => r.tag);
  }

  /**
   * Lọc khách theo tag phục vụ phát hành hàng loạt.
   * match 'any' (mặc định): có ≥1 tag; 'all': có đủ mọi tag.
   */
  static async filterByTags(tags: string[], match: 'any' | 'all' = 'any', limit = 500) {
    const clean = Array.from(new Set(tags.map((t) => `${t}`.trim()).filter(Boolean)));
    if (clean.length === 0) throw new Error('Cần ít nhất 1 tag để lọc.');
    for (const t of clean) this.assertValidTag(t);
    if (match !== 'any' && match !== 'all') throw new Error(`match phải là 'any' hoặc 'all'.`);

    if (match === 'any') {
      const rows = await db
        .select({ customer: customers })
        .from(customers)
        .innerJoin(customerTags, eq(customerTags.customerId, customers.id))
        .where(inArray(customerTags.tag, clean))
        .groupBy(customers.id)
        .limit(limit);
      const ids = rows.map((r) => r.customer.id);
      return this.withTags(ids);
    }
    // all: GROUP BY + HAVING đủ số tag
    const rows = await db
      .select({ id: customers.id })
      .from(customers)
      .innerJoin(customerTags, eq(customerTags.customerId, customers.id))
      .where(inArray(customerTags.tag, clean))
      .groupBy(customers.id)
      .having(sql`COUNT(DISTINCT ${customerTags.tag}) >= ${clean.length}`)
      .limit(limit);
    return this.withTags(rows.map((r) => r.id));
  }

  private static async withTags(ids: string[]) {
    if (ids.length === 0) return [];
    const custs = await db.select().from(customers).where(inArray(customers.id, ids));
    const tagRows = await db.select().from(customerTags).where(inArray(customerTags.customerId, ids));
    const tagMap = new Map<string, string[]>();
    for (const tr of tagRows) {
      const arr = tagMap.get(tr.customerId) || [];
      arr.push(tr.tag);
      tagMap.set(tr.customerId, arr);
    }
    return custs.map((c) => ({ ...c, tags: tagMap.get(c.id) || [] }));
  }
}
