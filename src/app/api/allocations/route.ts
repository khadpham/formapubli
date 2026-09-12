import { NextRequest, NextResponse } from 'next/server';
import { AllocationService } from '@/services/allocation.service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get('warehouseId');
    const counterName = searchParams.get('counterName') || undefined;
    const mode = searchParams.get('mode');

    if (!warehouseId) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp warehouseId' },
        { status: 400 }
      );
    }

    if (mode === 'picklist') {
      const itemsRaw = searchParams.get('items');
      const items = itemsRaw ? JSON.parse(itemsRaw) : [];
      const pickList = await AllocationService.generatePickList(warehouseId, items);
      return NextResponse.json({ success: true, data: pickList });
    }

    const allocations = await AllocationService.getCounterAllocations(
      warehouseId,
      counterName
    );

    return NextResponse.json({ success: true, data: allocations });
  } catch (error: any) {
    console.error('Lỗi khi truy vấn allocations:', error);
    return NextResponse.json({ error: error.message || 'Lỗi máy chủ' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { warehouseId, counterName, cashboxSessionId, allocations } = body;

    if (!warehouseId || !counterName || !Array.isArray(allocations)) {
      return NextResponse.json(
        { error: 'Thiếu thông tin warehouseId, counterName hoặc danh sách allocations' },
        { status: 400 }
      );
    }

    const results = await AllocationService.allocateBooksToCounter({
      warehouseId,
      counterName,
      cashboxSessionId,
      allocations,
    });

    return NextResponse.json({ success: true, data: results });
  } catch (error: any) {
    console.error('Lỗi khi phân bổ sách chia mâm:', error);
    return NextResponse.json({ error: error.message || 'Lỗi máy chủ' }, { status: 500 });
  }
}
