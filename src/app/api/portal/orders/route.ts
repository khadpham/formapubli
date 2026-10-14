import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { portalProducts, orders, orderItems, customers, promotions, promotionGifts, products } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { randomUUID } from 'crypto';
import { isPosOrderCode } from '@/services/order-code';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

/**
 * POST /api/portal/orders - Tao don hang tu portal moi.
 *
 * Body:
 * {
 *   orderCode: "ORD2610140001",  // tu POST /api/orders/reserve-code
 *   customerId: "uuid",
 *   items: [{ productId: "uuid", quantity: 2 }],
 *   paymentMethod: "COD" | "TRANSFER",
 *   shippingAddress: { province, district, ward, detail },
 *   notes?: string,
 *   receiptImageUrl?: string  // bat buoc neu TRANSFER
 * }
 */
export async function POST(req: NextRequest) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const orderCode = String(body?.orderCode || '').trim();
    const customerId = String(body?.customerId || '').trim();
    const items = body?.items || [];
    const paymentMethod = String(body?.paymentMethod || '').trim();
    const shippingAddress = body?.shippingAddress || {};
    const notes = String(body?.notes || '').trim();
    const receiptImageUrl = String(body?.receiptImageUrl || '').trim();

    // Validate orderCode
    if (!orderCode || !isPosOrderCode(orderCode)) {
      return NextResponse.json(
        { error: 'Mã đơn không hợp lệ. Vui lòng lấy mã mới từ reserve-code.' },
        { status: 400 }
      );
    }
    // Kiem tra ma chua duoc dung
    const existingOrder = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderCode, orderCode))
      .limit(1);
    if (existingOrder[0]) {
      return NextResponse.json(
        { error: 'Mã đơn đã được sử dụng. Vui lòng lấy mã mới.' },
        { status: 400 }
      );
    }

    // Validate customer
    if (!customerId) {
      return NextResponse.json(
        { error: 'Thiếu thông tin khách hàng.' },
        { status: 400 }
      );
    }
    const customerRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    const customer = customerRows[0];
    if (!customer) {
      return NextResponse.json(
        { error: 'Không tìm thấy khách hàng.' },
        { status: 400 }
      );
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Giỏ hàng trống.' },
        { status: 400 }
      );
    }
    if (!['COD', 'TRANSFER'].includes(paymentMethod)) {
      return NextResponse.json(
        { error: 'Phương thức thanh toán không hợp lệ.' },
        { status: 400 }
      );
    }
    if (paymentMethod === 'TRANSFER' && !receiptImageUrl) {
      return NextResponse.json(
        { error: 'Vui lòng tải lên ảnh biên lai chuyển khoản.' },
        { status: 400 }
      );
    }

    // Lay thong tin san pham va tinh tien
    const productIds = items.map((i: any) => String(i.productId));
    const productRows = await db
      .select()
      .from(portalProducts)
      .where(inArray(portalProducts.id, productIds));

    const productMap = new Map(productRows.map((p) => [p.id, p]));

    let subtotal = 0;
    const orderItemData: Array<{
      portalProduct: typeof productRows[0];
      quantity: number;
      unitPrice: number;
    }> = [];

    for (const item of items) {
      const pid = String(item.productId);
      const qty = parseInt(String(item.quantity), 10);
      if (!qty || qty < 1) {
        return NextResponse.json(
          { error: 'Số lượng sản phẩm không hợp lệ.' },
          { status: 400 }
        );
      }
      const pp = productMap.get(pid);
      if (!pp || !pp.isVisible) {
        return NextResponse.json(
          { error: `Sản phẩm không tồn tại hoặc đã ẩn.` },
          { status: 400 }
        );
      }
      if (pp.productType === 'GIFT') {
        return NextResponse.json(
          { error: 'Quà tặng không thể mua trực tiếp.' },
          { status: 400 }
        );
      }
      // TODO: kiem tra ton kho tu inventory_ledger
      const unitPrice = pp.salePrice != null && pp.salePrice < pp.coverPrice
        ? pp.salePrice
        : pp.coverPrice;
      subtotal += unitPrice * qty;
      orderItemData.push({ portalProduct: pp, quantity: qty, unitPrice });
    }

    // Ap dung khuyen mai (qua tang theo moc)
    const now = new Date().toISOString();
    const activePromos = await db
      .select({ id: promotions.id })
      .from(promotions)
      .where(eq(promotions.isActive, true))
      .limit(10);

    const gifts: Array<{ productName: string; quantity: number }> = [];
    for (const promo of activePromos) {
      const giftRows = await db
        .select({
          minSubtotal: promotionGifts.minSubtotal,
          giftQuantity: promotionGifts.giftQuantity,
          giftName: products.name,
        })
        .from(promotionGifts)
        .innerJoin(products, eq(promotionGifts.productId, products.id))
        .where(eq(promotionGifts.promotionId, promo.id));

      // Tim moc cao nhat dat duoc
      let bestTier = null;
      for (const g of giftRows) {
        if (subtotal >= (g.minSubtotal || 0)) {
          if (!bestTier || (g.minSubtotal || 0) > (bestTier.minSubtotal || 0)) {
            bestTier = g;
          }
        }
      }
      if (bestTier) {
        gifts.push({
          productName: bestTier.giftName || 'Quà tặng',
          quantity: bestTier.giftQuantity || 1,
        });
      }
    }

    // Tao don hang
    const orderId = randomUUID();
    const idempotencyKey = `portal-${orderCode}`;

    // Lay warehouse mac dinh tu portal_settings
    const warehouseId = 'PHYSICAL_MAIN'; // TODO: doc tu portal_settings

    await db.insert(orders).values({
      id: orderId,
      orderCode,
      warehouseId,
      channel: 'ONLINE',
      customerId: customer.id,
      customerName: customer.fullName,
      subtotal,
      discountRate: 0,
      discountAmount: 0,
      finalAmount: subtotal,
      paymentMethod: paymentMethod === 'COD' ? 'CASH' : 'BANK_TRANSFER',
      fiscalScope: 'INTERNAL_MANAGEMENT', // Don portal mac dinh noi bo, ke toan xu ly sau
      status: 'PENDING_CONFIRMATION',
      syncStatus: 'SYNCED',
      cashierId: 'portal-system',
      idempotencyKey,
      note: [
        notes,
        `Dia chi giao: ${shippingAddress.detail || ''}, ${shippingAddress.ward || ''}, ${shippingAddress.district || ''}, ${shippingAddress.province || ''}`.trim(),
        paymentMethod === 'TRANSFER' ? `Bien lai: ${receiptImageUrl}` : '',
        gifts.length > 0 ? `Qua tang: ${gifts.map((g) => `${g.quantity}x ${g.productName}`).join(', ')}` : '',
      ].filter(Boolean).join(' | '),
    });

    // Tao order items
    for (const od of orderItemData) {
      const erpProductId = od.portalProduct.erpProductId;
      if (!erpProductId) continue;
      await db.insert(orderItems).values({
        id: randomUUID(),
        orderId,
        productId: erpProductId,
        quantity: od.quantity,
        unitCoverPrice: od.portalProduct.coverPrice,
        unitSellingPrice: od.unitPrice,
        totalAmount: od.unitPrice * od.quantity,
      });
    }

    // TODO: Day nhap hoa don dien tu (giai doan tiep theo)
    // TODO: Tru kho / giu cho ATP (giai doan tiep theo)

    return NextResponse.json({
      ok: true,
      orderCode,
      totalAmount: subtotal,
      discountAmount: 0,
      gifts,
      message: 'Đặt hàng thành công.',
    });
  } catch (e) {
    console.error(`[portal/orders] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
