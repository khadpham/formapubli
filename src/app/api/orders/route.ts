import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { extractUserRole, enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userRole = extractUserRole(req);
    const requestedScope = searchParams.get('fiscalScope') || 'ALL';
    // Server-side Scope Guard: Ép lọc theo vai trò người dùng
    const safeFiscalScope = enforceFiscalScope(userRole, requestedScope);
    const warehouseId = searchParams.get('warehouseId') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    // Ghi vết nhật ký nếu truy cập dữ liệu nội bộ
    if (safeFiscalScope !== 'OFFICIAL_TAX') {
      recordAuditLog({
        action: 'VIEW_FISCAL_MANAGEMENT',
        actorRole: userRole,
        actorId: req.headers.get('x-formapubli-actor') || userRole,
        resource: '/api/orders',
        details: `Truy vấn dữ liệu doanh thu phạm vi: ${safeFiscalScope}`,
      });
    }

    const [orderList, summary] = await Promise.all([
      OrderService.getOrders({ fiscalScope: safeFiscalScope, warehouseId, startDate, endDate }),
      OrderService.getSalesSummary({ fiscalScope: safeFiscalScope, warehouseId, startDate, endDate }),
    ]);

    return NextResponse.json({
      success: true,
      role: userRole,
      fiscalScope: safeFiscalScope,
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

    const userRole = extractUserRole(req);
    const safeFiscalScope = userRole === 'ROLE_TAX' ? 'OFFICIAL_TAX' : (fiscalScope || 'INTERNAL_MANAGEMENT');

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
      fiscalScope: safeFiscalScope,
      vatRate: vatRate !== undefined ? parseFloat(vatRate) : 0,
      vatInvoiceRequired: Boolean(vatInvoiceRequired),
      vatInvoiceCode,
      cashierId: cashierId || 'Thu ngân quầy',
      note,
      items,
    });

    recordAuditLog({
      action: 'MUTATE_ORDER',
      actorRole: userRole,
      actorId: cashierId || userRole,
      resource: '/api/orders',
      details: `Tạo đơn hàng ${result.orderCode} (${safeFiscalScope}) - Thực thu: ${result.finalAmount}`,
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
