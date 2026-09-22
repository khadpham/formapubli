import { NextRequest, NextResponse } from 'next/server';
import { PosCatalogService } from '@/services/pos-catalog.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * V4.1 S2.2/S2.3 — Danh mục POS theo kho: metadata + ATP + số bán hôm nay.
 * GET /api/pos/catalog?warehouseId=wh-hoi-cho-a
 * POS lọc atp > 0 và sắp xếp A-Z / bán chạy ngay trên response này.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
    ] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId');
    if (!warehouseId) {
      return NextResponse.json({ success: false, error: 'Thiếu warehouseId.' }, { status: 400 });
    }
    const data = await PosCatalogService.getCatalog(warehouseId);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
