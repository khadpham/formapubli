/**
 * POST /api/inventory/counts/[id]/submit - Gửi duyệt
 * POST /api/inventory/counts/[id]/approve - Duyệt và tạo bút toán ADJUSTMENT
 *
 * 2026-10-15: Viết lại approve dùng InventoryService.recordMovement()
 * để đảm bảo đúng schema (quantityDelta, actorId, idempotencyKey),
 * cập nhật stockBalances, và chống xuất âm.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { inventoryCounts, inventoryCountItems, products, comboComponents } from '@/db/schema';
import { eq, and, isNull, count } from 'drizzle-orm';
import { InventoryService } from '@/services/inventory.service';
import { createDocument } from '@/services/warehouse-document.service';

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
      // SUBMIT: gửi duyệt
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

    // APPROVE: duyệt và tạo bút toán điều chỉnh
    if (c.status !== 'PENDING_APPROVAL') {
      return NextResponse.json({ ok: false, error: 'Chưa gửi duyệt' }, { status: 400 });
    }

    const items = await db.select().from(inventoryCountItems).where(eq(inventoryCountItems.countId, id));

    // Lấy danh sách combo để bỏ qua (phòng thủ đợt snapshot cũ có combo)
    const comboRows = await db.select({ id: comboComponents.comboProductId }).from(comboComponents);
    const comboSet = new Set(comboRows.map(r => r.id));

    // Lấy productKind để set isBook đúng
    const productIds = items.map(it => it.productId);
    const prodRows = productIds.length > 0
      ? await db.select({ id: products.id, productKind: products.productKind }).from(products)
      : [];
    const kindMap = new Map(prodRows.map(p => [p.id, p.productKind]));

    const docRef = 'KK-' + id.substring(0, 8).toUpperCase();
    let created = 0;
    let skipped = 0;

    for (const it of items) {
      // Bỏ qua combo (không có tồn vật lý riêng)
      if (comboSet.has(it.productId)) {
        skipped++;
        continue;
      }
      const diff = (it.countedQty ?? 0) - it.systemQty;
      if (diff === 0) continue;

      const kind = kindMap.get(it.productId);
      const isBook = kind !== 'GOODS';

      await InventoryService.recordMovement({
        editionId: it.productId,
        isBook,
        warehouseId: c.warehouseId,
        eventType: 'ADJUSTMENT',
        quantityDelta: diff,
        condition: 'NEW',
        documentRef: docRef,
        note: 'Điều chỉnh kiểm kê' + (it.note ? ': ' + it.note : ''),
        actorId: 'system',
        idempotencyKey: `count-adjust-${id}-${it.id}`,
      });
      created++;
    }

    await db.update(inventoryCounts)
      .set({ status: 'APPROVED', approvedAt: new Date().toISOString() })
      .where(eq(inventoryCounts.id, id));

    // Tự động tạo Biên bản kiểm kê
    try {
      const docItems = items
        .filter(it => !comboSet.has(it.productId))
        .map(it => {
          const diff = (it.countedQty ?? 0) - it.systemQty;
          return {
            productId: it.productId,
            quantity: it.countedQty ?? 0,
            note: diff !== 0 ? `Lệch ${diff > 0 ? '+' : ''}${diff} (hệ thống: ${it.systemQty})` : undefined,
          };
        });
      const bbkk = await createDocument({
        docType: 'COUNT_MINUTES',
        warehouseId: c.warehouseId,
        items: docItems,
        note: `Biên bản kiểm kê từ đợt ${docRef}`,
        ledgerRefs: [docRef],
        createdBy: 'system',
      });
      console.log('[counts/approve] Đã tạo biên bản:', bbkk.docNumber);
    } catch (docErr: any) {
      console.error('[counts/approve] Lỗi tạo biên bản:', docErr.message);
      // Không fail cả approve vì lỗi tạo biên bản
    }

    return NextResponse.json({
      ok: true,
      message: `Đã duyệt. Tạo ${created} bút toán điều chỉnh.` + (skipped > 0 ? ` Bỏ qua ${skipped} combo.` : ''),
      adjustments: created,
      skippedCombos: skipped,
    });
  } catch (e: any) {
    console.error('[counts/action] lỗi:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
