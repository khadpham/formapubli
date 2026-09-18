import { NextRequest, NextResponse } from 'next/server';
import { ShipmentService } from '@/services/shipment.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole, resolveRequestIdentity, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Bước 2 — Contract API Vận chuyển SPX & COD.
 * POST /api/shipments { action, ... }:
 * - PUSH: { orderId, carrier:'SPX', trackingCode, shippingFee? }
 * - UPDATE_STATUS: { orderId, shippingStatus }
 * - SETTLE_COD: { orderId, bankReference } (Manager/Owner)
 * GET /api/shipments?shippingStatus=&codStatus=&carrier=
 * Webhook SPX thật sau này verify chữ ký rồi gọi cùng UPDATE_STATUS.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX']
    );
    const { searchParams } = new URL(req.url);

    // FIX-06: Kế toán thuế chỉ được thấy đơn OFFICIAL_TAX, tuyệt đối không lộ đơn nội bộ
    const safeFiscalScope = session.role === 'ROLE_TAX' 
      ? 'OFFICIAL_TAX' 
      : (searchParams.get('fiscalScope') || undefined);

    const list = await ShipmentService.list({
      shippingStatus: searchParams.get('shippingStatus') || undefined,
      codStatus: searchParams.get('codStatus') || undefined,
      carrier: searchParams.get('carrier') || undefined,
      fiscalScope: safeFiscalScope,
    });
    return NextResponse.json({ success: true, shipments: list });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']
    );
    const body = await req.json();
    const userRole = session.role as any;
    const actorHeader = session.actorId;

    if (body.action === 'PUSH') {
      const result = await ShipmentService.push(
        body.orderId, body.carrier || 'SPX', body.trackingCode,
        body.shippingFee !== undefined ? parseFloat(body.shippingFee) : 0, userRole
      );
      await recordAuditLog({
        action: 'MUTATE_ORDER', actorRole: userRole, actorId: actorHeader,
        resource: '/api/shipments', details: `Đẩy đơn ${body.orderId} sang ${result.carrier} (vận đơn ${result.trackingCode}, COD ${result.codAmount}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'UPDATE_STATUS') {
      const result = await ShipmentService.updateStatus(body.orderId, body.shippingStatus, userRole);
      await recordAuditLog({
        action: 'MUTATE_ORDER', actorRole: userRole, actorId: actorHeader,
        resource: '/api/shipments', details: `Vận đơn đơn ${body.orderId} → ${result.shippingStatus}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'SETTLE_COD') {
      if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
        throw new AuthError(403, 'Chỉ Manager/Owner mới có quyền tất toán COD.');
      }
      const result = await ShipmentService.settleCod(body.orderId, userRole, body.bankReference);
      await recordAuditLog({
        action: 'MUTATE_ORDER', actorRole: userRole, actorId: actorHeader,
        resource: '/api/shipments', details: `Tất toán COD đơn ${body.orderId}: ${result.codAmount}đ về NH (${result.bankReference}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: 'action không hợp lệ (PUSH | UPDATE_STATUS | SETTLE_COD).' },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}

