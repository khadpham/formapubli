import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { InventoryService } from '@/services/inventory.service';
import { extractUserRole } from '@/lib/rbac-guard';
import { resolveRequestIdentity } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Bước 1 — Tra cứu tồn khả dụng ATP (physical NEW − đơn PENDING giữ chỗ).
 * GET /api/atp?editionId=&warehouseId=
 * POS dùng để chặn bán lẹm hàng online đã giữ chỗ (team wire vào addToCart).
 */
export async function GET(req: NextRequest) {
  try {
    await resolveRequestIdentity(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'],
      { role: extractUserRole(req), actorId: 'atp-reader' }
    );
    const { searchParams } = new URL(req.url);
    const editionId = searchParams.get('editionId');
    const warehouseId = searchParams.get('warehouseId');
    if (!editionId || !warehouseId) {
      return NextResponse.json({ success: false, error: 'Thiếu editionId hoặc warehouseId.' }, { status: 400 });
    }
    const [physical, atp] = await Promise.all([
      InventoryService.getBalance(editionId, warehouseId, 'NEW'),
      OrderService.getATP(editionId, warehouseId),
    ]);
    return NextResponse.json({ success: true, data: { editionId, warehouseId, physical, held: physical - atp, atp } });
  } catch (error: any) {
    return handleApiError(error);
  }
}

