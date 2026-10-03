import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { DiscountApprovalService } from '@/services/discount-approval.service';
import { AppError } from '@/services/app-error';
import { db, orders, orderItems, warehouses, staffAccounts } from '@/db';
import { eq, inArray, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Server-side Discount Hard-cap (chặn thu ngân tự ý chiết khấu sâu).
// Trần thu ngân: 20%. Vượt trần bắt buộc có Quản lý phê duyệt — KHÔNG phải PIN.
// (Nhánh PIN đã gỡ 2026-09-29: không UI nào gửi managerPin nên thu ngân bị kẹt
//  với lỗi không gỡ được. Xem phần đơn gõ bù > 7 ngày ở dưới.)
// ---------------------------------------------------------------------------
const MAX_CASHIER_DISCOUNT_RATE = 0.2;

const PAYMENT_PROOF_MAX_LEN = 200;
const CANCEL_REASON_MAX_LEN = 500;

/** Cờ dòng quà (`order_items.is_gift_line`) từ JSON body: 1, "1", true. */
function isGiftLineFlag(value: unknown): boolean {
  return value === true || value === 1 || `${value}` === '1';
}

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

    // Dashboard cần biết mỗi đơn có bao nhiêu cuốn để vẽ thẻ "Top 5 đơn giá trị cao"
    // mà KHÔNG phải gọi N+1 `/api/orders/:id` cho từng dòng. Vì vậy gom một câu
    // GROUP BY duy nhất rồi gắn ngược bằng Map. Đơn không có dòng hàng không xuất
    // hiện trong kết quả ⇒ mặc định 0, đúng hợp đồng C1.
    // `inArray([])` sẽ ném lỗi cú pháp SQL nên phải chặn trước cho danh sách rỗng.
    //
    // CHIA LÔ BATCH: `getOrders` KHÔNG giới hạn số dòng, nên `inArray` có thể sinh
    // hàng chục nghìn tham số ràng buộc. SQLite giới hạn 32766 biến cho MỘT câu
    // lệnh (libSQL kế thừa giới hạn này) ⇒ phạm vi đủ lớn sẽ văng 500 và CÁI
    // dashboard chính — không phải một màn hăn phụ — chết theo. Chia lô 500 id/lô
    // giữ câu lệnh ở mức an toàn với chi phí chỉ là vài vòng await tuần tự.
    const ITEM_BATCH_SIZE = 500;
    const orderIds = orderList.map((o: any) => o.id).filter(Boolean);
    const itemAgg: any[] = [];
    for (let i = 0; i < orderIds.length; i += ITEM_BATCH_SIZE) {
      const batch = orderIds.slice(i, i + ITEM_BATCH_SIZE);
      itemAgg.push(
        ...(await db
          .select({
            orderId: orderItems.orderId,
            qty: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
            lines: sql<number>`COUNT(*)`,
            giftQty: sql<number>`COALESCE(SUM(CASE WHEN ${orderItems.isGiftLine} = 1 THEN ${orderItems.quantity} ELSE 0 END), 0)`,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, batch))
          .groupBy(orderItems.orderId)),
      );
    }
    const aggByOrder = new Map(itemAgg.map((r: any) => [r.orderId, r]));

    return NextResponse.json({
      success: true,
      role: userRole,
      fiscalScope: safeFiscalScope,
      orders: orderList.map((o: any) => {
        const agg: any = aggByOrder.get(o.id);
        return {
          ...o,
          itemQty: agg ? Number(agg.qty) || 0 : 0,
          itemLines: agg ? Number(agg.lines) || 0 : 0,
          giftQty: agg ? Number(agg.giftQty) || 0 : 0,
        };
      }),
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
      // 0031: dòng quà của chương trình mốc tiền (client có thể gửi 1 hoặc "1").
      isGiftLine: isGiftLineFlag(it?.isGiftLine),
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
    // DÒNG QUÀ (`is_gift_line`) bị loại TRƯỚC khi so trần: giá bìa của món quà đi
    // kèm `unitDiscountRate = 1` (bán 0đ) là quyền lợi ĐÃ CẤU HÌNH của chương
    // trình, không phải thu ngân tự chiết khấu. Nếu tính vào đây thì MỌI đơn
    // khuyến mại (discountRate = 0 ⇒ giftFlag = false) đều 403 với thông báo
    // "Chiết khấu từ 20% trở lên cần Quản lý phê duyệt".
    const effectiveItemDiscounts = (safeItems as any[])
      .filter((it) => !isGiftLineFlag(it?.isGiftLine))
      .map((it) => {
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
    // 'NONE' = không có phê duyệt nào (dưới trần, hoặc quản lý tự bán). Không còn
    // 'MANAGER_PIN'/'SYSTEM_MANAGER_PIN' sau khi gỡ nhánh PIN ở P1.
    let approvalSource = isPrivilegedRole ? userRole : 'NONE';
    let approvalApproverId: string | null = null;

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
            // Dòng quà không có trong yêu cầu duyệt (người duyệt không duyệt quà), nên
            // hash giỏ phải băm trên tập dòng KHÔNG phải quà — khớp với
            // `consumeApproval` ở order.service.ts (cũng đã lọc dòng quà).
            items: pricedItems.filter((it: any) => !it.isGiftLine),
            discountRate: Number.isFinite(parsedOrderDiscount) ? parsedOrderDiscount : 0,
            warehouseId,
            actorId: actorHeader,
          });
          verifiedApprovalId = discountApprovalId;
          // Ghi nguồn phê duyệt vào audit (người duyệt thật, không phải mặc định).
          const appr = await DiscountApprovalService.getRequest(discountApprovalId);
          approvalSource = appr?.approvedBy || 'APPROVAL_REQUEST';
          approvalApproverId = appr?.approvedBy || null;
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
              { success: false, code: 'FORBIDDEN', error: err?.message || 'Phê duyệt không khớp đơn.' },
              { status: 403 }
            );
          }
          // INVALID (không tìm thấy/chưa duyệt/hết hạn): rẽ sang PIN bên dưới.
        }
      }

      if (!verifiedApprovalId) {
        // P1 GỠ 2026-09-29: bỏ nhánh rẽ PIN quản lý. Nhánh đó chưa bao giờ chạy
        // được — client không có UI nhập PIN nào, `managerPin` luôn undefined nên
        // verify luon false => thu ngân bi ket, loi khong gỡ duoc
        // gỡ được. Một đường duyệt duy nhất: quyết định của Quản lý.
        await recordAuditLog({
          action: 'MANAGER_DISCOUNT_DENIED',
          actorRole: userRole,
          actorId: actorHeader,
          resource: '/api/orders',
          details: `Từ chối đơn chiết khấu vượt trần ${Math.round(maxDiscountRate * 100)}% (cashier: ${actorHeader}, không có phê duyệt hợp lệ của Quản lý).`,
        });
        return NextResponse.json(
          {
            success: false,
            code: 'FORBIDDEN',
            error: 'Chiết khấu từ 20% trở lên cần Quản lý phê duyệt. Hãy lập yêu cầu duyệt và thử lại sau khi Quản lý duyệt (yêu cầu cũ đã hết hạn sẽ phải lập lại).',
          },
          { status: 403 }
        );
      }
    }

    // P0 Contract: Không cho phép bán âm (overdraft) trên đường bán trực tiếp thông thường.
    // Chỉ cho phép khi là đơn sync ngoại tuyến hội chợ (isOfflineSync && channel === 'FAIR_EVENT')
    // hoặc có phê duyệt của quản trị viên (ROLE_OWNER / ROLE_MANAGER).
    const isFairOfflineSync = Boolean(isOfflineSync && channel === 'FAIR_EVENT');
    const safeAllowOverdraft = Boolean((isFairOfflineSync || isPrivilegedRole) && allowOverdraft);

    // P2-10 → 2026-09-29: gỡ nhánh PIN quản lý, giữ đúng lớp kiểm soát.
    //
    // Trước đây: đơn gõ bù > 7 ngày thì thu ngân phải có PIN quản lý. Nhưng KHÔNG
    // có UI nào gửi `managerPin` (grep toàn src/ chỉ còn 3 file server) ⇒
    // `verifyManagerPinRateLimited` luôn false ⇒ thu ngân bị kẹt với lỗi
    // "Yêu cầu mã PIN Quản lý!" mà không có cách nào gỡ ra. Đây là ngõ cụt,
    // không phải lớp kiểm soát.
    //
    // Kiểm soát thật sự nằm ở VAI TRÒ: thu ngân không được gõ bù, Quản lý/Owner
    // được. Nên nhánh này chỉ cần một kiểm tra vai trò + thông báo nói rõ phải
    // làm gì, không cần PIN, không cần rate-limit, không cần bảng duyệt.
    // Service (order.service.ts, BACKDATE_LIMIT_DAYS) vẫn chặn lần hai như một
    // lưới an toàn — cả hai lớp cùng một quy tắc.
    if (createdAt) {
      const ts = new Date(createdAt).getTime();
      if (!Number.isNaN(ts) && Date.now() - ts > 7 * 86400000 && !isPrivilegedRole) {
        await recordAuditLog({
          action: 'BACKDATE_DENIED',
          actorRole: userRole,
          actorId: actorHeader,
          resource: '/api/orders',
          details: `Từ chối đơn gõ bù quá 7 ngày (${createdAt}) — thu ngân không có quyền ghi ngày quá khứ.`,
        });
        return NextResponse.json(
          {
            success: false,
            code: 'FORBIDDEN',
            error:
              'Đơn gõ bù quá 7 ngày: chỉ Quản lý hoặc Owner được tạo. Hãy nhờ Quản lý đăng nhập tạo lại đơn này.',
          },
          { status: 403 }
        );
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
    const approvalAuditActorId = approvalApproverId || actorHeader;
    const approvalAuditRole = approvalApproverRole;
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
      vatRate: (() => {
        // vatRate là `text`→`real` trong DB và CHƯA được dùng vào bất kỳ phép
        // tính tiền nào, nhưng parseFloat("abc") = NaN ⇒ libsql ném lỗi driver
        // ⇒ 500 thay vì 400. Chặn ở biên: chỉ nhận số hữu hạn trong [0, 1].
        const v = vatRate !== undefined && vatRate !== null && `${vatRate}` !== '' ? parseFloat(vatRate) : 0;
        if (!Number.isFinite(v) || v < 0 || v > 1) {
          throw AppError.invalid('Thuế suất VAT không hợp lệ (phải nằm trong khoảng 0 - 1, VD: 0.05).');
        }
        return v;
      })(),
      vatInvoiceRequired: giftFlag ? false : Boolean(vatInvoiceRequired),
      vatInvoiceCode: giftFlag ? undefined : vatInvoiceCode,
      cashierId: actorHeader,
      actorContext,
      cashboxSessionId,
      note,
      // Bước 1: web/social truyền confirmImmediately:false → đơn PENDING giữ chỗ ATP
      confirmImmediately: confirmImmediately !== undefined ? Boolean(confirmImmediately) : true,
      // Quyền ghi ngày quá khứ: đã chặn theo vai trò ở trên (thu ngân 403,
      // Quản lý/Owner đi tiếp). Truyền `true` để lớp guard BACKDATE_LIMIT_DAYS
      // trong service không chặn lần hai thứ đã hợp lệ.
      backdateApproved: true,
      isOfflineSync: Boolean(isOfflineSync),
      allowOverdraft: safeAllowOverdraft,

      isGift: giftFlag,
      giftReason: giftFlag ? `${giftReason ?? note ?? ''}`.trim() : undefined,
      requiredAudit,
      items: giftFlag
        ? pricedItems.map((it: any) => ({ ...it, unitDiscountRate: 1 }))
        : pricedItems,
      bundles: Array.isArray(bundles)
        ? bundles.map((b: any) => ({
            bundleId: b.bundleId,
            // KHÔNG parseInt ở biên HTTP — cùng quy tắc CP3-B1.2 đã áp cho
            // /api/transfers: "1.5" phải tới service NGUYÊN VẸN để bị từ chối.
            // parseInt("1.9") = 1 ⇒ khách đặt 1,9 bộ chỉ bị tính 1 bộ, mất tiền
            // và sai tồn kho. Chuỗi số nguyên vẫn được nhận như trước.
            quantity:
              typeof b.quantity === 'number'
                ? b.quantity
                : typeof b.quantity === 'string' && b.quantity.trim() !== ''
                  ? Number(b.quantity.trim())
                  : 0,
          }))
        : undefined,
      // A1-H: phê duyệt đã verify ở trên → service tiêu thụ NGUYÊN TỬ trong
      // cùng transaction tạo đơn (fail → rollback, không ghi đơn/không trừ kho).
      // Không còn consume sau create (bản cũ warn rồi success là lỗ hổng).
      discountApprovalId: verifiedApprovalId,
    });

    await recordAuditLog({
      id: `aud-order-${result.orderId}-mutate`,
      action: 'MUTATE_ORDER',
      actorRole: userRole,
      actorId: actorHeader,
      resource: '/api/orders',
      details: `Tạo đơn ${result.orderCode} (${safeFiscalScope}) - Thực thu: ${result.finalAmount}`,
    });



    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}



