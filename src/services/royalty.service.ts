import { db, rightsContracts, editions, inventoryLedger } from '../db';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { businessDateOf } from './order.service';

/**
 * SỔ BẢN QUYỀN & NHUẬN BÚT (RIGHTS & ROYALTIES LEDGER) — chỉ đọc ledger.
 *
 * - Hạn ngạch in: SUM RECEIPT (mọi kho) của các ấn bản thuộc tác phẩm trong
 *   thời hạn hợp đồng. Cảnh báo khi còn <= 200 cuốn hoặc <= 10% quota.
 *   KHÔNG chặn cứng nhập kho: phần mềm không ngăn được máy in chạy, chặn
 *   cứng chỉ tạo tồn ảo + đơn treo. Cảnh báo + audit là đúng bản chất.
 * - Nhuận bút: bán thật (DISPATCH_SALE + CONSIGNMENT_SOLD) trong thời hạn ×
 *   giá bìa hiện hành × royalty_rate, trừ tạm ứng, floor 0.
 * - Vòng đời: TERMINATED (tay) > EXPIRED (quá hạn) > ACTIVE (suy ra theo ngày).
 */
export const QUOTA_WARN_ABSOLUTE = 200;
export const QUOTA_WARN_RATIO = 0.1;

/**
 * `recorded_at` trong kho là UTC; `effective_date`/`expiration_date` của hợp
 * đồng là NGÀY VIỆT NAM. Lọc "sự kiện có nằm trong hạn hợp đồng không" bằng cách
 * đổi `recorded_at` sang ngày VN ngay trong SQL rồi so trên chuỗi YYYY-MM-DD —
 * bao trọn cả hai đầu, không lệch 7 tiếng, và nhận được cả hai họ timestamp đang
 * cùng tồn tại (SQLite CURRENT_TIMESTAMP 'YYYY-MM-DD HH:mm:ss' và ISO
 * 'YYYY-MM-DDTHH:mm:ssZ' mà app ghi). Việt Nam cố định UTC+7, không DST.
 */
function vnDayBetween(col: any, fromDay: string, toDay: string) {
  return sql`substr(datetime(${col}, '+7 hours'), 1, 10) BETWEEN ${fromDay} AND ${toDay}`;
}

export type ContractLifecycle = 'ACTIVE' | 'EXPIRED' | 'TERMINATED';

export interface QuotaStatus {
  contractId: string;
  contractNumber: string;
  printQuota: number;
  printed: number;
  remaining: number;
  quotaWarning: boolean;
  lifecycle: ContractLifecycle;
}

export interface RoyaltyStatement {
  contractId: string;
  contractNumber: string;
  workId: string;
  royaltyRate: number;
  soldQty: number;
  coverRevenue: number;
  accrued: number;
  advanceAmount: number;
  payable: number;
  lifecycle: ContractLifecycle;
}

export function deriveLifecycle(
  terminated: boolean | null | undefined,
  expirationDate: string,
  // Mặc định lấy NGÀY VIỆT NAM. Trước đây lấy `toISOString().slice(0,10)` = ngày
  // UTC, nên từ 00:00–07:00 VN một hợp đồng hết hạn "hôm nay" vẫn hiện ACTIVE
  // thêm 7 tiếng. Vẫn nhận tham số để test tự điều khiển được thời gian.
  nowIso: string = businessDateOf(new Date())
): ContractLifecycle {
  if (terminated) return 'TERMINATED';
  if (expirationDate < nowIso) return 'EXPIRED';
  return 'ACTIVE';
}

export class RoyaltyService {
  static async createContract(params: {
    contractNumber: string;
    workId: string;
    licensorId?: string;
    licensorName?: string;
    royaltyRate: number;
    printQuota: number;
    advanceAmount?: number;
    effectiveDate: string;
    expirationDate: string;
    createdBy: string;
    notes?: string;
  }) {
    const {
      contractNumber, workId, licensorId, licensorName, royaltyRate,
      printQuota, effectiveDate, expirationDate, createdBy, notes,
    } = params;
    const advanceAmount = params.advanceAmount ?? 0;

    if (!contractNumber.trim()) throw new Error('Thiếu mã hợp đồng.');
    if (!(royaltyRate > 0 && royaltyRate < 1)) throw new Error('royalty_rate phải trong (0, 1).');
    if (!(printQuota > 0)) throw new Error('print_quota phải lớn hơn 0.');
    if (advanceAmount < 0) throw new Error('advance_amount không được âm.');
    if (expirationDate <= effectiveDate) throw new Error('expiration_date phải sau effective_date.');

    const id = `RC-${contractNumber}`;
    await db.insert(rightsContracts).values({
      id,
      contractNumber: contractNumber.trim(),
      workId,
      licensorId,
      licensorName,
      royaltyRate,
      printQuota,
      advanceAmount,
      effectiveDate,
      expirationDate,
      terminated: false,
      notes,
      createdBy,
    });
    return { contractId: id, contractNumber: contractNumber.trim() };
  }

  static async terminateContract(contractId: string, actorId: string, reason: string) {
    if (!reason || !reason.trim()) throw new Error('Chấm dứt hợp đồng bắt buộc ghi lý do.');
    const existing = (
      await db.select().from(rightsContracts).where(eq(rightsContracts.id, contractId)).limit(1)
    )[0];
    if (!existing) throw new Error(`Không tìm thấy hợp đồng ${contractId}.`);
    await db
      .update(rightsContracts)
      .set({ terminated: true, terminateReason: reason.trim() })
      .where(eq(rightsContracts.id, contractId));
    return { contractId, lifecycle: 'TERMINATED' as ContractLifecycle, by: actorId };
  }

  static async editionIdsOfWork(workId: string): Promise<string[]> {
    const rows = await db.select({ id: editions.id }).from(editions).where(eq(editions.workId, workId));
    return rows.map((r) => r.id);
  }

  /** Tổng in trong thời hạn hợp đồng (mọi kho, mốc recordedAt).
   *
   *  `effective_date`/`expiration_date` là NGÀY HỢP ĐỒNG theo giờ VN; `recorded_at`
   *  là UTC. Trước đây so chuỗi trần, và cái "hậu tố ' 2' để bao trọn ngày" trong
   *  comment là SAI:
   *    · '2026-12-31 23:59:59' <= '2026-12-31 2' là FALSE ⇒ mất 22 giờ cuối ngày
   *      hết hạn, chỉ giữ lại 00:00–01:59.
   *    · Dòng ISO ('2026-12-31T02:00:00.000Z') bị loại HẾT cả ngày, vì so chuỗi
   *      thì 'T' > ' ' nên '2026-12-31T...' > '2026-12-31 2'.
   *  Hai lỗi đều làm royalty bị TRẾU, tức tác giả mất tiền.
   *
   *  Nay lọc theo NGÀY VN của chính `recorded_at`, nên bao trọn cả ngày hết hạn,
   *  xử lý được cả hai họ timestamp, và lệch 7 tiếng cũng được bù đúng. */
  static async printedInTerm(contractId: string): Promise<number> {
    const c = (
      await db.select().from(rightsContracts).where(eq(rightsContracts.id, contractId)).limit(1)
    )[0];
    if (!c) throw new Error(`Không tìm thấy hợp đồng ${contractId}.`);
    const editionIds = await this.editionIdsOfWork(c.workId);
    if (editionIds.length === 0) return 0;
    const rows = await db
      .select({ qty: sql<number>`COALESCE(SUM(${inventoryLedger.quantityDelta}), 0)` })
      .from(inventoryLedger)
      .where(
        and(
          inArray(inventoryLedger.editionId, editionIds),
          inArray(inventoryLedger.eventType, ['RECEIPT', 'OPENING_BALANCE']),
          vnDayBetween(inventoryLedger.recordedAt, c.effectiveDate, c.expirationDate)
        )
      );
    return Number(rows[0]?.qty ?? 0);
  }

  static async quotaStatus(contractId: string): Promise<QuotaStatus> {
    const c = (
      await db.select().from(rightsContracts).where(eq(rightsContracts.id, contractId)).limit(1)
    )[0];
    if (!c) throw new Error(`Không tìm thấy hợp đồng ${contractId}.`);
    const printed = await this.printedInTerm(contractId);
    const remaining = c.printQuota - printed;
    return {
      contractId,
      contractNumber: c.contractNumber,
      printQuota: c.printQuota,
      printed,
      remaining,
      quotaWarning: remaining <= QUOTA_WARN_ABSOLUTE || remaining <= c.printQuota * QUOTA_WARN_RATIO,
      lifecycle: deriveLifecycle(c.terminated, c.expirationDate),
    };
  }

  /** Bảng nhuận bút: bán thật trong hạn × giá bìa hiện hành × rate − tạm ứng. */
  static async royaltyStatement(contractId: string): Promise<RoyaltyStatement> {
    const c = (
      await db.select().from(rightsContracts).where(eq(rightsContracts.id, contractId)).limit(1)
    )[0];
    if (!c) throw new Error(`Không tìm thấy hợp đồng ${contractId}.`);
    const editionIds = await this.editionIdsOfWork(c.workId);

    let soldQty = 0;
    let coverRevenue = 0;
    if (editionIds.length > 0) {
      const rows = await db
        .select({
          editionId: inventoryLedger.editionId,
          qty: sql<number>`COALESCE(SUM(-${inventoryLedger.quantityDelta}), 0)`,
        })
        .from(inventoryLedger)
        .where(
          and(
            inArray(inventoryLedger.editionId, editionIds),
            inArray(inventoryLedger.eventType, ['DISPATCH_SALE', 'CONSIGNMENT_SOLD']),
            // Cùng lý do printedInTerm: ngày hợp đồng là ngày VN, recorded_at là
            // UTC, và so chuỗi trần làm mất ngày hết hạn.
            // Cùng lý do printedInTerm: ngày hợp đồng là ngày VN, recorded_at là
            // UTC, và so chuỗi trần làm mất ngày hết hạn.
            vnDayBetween(inventoryLedger.recordedAt, c.effectiveDate, c.expirationDate)
          )
        )
        .groupBy(inventoryLedger.editionId);

      const covers = new Map(
        (
          await db
            .select({ id: editions.id, coverPrice: editions.coverPrice })
            .from(editions)
            .where(inArray(editions.id, editionIds))
        ).map((e) => [e.id, e.coverPrice ?? 0])
      );
      for (const r of rows) {
        const q = Number(r.qty ?? 0);
        soldQty += q;
        coverRevenue += q * (covers.get(r.editionId) ?? 0);
      }
    }

    const accrued = Math.round(coverRevenue * c.royaltyRate);
    return {
      contractId,
      contractNumber: c.contractNumber,
      workId: c.workId,
      royaltyRate: c.royaltyRate,
      soldQty,
      coverRevenue,
      accrued,
      advanceAmount: c.advanceAmount ?? 0,
      payable: Math.max(0, accrued - (c.advanceAmount ?? 0)),
      lifecycle: deriveLifecycle(c.terminated, c.expirationDate),
    };
  }

  /**
   * Danh sách hợp đồng, lọc vòng đời TRONG SQL rồi mới `limit`.
   *
   * Trước đây `limit` chạy trên tập ĐÃ SẮP XẾP rồi mới lọc vòng đời ở JS ⇒
   * hợp đồng ACTIVE nằm ngoài `limit` biến mất im lặng. Đã quan sát thật:
   * 2 hợp đồng MỚI NHẤT đều TERMINATED/EXPIRED ⇒ `listContracts('ACTIVE', 2)`
   * trả về 0 dòng, UI hiện "Chưa có hợp đồng ACTIVE nào" trong khi vẫn có HĐ
   * đang hiệu lực. Đây cũng là chỗ "limit cắt rồi mới cộng" mà báo cáo phải khớp.
   */
  static async listContracts(lifecycle?: ContractLifecycle, limit = 100) {
    // Ngày nghiệp vụ VN, đúng như `deriveLifecycle` dùng — lọc SQL và gán nhãn
    // phải cùng một đồng hồ, nếu không sẽ lệch ở khung 00:00–07:00 VN.
    const today = businessDateOf(new Date());
    const conds = [];
    if (lifecycle === 'TERMINATED') {
      conds.push(sql`${rightsContracts.terminated} IS 1`);
    } else if (lifecycle === 'EXPIRED') {
      conds.push(
        sql`${rightsContracts.terminated} IS NOT 1 AND ${rightsContracts.expirationDate} < ${today}`
      );
    } else if (lifecycle === 'ACTIVE') {
      conds.push(
        sql`${rightsContracts.terminated} IS NOT 1 AND ${rightsContracts.expirationDate} >= ${today}`
      );
    }

    const all = conds.length
      ? await db
          .select()
          .from(rightsContracts)
          .where(and(...conds))
          .orderBy(desc(rightsContracts.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(rightsContracts)
          .orderBy(desc(rightsContracts.createdAt))
          .limit(limit);

    return all.map((c) => ({ ...c, lifecycle: deriveLifecycle(c.terminated, c.expirationDate, today) }));
  }
}
