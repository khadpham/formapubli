/**
 * POST /api/inventory/counts/[id]/submit - Gửi duyệt
 * POST /api/inventory/counts/[id]/approve - Duyệt và tạo bút toán ADJUSTMENT
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { inventoryCounts, inventoryCountItems, inventoryLedger } from '@/db/schema';
import { eq, and, isNull, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pathname = new URL(req.url).pathname;
    const isApprove = pathname.endsWith('/approve');

    const cnt = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, id)).limit(1);
    if (cnt.length === 0) {
      return NextResponse.json({ ok: false, error: 'Không tìm thấy' }, { status: 404 });
    }
    const c = cnt[0];

    if (!isApprove) {
      if (!['DRAFT', 'COUNTING'].includes(c.status)) {
        return NextResponse.json({ ok: false, error: 'Trạng thái không hợp lệ' }, { status: 400 });
      }
      const uncounted = await db
        .select({ c: count() })
        .from(inventoryCountItems)
        .where(and(eq(inventoryCountItems.countId, id), isNull(inventoryCountItems.countedQty)));
      const n = Number(uncounted[0]?.c || 0);
      if (n > 0) {
        return NextResponse.json({ ok: false, error: `Còn ${n} mặt hàng chưa nhập số đếm` }, { status: 400 });
      }
      await db.update(inventoryCounts)
        .set({ status: 'PENDING_APPROVAL', submittedAt: new Date().toISOString() })
        .where(eq(inventoryCounts.id, id));
      return NextResponse.json({ ok: true, message: 'Đã gửi duyệt' });
    }

    // APPROVE
    if (c.status !== 'PENDING_APPROVAL') {
      return NextResponse.json({ ok: false, error: 'Chưa gửi duyệt' }, { status: 400 });
    }
    const items = await db.select().from(inventoryCountItems).where(eq(inventoryCountItems.countId, id));
    let created = 0;
    const docRef = 'KK-' + id.substring(0, 8).toUpperCase();

    for (const it of items) {
      const diff = (it.countedQty ?? 0) - it.systemQty;
      if (diff === 0) continue;
      await db.insert(inventoryLedger).values({
        id: randomUUID(),
        warehouseId: c.warehouseId,
        productId: it.productId,
        editionId: it.editionId,
        eventType: 'ADJUSTMENT',
        delta: diff,
        documentRef: docRef,
        note: 'Điều chỉnh kiểm kê' + (it.note ? ': ' + it.note : ''),
        createdAt: new Date().toISOString(),
      } as any);
      created++;
    }

    await db.update(inventoryCounts)
      .set({ status: 'APPROVED', approvedAt: new Date().toISOString() })
      .where(eq(inventoryCounts.id, id));

    return NextResponse.json({
      ok: true,
      message: `Đã duyệt. Tạo ${created} bút toán điều chỉnh.`,
      adjustments: created,
    });
  } catch (e: any) {
    console.error('[counts/action] lỗi:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
