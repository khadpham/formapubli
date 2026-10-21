import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeReturns } from '@/db';
import { pullShopeeReturns } from '@/services/shopee/returns-sync';
import { getShopeeConfig, resolveShopeeShopId } from '@/services/shopee/shop-config';

export const dynamic = 'force-dynamic';

const RETURN_LABEL: Record<string, string> = {
  REQUESTED: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  ACCEPTED: 'Đã chấp nhận',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};

/**
 * GET /api/shopee/returns - danh sách trả hàng/hoàn tiền từ DB.
 * POST /api/shopee/returns { hours? } - đồng bộ từ Shopee về.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const rows = await db.select().from(shopeeReturns).orderBy(desc(shopeeReturns.createdAt)).limit(100);
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({ ...r, statusLabel: RETURN_LABEL[r.status] || r.status })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as { hours?: number };
    const hours = Math.min(Math.max(Number(body.hours || 72) || 72, 1), 15 * 24);
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID || '0');
    const partnerKey = `${process.env.SHOPEE_PARTNER_KEY || ''}`;
    const baseUrl = `${process.env.SHOPEE_BASE_URL || 'https://partner.shopeemobile.com'}`.replace(/\/$/, '');
    const { shopId } = await resolveShopeeShopId();
    const shopCfg = await getShopeeConfig();
    if (!partnerId || !partnerKey || !shopId) {
      return NextResponse.json({ success: false, error: 'Chưa cấu hình Shopee.' }, { status: 400 });
    }
    const timeTo = Math.floor(Date.now() / 1000);
    const timeFrom = timeTo - hours * 3600;
    const result = await pullShopeeReturns(
      { shopId, partnerId, partnerKey, baseUrl, warehouseId: shopCfg.warehouseId, codEnabled: shopCfg.codEnabled },
      timeFrom,
      timeTo
    );
    return NextResponse.json({ success: true, data: { ...result, hours } });
  } catch (error) {
    return handleApiError(error);
  }
}
