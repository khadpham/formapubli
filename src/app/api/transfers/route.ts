import { NextRequest, NextResponse } from 'next/server';
import { TransferService, DEFAULT_STALE_HOURS } from '@/services/transfer.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { resolveRequestIdentity, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// GET /api/transfers?status=IN_TRANSIT&limit=50
// GET /api/transfers?staleHours=12 — phiếu kẹt quá ngưỡng
// GET /api/transfers?id=TRF-... — chi tiết 1 phiếu
export async function GET(req: NextRequest) {
  try {
    const identity = await resolveRequestIdentity(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE'],
      { role: extractUserRole(req), actorId: 'transfers-reader' }
    );
    if (identity.role === 'ROLE_TAX') {
      throw new AuthError(403, 'Kế toán thuế không có quyền quản trị luân chuyển kho.');
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const shipment = await TransferService.getShipment(id);
      return NextResponse.json({ success: true, data: shipment });
    }

    const staleHours = searchParams.get('staleHours');
    if (staleHours !== null) {
      const hours = staleHours === '' ? DEFAULT_STALE_HOURS : parseInt(staleHours, 10);
      const stale = await TransferService.listStaleShipments(
        Number.isFinite(hours) ? hours : DEFAULT_STALE_HOURS
      );
      return NextResponse.json({ success: true, data: stale });
    }

    const status = searchParams.get('status') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
    const list = await TransferService.listShipments(status, limit);
    return NextResponse.json({ success: true, data: list });
  } catch (error: any) {
    return handleApiError(error);
  }
}

// POST /api/transfers { action: 'dispatch' | 'receive' | 'cancel', ... }
export async function POST(req: NextRequest) {
  try {
    const identity = await resolveRequestIdentity(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE'],
      { role: extractUserRole(req), actorId: req.headers.get('x-formapubli-actor') || extractUserRole(req) }
    );
    const userRole = identity.role;
    const actorHeader = identity.actorId;

    if (userRole === 'ROLE_TAX') {
      throw new AuthError(403, 'Kế toán thuế không có quyền luân chuyển kho.');
    }

    const body = await req.json();
    const { action } = body;

    if (action === 'dispatch') {
      const { fromWarehouseId, toWarehouseId, dispatcherId, vehicleInfo, notes, items } = body;
      if (!fromWarehouseId || !toWarehouseId || !items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Thiếu kho gửi/nhận hoặc danh sách hàng (items).' },
          { status: 400 }
        );
      }
      const result = await TransferService.dispatch({
        fromWarehouseId,
        toWarehouseId,
        dispatcherId: dispatcherId || actorHeader,
        vehicleInfo,
        notes,
        items: items.map((it: any) => ({
          editionId: it.editionId,
          quantity: parseInt(it.quantity ?? it.quantityDispatched ?? it.dispatchedQty ?? 0, 10),
          notes: it.notes,
        })),
      });
      recordAuditLog({
        action: 'TRANSFER_DISPATCH',
        actorRole: userRole,
        actorId: dispatcherId || actorHeader,
        resource: '/api/transfers',
        details: `Xuất kho luân chuyển ${result.shipmentId} (${fromWarehouseId} → ${toWarehouseId}, ${items.length} đầu sách).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'receive') {
      const { shipmentId, receiverId, items, receivedItems, notes } = body;
      const rawItems = items || receivedItems;
      if (!shipmentId || !rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã phiếu (shipmentId) hoặc danh sách hàng nhận (items).' },
          { status: 400 }
        );
      }
      const result = await TransferService.receive({
        shipmentId,
        receiverId: receiverId || actorHeader,
        notes,
        items: rawItems.map((it: any) => ({
          editionId: it.editionId,
          receivedQty: parseInt(it.receivedQty ?? it.quantityReceived ?? 0, 10),
          damagedQty: parseInt(it.damagedQty ?? 0, 10),
          lostQty: parseInt(it.lostQty ?? 0, 10),
          notes: it.notes,
        })),
      });
      const discrepancyCount = result.totalDamaged + result.totalLost;
      recordAuditLog({
        action: 'TRANSFER_RECEIVE',
        actorRole: userRole,
        actorId: receiverId || actorHeader,
        resource: '/api/transfers',
        details: `Nhập kho luân chuyển ${shipmentId} (trạng thái ${result.status}${discrepancyCount ? `, lệch ${discrepancyCount} món` : ''}).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'cancel') {
      const { shipmentId, actorId } = body;
      if (!shipmentId) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã phiếu (shipmentId).' },
          { status: 400 }
        );
      }
      const result = await TransferService.cancel(shipmentId, actorId || actorHeader);
      recordAuditLog({
        action: 'TRANSFER_CANCEL',
        actorRole: userRole,
        actorId: actorId || actorHeader,
        resource: '/api/transfers',
        details: `Hủy phiếu luân chuyển ${shipmentId}, rút hàng về kho gửi.`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}. Chỉ chấp nhận 'dispatch', 'receive', 'cancel'.` },
      { status: 400 }
    );
  } catch (error: any) {
    return handleApiError(error);
  }
}
