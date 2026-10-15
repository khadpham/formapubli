/**
 * GET /api/inventory/counts/[id] - Chi tiết đợt kiểm kê
 * POST /api/inventory/counts/[id] - Snapshot tồn kho (action: snapshot)
 * PUT /api/inventory/counts/[id] - Cập nhật số đếm
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { inventoryCounts, inventoryCountItems, products, inventoryLedger } from '@/db/schema';
import { eq, and, isNull, sum, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const count = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, id)).limit(1);
    if (count.length === 0) {
      return NextResponse.json({ ok: false, error: 'Không tìm thấy' }, { status: 404 });
    }
    const items = await db
      .select({
        id: inventoryCountItems.id,
        productId: inventoryCountItems.productId,
        productName: products.name,
        systemQty: inventoryCountItems.systemQty,
        countedQty: inventoryCountItems.countedQty,
        note: inventoryCountItems.note,
      })
      .from(inventoryCountItems)
      .leftJoin(products, eq(inventoryCountItems.productId, products.id))
      .where(eq(inventoryCountItems.countId, id));

    return NextResponse.json({ ok: true, data: { ...count[0], items } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (body.action !== 'snapshot') {
      return NextResponse.json({ ok: false, error: 'Action không hợp lệ' }, { status: 400 });
    }

    const count = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, id)).limit(1);
    if (count.length === 0 || count[0].status !== 'DRAFT') {
      return NextResponse.json({ ok: false, error: 'Trạng thái không hợp lệ' }, { status: 400 });
    }

    // Tính tồn kho từ ledger cho từng sản phẩm
    const stockRows = await db
      .select({
        productId: inventoryLedger.productId,
        qty: sum(inventoryLedger.quantityDelta),
      })
      .from(inventoryLedger)
      .where(eq(inventoryLedger.warehouseId, count[0].warehouseId))
      .groupBy(inventoryLedger.productId);

    const stockMap = new Map(stockRows.map(r => [r.productId, Math.max(0, Math.round(Number(r.qty) || 0))]));

    // Lấy tất cả sản phẩm để snapshot (kể cả tồn 0)
    const allProducts = await db.select({ id: products.id }).from(products).limit(500);

    let inserted = 0;
    for (const p of allProducts) {
      try {
        await db.insert(inventoryCountItems).values({
          id: randomUUID(),
          countId: id,
          productId: p.id,
          systemQty: stockMap.get(p.id) || 0,
        });
        inserted++;
      } catch {
        // Trùng thì bỏ qua
      }
    }

    await db.update(inventoryCounts).set({ status: 'COUNTING' }).where(eq(inventoryCounts.id, id));
    return NextResponse.json({ ok: true, message: `Đã snapshot ${inserted} sản phẩm`, count: inserted });
  } catch (e: any) {
    console.error('[counts] lỗi:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json();
    const { items } = body;
    if (!Array.isArray(items)) {
      return NextResponse.json({ ok: false, error: 'Thiếu items' }, { status: 400 });
    }
    for (const it of items) {
      if (!it.itemId) continue;
      await db.update(inventoryCountItems)
        .set({
          countedQty: it.countedQty != null ? Math.max(0, Math.round(Number(it.countedQty))) : null,
          note: it.note || null,
        })
        .where(eq(inventoryCountItems.id, it.itemId));
    }
    return NextResponse.json({ ok: true, message: `Đã cập nhật ${items.length} dòng` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/inventory/counts/[id] - Huy dot kiem ke (chi khi chua duyet)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const count = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, id)).limit(1);
    if (count.length === 0) {
      return NextResponse.json({ ok: false, error: 'Khong tim thay' }, { status: 404 });
    }
    if (count[0].status === 'APPROVED') {
      return NextResponse.json({ ok: false, error: 'Dot da duyet, khong the huy' }, { status: 400 });
    }
    await db.update(inventoryCounts).set({ status: 'CANCELLED' }).where(eq(inventoryCounts.id, id));
    return NextResponse.json({ ok: true, message: 'Da huy dot kiem ke' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
