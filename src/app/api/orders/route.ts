import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';
import { verifyManagerPinRateLimited } from '@/lib/manager-pin';
import { requireSessionRole, extractClientIp } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DiscountApprovalService } from '@/services/discount-approval.service';
import { db, staffAccounts } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Server-side Discount Hard-cap (chống thu ngân tự ý chiết khấu sâu).
// Trần thu ngân: 20%. Vượt trần bắt buộc có mã PIN quản lý phê duyệt.
// PIN xác thực bằng hash (manager-pin.ts + env MANAGER_PIN_HASHES).
// ---------------------------------------------------------------------------
const MAX_CASHIER_DISCOUNT_RATE = 0.2;

const PAYMENT_PROOF_MAX_LEN = 200;
const CANCEL_REASON_MAX_LEN = 500;

/**
 * Kiểm tra ảnh xác nhận ở biên HTTP: cả hai trường hoặc cùng có, hoặc cùng thiếu.
 * Giới hạn độ dài để client không phình audit_logs, và bắt buộc capturedAt là ngày hợp lệ.
 */
function paymentProofError(body: any): string | null {
  const id = body?.paymentProofId;
  const capturedAt = body?.paymentProofCapturedAt;
  if (id === undefined && capturedAt === undefined) return null;
  if (id == null || capturedAt == null) return 'Ảnh xác nhận thiếu id hoặc thời điểm chụp.';
  if (typeof id !== 'string' || !id.trim() || id.length > PAYMENT_PROOF_MAX_LEN) {
    return 'Mã ảnh xác nhận không hợp lệ.';
  }
  if (typeof capturedAt !== 'string' || !capturedAt.trim() || capturedAt.length > PAYMENT_PROOF_MAX_LEN || !Number.isFinite(Date.parse(capturedAt))) {
    return 'Thời điểm chụp ảnh không hợp lệ.';
  }
  return null;
}

/** Lý do hủy là text tự do: chỉ nhận chuỗi, cắt khoảng trắng, giới hạn độ dài. */
function cancelReasonError(reason: any): string | null {
  if (reason === undefined || reason === null || reason === '') return null;
  if (typeof reason !== 'string' || reason.trim().length > CANCEL_REASON_MAX_LEN) {
    return 'Lý do hủy đơn không hợp lệ.';
  }
  return null;
}

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

    // Bước 1: duyệt / hủy đơn PENDING. Phân quyền + audit nằm trong service
    // (Cashier chỉ xử lý đơn của chính mình; Owner/Manager mọi đơn).
    if (body.action === 'CONFIRM' || body.action === 'CANCEL') {
      if (userRole === 'ROLE_TAX') {
        return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Kế toán thuế không được duyệt/hủy đơn.' }, { status: 403 });
      }
      const proofError = paymentProofError(body);
      if (proofError) {
        return NextResponse.json({ success: false, code: 'INVALID_INPUT', error: proofError }, { status: 400 });
      }
      // Lý do hủy là input tự do của client, nay đã mở cho ROLE_CASHIER: chặn độ dài
      // để orders.note / audit_logs.details không bị phình vô hạn.
      const reasonError = cancelReasonError(body.reason);
      if (reasonError) {
        return NextResponse.json({ success: false, code: 'INVALID_INPUT', error: reasonError }, { status: 400 });
      }
      const result = body.action === 'CONFIRM'
        ? await OrderService.confirmOrder(
            body.orderId,
            userRole,
            actorHeader,
            actorContext,
            body.paymentProofId && body.paymentProofCapturedAt
              ? { id: body.paymentProofId, capturedAt: body.paymentProofCapturedAt }
              : undefined
          )
        : await OrderService.cancelOrder(
            body.orderId,
            userRole,
            typeof body.reason === 'string' ? body.reason.trim() : undefined,
            actorContext,
            actorHeader
          );
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
       moneyReceived,
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
    const effectivePaymentMethod = paymentMethod || 'CASH';
    const isDigitalMethod = effectivePaymentMethod === 'BANK_TRANSFER' || effectivePaymentMethod === 'QR_CODE';
    // Đơn chuyển khoản/QR tại quầy: tạo PENDING trước (confirmImmediately:false),
    // không cần moneyReceived. Đồng bộ offline tức thì vẫn phải có proof.
    const isImmediateDigital = isDigitalMethod && confirmImmediately !== false && !giftFlag;
    // Validate input TRƯỚC các cổng nghiệp vụ: cùng một payload lỗi phải luôn trả 400,
    // không được rơi vào 403 của cổng "thiếu ảnh" (client không phân biệt được lỗi dữ liệu).
    const createProofError = paymentProofError(body);
    if (createProofError) {
      return NextResponse.json({ success: false, code: 'INVALID_INPUT', error: createProofError }, { status: 400 });
    }
    if (isImmediateDigital && moneyReceived !== true) {
      return NextResponse.json(
        { success: false, error: 'Phải xác nhận đã nhận tiền trước khi chốt đơn chuyển khoản/QR.' },
        { status: 403 }
      );
    }
    if (isImmediateDigital && (!body.paymentProofId || !body.paymentProofCapturedAt)) {
      return NextResponse.json(
        { success: false, error: 'Thiếu ảnh xác nhận thanh toán cho đơn chuyển khoản/QR.' },
        { status: 403 }
      );
    }
    const effectiveItemDiscounts = (safeItems as any[]).map((it) => {
      const v = it?.unitDiscountRate;
      const parsed =
        v !== undefined && v !== null && `${v}` !== '' ? parseFloat(v) : parsedOrderDiscount;
      return Number.isFinite(parsed) ? parsed : 0;
    });
    const maxDiscountRate = giftFlag
      ? 1
      : Math.max(
          Number.isFinite(parsedOrderDiscount) ? parsedOrderDiscount : 0,
          ...effectiveItemDiscounts
        );
    const exceedsHardCap = maxDiscountRate >= MAX_CASHIER_DISCOUNT_RATE;
    const isPrivilegedRole = userRole === 'ROLE_OWNER' || userRole === 'ROLE_MANAGER';
    let approvalIdForOrder = discountApprovalId;
    let approvalSource = isPrivilegedRole ? userRole : 'MANAGER_PIN';
    let approvalApproverId: string | null = null;

    if (exceedsHardCap && !isPrivilegedRole) {
      let isApprovalValid = false;
      if (discountApprovalId) {
        try {
           const appr = await DiscountApprovalService.getRequest(discountApprovalId);
            if (appr && (appr.status === 'APPROVED' || appr.status === 'CONSUMED') && (userRole !== 'ROLE_CASHIER' || appr.cashierId === actorHeader)) {
              isApprovalValid = true;
              approvalIdForOrder = discountApprovalId;
              approvalSource = appr.approvedBy || 'APPROVAL_REQUEST';
              approvalApproverId = appr.approvedBy || null;
           } else if (userRole === 'ROLE_CASHIER') {
             approvalIdForOrder = undefined;
           }
         } catch {
           if (userRole === 'ROLE_CASHIER') approvalIdForOrder = undefined;
         }
      }

      if (!isApprovalValid) {
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
            actorId: actorHeader,
            resource: '/api/orders',
            details: `Từ chối đơn chiết khấu vượt trần ${Math.round(maxDiscountRate * 100)}% (cashier: ${actorHeader}, thiếu phê duyệt hoặc PIN quản lý hợp lệ).`,
          });
          return NextResponse.json(
            { success: false, error: 'Chiết khấu từ 20% trở lên bắt buộc có mã PIN hoặc phê duyệt của Quản lý.' },
            { status: 403 }
          );
        }
        approvalSource = 'SYSTEM_MANAGER_PIN';
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

    let approvalApproverRole: UserRole = userRole;
    if (approvalApproverId) {
      const approverRows = await db
        .select({ role: staffAccounts.role })
        .from(staffAccounts)
        .where(eq(staffAccounts.staffId, approvalApproverId))
        .limit(1);
      approvalApproverRole = (approverRows[0]?.role as UserRole) || 'ROLE_MANAGER';
    }
    const approvalAuditActorId = approvalApproverId || (approvalSource === 'SYSTEM_MANAGER_PIN' ? 'SYSTEM_MANAGER_PIN' : actorHeader);
    const approvalAuditRole = approvalSource === 'SYSTEM_MANAGER_PIN' ? 'ROLE_MANAGER' : approvalApproverRole;
    const requiredAudit = [
      ...(exceedsHardCap
        ? [{
            id: 'discount-approval',
            action: 'MANAGER_DISCOUNT_APPROVED',
            actorRole: approvalAuditRole,
            actorId: approvalAuditActorId,
            resource: '/api/orders',
            details: (committedOrderCode: string) => `Duyệt chiết khấu vượt trần ${Math.round(maxDiscountRate * 100)}% cho đơn ${committedOrderCode} (cashier: ${actorHeader}, phê duyệt bởi: ${approvalSource}).`,
          }]
        : []),
      ...(giftFlag
        ? [{
            id: 'gift-approval',
            action: 'MANAGER_DISCOUNT_APPROVED',
            actorRole: approvalAuditRole,
            actorId: approvalAuditActorId,
            resource: '/api/orders',
            details: (committedOrderCode: string) => `Duyệt đơn Tặng 100% (GIFT) ${committedOrderCode} (lý do: ${`${giftReason ?? note ?? ''}`.trim()}, kho: ${warehouseId}).`,
          }]
        : []),
      ...(isImmediateDigital
        ? [{
            id: 'transfer-payment-confirmation',
            action: 'ORDER_CONFIRMED',
            actorRole: userRole,
            actorId: actorHeader,
            resource: '/api/orders',
            details: (committedOrderCode: string) => `Xác nhận offline ${committedOrderCode}; proof=${body.paymentProofId}; capturedAt=${body.paymentProofCapturedAt}.`,
          }]
        : []),
    ];

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
      discountApprovalId: approvalIdForOrder,
      note,
      // Bước 1: web/social truyền confirmImmediately:false → đơn PENDING giữ chỗ ATP
      confirmImmediately: confirmImmediately !== undefined ? Boolean(confirmImmediately) : true,
      // P2-10: cờ duyệt gõ bù > 7 ngày (đã check PIN ở trên)
      backdateApproved,
      isOfflineSync: Boolean(isOfflineSync),
      allowOverdraft: safeAllowOverdraft,

      isGift: giftFlag,
      giftReason: giftFlag ? `${giftReason ?? note ?? ''}`.trim() : undefined,
      requiredAudit,
      items: giftFlag
        ? pricedItems.map((it: any) => ({ ...it, unitDiscountRate: 1 }))
        : pricedItems,
      bundles: Array.isArray(bundles)
        ? bundles.map((b: any) => ({ bundleId: b.bundleId, quantity: parseInt(b.quantity ?? 0, 10) }))
        : undefined,
    });

    await recordAuditLog({
      id: `aud-order-${result.orderId}-mutate`,
      action: 'MUTATE_ORDER',
      actorRole: userRole,
      actorId: actorHeader,
      resource: '/api/orders',
      details: `Tạo đơn hàng ${result.orderCode} (${safeFiscalScope}) - Thực thu: ${result.finalAmount}`,
    });



    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}



