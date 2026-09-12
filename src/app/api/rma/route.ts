import { NextRequest, NextResponse } from 'next/server';
import { RmaService } from '@/services/rma.service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get('warehouseId') || undefined;
    const status = searchParams.get('status') || undefined;
    const editionId = searchParams.get('editionId') || undefined;

    const tickets = await RmaService.listTickets({
      warehouseId,
      status,
      editionId,
    });

    return NextResponse.json({ success: true, data: tickets });
  } catch (error: any) {
    console.error('Lỗi khi truy vấn danh sách RMA:', error);
    return NextResponse.json({ error: error.message || 'Lỗi máy chủ' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'resolve') {
      const { ticketId, resolutionAction, actorId, notes } = body;
      if (!ticketId || !resolutionAction) {
        return NextResponse.json(
          { error: 'Thiếu ticketId hoặc resolutionAction' },
          { status: 400 }
        );
      }

      const updated = await RmaService.resolveTicket({
        ticketId,
        action: resolutionAction,
        actorId: actorId || 'staff-admin',
        notes,
      });

      return NextResponse.json({ success: true, data: updated });
    }

    // Mặc định là tạo ticket mới
    const {
      warehouseId,
      editionId,
      quantity,
      defectReason,
      orderId,
      sourceCondition,
      targetCondition,
      inspectedBy,
      notes,
    } = body;

    if (!warehouseId || !editionId || !quantity || !defectReason) {
      return NextResponse.json(
        { error: 'Thiếu trường bắt buộc: warehouseId, editionId, quantity, defectReason' },
        { status: 400 }
      );
    }

    const ticket = await RmaService.createTicket({
      warehouseId,
      editionId,
      quantity: Number(quantity),
      defectReason,
      orderId,
      sourceCondition,
      targetCondition,
      inspectedBy,
      notes,
    });

    return NextResponse.json({ success: true, data: ticket });
  } catch (error: any) {
    console.error('Lỗi khi xử lý phiếu RMA:', error);
    return NextResponse.json({ error: error.message || 'Lỗi máy chủ' }, { status: 500 });
  }
}
