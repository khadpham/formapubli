import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { enforceFiscalScope, recordAuditLog } from '@/lib/rbac-guard';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { db, orders, orderItems, products, warehouses, staffAccounts } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Chi tiết 1 đơn (cho màn chờ ATP + xem đơn trong ngày).
 * Bấm mới tải - không tải N+1 lúc mở danh sách (trần 50 subrequest của Workers).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ALLOWED_VIEW_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];
    const session = await requireSessionRole(req, ALLOWED_VIEW_ROLES);
    const userRole = session.role as UserRole;
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu mã đơn.' }, { status: 400 });
    }

    const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    const order = rows[0] as any;
    if (!order) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy đơn.' }, { status: 404 });
    }

    // Cùng luật như GET /api/orders: thủ kho không xem doanh số, thu ngân chỉ xem đơn của mình.
    if (userRole === 'ROLE_WAREHOUSE') {
      return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Thủ kho không có quyền xem doanh số đơn.' }, { status: 403 });
    }
    if (userRole === 'ROLE_CASHIER' && `${order.cashierId}` !== `${session.actorId}`) {
      return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Thu ngân chỉ xem được đơn do chính mình tạo.' }, { status: 403 });
    }
    const safeFiscalScope = enforceFiscalScope(userRole, 'ALL');
    if (safeFiscalScope !== 'ALL' && order.fiscalScope !== safeFiscalScope) {
      return NextResponse.json({ success: false, code: 'FORBIDDEN', error: 'Đơn không thuộc phạm vi sổ bạn được xem.' }, { status: 403 });
    }

    const lines = await db
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        productId: orderItems.productId,
        editionId: orderItems.editionId,
        unitCoverPrice: orderItems.unitCoverPrice,
        unitDiscountRate: orderItems.unitDiscountRate,
        unitSellingPrice: orderItems.unitSellingPrice,
        totalAmount: orderItems.totalAmount,
        isGiftLine: orderItems.isGiftLine,
        isGiftShortfall: orderItems.isGiftShortfall,
        productName: products.name,
        productCode: products.code,
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, id));

    const whRows = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, order.warehouseId)).limit(1);
    const staffRows = await db.select({ fullName: staffAccounts.fullName }).from(staffAccounts).where(eq(staffAccounts.staffId, order.cashierId)).limit(1);

    if (safeFiscalScope !== 'OFFICIAL_TAX') {
      await recordAuditLog({
        action: 'VIEW_FISCAL_MANAGEMENT',
        actorRole: userRole,
        actorId: session.actorId,
        resource: '/api/orders/[id]',
        details: `Xem chi tiết đơn ${order.orderCode}`,
      });
    }

    return NextResponse.json({
      success: true,
      order: { ...order, warehouseName: whRows[0]?.name || order.warehouseId, cashierName: staffRows[0]?.fullName || order.cashierId },
      items: lines,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
