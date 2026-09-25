import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';
import { verifyManagerPinRateLimited } from '@/lib/manager-pin';
import { requireSessionRole, extractClientIp } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DiscountApprovalService } from '@/services/discount-approval.service';
import { db, orders, warehouses } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Server-side Discount Hard-cap (chống thu ngân tự ý chiết khấu sâu).
// Trần thu ngân: 20%. Vượt trần bắt buộc có mã PIN quản lý phê duyệt.
// PIN xác thực bằng hash (manager-pin.ts + env MANAGER_PIN_HASHES).
// ---------------------------------------------------------------------------
const MAX_CASHIER_DISCOUNT_RATE = 0.2;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ALLOWED_VIEW_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];
    // P1b: Default-Deny — bắt buộc session cookie hợp lệ, không fallback header.
    const session = await requireSessionRole(req, ALLOWED_VIEW_ROLES);
    const userRole = session.role as UserRole;
    const actorHeader = session.actorId;

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
      await recordAuditLog({
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
    return handleApiError(error);
  }
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ALLOWED_POST_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER'];
    // P1b: Default-Deny — danh tính lấy từ session (chống mạo danh cashierId,
    // PHASE0_CONTRACT §1: cashierId client gửi không còn được dùng làm actor).
    const session = await requireSessionRole(req, ALLOWED_POST_ROLES);
    const userRole = session.role as UserRole;
    const actorHeader = session.actorId;
    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
      sessionId: session.sessionId,
    };

    // Bước 1: duyệt / hủy đơn PENDING (chỉ Manager/Owner, enforce kép route + service)
    if (body.action === 'CONFIRM' || body.action === 'CANCEL') {
      if (userRole === 'ROLE_TAX') {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Kế toán thuế không được duyệt/hủy đơn.' }, { status: 403 });
      }
      if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Chỉ Manager/Owner được duyệt/hủy đơn PENDING.' }, { status: 403 });
      }
      const result = body.action === 'CONFIRM'
        ? await OrderService.confirmOrder(body.orderId, userRole, actorHeader)
        : await OrderService.cancelOrder(body.orderId, userRole, body.reason);
      await recordAuditLog({
        action: body.action === 'CONFIRM' ? 'ORDER_CONFIRMED' : 'ORDER_CANCELLED',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/orders',
        details: `${body.action === 'CONFIRM' ? 'Duyệt' : 'Hủy'} đơn online ${body.orderId}${body.reason ? ` (lý do: ${body.reason})` : ''}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    // 1.2: dọn đơn PENDING quá TTL 48h (Manager/Owner) — nút trên màn Pending
    if (body.action === 'CLEANUP') {
      if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Chỉ Manager/Owner được dọn đơn hết hạn.' }, { status: 403 });
      }
      const cleaned = await OrderService.cleanupExpiredPending();
      await recordAuditLog({
        action: 'ORDER_CANCELLED', actorRole: userRole, actorId: actorHeader,
        resource: '/api/orders', details: `Dọn ${cleaned} đơn PENDING quá hạn giữ chỗ.`,
      });
      return NextResponse.json({ success: true, data: { cleaned } });
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
      discountApprovalId,
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

    // Ràng buộc gán kho: nhân viên được quản lý gán kho chỉ được bán ĐÚNG kho đó.
    // Đây là chốt chặn ở SERVER — client có sửa payload cũng không lách được.
    if (session.assignedWarehouseId && `${session.assignedWarehouseId}` !== `${warehouseId}`) {
      const whName = await db
        .select({ name: warehouses.name })
        .from(warehouses)
        .where(eq(warehouses.id, session.assignedWarehouseId as string))
        .limit(1);
      return NextResponse.json(
        {
          success: false,
          code: 'FORBIDDEN',
          error: `Bạn được phân công phụ trách kho [${whName[0]?.name || session.assignedWarehouseId}]. Không thể xuất hàng từ kho khác; liên hệ quản lý nếu cần đổi kho.`,
        },
        { status: 403 }
      );
    }

    // P1b: replay mất response — đơn đã ghi với key này thì đi thẳng tới
    // createOrder (B0 trả đơn cũ / ném IDEMPOTENCY_CONFLICT nếu payload khác),
    // BỎ QUA verify approval (approval đã CONSUMED bởi lần ghi đầu nên verify
    // lại sẽ 403 oan). Không có key hoặc chưa có đơn → luồng verify thường.
    let isReplay = false;
    const replayKey = `${idempotencyKey || ''}`.trim();
    if (replayKey) {
      const existing = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.idempotencyKey, replayKey))
        .limit(1);
      isReplay = existing.length > 0;
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
    const exceedsHardCap = maxDiscountRate >= MAX_CASHIER_DISCOUNT_RATE;
    const isPrivilegedRole = userRole === 'ROLE_OWNER' || userRole === 'ROLE_MANAGER';

    // A1-H: ID phê duyệt đã verify (khớp giỏ/mức/kho/người) để createOrder
    // tiêu thụ nguyên tử trong transaction. Khai báo ngoài để dùng ở dưới.
    // P1b: replay (đơn đã tồn tại với key) bỏ qua verify — approval đã bị
    // consume bởi lần ghi đầu, verify lại sẽ 403 oan; createOrder tự trả đơn
    // cũ hoặc ném IDEMPOTENCY_CONFLICT nếu payload khác.
    let verifiedApprovalId: string | undefined;
    if (!isReplay && exceedsHardCap && !isPrivilegedRole) {
      // A1-H: verify đầy đủ khớp giỏ/mức/kho/người TRƯỚC khi tạo đơn.
      // - Phê duyệt cũ/hết hiệu lực (INVALID): rẽ sang PIN quản lý như hành vi cũ.
      // - Giỏ tráo sau duyệt (FORBIDDEN): từ chối cứng, không cho rẽ PIN.
      // verifiedApprovalId đưa vào createOrder để tiêu thụ NGUYÊN TỬ trong tx.
      if (discountApprovalId) {
        try {
          await DiscountApprovalService.assertValidForCheckout({
            requestId: discountApprovalId,
            items: pricedItems,
            discountRate: Number.isFinite(parsedOrderDiscount) ? parsedOrderDiscount : 0,
            warehouseId,
            actorId: actorHeader,
          });
          verifiedApprovalId = discountApprovalId;
        } catch (err: any) {
          if (err?.code === 'FORBIDDEN') {
            await recordAuditLog({
              action: 'MANAGER_DISCOUNT_DENIED',
              actorRole: userRole,
              actorId: actorHeader,
              resource: '/api/orders',
              details: `Từ chối đơn chiết khấu: ${err?.message || 'giỏ/kho/mức giảm không khớp phê duyệt'} (approval: ${discountApprovalId}).`,
            });
            return NextResponse.json(
              { success: false, code: 'FORBIDDEN', error: err?.message || 'Phê duyệt không khớp đơn hàng.' },
              { status: 403 }
            );
          }
          // INVALID (không tìm thấy/chưa duyệt/hết hạn): rẽ sang PIN bên dưới.
        }
      }

      if (!verifiedApprovalId) {
        const providedPin = `${managerPin ?? managerApprovalCode ?? ''}`;
        const pinCheck = await verifyManagerPinRateLimited(providedPin, `${actorHeader}:${extractClientIp(req)}`);
        if (pinCheck.locked) {
          return NextResponse.json(
            { success: false, code: 'RATE_LIMITED', error: 'Mã PIN quản lý tạm khóa 15 phút do nhập sai nhiều lần.' },
            { status: 429 }
          );
        }
        if (!pinCheck.ok) {
          await recordAuditLog({
            action: 'MANAGER_DISCOUNT_DENIED',
            actorRole: userRole,
            actorId: cashierId || userRole,
            resource: '/api/orders',
            details: `Từ chối đơn chiết khấu vượt trần ${Math.round(maxDiscountRate * 100)}% (cashier: ${cashierId || userRole}, thiếu phê duyệt hoặc PIN quản lý hợp lệ).`,
          });
          return NextResponse.json(
            { success: false, error: 'Chiết khấu từ 20% trở lên bắt buộc có mã PIN hoặc phê duyệt của Quản lý.' },
            { status: 403 }
          );
        }
      }
    }

    // P0 Contract: Không cho phép bán âm (overdraft) trên đường bán trực tiếp thông thường.
    // Chỉ cho phép khi là đơn sync ngoại tuyến hội chợ (isOfflineSync && channel === 'FAIR_EVENT')
    // hoặc có phê duyệt của quản trị viên (ROLE_OWNER / ROLE_MANAGER).
    const isFairOfflineSync = Boolean(isOfflineSync && channel === 'FAIR_EVENT');
    const safeAllowOverdraft = Boolean((isFairOfflineSync || isPrivilegedRole) && allowOverdraft);

    // P2-10: đơn gõ bù > 7 ngày — thu ngân phải có PIN quản lý (privileged được miễn)
    let backdateApproved = isPrivilegedRole;
    if (createdAt) {
      const ts = new Date(createdAt).getTime();
      if (!Number.isNaN(ts) && Date.now() - ts > 7 * 86400000 && !isPrivilegedRole) {
        const providedPin = `${managerPin ?? managerApprovalCode ?? ''}`;
        const pinCheck = await verifyManagerPinRateLimited(providedPin, `${actorHeader}:${extractClientIp(req)}`);
        if (pinCheck.locked) {
          return NextResponse.json(
            { success: false, code: 'RATE_LIMITED', error: 'Mã PIN quản lý tạm khóa 15 phút do nhập sai nhiều lần.' },
            { status: 429 }
          );
        }
        if (!pinCheck.ok) {
          return NextResponse.json(
            { success: false, code: 'FORBIDDEN', error: 'Đơn gõ bù quá 7 ngày. Yêu cầu mã PIN Quản lý!' },
            { status: 403 }
          );
        }
        backdateApproved = true;
      }
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
      discountRate: giftFlag ? 1 : (discountRate !== undefined ? parseFloat(discountRate) : 0),
      paymentMethod: paymentMethod || 'CASH',
      fiscalScope: safeFiscalScope,
      vatRate: vatRate !== undefined ? parseFloat(vatRate) : 0,
      vatInvoiceRequired: giftFlag ? false : Boolean(vatInvoiceRequired),
      vatInvoiceCode: giftFlag ? undefined : vatInvoiceCode,
      cashierId: actorHeader,
      actorContext,
      cashboxSessionId,
      note,
      // Bước 1: web/social truyền confirmImmediately:false → đơn PENDING giữ chỗ ATP
      confirmImmediately: confirmImmediately !== undefined ? Boolean(confirmImmediately) : true,
      // P2-10: cờ duyệt gõ bù > 7 ngày (đã check PIN ở trên)
      backdateApproved,
      isOfflineSync: Boolean(isOfflineSync),
      allowOverdraft: safeAllowOverdraft,

      isGift: giftFlag,
      giftReason: giftFlag ? `${giftReason ?? note ?? ''}`.trim() : undefined,
      items: giftFlag
        ? pricedItems.map((it: any) => ({ ...it, unitDiscountRate: 1 }))
        : pricedItems,
      bundles: Array.isArray(bundles)
        ? bundles.map((b: any) => ({ bundleId: b.bundleId, quantity: parseInt(b.quantity ?? 0, 10) }))
        : undefined,
      // A1-H: phê duyệt đã verify ở trên → service tiêu thụ NGUYÊN TỬ trong
      // cùng transaction tạo đơn (fail → rollback, không ghi đơn/không trừ kho).
      // Không còn consume sau create (bản cũ warn rồi success là lỗ hổng).
      discountApprovalId: verifiedApprovalId,
    });

    await recordAuditLog({
      action: 'MUTATE_ORDER',
      actorRole: userRole,
      actorId: actorHeader,
      resource: '/api/orders',
      details: `Tạo đơn hàng ${result.orderCode} (${safeFiscalScope}) - Thực thu: ${result.finalAmount}`,
    });

    // Ghi vết phê duyệt chiết khấu vượt trần (tuyệt đối không lưu mã PIN).
    if (exceedsHardCap) {
      await recordAuditLog({
        action: 'MANAGER_DISCOUNT_APPROVED',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/orders',
        details: `Duyệt chiết khấu vượt trần ${Math.round(maxDiscountRate * 100)}% cho đơn ${result.orderCode} (cashier: ${actorHeader}, phê duyệt bởi: ${userRole}).`,
      });
    }

    // BV-03: vết kiểm toán riêng cho đơn quà tặng (doanh thu 0đ, vẫn trừ kho).
    // Tái dùng MANAGER_DISCOUNT_APPROVED để không phình enum audit (giữ nguyên rbac-guard).
    if (giftFlag) {
      await recordAuditLog({
        action: 'MANAGER_DISCOUNT_APPROVED',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/orders',
        details: `Duyệt đơn Tặng 100% (GIFT) ${result.orderCode} (lý do: ${`${giftReason ?? note ?? ''}`.trim()}, kho: ${warehouseId}).`,
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}



