import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { editionId, warehouseId, eventType, quantityDelta, documentRef, note, actorId } = body;

    if (!editionId || !warehouseId || !eventType || !quantityDelta || !documentRef) {
      return NextResponse.json(
        { error: 'Thiếu thông tin bắt buộc (editionId, warehouseId, eventType, quantityDelta, documentRef)' },
        { status: 400 }
      );
    }

    const result = await InventoryService.recordMovement({
      editionId,
      warehouseId,
      eventType,
      quantityDelta: parseInt(quantityDelta, 10),
      documentRef,
      note,
      actorId: actorId || 'Thủ kho formapubli',
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Lỗi xử lý bút toán kho' },
      { status: 400 }
    );
  }
}