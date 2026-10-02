import { NextRequest, NextResponse } from 'next/server';
import { AllocationService } from '@/services/allocation.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireSessionRole(
      request,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE']
    );
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get('warehouseId');
    const counterName = searchParams.get('counterName') || undefined;
    const mode = searchParams.get('mode');

    if (!warehouseId) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng cung cấp warehouseId' },
        { status: 400 }
      );
    }

    if (mode === 'picklist') {
      const itemsRaw = searchParams.get('items');
      let items: unknown = [];
      try {
        items = itemsRaw ? JSON.parse(itemsRaw) : [];
      } catch {
        return NextResponse.json(
          { success: false, error: 'Tham số items không phải JSON hợp lệ.' },
          { status: 400 }
        );
      }
      if (!Array.isArray(items)) {
        return NextResponse.json({ success: false, error: 'items phải là mảng.' }, { status: 400 });
      }
      if (items.length > 500) {
        return NextResponse.json({ success: false, error: 'Phiếu soạn tối đa 500 dòng.' }, { status: 400 });
      }
      const pickList = await AllocationService.generatePickList(warehouseId, items as any);
      return NextResponse.json({ success: true, data: pickList });
    }

    const allocations = await AllocationService.getCounterAllocations(
      warehouseId,
      counterName
    );

    return NextResponse.json({ success: true, data: allocations });
  } catch (error: any) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSessionRole(
      request,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']
    );

    const body = await request.json();
    const { warehouseId, counterName, cashboxSessionId, allocations } = body;

    if (!warehouseId || !counterName || !Array.isArray(allocations)) {
      return NextResponse.json(
        { success: false, error: 'Thiếu thông tin warehouseId, counterName hoặc danh sách allocations' },
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
    return handleApiError(error);
  }
}

