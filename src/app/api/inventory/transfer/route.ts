import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { editionId, fromWarehouseId, toWarehouseId, quantity, documentRef, note, actorId } = body;

    if (!editionId || !fromWarehouseId || !toWarehouseId || !quantity || !documentRef) {
      return NextResponse.json(
        { error: 'Thiếu thông tin bắt buộc (editionId, fromWarehouseId, toWarehouseId, quantity, documentRef)' },
        { status: 400 }
      );
    }

    const result = await InventoryService.transfer({
      editionId,
      fromWarehouseId,
      toWarehouseId,
      quantity: parseInt(quantity, 10),
      documentRef,
      note,
      actorId: actorId || 'Thủ kho formapubli',
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Lỗi xử lý chuyển kho' },
      { status: 400 }
    );
  }
}