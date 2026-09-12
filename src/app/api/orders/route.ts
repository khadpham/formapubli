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
    const actorHeader = req.headers.get('x-formapubli-actor') || userRole;

    // SIẾT CHẶT THỦ KHO & THU NGÂN:
    // Thu ngân chỉ được xem các đơn do chính mình tạo (ca của mình).
    // Thủ kho không được xem dữ liệu doanh thu đơn hàng (trả về danh sách rỗng).
    let cashierFilter: string | undefined = undefined;
    if (userRole === 'ROLE_CASHIER') {
      cashierFilter = actorHeader;
    } else if (userRole === 'ROLE_WAREHOUSE') {
      return NextResponse.json({
        success: true,
        role: userRole,
        fiscalScope: safeFiscalScope,
        orders: [],
        summary: null,
        message: 'Thủ kho chỉ có quyền quản lý tồn kho vật lý, không có quyền truy cập doanh số bán hàng.',
      });
    }

    // Ghi vết nhật ký nếu truy cập dữ liệu nội bộ
    if (safeFiscalScope !== 'OFFICIAL_TAX') {
      recordAuditLog({
        action: 'VIEW_FISCAL_MANAGEMENT',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/orders',
        details: `Truy vấn dữ liệu doanh thu phạm vi: ${safeFiscalScope}`,
      });
    }

    const [orderList, summary] = await Promise.all([
      OrderService.getOrders({
        fiscalScope: safeFiscalScope,
        warehouseId,
        startDate,
        endDate,
        cashierId: cashierFilter,
      }),
      OrderService.getSalesSummary({
        fiscalScope: safeFiscalScope,
        warehouseId,
        startDate,
        endDate,
        cashierId: cashierFilter,
      }),
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
      cashboxSessionId,
      note,
      items,
      isOfflineSync,
      allowOverdraft,
    } = body;

    if (!warehouseId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Thiếu kho xuất hàng (warehouseId) hoặc danh sách sản phẩm (items).' },
        { status: 400 }
      );
    }

    const userRole = extractUserRole(req);
    const safeFiscalScope = userRole === 'ROLE_TAX' ? 'OFFICIAL_TAX' : (fiscalScope || 'INTERNAL_MANAGEMENT');

    // BẢO VỆ PHÂN QUYỀN OVERDRAFT:
    // Chỉ Quản lý/Chủ (ROLE_MANAGER, ROLE_OWNER) mới được phép gửi allowOverdraft = true.
    // Nếu là thu ngân (ROLE_CASHIER) hoặc vai trò khác, chỉ cho phép allowOverdraft khi đây là đơn sync ngoại tuyến (isOfflineSync = true).
    const isManagerOrOwner = userRole === 'ROLE_OWNER' || userRole === 'ROLE_MANAGER';
    const isLegitOfflineSync = Boolean(isOfflineSync);
    const safeAllowOverdraft = isManagerOrOwner ? Boolean(allowOverdraft) : (isLegitOfflineSync && Boolean(allowOverdraft));

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
      cashboxSessionId,
      note,
      isOfflineSync: isLegitOfflineSync,
      allowOverdraft: safeAllowOverdraft,
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
