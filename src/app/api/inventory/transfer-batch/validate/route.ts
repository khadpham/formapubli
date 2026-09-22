import { NextRequest, NextResponse } from 'next/server';
import { InventoryService } from '@/services/inventory.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

/**
 * V4.1 S1.3 — Nút "Kiểm tra tồn kho": dry-run thuần đọc, không ghi gì.
 * Stale trả 200 + {ok:false} để UI highlight đỏ dòng thiếu (không toast lỗi);
 * chỉ commit mới ném 409.
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);

    const body = await req.json();
    const { fromWarehouseId, toWarehouseId, items } = body ?? {};
    const result = await InventoryService.checkBatchAvailability({ fromWarehouseId, toWarehouseId, items });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return handleApiError(error);
  }
}
