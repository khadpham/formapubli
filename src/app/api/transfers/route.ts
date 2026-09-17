import { NextRequest, NextResponse } from 'next/server';
import { TransferService, DEFAULT_STALE_HOURS } from '@/services/transfer.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole, resolveRequestIdentity, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * CP3-B1.2 (mục 5): chuyển đổi số lượng KHÔNG cắt phần thập phân.
 * "1.5" phải tới service nguyên vẹn để bị từ chối (không parseInt).
 */
function toQty(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.trim());
  return 0;
}

// GET /api/transfers?status=IN_TRANSIT&limit=50
// GET /api/transfers?staleHours=12 — phiếu kẹt quá ngưỡng
// GET /api/transfers?id=TRF-... — chi tiết 1 phiếu
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']);

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
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']);
    const userRole = session.role;
    const actorHeader = session.actorId;
    const actorContext = {
      staffId: session.actorId,
      role: session.role,
      fullName: session.fullName,
      sessionId: session.sessionId,
    };

    const body = await req.json();
    const { action } = body;
    const idempotencyKey =
      req.headers.get('idempotency-key') ||
      req.headers.get('x-idempotency-key') ||
      body.idempotencyKey;

    if (!idempotencyKey || !`${idempotencyKey}`.trim()) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', error: `Bắt buộc cung cấp idempotencyKey cho thao tác ${action || 'luân chuyển'}.` },
        { status: 400 }
      );
    }
    const cleanIdemKey = `${idempotencyKey}`.trim();

    if (action === 'dispatch') {
      const { fromWarehouseId, toWarehouseId, vehicleInfo, notes, items } = body;
      if (!fromWarehouseId || !toWarehouseId || !items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Thiếu kho gửi/nhận hoặc danh sách hàng (items).' },
          { status: 400 }
        );
      }
      const result = await TransferService.dispatch({
        fromWarehouseId,
        toWarehouseId,
        vehicleInfo,
        notes,
        idempotencyKey: cleanIdemKey,
        actorContext,
        items: items.map((it: any) => ({
          editionId: it.editionId,
          quantity: toQty(it.quantity ?? it.quantityDispatched ?? it.dispatchedQty ?? 0),
          notes: it.notes,
        })),
      });
      if (!(result as any).isDuplicate) {
        recordAuditLog({
          action: 'TRANSFER_DISPATCH',
          actorRole: userRole,
          actorId: actorHeader,
          resource: '/api/transfers',
          details: `Xuất kho luân chuyển ${result.shipmentId} (${fromWarehouseId} → ${toWarehouseId}, ${result.itemsCount} đầu sách).`,
        });
      }
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'receive') {
      const { shipmentId, items, receivedItems, notes } = body;
      const rawItems = items || receivedItems;
      if (!shipmentId || !rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã phiếu (shipmentId) hoặc danh sách hàng nhận (items).' },
          { status: 400 }
        );
      }
      const result = await TransferService.receive({
        shipmentId,
        notes,
        idempotencyKey: cleanIdemKey,
        actorContext,
        items: rawItems.map((it: any) => ({
          editionId: it.editionId,
          receivedQty: toQty(it.receivedQty ?? it.quantityReceived ?? 0),
          damagedQty: toQty(it.damagedQty ?? 0),
          lostQty: toQty(it.lostQty ?? 0),
          notes: it.notes,
        })),
      });
      const discrepancyCount = result.totalDamaged + result.totalLost;
      if (!(result as any).isDuplicate) {
        recordAuditLog({
          action: 'TRANSFER_RECEIVE',
          actorRole: userRole,
          actorId: actorHeader,
          resource: '/api/transfers',
          details: `Nhập kho luân chuyển ${shipmentId} (trạng thái ${result.status}${discrepancyCount ? `, lệch ${discrepancyCount} món` : ''}).`,
        });
      }
      return NextResponse.json({ success: true, data: result });
    }

    if (action === 'cancel') {
      const { shipmentId, notes } = body;
      if (!shipmentId) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã phiếu (shipmentId).' },
          { status: 400 }
        );
      }
      const result = await TransferService.cancel({
        shipmentId,
        notes,
        idempotencyKey: cleanIdemKey,
        actorContext,
      });
      if (!(result as any).isDuplicate) {
        recordAuditLog({
          action: 'TRANSFER_CANCEL',
          actorRole: userRole,
          actorId: actorHeader,
          resource: '/api/transfers',
          details: `Hủy phiếu luân chuyển ${shipmentId}, rút hàng về kho gửi.`,
        });
      }
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
