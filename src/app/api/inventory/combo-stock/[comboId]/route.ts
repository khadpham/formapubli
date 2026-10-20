import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { getComboStocks } from '@/services/combo.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory/combo-stock/[comboId]?warehouseId=... - ton co the ban cua 1 combo.
 * Ton = min(ton tung thanh phan / so luong yeu cau). warehouseId bat buoc.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ comboId: string }> }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE']);
    const { comboId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId')?.trim() || '';
    if (!comboId) return NextResponse.json({ error: 'Thieu comboId.' }, { status: 400 });
    if (!warehouseId) return NextResponse.json({ error: 'Thieu warehouseId.' }, { status: 400 });
    const m = await getComboStocks([comboId], warehouseId);
    const s = m.get(comboId) || { stock: 0, components: [] };
    return NextResponse.json({ ok: true, stock: s.stock, components: s.components });
  } catch (e) {
    return handleApiError(e);
  }
}
