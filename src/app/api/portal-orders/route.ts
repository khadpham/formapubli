import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { db, customers } from '@/db';
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
 * 2. Tạo order với channel=ONLINE, status=PENDING_CONFIRMATION (giữ chỗ ATP).
 * 3. Trả về orderId để portal theo dõi.
 *
 * Body:
 * {
 *   madon: string,           // Mã đơn portal (dùng làm idempotency key)
 *   email: string,
 *   name: string,
 *   phone: string,
 *   address: string,
 *   items: [{ portalProductId: string, qty: number }],
 *   paymentMethod: 'COD' | 'BANK_TRANSFER',
 *   shippingFee: number,
 *   hasGift: boolean
 * }
 */

// Map portal product ID → formapubli edition ID.
// Cấu hình qua env PORTAL_PRODUCT_MAP (JSON): {"nu-cong-tuoc-de-langeais":"edition-id",...}
// Để nhân viên tự cập nhật khi thêm sách mới mà không cần sửa code.
function getProductMap(): Record<string, string> {
  try {
    return JSON.parse(process.env.PORTAL_PRODUCT_MAP || '{}');
  } catch {
    return {};
  }
}

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export async function POST(req: NextRequest) {
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

    // 1. Map sản phẩm portal → edition
    const productMap = getProductMap();
    const orderItems: Array<{ editionId: string; quantity: number; isGiftLine?: boolean }> = [];
    for (const it of items) {
      const editionId = productMap[it.portalProductId];
      if (!editionId) {
        return NextResponse.json(
          { success: false, error: `Chưa map sản phẩm portal: ${it.portalProductId}` },
          { status: 400 },
        );
      }
      const qty = Math.floor(Number(it.qty));
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
        return NextResponse.json(
          { success: false, error: `Số lượng không hợp lệ: ${it.portalProductId}` },
          { status: 400 },
        );
      }
      orderItems.push({ editionId, quantity: qty });
    }
    // Quà tri ân: dòng quà 0đ
    if (hasGift) {
      // TODO: xác định editionId của quà tặng (hoặc dùng isGiftLine với editionId null nếu hỗ trợ)
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
    const warehouseId = process.env.PORTAL_WAREHOUSE_ID;
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
    });

    const ord = order as unknown as { id: string; orderCode: string };
    return NextResponse.json({
      success: true,
      data: {
        orderId: ord.id,
        orderCode: ord.orderCode,
        status: 'PENDING_CONFIRMATION',
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
