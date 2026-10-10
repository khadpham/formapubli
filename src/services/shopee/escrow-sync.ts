import { eq } from 'drizzle-orm';
import { db, orders, orderItems, products, shopeeOrderFinance } from '@/db';
import { AppError } from '../app-error';
import type { ShopeeSyncConfig } from './order-sync';
import { generateShopeeSign } from './sign';
import { TursoTokenStorage } from './token-store';
import { refreshShopeeTokenOnce } from './auth';

export interface EscrowBreakdown {
  orderSn: string;
  buyerTotal: number;
  escrowAmount: number;
  commissionFee: number;
  transactionFee: number;
  serviceFee: number;
  sellerDiscount: number;
  shopeeDiscount: number;
  /** Giá vốn hàng bán. null = thiếu giá vốn, không bịa. */
  cogs: number | null;
  /** escrow − COGS. null khi chưa đủ giá vốn. */
  netProfit: number | null;
}

/**
 * Đối soát tài chính 1 đơn Shopee đã giao.
 * - Chỉ đơn DELIVERED (tiền chưa về mà tính lãi là phồng số).
 * - Tên trường theo đúng GetEscrowDetailOrderIncome của Shopee.
 * - COGS từ products.cost_price; thiếu → null trung thực.
 */
export async function syncEscrow(
  cfg: ShopeeSyncConfig,
  orderSn: string
): Promise<EscrowBreakdown> {
  const ords = await db
    .select({ id: orders.id, shippingStatus: orders.shippingStatus })
    .from(orders)
    .where(eq(orders.idempotencyKey, `shopee-${orderSn}`))
    .limit(1);
  if (ords.length === 0) throw AppError.invalid(`Không tìm thấy đơn Shopee #${orderSn}.`);
  if (ords[0].shippingStatus !== 'DELIVERED') {
    throw AppError.invalid(`Đơn #${orderSn} chưa giao xong - chưa đối soát được.`);
  }

  const fetchFn = cfg.fetchFn ?? globalThis.fetch;
  const store = new TursoTokenStorage(cfg.shopId);
  let token = await store.get();
  if (!token || token.expired_at <= Date.now() + 5 * 60 * 1000) {
    token = await refreshShopeeTokenOnce(cfg);
  }
  const apiPath = '/api/v2/payment/get_escrow_detail';
  const { timestamp, sign } = generateShopeeSign({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    apiPath,
    accessToken: token.access_token,
    shopId: cfg.shopId,
  });
  const qs = new URLSearchParams({
    order_sn: orderSn,
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    access_token: token.access_token,
    shop_id: String(cfg.shopId),
    sign,
  });
  const res = await fetchFn(`${cfg.baseUrl}${apiPath}?${qs.toString()}`, { method: 'GET' });
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`Shopee API lỗi: ${data.error} - ${data.message || ''}`);
  const inc = data.response?.order_income ?? {};
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // COGS: giá vốn từng dòng theo products.cost_price.
  const lines = await db
    .select({ quantity: orderItems.quantity, costPrice: products.costPrice })
    .from(orderItems)
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, ords[0].id));
  let cogs: number | null = 0;
  for (const l of lines) {
    if (l.costPrice === null || l.costPrice === undefined) {
      cogs = null;
      break;
    }
    (cogs as number) += l.quantity * Number(l.costPrice);
  }

  const out: EscrowBreakdown = {
    orderSn,
    buyerTotal: num(inc.buyer_total_amount),
    escrowAmount: num(inc.escrow_amount),
    commissionFee: num(inc.commission_fee),
    transactionFee: num(inc.seller_transaction_fee ?? inc.transaction_fee),
    serviceFee: num(inc.service_fee),
    sellerDiscount: num(inc.seller_discount) + num(inc.voucher_from_seller),
    shopeeDiscount: num(inc.shopee_discount) + num(inc.voucher_from_shopee),
    cogs,
    netProfit: cogs === null ? null : num(inc.escrow_amount) - (cogs as number),
  };
  await db
    .insert(shopeeOrderFinance)
    .values({
      orderSn,
      buyerTotal: out.buyerTotal,
      escrowAmount: out.escrowAmount,
      commissionFee: out.commissionFee,
      transactionFee: out.transactionFee,
      serviceFee: out.serviceFee,
      sellerDiscount: out.sellerDiscount,
      shopeeDiscount: out.shopeeDiscount,
      cogs: out.cogs,
      netProfit: out.netProfit,
    })
    .onConflictDoUpdate({
      target: shopeeOrderFinance.orderSn,
      set: {
        buyerTotal: out.buyerTotal,
        escrowAmount: out.escrowAmount,
        commissionFee: out.commissionFee,
        transactionFee: out.transactionFee,
        serviceFee: out.serviceFee,
        sellerDiscount: out.sellerDiscount,
        shopeeDiscount: out.shopeeDiscount,
        cogs: out.cogs,
        netProfit: out.netProfit,
      },
    });
  return out;
}
