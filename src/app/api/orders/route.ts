import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { extractUserRole, enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';
import { isValidManagerPin } from '@/lib/manager-pin';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Server-side Discount Hard-cap (chống thu ngân tự ý chiết khấu sâu).
// Trần thu ngân: 15%. Vượt trần bắt buộc có mã PIN quản lý phê duyệt.
// PIN xác thực bằng hash (manager-pin.ts + env MANAGER_PIN_HASHES).
// ---------------------------------------------------------------------------
const MAX_CASHIER_DISCOUNT_RATE = 0.15;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userRole = extractUserRole(req);
    const requestedScope = searchParams.get('fiscalScope') || 'ALL';
    // Bước 1: mặc định chỉ liệt kê đơn COMPLETED (giữ nguyên hành vi cũ);
    // màn hình "chờ xác nhận" truyền ?status=PENDING_CONFIRMATION hoặc ALL.
    const requestedStatus = searchParams.get('status') || 'COMPLETED';
    const requestedChannel = searchParams.get('channel') || undefined;
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
        status: requestedStatus as any,
        channel: requestedChannel,
      }),
      OrderService.getSalesSummary({
        fiscalScope: safeFiscalScope,
        warehouseId,
        startDate,
        endDate,
        cashierId: cashierFilter,
        channel: requestedChannel,
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
    const userRole = extractUserRole(req);
    const actorHeader = req.headers.get('x-formapubli-actor') || body.cashierId || userRole;

    // Bước 1: duyệt / hủy đơn PENDING (chỉ Manager/Owner, enforce trong service)
    if (body.action === 'CONFIRM' || body.action === 'CANCEL') {
      if (userRole === 'ROLE_TAX') {
        return NextResponse.json({ success: false, error: 'Kế toán thuế không được duyệt/hủy đơn.' }, { status: 403 });
      }
      const result = body.action === 'CONFIRM'
        ? await OrderService.confirmOrder(body.orderId, userRole, actorHeader)
        : await OrderService.cancelOrder(body.orderId, userRole, body.reason);
      recordAuditLog({
        action: body.action === 'CONFIRM' ? 'ORDER_CONFIRMED' : 'ORDER_CANCELLED',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/orders',
        details: `${body.action === 'CONFIRM' ? 'Duyệt' : 'Hủy'} đơn online ${body.orderId}${body.reason ? ` (lý do: ${body.reason})` : ''}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

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
      isGift,
      giftReason,
      confirmImmediately,
    } = body;

    if (!warehouseId || ((!items || !Array.isArray(items) || items.length === 0) && (!bundles || !Array.isArray(bundles) || bundles.length === 0))) {
      return NextResponse.json(
        { success: false, error: 'Thiếu kho xuất hàng (warehouseId) hoặc danh sách sản phẩm (items/bundles).' },
        { status: 400 }
      );
    }

    // userRole đã trích xuất ở đầu hàm (dùng chung cho CONFIRM/CANCEL).
    // SERVER-ENFORCE DISCOUNT HARD-CAP:
    // Chặn cả chiết khấu tổng đơn LẪN chiết khấu từng dòng (line item),
    // vì OrderService cho phép unitDiscountRate kế thừa discountRate tổng.
    // Dòng combo (bundles) do management định giá sẵn nên miễn trần này.
    const safeItems = Array.isArray(items) ? items : [];
    // FIX-01: strip unitCoverPrice client gửi — service tự tra giá bìa từ DB.
    const pricedItems = (safeItems as any[]).map((it) => ({
      editionId: it?.editionId,
      quantity: it?.quantity,
      unitDiscountRate: it?.unitDiscountRate,
    }));
    const parsedOrderDiscount =
      discountRate !== undefined && discountRate !== null && `${discountRate}` !== ''
        ? parseFloat(discountRate)
        : 0;
    // BV-03: quà tặng 100% chỉ ghi Sổ Nội bộ (doanh thu 0đ, vẫn trừ kho)
    const giftFlag = Boolean(isGift) || parsedOrderDiscount === 1;
    let safeFiscalScope = userRole === 'ROLE_TAX' ? 'OFFICIAL_TAX' : (fiscalScope || 'INTERNAL_MANAGEMENT');
    if (giftFlag) {
      const reason = `${giftReason ?? note ?? ''}`.trim();
      if (!reason) {
        return NextResponse.json(
          { success: false, error: 'Đơn Tặng sách bắt buộc ghi lý do (giftReason/note).' },
          { status: 400 }
        );
      }
      if (parsedOrderDiscount > 1) {
        return NextResponse.json(
          { success: false, error: 'Chiết khấu không được vượt quá 100%.' },
          { status: 400 }
        );
      }
      if (Array.isArray(bundles) && bundles.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Đơn Tặng sách chưa hỗ trợ combo đóng hộp.' },
          { status: 400 }
        );
      }
      safeFiscalScope = 'INTERNAL_MANAGEMENT';
    }
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
      if (!isValidManagerPin(providedPin)) {
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
      discountRate: giftFlag ? 1 : (discountRate !== undefined ? parseFloat(discountRate) : 0),
      paymentMethod: paymentMethod || 'CASH',
      fiscalScope: safeFiscalScope,
      vatRate: vatRate !== undefined ? parseFloat(vatRate) : 0,
      vatInvoiceRequired: giftFlag ? false : Boolean(vatInvoiceRequired),
      vatInvoiceCode: giftFlag ? undefined : vatInvoiceCode,
      cashierId: cashierId || 'Thu ngân quầy',
      cashboxSessionId,
      note,
      // Bước 1: web/social truyền confirmImmediately:false → đơn PENDING giữ chỗ ATP
      confirmImmediately: confirmImmediately !== undefined ? Boolean(confirmImmediately) : true,
      isOfflineSync: isLegitOfflineSync,
      allowOverdraft: safeAllowOverdraft,
      isGift: giftFlag,
      giftReason: giftFlag ? `${giftReason ?? note ?? ''}`.trim() : undefined,
      items: giftFlag
        ? pricedItems.map((it: any) => ({ ...it, unitDiscountRate: 1 }))
        : pricedItems,
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

    // BV-03: vết kiểm toán riêng cho đơn quà tặng (doanh thu 0đ, vẫn trừ kho).
    // Tái dùng MANAGER_DISCOUNT_APPROVED để không phình enum audit (giữ nguyên rbac-guard).
    if (giftFlag) {
      recordAuditLog({
        action: 'MANAGER_DISCOUNT_APPROVED',
        actorRole: userRole,
        actorId: cashierId || userRole,
        resource: '/api/orders',
        details: `Duyệt đơn Tặng 100% (GIFT) ${result.orderCode} (lý do: ${`${giftReason ?? note ?? ''}`.trim()}, kho: ${warehouseId}).`,
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
