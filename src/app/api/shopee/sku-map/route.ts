import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeSkuComponents, editions } from '@/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/shopee/sku-map - danh sách mapping SKU Shopee → thành phần ERP.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const rows = await db.select().from(shopeeSkuComponents);
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/shopee/sku-map { shopeeSku, components: [{ editionId, quantity }] }
 * Ghi đè mapping cho một SKU (xóa cũ, thêm mới).
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as {
      shopeeSku?: string;
      components?: Array<{ editionId?: string; quantity?: number }>;
    };
    const shopeeSku = String(body.shopeeSku || '').trim();
    const components = (body.components || []).filter(
      (c) => c.editionId && Number(c.quantity) > 0
    );
    if (!shopeeSku || components.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Thiếu SKU hoặc danh sách thành phần.' },
        { status: 400 }
      );
    }
    // Kiểm tra edition tồn tại.
    const ids = [...new Set(components.map((c) => String(c.editionId)))];
    const found = await db
      .select({ id: editions.id })
      .from(editions);
    const valid = new Set(found.map((e) => e.id));
    for (const id of ids) {
      if (!valid.has(id)) {
        return NextResponse.json(
          { success: false, error: `Sản phẩm không tồn tại: ${id}` },
          { status: 400 }
        );
      }
    }
    await db.delete(shopeeSkuComponents).where(eq(shopeeSkuComponents.shopeeSku, shopeeSku));
    await db.insert(shopeeSkuComponents).values(
      components.map((c) => ({
        shopeeSku,
        editionId: String(c.editionId),
        quantity: Math.floor(Number(c.quantity)),
      }))
    );
    return NextResponse.json({ success: true, data: { shopeeSku, count: components.length } });
  } catch (error) {
    return handleApiError(error);
  }
}
