/**
 * PUT /api/products/[id]/threshold - Cập nhật ngưỡng tồn thấp
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { products } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const threshold = Math.max(0, Math.round(Number(body.threshold) || 0));

    await db.update(products)
      .set({ lowStockThreshold: threshold })
      .where(eq(products.id, id));

    return NextResponse.json({ ok: true, message: 'Đã cập nhật ngưỡng' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
