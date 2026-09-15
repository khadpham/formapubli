import { NextRequest, NextResponse } from 'next/server';
import { BundleService } from '@/services/bundle.service';
import { extractUserRole, recordAuditLog } from '@/lib/rbac-guard';
import { resolveRequestIdentity, AuthError } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

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
    return handleApiError(error);
  }
}

// POST /api/bundles { action: 'create', code, seasonName, releaseDate,
//   comboPrice, totalCoverPrice?, items: [{ editionId, quantityInBundle? }] }
// Chỉ Quản lý/Chủ được định nghĩa combo.
export async function POST(req: NextRequest) {
  try {
    const identity = await resolveRequestIdentity(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER'],
      { role: extractUserRole(req), actorId: req.headers.get('x-formapubli-actor') || extractUserRole(req) }
    );
    if (identity.role !== 'ROLE_OWNER' && identity.role !== 'ROLE_MANAGER') {
      throw new AuthError(403, 'Chỉ Quản lý/Chủ được định nghĩa combo mới.');
    }

    const body = await req.json();
    const { action } = body;
    const userRole = identity.role as any;
    const actorHeader = identity.actorId;

    if (action === 'create') {
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
    return handleApiError(error);
  }
}

