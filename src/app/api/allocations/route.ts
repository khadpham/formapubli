import { NextRequest, NextResponse } from 'next/server';
import { AllocationService } from '@/services/allocation.service';
import { extractUserRole } from '@/lib/rbac-guard';
import { resolveRequestIdentity, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await resolveRequestIdentity(
      request,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE'],
      { role: extractUserRole(request), actorId: 'allocations-reader' }
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
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await resolveRequestIdentity(
      request,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE'],
      { role: extractUserRole(request), actorId: request.headers.get('x-formapubli-actor') || extractUserRole(request) }
    );
    if (!['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE'].includes(identity.role)) {
      throw new AuthError(403, 'Chỉ Chủ/Quản lý hoặc Thủ kho mới có quyền phân bổ sách chia mâm.');
    }

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

