import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fiscalScope = (searchParams.get('fiscalScope') as any) || 'ALL';
    const warehouseId = searchParams.get('warehouseId') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const [orderList, summary] = await Promise.all([
      OrderService.getOrders({ fiscalScope, warehouseId, startDate, endDate }),
      OrderService.getSalesSummary({ fiscalScope, warehouseId, startDate, endDate }),
    ]);

    return NextResponse.json({
      success: true,
      orders: orderList,
      summary,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi truy vấn đơn hàng' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      id,
      orderCode,
      createdAt,
      idempotencyKey,
      warehouseId,
      channel,
      partnerId,
      customerId,
      customerName,
      discountRate,
      paymentMethod,
      fiscalScope,
      vatRate,
      vatInvoiceRequired,
      vatInvoiceCode,
      cashierId,
      note,
      items,
    } = body;

    if (!warehouseId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Thiếu kho xuất hàng (warehouseId) hoặc danh sách sản phẩm (items).' },
        { status: 400 }
      );
    }

    const result = await OrderService.createOrder({
      id,
      orderCode,
      createdAt,
      idempotencyKey,
      warehouseId,
      channel,
      partnerId,
      customerId,
      customerName,
      discountRate: discountRate !== undefined ? parseFloat(discountRate) : 0,
      paymentMethod: paymentMethod || 'CASH',
      fiscalScope: fiscalScope || 'INTERNAL_MANAGEMENT',
      vatRate: vatRate !== undefined ? parseFloat(vatRate) : 0,
      vatInvoiceRequired: Boolean(vatInvoiceRequired),
      vatInvoiceCode,
      cashierId: cashierId || 'Thu ngân quầy',
      note,
      items,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi tạo đơn hàng bán sách' },
      { status: 400 }
    );
  }
}
