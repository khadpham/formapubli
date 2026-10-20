/**
 * POST /api/inventory/counts - Tạo đợt kiểm kê mới
 * GET /api/inventory/counts - Danh sách đợt kiểm kê
 *
 * Body POST: { warehouseId: string, note?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { inventoryCounts, inventoryCountItems, warehouses } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function GET() {
  try {
    const counts = await db
      .select({
        id: inventoryCounts.id,
        warehouseId: inventoryCounts.warehouseId,
        status: inventoryCounts.status,
        note: inventoryCounts.note,
        createdAt: inventoryCounts.createdAt,
        submittedAt: inventoryCounts.submittedAt,
        approvedAt: inventoryCounts.approvedAt,
      })
      .from(inventoryCounts)
      .orderBy(desc(inventoryCounts.createdAt))
      .limit(50);

    return NextResponse.json({ ok: true, data: counts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { warehouseId, note } = body;

    if (!warehouseId) {
      return NextResponse.json({ ok: false, error: 'Thiếu warehouseId' }, { status: 400 });
    }

    // Kiểm tra kho tồn tại
    const wh = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId)).limit(1);
    if (wh.length === 0) {
      return NextResponse.json({ ok: false, error: 'Kho không tồn tại' }, { status: 404 });
    }

    // Kiểm tra có đợt đang mở không
    const open = await db
      .select()
      .from(inventoryCounts)
      .where(eq(inventoryCounts.warehouseId, warehouseId))
      .limit(10);
    const hasOpen = open.some(o => ['DRAFT', 'COUNTING', 'PENDING_APPROVAL'].includes(o.status));
    if (hasOpen) {
      return NextResponse.json(
        { ok: false, error: 'Kho này đang có đợt kiểm kê chưa hoàn tất' },
        { status: 400 }
      );
    }

    const id = randomUUID();
    await db.insert(inventoryCounts).values({
      id,
      warehouseId,
      status: 'DRAFT',
      note: note || null,
    });

    return NextResponse.json({ ok: true, id, message: 'Đã tạo đợt kiểm kê' });
  } catch (e: any) {
    console.error('[inventory/counts] lỗi:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
