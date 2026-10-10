import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/order.service';
import { InventoryService } from '@/services/inventory.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Bước 1 - Tra cứu tồn khả dụng ATP (physical NEW − đơn PENDING giữ chỗ).
 * GET /api/atp?editionId=&warehouseId=            → 1 ấn bản (giữ nguyên cho
 *                                                   các nơi gọi cũ)
 * GET /api/atp?editionIds=a,b,c&warehouseId=      → nhiều ấn bản trong 1 vòng
 * POS dùng để chặn bán lẹm hàng online đã giữ chỗ (team wire vào addToCart).
 * P1b: Default-Deny fail-closed, bắt buộc session cookie hợp lệ.
 *
 * 30/09: thêm `editionIds`. Trước đây POS chốt đơn gọi vòng lặp MỘT LẦN cho
 * từng cuốn, nối tiếp ⇒ chờ nhiều giây ở hội chợ. Gộp còn 1 vòng.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(
      req,
      ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX']
    );
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId');
    const single = searchParams.get('editionId');
    const many = searchParams.get('editionIds');
    const editionIds = many
      ? many.split(',').map((s) => s.trim()).filter(Boolean)
      : single
        ? [single]
        : [];
    if (editionIds.length === 0 || !warehouseId) {
      return NextResponse.json({ success: false, error: 'Thiếu editionId(s) hoặc warehouseId.' }, { status: 400 });
    }
    // Chặn trần: `inArray` dài quá là câu SQL rác và là chậm. 200 ấn bản đã vượt
    // xa giỏ POS thật (chốt đơn tay ~20 cuốn là trần nghiệp vụ).
    if (editionIds.length > 200) {
      return NextResponse.json({ success: false, error: 'Quá nhiều ấn bản trong một lần tra ATP.' }, { status: 400 });
    }
    const [balanceMap, atpMap] = await Promise.all([
      InventoryService.getBatchBalance(editionIds, warehouseId, 'NEW'),
      OrderService.getBatchATP(editionIds, warehouseId),
    ]);
    const items = editionIds.map((id) => {
      const physical = balanceMap.get(id) ?? 0;
      const atp = atpMap.get(id) ?? 0;
      return { editionId: id, physical, atp, held: physical - atp };
    });
    // Giữ nguyên hình dạng cũ khi gọi 1 ấn bản để không phá 3 nơi đang gọi.
    if (!many) {
      return NextResponse.json({ success: true, data: { warehouseId, ...items[0] } });
    }
    return NextResponse.json({ success: true, data: { warehouseId, items } });
  } catch (error: any) {
    return handleApiError(error);
  }
}

