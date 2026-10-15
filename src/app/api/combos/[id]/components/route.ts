import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { comboComponents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { isCombo, validateComponents } from '@/services/combo.service';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/combos/[id]/components - thay the toan bo thanh phan (Owner/Manager).
 * Body: { components: [{ productId, quantity }] }. Xoa cu, insert moi (1 transaction).
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const components = body?.components;

    if (!id) return NextResponse.json({ error: 'Thieu id combo.' }, { status: 400 });
    if (!(await isCombo(id))) {
      return NextResponse.json({ error: 'Combo khong ton tai.' }, { status: 404 });
    }
    const compError = await validateComponents(components);
    if (compError) return NextResponse.json({ error: compError }, { status: 400 });

    await db.transaction(async (tx) => {
      await tx.delete(comboComponents).where(eq(comboComponents.comboProductId, id));
      for (const c of components) {
        await tx.insert(comboComponents).values({
          id: `cc-${randomUUID()}`,
          comboProductId: id,
          componentProductId: String(c.productId),
          quantity: Number(c.quantity),
        });
      }
    });
    return NextResponse.json({ ok: true, id, count: components.length });
  } catch (e) {
    return handleApiError(e);
  }
}
