import { NextRequest, NextResponse } from 'next/server';
import { ShipmentService } from '@/services/shipment.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';

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
    const { searchParams } = new URL(req.url);
    extractUserRole(req);
    const list = await ShipmentService.list({
      shippingStatus: searchParams.get('shippingStatus') || undefined,
      codStatus: searchParams.get('codStatus') || undefined,
      carrier: searchParams.get('carrier') || undefined,
    });
    return NextResponse.json({ success: true, shipments: list });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Lỗi truy vấn vận chuyển' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userRole = extractUserRole(req);
    const actorHeader = req.headers.get('x-formapubli-actor') || userRole;

    if (body.action === 'PUSH') {
      const result = await ShipmentService.push(
        body.orderId, body.carrier || 'SPX', body.trackingCode,
        body.shippingFee !== undefined ? parseFloat(body.shippingFee) : 0, userRole
      );
      recordAuditLog({
        action: 'MUTATE_ORDER', actorRole: userRole, actorId: actorHeader,
        resource: '/api/shipments', details: `Đẩy đơn ${body.orderId} sang ${result.carrier} (vận đơn ${result.trackingCode}, COD ${result.codAmount}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'UPDATE_STATUS') {
      const result = await ShipmentService.updateStatus(body.orderId, body.shippingStatus, userRole);
      recordAuditLog({
        action: 'MUTATE_ORDER', actorRole: userRole, actorId: actorHeader,
        resource: '/api/shipments', details: `Vận đơn đơn ${body.orderId} → ${result.shippingStatus}.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === 'SETTLE_COD') {
      const result = await ShipmentService.settleCod(body.orderId, userRole, body.bankReference);
      recordAuditLog({
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
    const status = /Chỉ Manager\/Owner|Kế toán thuế/.test(error.message || '') ? 403 : 400;
    return NextResponse.json({ success: false, error: error.message || 'Lỗi vận chuyển' }, { status });
  }
}
