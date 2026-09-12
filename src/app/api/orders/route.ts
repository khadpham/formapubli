import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { extractUserRole, enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Server-side Discount Hard-cap (chống thu ngân tự ý chiết khấu sâu).
// Trần thu ngân: 15%. Vượt trần bắt buộc có mã PIN quản lý phê duyệt.
// Lưu ý: PIN hardcode tạm thời để vá lỗ hổng khẩn cấp.
// Backlog: chuyển vào biến môi trường / bảng User Settings kèm hash bcrypt.
// ---------------------------------------------------------------------------
const MAX_CASHIER_DISCOUNT_RATE = 0.15;
const VALID_MANAGER_PINS = ['9999', '1234', '8888'];

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
      bundles,
      isOfflineSync,
      allowOverdraft,
      managerPin,
      managerApprovalCode,
    } = body;

    if (!warehouseId || ((!items || !Array.isArray(items) || items.length === 0) && (!bundles || !Array.isArray(bundles) || bundles.length === 0))) {
      return NextResponse.json(
        { success: false, error: 'Thiếu kho xuất hàng (warehouseId) hoặc danh sách sản phẩm (items/bundles).' },
        { status: 400 }
      );
    }

    const userRole = extractUserRole(req);
    const safeFiscalScope = userRole === 'ROLE_TAX' ? 'OFFICIAL_TAX' : (fiscalScope || 'INTERNAL_MANAGEMENT');

    // SERVER-ENFORCE DISCOUNT HARD-CAP:
    // Chặn cả chiết khấu tổng đơn LẪN chiết khấu từng dòng (line item),
    // vì OrderService cho phép unitDiscountRate kế thừa discountRate tổng.
    // Dòng combo (bundles) do management định giá sẵn nên miễn trần này.
    const safeItems = Array.isArray(items) ? items : [];
    const parsedOrderDiscount =
      discountRate !== undefined && discountRate !== null && `${discountRate}` !== ''
        ? parseFloat(discountRate)
        : 0;
    const effectiveItemDiscounts = (safeItems as any[]).map((it) => {
      const v = it?.unitDiscountRate;
      const parsed =
        v !== undefined && v !== null && `${v}` !== '' ? parseFloat(v) : parsedOrderDiscount;
      return Number.isFinite(parsed) ? parsed : 0;
    });
    const maxDiscountRate = Math.max(
      Number.isFinite(parsedOrderDiscount) ? parsedOrderDiscount : 0,
      ...effectiveItemDiscounts
    );
    const exceedsHardCap = maxDiscountRate > MAX_CASHIER_DISCOUNT_RATE;
    const isPrivilegedRole = userRole === 'ROLE_OWNER' || userRole === 'ROLE_MANAGER';

    if (exceedsHardCap && !isPrivilegedRole) {
      const providedPin = `${managerPin ?? managerApprovalCode ?? ''}`;
      if (!VALID_MANAGER_PINS.includes(providedPin)) {
        recordAuditLog({
          action: 'MANAGER_DISCOUNT_DENIED',
          actorRole: userRole,
          actorId: cashierId || userRole,
          resource: '/api/orders',
          details: `Từ chối đơn chiết khấu vượt trần ${Math.round(maxDiscountRate * 100)}% (cashier: ${cashierId || userRole}, thiếu PIN quản lý hợp lệ).`,
        });
        return NextResponse.json(
          { success: false, error: 'Vượt trần chiết khấu 15%. Yêu cầu mã PIN Quản lý!' },
          { status: 403 }
        );
      }
    }

    // BẢO VỆ PHÂN QUYỀN OVERDRAFT:
    // Chỉ Quản lý/Chủ (ROLE_MANAGER, ROLE_OWNER) mới được phép gửi allowOverdraft = true.
    // Nếu là thu ngân (ROLE_CASHIER) hoặc vai trò khác, chỉ cho phép allowOverdraft khi đây là đơn sync ngoại tuyến (isOfflineSync = true).
    const isLegitOfflineSync = Boolean(isOfflineSync);
    const safeAllowOverdraft = isPrivilegedRole ? Boolean(allowOverdraft) : (isLegitOfflineSync && Boolean(allowOverdraft));

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
      items: safeItems,
      bundles: Array.isArray(bundles)
        ? bundles.map((b: any) => ({ bundleId: b.bundleId, quantity: parseInt(b.quantity ?? 0, 10) }))
        : undefined,
    });

    recordAuditLog({
      action: 'MUTATE_ORDER',
      actorRole: userRole,
      actorId: cashierId || userRole,
      resource: '/api/orders',
      details: `Tạo đơn hàng ${result.orderCode} (${safeFiscalScope}) - Thực thu: ${result.finalAmount}`,
    });

    // Ghi vết phê duyệt chiết khấu vượt trần (tuyệt đối không lưu mã PIN).
    if (exceedsHardCap) {
      recordAuditLog({
        action: 'MANAGER_DISCOUNT_APPROVED',
        actorRole: userRole,
        actorId: cashierId || userRole,
        resource: '/api/orders',
        details: `Duyệt chiết khấu vượt trần ${Math.round(maxDiscountRate * 100)}% cho đơn ${result.orderCode} (cashier: ${cashierId || userRole}, phê duyệt bởi: ${userRole}).`,
      });
    }

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
