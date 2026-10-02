import { db, rightsContracts, editions, orderItems, orders, inventoryLedger } from '../db';
import { AppError } from './app-error';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { businessDateOf, createdAtBetween } from './order.service';

/**
 * SỔ BẢN QUYỀN & NHUẬN BÚT (RIGHTS & ROYALTIES LEDGER) — chỉ đọc ledger.
 *
 * - Hạn ngạch in: SUM RECEIPT (mọi kho) của các ấn bản thuộc tác phẩm trong
 *   thời hạn hợp đồng. Cảnh báo khi còn <= 200 cuốn hoặc <= 10% quota.
 *   KHÔNG chặn cứng nhập kho: phần mềm không ngăn được máy in chạy, chặn
 *   cứng chỉ tạo tồn ảo + đơn treo. Cảnh báo + audit là đúng bản chất.
 * - Nhuận bút: xem `royaltyBasis` bên dưới — mặc định NET_SOLD (tiền thực
 *   thu trong sổ cái) hoặc COVER_PRICE (hợp đồng trả theo giá bìa).
 * - Vòng đời: TERMINATED (tay) > EXPIRED (quá hạn) > ACTIVE (suy ra theo ngày).
 */
export const QUOTA_WARN_ABSOLUTE = 200;
export const QUOTA_WARN_RATIO = 0.1;

/**
 * Cơ sở tính tiền nhuận bút — quyết định nghiệp vụ, KHÔNG phải chi tiết kỹ thuật.
 *
 * - `NET_SOLD` (MẶC ĐỊNH): tiền thực thu = SUM(`order_items.total_amount`) của
 *   đơn COMPLETED trong hạn. Đây là đúng số tiền khách đã trả sau chiết khấu,
 *   tức số nằm trong sổ cái. Hợp đồng trả theo dòng tiền thật thì dùng cái này.
 * - `COVER_PRICE`: lượng bán × GIÁ BÌA HIỆN HÀNH (`editions.cover_price`).
 *   Chỉ dùng cho hợp đồng ghi rõ trả theo giá bìa.
 *
 * VÌ SAO PHẢI CÓ LỰA CHỌN: trước đây (và mặc định cũ) nhân `qty × coverPrice`
 * ⇒ khách chiết khấu 10% thì tác giả vẫn nhận nhuận bút trên 100% giá bìa, tức
 * royalty BỊ THỔI PHỒNG ~10%. Bảng kê phải nói rõ đang dùng cơ sở nào, nếu không
 * khi đối chiếu với đối tác sẽ phải đoán.
 */
export type RoyaltyBasis = 'NET_SOLD' | 'COVER_PRICE';

export const ROYALTY_BASES: RoyaltyBasis[] = ['NET_SOLD', 'COVER_PRICE'];

export const ROYALTY_BASIS_LABEL: Record<RoyaltyBasis, string> = {
  NET_SOLD: 'Tiền thực thu (giá bán sau chiết khấu)',
  COVER_PRICE: 'Giá bìa',
};

export const ROYALTY_BASIS_OPTIONS = ROYALTY_BASES.map((b) => ({ value: b, label: ROYALTY_BASIS_LABEL[b] }));

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
  /** Cơ sở đã dùng để ra con số này — bảng kê phải nói rõ, không để đối tác đoán. */
  royaltyBasis: RoyaltyBasis;
  /** Nhãn tiếng Việt của `royaltyBasis`, dán thẳng lên header bản in. */
  royaltyBasisLabel: string;
  soldQty: number;
  /** Lượng × GIÁ BÌA HIỆN HÀNH. Chỉ là con số đối chiếu, KHÔNG phải doanh thu
   *  dùng để trả khi `royaltyBasis = NET_SOLD`. */
  coverRevenue: number;
  /** Doanh thu theo cơ sở đang áp dụng — đây mới là số nhân với `royaltyRate`. */
  basisRevenue: number;
  /** Bao nhiêu cuốn trong `soldQty` KHÔNG bốc được giá từ đơn hàng (ký gửi, ghi
   *  tay) nên phải tính theo giá bìa. Không có số này thì việc lấp bằng giá bìa
   *  là vô hình — sẽ không ai biết mình đang trả theo cơ sở nào cho phần này. */
  soldQtyUnpriced: number;
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

/**
 * Tập `orders.id` ĐỦ điều kiện sinh nhuận bút: COMPLETED + không phải kênh
 * SPONSORSHIP + phát sinh trong hạn hợp đồng (ngày nghiệp vụ VN).
 *
 * Tách riêng thành hàm để `royaltyStatement` không phải tự viết lại bộ lọc —
 * cùng bộ với `OrderService.getSalesSummary` (`status = COMPLETED`, bỏ
 * SPONSORSHIP, `createdAtBetween`). Trả về Set rỗng khi không có id nào.
 */
async function qualifyingOrderIds(
  orderIds: string[],
  fromDay: string,
  toDay: string
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        inArray(orders.id, orderIds),
        eq(orders.status, 'COMPLETED'),
        sql`${orders.channel} != 'SPONSORSHIP'`,
        ...createdAtBetween(orders.createdAt, fromDay, toDay)
      )
    );
  return new Set(rows.map((r) => r.id));
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
    /** Cơ sở tính tiền. Bỏ trống = `NET_SOLD` (tiền thực thu sau chiết khấu). */
    royaltyBasis?: RoyaltyBasis;
  }) {
    const {
      contractNumber, workId, licensorId, licensorName, royaltyRate,
      printQuota, effectiveDate, expirationDate, createdBy, notes,
    } = params;
    const advanceAmount = params.advanceAmount ?? 0;
    const royaltyBasis: RoyaltyBasis = params.royaltyBasis ?? 'NET_SOLD';

    if (!contractNumber.trim()) throw AppError.invalid('Thiếu mã hợp đồng.');
    if (!(royaltyRate > 0 && royaltyRate < 1)) throw AppError.invalid('royalty_rate phải trong (0, 1).');
    if (!ROYALTY_BASES.includes(royaltyBasis)) {
      throw AppError.invalid(`royalty_basis không hợp lệ: ${royaltyBasis}. Chỉ chấp nhận NET_SOLD hoặc COVER_PRICE.`);
    }
    if (!(printQuota > 0)) throw AppError.invalid('print_quota phải lớn hơn 0.');
    if (advanceAmount < 0) throw AppError.invalid('advance_amount không được âm.');
    if (expirationDate <= effectiveDate) throw AppError.invalid('expiration_date phải sau effective_date.');

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
      royaltyBasis,
    });
    return { contractId: id, contractNumber: contractNumber.trim() };
  }

  static async terminateContract(contractId: string, actorId: string, reason: string) {
    if (!reason || !reason.trim()) throw AppError.invalid('Chấm dứt hợp đồng bắt buộc ghi lý do.');
    const existing = (
      await db.select().from(rightsContracts).where(eq(rightsContracts.id, contractId)).limit(1)
    )[0];
    if (!existing) throw AppError.invalid(`Không tìm thấy hợp đồng ${contractId}.`);
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
    if (!c) throw AppError.invalid(`Không tìm thấy hợp đồng ${contractId}.`);
    const editionIds = await this.editionIdsOfWork(c.workId);
    if (editionIds.length === 0) return 0;
    const rows = await db
      .select({ qty: sql<number>`COALESCE(SUM(${inventoryLedger.quantityDelta}), 0)` })
      .from(inventoryLedger)
      .where(
        and(
          inArray(inventoryLedger.editionId, editionIds),
          inArray(inventoryLedger.eventType, ['RECEIPT', 'OPENING_BALANCE']),
          ...createdAtBetween(inventoryLedger.recordedAt, c.effectiveDate, c.expirationDate)
        )
      );
    return Number(rows[0]?.qty ?? 0);
  }

  static async quotaStatus(contractId: string): Promise<QuotaStatus> {
    const c = (
      await db.select().from(rightsContracts).where(eq(rightsContracts.id, contractId)).limit(1)
    )[0];
    if (!c) throw AppError.invalid(`Không tìm thấy hợp đồng ${contractId}.`);
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

  /**
   * Bảng nhuận bút.
   * `soldQty` và `coverRevenue` luôn lấy từ SỔ KHO (DISPATCH_SALE +
   * CONSIGNMENT_SOLD trong hạn) — đó là sự thật vật lý "đã bán được mấy cuốn",
   * và là nguồn duy nhất mà hạn ngạch in cũng dùng.
   *
   * `basisRevenue` là số được nhân với `royaltyRate`, chọn theo `royaltyBasis`:
   *   · NET_SOLD (mặc định) = SUM(`order_items.total_amount`) của những lần bán
   *     đó — tức tiền thực thu sau chiết khấu, đúng số trong sổ cái.
   *   · COVER_PRICE = `coverRevenue` (giá bìa hiện hành), giữ đúng hành vi cũ
   *     cho hợp đồng ghi rõ trả theo giá bìa.
   *
   * VÌ SAO CẦN `soldQtyUnpriced`: có lần bán trong sổ kho mà KHÔNG bốc được
   * dòng đơn (ký gửi, phiếu ghi tay, đơn ngoài phạm vi app). Nếu cứ im lặng
   * bỏ qua thì tác giả mất tiền; nếu âm thầm lấp bằng giá bìa thì không ai
   * biết mình đang trả cái gì. Ta lấp bằng giá bìa (hành vi cũ, không bao giờ
   * trả ít hơn trước) và ĐẾM RA, để bảng kê nói thẳng phần nào không có giá
   * thực thu.
   */
  static async royaltyStatement(contractId: string): Promise<RoyaltyStatement> {    const c = (
      await db.select().from(rightsContracts).where(eq(rightsContracts.id, contractId)).limit(1)
    )[0];
    if (!c) throw AppError.invalid(`Không tìm thấy hợp đồng ${contractId}.`);

    // Chặn ngay ở cổng đọc: `royalty_rate` là hệ số nhân tiền thật. Giá trị hỏng
    // (NaN / null / âm / ≥1) sẽ biến `accrued` và `payable` thành NaN rồi in ra
    // bảng kê — `createContract` chặn lúc GHI, nhưng dữ liệu có thể còn từ
    // import cũ hoặc sửa tay trong DB, nên phải chặn lúc ĐỌC nữa.
    const rate = Number(c.royaltyRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
      throw AppError.invalid(
        `royalty_rate của hợp đồng ${c.contractNumber} không hợp lệ (${c.royaltyRate}). ` +
          `Phải nằm trong (0, 1) — sửa hợp đồng rồi tính lại bảng kê.`
      );
    }
    const basis: RoyaltyBasis = c.royaltyBasis === 'COVER_PRICE' ? 'COVER_PRICE' : 'NET_SOLD';
    const editionIds = await this.editionIdsOfWork(c.workId);

    let soldQty = 0;
    let coverRevenue = 0;
    let netRevenue = 0;
    let soldQtyUnpriced = 0;

    if (editionIds.length > 0) {
      // Bước 1 — sổ kho. Nhóm theo (ấn bản, correlation_id) để từng lần bán còn
      // giữ được mối nối tới đơn hàng (correlation_id = orders.id khi bán qua
      // POS/online; ký gửi thì correlation_id = mã kỳ đối soát, không khớp đơn
      // nào ⇒ tự rơi vào phần "không có giá thực thu").
      const ledgerRows = await db
        .select({
          editionId: inventoryLedger.editionId,
          correlationId: inventoryLedger.correlationId,
          qty: sql<number>`COALESCE(SUM(-${inventoryLedger.quantityDelta}), 0)`,
        })
        .from(inventoryLedger)
        .where(
          and(
            inArray(inventoryLedger.editionId, editionIds),
            inArray(inventoryLedger.eventType, ['DISPATCH_SALE', 'CONSIGNMENT_SOLD']),
            // `effective_date`/`expiration_date` là NGÀY VIỆT NAM còn
            // `recorded_at` là UTC. Dùng lại `createdAtBetween` của
            // order.service (chung với getSalesSummary) để không tự viết lại
            // một bản lọc ngày — so chuỗi trần làm mất ngày hết hạn và lệch 7
            // tiếng, tức tác giả mất tiền.
            ...createdAtBetween(inventoryLedger.recordedAt, c.effectiveDate, c.expirationDate)
          )
        )
        .groupBy(inventoryLedger.editionId, inventoryLedger.correlationId);

      // Bước 2 — giá bìa hiện hành (chỉ để đối chiếu / lấp phần không có đơn).
      const covers = new Map(
        (
          await db
            .select({ id: editions.id, coverPrice: editions.coverPrice })
            .from(editions)
            .where(inArray(editions.id, editionIds))
        ).map((e) => [e.id, e.coverPrice ?? 0])
      );

      // Bước 3 — phân loại từng lần bán theo dòng đơn.
      //
      // Bộ lọc CỐ TÌNH giống hệt `OrderService.getSalesSummary`: đơn COMPLETED +
      // bỏ kênh SPONSORSHIP (đơn rút quỹ, final 0đ) + ngày nghiệp vụ VN — để bảng
      // kê royalty và sổ doanh số phải khớp nhau. Chạy cho CẢ HAI cơ sở, không
      // chỉ NET_SOLD: một đơn SPONSORSHIP là ĐƠN TÀI TRỢ (sách rút từ quỹ, không
      // phải khách mua), nên nó không phải doanh số bán và không được sinh
      // nhuận bút dù HĐ tính theo giá bìa.
      const netByLine = new Map<string, number>();
      const orderIds = Array.from(
        new Set(ledgerRows.map((r) => r.correlationId).filter((x): x is string => !!x))
      );
      const eligible = await qualifyingOrderIds(orderIds, c.effectiveDate, c.expirationDate);
      // correlationId có tồn tại trong `orders` nhưng không đạt điều kiện ⇒ loại
      // hẳn, KHÔNG lấp bằng giá bìa. Phải phân biệt rõ với "không có đơn nào":
      // gộp chung thì đơn SPONSORSHIP rơi vào nhánh lấp giá bìa và bị trả oan
      // (đo thật khi chạy test: 3 cuốn tài trợ ⇒ 360.000 tiền nhuận bút oan).
      const nonQualifying = new Set<string>();
      if (orderIds.length > 0) {
        const linked = await db
          .select({ id: orders.id })
          .from(orders)
          .where(inArray(orders.id, orderIds));
        for (const o of linked) {
          if (!eligible.has(o.id)) nonQualifying.add(o.id);
        }

        if (basis === 'NET_SOLD' && eligible.size > 0) {
          const netRows = await db
            .select({
              orderId: orderItems.orderId,
              editionId: orderItems.editionId,
              net: sql<number>`COALESCE(SUM(${orderItems.totalAmount}), 0)`,
            })
            .from(orderItems)
            .where(
              and(
                inArray(orderItems.orderId, Array.from(eligible)),
                inArray(orderItems.editionId, editionIds)
              )
            )
            .groupBy(orderItems.orderId, orderItems.editionId);
          for (const r of netRows) netByLine.set(`${r.orderId}|${r.editionId}`, Number(r.net ?? 0));
        }
      }

      for (const r of ledgerRows) {
        // `edition_id` NULLABLE từ 0033 (hàng hóa không có dòng `editions`).
        // Truy vấn trên đã lọc `inArray(edition_id, editionIds)` nên dòng hàng
        // hóa không lọt vào đây — guard chỉ để thu hẹp kiểu, không đổi hành vi.
        if (r.editionId === null) continue;
        const q = Number(r.qty ?? 0);
        if (!q) continue;
        // Đơn không đạt điều kiện (tài trợ / chưa hoàn tất / ngoài hạn): không phải
        // doanh số bán, không tính vào bảng kê — khớp `getSalesSummary`.
        if (r.correlationId && nonQualifying.has(r.correlationId)) continue;

        const cover = covers.get(r.editionId) ?? 0;
        soldQty += q;
        coverRevenue += q * cover;

        const net = r.correlationId && eligible.has(r.correlationId)
          ? netByLine.get(`${r.correlationId}|${r.editionId}`)
          : undefined;
        if (net === undefined) {
          // Không có dòng đơn nào để bốc giá (ký gửi, phiếu ghi tay) ⇒ không biết
          // tiền thực thu. Lấp bằng giá bìa như hành vi cũ (tác giả không bị trả
          // ít) và ĐẾM RA, để bảng kê nói thẳng phần nào không có giá thực thu.
          soldQtyUnpriced += q;
          netRevenue += q * cover;
        } else {
          netRevenue += net;
        }
      }
    }

    const basisRevenue = basis === 'COVER_PRICE' ? coverRevenue : netRevenue;
    // Làm tròn MỘT LẦN ở cuối trên tổng, không làm tròn từng dòng: làm tròn mỗi
    // dòng rồi cộng lại lệch với tổng (đã có test B1.3 bắt). Bảng kê là số tích
    // lũy từ đầu hạn đến nay chứ không chia theo kỳ, nên không có chuyện "lệch
    // so với kỳ trước" — cùng dữ liệu là ra cùng một con số.
    const accrued = Math.round(basisRevenue * rate);
    const advanceAmount = Number.isFinite(Number(c.advanceAmount)) ? Math.max(0, Number(c.advanceAmount)) : 0;
    return {
      contractId,
      contractNumber: c.contractNumber,
      workId: c.workId,
      royaltyRate: rate,
      royaltyBasis: basis,
      royaltyBasisLabel: ROYALTY_BASIS_LABEL[basis],
      soldQty,
      coverRevenue,
      basisRevenue,
      soldQtyUnpriced,
      accrued,
      advanceAmount,
      payable: Math.max(0, accrued - advanceAmount),
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
