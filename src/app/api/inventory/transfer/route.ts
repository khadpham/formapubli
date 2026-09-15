import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userRole = extractUserRole(req);
    const actorHeader = req.headers.get('x-formapubli-actor');
    // Chặn TAX/CASHIER khai báo tường minh (luồng UI nội bộ header vắng mặt vẫn qua)
    if (userRole === 'ROLE_TAX' || userRole === 'ROLE_CASHIER') {
      return NextResponse.json({ error: 'Chuyển kho chỉ dành cho Thủ kho/Quản lý.' }, { status: 403 });
    }
    const { editionId, fromWarehouseId, toWarehouseId, quantity, documentRef, note, actorId, idempotencyKey } = body;

    if (!editionId || !fromWarehouseId || !toWarehouseId || quantity === undefined || quantity === null || !documentRef) {
      return NextResponse.json(
        { error: 'Thiếu thông tin bắt buộc (editionId, fromWarehouseId, toWarehouseId, quantity, documentRef)' },
        { status: 400 }
      );
    }
    const qty = typeof quantity === 'number' ? quantity : Number(`${quantity}`.trim());
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json({ error: 'quantity phải là số nguyên > 0.' }, { status: 400 });
    }

    const result = await InventoryService.transfer({
      editionId,
      fromWarehouseId,
      toWarehouseId,
      quantity: qty,
      documentRef,
      note,
      actorId: actorHeader || actorId || 'Thủ kho formapubli',
      // P2-04: client gửi key để chống replay nhân đôi (thiếu key vẫn chạy như cũ)
      idempotencyKey: idempotencyKey ? `${idempotencyKey}`.trim() : undefined,
    });

    if (!(result as any).isDuplicate) {
      recordAuditLog({
        action: 'TRANSFER_DISPATCH', actorRole: userRole, actorId: actorHeader || actorId || userRole,
        resource: '/api/inventory/transfer', details: `Chuyển ${qty} cuốn ${editionId}: ${fromWarehouseId} → ${toWarehouseId} (${documentRef}).`,
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Lỗi xử lý chuyển kho' },
      { status: 400 }
    );
  }
}
