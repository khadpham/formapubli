import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { db, portalSettings, warehouses } from '@/db';
import { eq } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal-settings — Lấy cấu hình portal (kho mặc định).
 * Quyền: Owner, Manager.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const rows = await db.select().from(portalSettings);
    const config: Record<string, string> = {};
    for (const r of rows) config[r.key] = r.value;
    // Fallback env nếu chưa có trong DB
    if (!config.PORTAL_WAREHOUSE_ID && process.env.PORTAL_WAREHOUSE_ID) {
      config.PORTAL_WAREHOUSE_ID = process.env.PORTAL_WAREHOUSE_ID;
    }
    return NextResponse.json({ success: true, data: config });
  } catch (e) {
    return handleApiError(e);
  }
}

/**
 * POST /api/portal-settings — Cập nhật cấu hình portal.
 * Body: { PORTAL_WAREHOUSE_ID: string }
 * Quyền: Owner, Manager.
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = await req.json().catch(() => ({}));
    const warehouseId = String(body.PORTAL_WAREHOUSE_ID || '').trim();
    if (!warehouseId) {
      return NextResponse.json(
        { success: false, error: 'Thiếu PORTAL_WAREHOUSE_ID.' },
        { status: 400 },
      );
    }
    // Kiểm tra kho tồn tại và đang hoạt động (tránh lưu id chết như vụ NV-01:
    // kho ngưng sau này thì đơn portal báo lỗi rõ lúc tạo, admin cấu hình lại).
    const wh = (
      await db
        .select({ id: warehouses.id, isActive: warehouses.isActive })
        .from(warehouses)
        .where(eq(warehouses.id, warehouseId))
        .limit(1)
    )[0];
    if (!wh) {
      return NextResponse.json(
        { success: false, error: 'Kho không tồn tại.' },
        { status: 400 },
      );
    }
    if (wh.isActive !== true) {
      return NextResponse.json(
        { success: false, error: 'Kho đã ngưng hoạt động.' },
        { status: 400 },
      );
    }
    await db
      .insert(portalSettings)
      .values({ key: 'PORTAL_WAREHOUSE_ID', value: warehouseId })
      .onConflictDoUpdate({
        target: portalSettings.key,
        set: { value: warehouseId, updatedAt: new Date().toISOString() },
      });
    return NextResponse.json({ success: true, data: { PORTAL_WAREHOUSE_ID: warehouseId } });
  } catch (e) {
    return handleApiError(e);
  }
}
