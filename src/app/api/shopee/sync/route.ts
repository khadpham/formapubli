import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { pullShopeeOrders } from '@/services/shopee/order-sync';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopee/sync { hours?, from_date? } - kéo đơn Shopee chủ động (UI nút bấm tay
 * và job định kỳ dùng chung). Mặc định quét 24 giờ qua; tối đa 15 ngày
 * (cửa sổ get_order_list của Shopee) cho mỗi cửa sổ - nếu from_date xa hơn,
 * tự chia thành nhiều cửa sổ 15 ngày để lấy đủ lịch sử.
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as { hours?: number; from_date?: string };
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl =
      `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const shopId = (await resolveShopeeShopId()).shopId;
    const shopCfg = await getShopeeConfig();
    if (!partnerId || !partnerKey || !shopId) {
      return NextResponse.json(
        { success: false, error: 'Chưa cấu hình Shopee (partner/shop).' },
        { status: 400 }
      );
    }
    const timeTo = Math.floor(Date.now() / 1000);
    // Ưu tiên from_date (YYYY-MM-DD) nếu có, mặc định 2026-10-01 để lấy đủ lịch sử shop.
    let timeFrom: number;
    let windowLabel: string;
    if (body.from_date && /^\d{4}-\d{2}-\d{2}$/.test(body.from_date)) {
      timeFrom = Math.floor(new Date(`${body.from_date}T00:00:00+07:00`).getTime() / 1000);
      windowLabel = `from_date=${body.from_date}`;
    } else {
      const hours = Math.min(Math.max(Number(body.hours || 24) || 24, 1), 15 * 24);
      timeFrom = timeTo - hours * 3600;
      windowLabel = `hours=${hours}`;
    }
    const cfg = {
      shopId,
      partnerId,
      partnerKey,
      baseUrl,
      warehouseId: shopCfg.warehouseId,
      codEnabled: shopCfg.codEnabled,
    };
    // Shopee giới hạn 15 ngày/cửa sổ - chia nhỏ nếu khoảng thời gian dài hơn.
    const WINDOW = 15 * 24 * 3600;
    const total: { pulled: number; skipped: number; quarantined: unknown[] } = {
      pulled: 0,
      skipped: 0,
      quarantined: [],
    };
    let winEnd = timeTo;
    while (winEnd > timeFrom) {
      const winStart = Math.max(timeFrom, winEnd - WINDOW);
      const r = await pullShopeeOrders(cfg, winStart, winEnd);
      total.pulled += r.pulled;
      total.skipped += r.skipped;
      total.quarantined.push(...r.quarantined);
      winEnd = winStart;
    }
    return NextResponse.json({ success: true, data: { ...total, window: windowLabel } });
  } catch (error) {
    return handleApiError(error);
  }
}
