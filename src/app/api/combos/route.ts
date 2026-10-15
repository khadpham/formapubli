import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { comboComponents, products } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { getComboStocks, validateComponents } from '@/services/combo.service';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_WAREHOUSE'] as const;
const WRITE_ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as const;

/**
 * GET /api/combos?warehouseId=... - danh sach combo kem ton dong.
 * Co warehouseId: ton tinh theo kho. Khong co: stock = null (chi mo ta cau truc).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [...READ_ROLES]);
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId')?.trim() || '';

    const comboRows = await db
      .select({
        comboProductId: comboComponents.comboProductId,
        componentProductId: comboComponents.componentProductId,
        quantity: comboComponents.quantity,
      })
      .from(comboComponents);
    const comboIds = Array.from(new Set(comboRows.map((r) => r.comboProductId)));
    if (comboIds.length === 0) return NextResponse.json({ combos: [] });

    const prodRows = await db
      .select({ id: products.id, code: products.code, name: products.name, sellingPrice: products.sellingPrice })
      .from(products)
      .where(inArray(products.id, comboIds));
    const prodMap = new Map(prodRows.map((p) => [p.id, p]));

    let stocks = new Map<string, { stock: number; components: any[] }>();
    if (warehouseId) {
      stocks = await getComboStocks(comboIds, warehouseId);
    }
    const combos = comboIds.map((id) => {
      const p = prodMap.get(id);
      const s = stocks.get(id);
      return {
        id,
        code: p?.code || '',
        name: p?.name || id,
        sellingPrice: p?.sellingPrice ?? 0,
        stock: s ? s.stock : null,
        components: s
          ? s.components
          : comboRows.filter((r) => r.comboProductId === id).map((r) => ({ productId: r.componentProductId, required: r.quantity })),
      };
    });
    return NextResponse.json({ combos });
  } catch (e) {
    return handleApiError(e);
  }
}

/**
 * POST /api/combos - tao combo moi (Owner/Manager).
 * Body: { code, name, sellingPrice, components: [{ productId, quantity }] }
 * Thanh phan phai la sach co dong editions (de but toan ledger khong vo FK).
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, [...WRITE_ROLES]);
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || '').trim();
    const name = String(body?.name || '').trim();
    const sellingPrice = Number(body?.sellingPrice);
    const components = body?.components;

    if (!code) return NextResponse.json({ error: 'Thieu ma combo.' }, { status: 400 });
    if (!name) return NextResponse.json({ error: 'Thieu ten combo.' }, { status: 400 });
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      return NextResponse.json({ error: 'Gia ban khong hop le.' }, { status: 400 });
    }
    if (!Array.isArray(components) || components.length === 0) {
      return NextResponse.json({ error: 'Combo phai co it nhat 1 sach thanh phan.' }, { status: 400 });
    }
    const compError = await validateComponents(components);
    if (compError) return NextResponse.json({ error: compError }, { status: 400 });

    const dup = await db.select({ id: products.id }).from(products).where(eq(products.code, code)).limit(1);
    if (dup.length > 0) return NextResponse.json({ error: `Ma ${code} da ton tai.` }, { status: 400 });

    const id = `cb-${randomUUID()}`;
    await db.transaction(async (tx) => {
      await tx.insert(products).values({ id, code, name, productKind: 'BOOK', sellingPrice });
      for (const c of components) {
        await tx.insert(comboComponents).values({
          id: `cc-${randomUUID()}`,
          comboProductId: id,
          componentProductId: String(c.productId),
          quantity: Number(c.quantity),
        });
      }
    });
    return NextResponse.json({ id, code, name, sellingPrice });
  } catch (e) {
    return handleApiError(e);
  }
}
