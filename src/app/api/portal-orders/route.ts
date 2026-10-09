import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { db, customers, editions, portalSettings, orders } from '@/db';
import { eq } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * POST /api/portal-orders — Nhận đơn từ Customer Order Portal.
 *
 * Xác thực: Bearer token trong header Authorization (env PORTAL_API_KEY).
 *
 * Luồng:
 * 1. Tìm hoặc tạo customer theo email.
 * 2. Tra edition theo SKU code (H82, H83...).
 * 3. Tạo order với channel=ONLINE, status=PENDING_CONFIRMATION (giữ chỗ ATP).
 * 4. Trả về orderId để portal theo dõi.
 *
 * Body:
 * {
 *   madon: string,           // Mã đơn portal (dùng làm idempotency key)
 *   email: string,
 *   name: string,
 *   phone: string,
 *   address: string,
 *   items: [{ sku: "H82", qty: 2 }],  // SKU code từ bảng editions
 *   paymentMethod: 'COD' | 'BANK_TRANSFER',
 *   shippingFee: number,
 *   hasGift: boolean
 * }
 */

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  let madonForLog = '';
  try {
    const apiKey = process.env.PORTAL_API_KEY;
    if (!apiKey) {
      console.error('[portal-orders] PORTAL_API_KEY chưa cấu hình');
      return NextResponse.json(
        { success: false, error: 'Tích hợp portal chưa được cấu hình.' },
        { status: 500 },
      );
    }
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${apiKey}`) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const { madon, email, name, phone, address, items, paymentMethod, shippingFee, hasGift } = body;
    madonForLog = `${madon || ''}`.slice(0, 32);
    // Nhật ký chẩn đoán (không log key/PIN/SĐT): soi live bằng `wrangler tail`
    // khi khách đặt test mà đơn không về.
    console.log(
      `[portal-orders] POST madon=${`${madon || ''}`.slice(0, 32)} items=${Array.isArray(items) ? items.length : 0} payment=${`${paymentMethod || ''}`.slice(0, 16)} gift=${!!hasGift}`
    );

    if (!madon || !email || !name || !items?.length) {
      return NextResponse.json(
        { success: false, error: 'Thiếu thông tin đơn hàng (madon, email, name, items).' },
        { status: 400 },
      );
    }
    if (paymentMethod !== 'COD' && paymentMethod !== 'BANK_TRANSFER') {
      return NextResponse.json(
        { success: false, error: 'paymentMethod phải là COD hoặc BANK_TRANSFER.' },
        { status: 400 },
      );
    }

    // 1. Tra edition theo SKU code (H82, H83...)
    // Map portal product ID → SKU code (cố định, không cần cấu hình)
    const PORTAL_SKU_MAP: Record<string, string> = {
      'nu-cong-tuoc-de-langeais': 'H82',
      'mot-vu-viec-am-muoi': 'H83',
      'nicholas-nickleby': 'H84',
      'la-do-ngan-2': 'H86',
      'cach-ton-tai-rieng': 'H87',
      'ngan-1-in-lan-2': 'H88',
    };
    const orderItems: Array<{ editionId: string; quantity: number; isGiftLine?: boolean }> = [];
    for (const it of items) {
      const sku = PORTAL_SKU_MAP[it.portalProductId] || it.sku;
      if (!sku) {
        // Dòng quà trong giỏ portal (đã có hasGift thêm SP-004 riêng) thiếu SKU
        // thì BỎ QUA, không giết cả đơn. Dòng mua thiếu SKU vẫn 400 để không
        // mất tiền oan.
        if (it.isGift || hasGift) {
          console.warn(
            `[portal-orders] bỏ dòng quà thiếu SKU madon=${`${madon || ''}`.slice(0, 32)} item=${`${it.portalProductId || ''}`.slice(0, 48)}`
          );
          continue;
        }
        console.warn(
          `[portal-orders] 400 thiếu SKU madon=${`${madon || ''}`.slice(0, 32)} item=${`${it.portalProductId || ''}`.slice(0, 48)}`
        );
        return NextResponse.json(
          { success: false, error: `Thiếu SKU cho sản phẩm: ${it.portalProductId}` },
          { status: 400 },
        );
      }
      const edition = (
        await db.select({ id: editions.id }).from(editions).where(eq(editions.code, sku)).limit(1)
      )[0];
      if (!edition) {
        console.warn(
          `[portal-orders] 400 không thấy ấn bản madon=${`${madon || ''}`.slice(0, 32)} sku=${`${sku}`.slice(0, 16)}`
        );
        return NextResponse.json(
          { success: false, error: `Không tìm thấy ấn bản với mã: ${sku}` },
          { status: 400 },
        );
      }
      const qty = Math.floor(Number(it.qty));
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
        console.warn(
          `[portal-orders] 400 số lượng sai madon=${`${madon || ''}`.slice(0, 32)} sku=${`${sku}`.slice(0, 16)}`
        );
        return NextResponse.json(
          { success: false, error: `Số lượng không hợp lệ: ${sku}` },
          { status: 400 },
        );
      }
      orderItems.push({ editionId: edition.id, quantity: qty });
    }
    // Quà tri ân: túi tote SP-004 (hàng hóa, KHÔNG phải ấn bản) — tra products
    // trực tiếp. Bản deploy cũ chỉ tra editions ⇒ giftId null ⇒ dòng quà mất.
    let giftId: string | null = null;
    if (hasGift) {
      const { products } = await import('@/db');
      const giftProduct = (
        await db.select({ id: products.id }).from(products).where(eq(products.code, 'SP-004')).limit(1)
      )[0];
      giftId = giftProduct?.id || null;
      if (!giftId) {
        console.warn('[portal-orders] Không tìm thấy SP-004 trong products, bỏ quà.');
      }
    }
    if (giftId) {
      // Route đã tự xác minh SP-004 → server tin (trustedGiftIds), không cần
      // chương trình khuyến mại. Dòng quà 0đ, không tính doanh thu.
      orderItems.push({ editionId: giftId, quantity: 1, isGiftLine: true });
    }

    // 2. Tìm hoặc tạo customer
    const normalizedEmail = String(email).trim().toLowerCase();
    let customer = (
      await db.select().from(customers).where(eq(customers.email, normalizedEmail)).limit(1)
    )[0];
    if (!customer) {
      const code = `CUST-P${Date.now().toString(36).toUpperCase()}`;
      const inserted = await db
        .insert(customers)
        .values({
          id: `cust-portal-${Date.now()}`,
          code,
          fullName: String(name).trim(),
          email: normalizedEmail,
          phone: String(phone || '').trim(),
          addressDetail: String(address || '').trim(),
          segment: 'RETAIL',
          channel: 'DIRECT',
        })
        .returning();
      customer = inserted[0];
    }

    // 3. Tạo order PENDING (giữ chỗ ATP, chưa trừ kho, chưa ghi doanh thu)
    // Ưu tiên: warehouseId từ body > DB portal_settings > env PORTAL_WAREHOUSE_ID
    let warehouseId = (body as any).warehouseId as string | undefined;
    if (!warehouseId) {
      const setting = (
        await db
          .select({ value: portalSettings.value })
          .from(portalSettings)
          .where(eq(portalSettings.key, 'PORTAL_WAREHOUSE_ID'))
          .limit(1)
      )[0];
      warehouseId = setting?.value || process.env.PORTAL_WAREHOUSE_ID;
    }
    if (!warehouseId) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình kho cho đơn portal (PORTAL_WAREHOUSE_ID).' },
        { status: 500 },
      );
    }

    const order = await OrderService.createOrder({
      warehouseId,
      channel: 'ONLINE',
      customerId: customer.id,
      customerName: customer.fullName,
      paymentMethod: paymentMethod as 'COD' | 'BANK_TRANSFER',
      confirmImmediately: false, // PENDING_CONFIRMATION
      idempotencyKey: `portal-${madon}`,
      note: `Đơn từ Customer Portal. Mã portal: ${madon}. SĐT: ${phone}. Địa chỉ: ${address}. Phí ship: ${shippingFee || 0}đ.`,
      items: orderItems,
      // Quà SP-004 do route tự xác minh — server tin mà không cần promotion.
      ...(giftId ? { trustedGiftIds: new Set([giftId]) } : {}),
    });

    // 0055: lưu mã portal để khách tra đơn bằng mã của họ (datmua).
    await db
      .update(orders)
      .set({ portalRef: madon })
      .where(eq(orders.id, (order as any).id));

    const ord = order as unknown as { id: string; orderCode: string };
    console.log(
      `[portal-orders] OK madon=${`${madon || ''}`.slice(0, 32)} order=${ord.orderCode} lines=${orderItems.length}`
    );
    return NextResponse.json({
      success: true,
      data: {
        orderId: ord.id,
        orderCode: ord.orderCode,
        status: 'PENDING_CONFIRMATION',
      },
    });
  } catch (e) {
    console.error(`[portal-orders] 500 madon=${madonForLog} ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
