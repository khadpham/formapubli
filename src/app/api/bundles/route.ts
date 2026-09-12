import { NextRequest, NextResponse } from 'next/server';
import { BundleService } from '@/services/bundle.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

// GET /api/bundles — danh sách combo đang bán
// GET /api/bundles?id=<bundleId>&warehouseId=<wh> — chi tiết + tồn khả dụng bottleneck
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const warehouseId = searchParams.get('warehouseId');

    if (id) {
      const detail = await BundleService.getBundle(id);
      if (warehouseId) {
        const availability = await BundleService.getAvailability(id, warehouseId);
        return NextResponse.json({ success: true, data: { ...detail, availability } });
      }
      return NextResponse.json({ success: true, data: detail });
    }

    const list = await BundleService.listBundles(true);
    return NextResponse.json({ success: true, data: list });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi truy vấn combo' },
      { status: 400 }
    );
  }
}

// POST /api/bundles { action: 'create', code, seasonName, releaseDate,
//   comboPrice, totalCoverPrice?, items: [{ editionId, quantityInBundle? }] }
// Chỉ Quản lý/Chủ được định nghĩa combo.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const userRole = extractUserRole(req);
    const actorHeader = req.headers.get('x-formapubli-actor') || userRole;

    if (action === 'create') {
      if (userRole !== 'ROLE_OWNER' && userRole !== 'ROLE_MANAGER') {
        return NextResponse.json(
          { success: false, error: 'Chỉ Quản lý/Chủ được định nghĩa combo mới.' },
          { status: 403 }
        );
      }
      const { code, seasonName, releaseDate, comboPrice, totalCoverPrice, items } = body;
      if (!code || !seasonName || !releaseDate || comboPrice === undefined || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Thiếu mã combo, mùa phát hành, giá hoặc linh kiện (items).' },
          { status: 400 }
        );
      }
      const result = await BundleService.createBundle({
        code,
        seasonName,
        releaseDate,
        comboPrice: parseFloat(comboPrice),
        totalCoverPrice:
          totalCoverPrice !== undefined && totalCoverPrice !== null
            ? parseFloat(totalCoverPrice)
            : undefined,
        items: items.map((it: any) => ({
          editionId: it.editionId,
          quantityInBundle: parseInt(it.quantityInBundle ?? 1, 10),
        })),
      });
      recordAuditLog({
        action: 'MUTATE_ORDER',
        actorRole: userRole,
        actorId: actorHeader,
        resource: '/api/bundles',
        details: `Tạo combo ${code} giá ${comboPrice} đ (${items.length} linh kiện).`,
      });
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { success: false, error: `Hành động không hợp lệ: ${action}. Chỉ chấp nhận 'create'.` },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi xử lý combo' },
      { status: 400 }
    );
  }
}
