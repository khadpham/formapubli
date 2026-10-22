import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db, shopeeMarketing } from '@/db';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  VOUCHER: 'Voucher',
  DISCOUNT: 'Giảm giá',
  BUNDLE: 'Combo khuyến mãi',
  ADDON: 'Mua kèm deal sốc',
  FLASH_SALE: 'Flash Sale',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  SCHEDULED: 'Đã lên lịch',
  ONGOING: 'Đang chạy',
  EXPIRED: 'Đã hết hạn',
  CANCELLED: 'Đã hủy',
};

/**
 * GET /api/shopee/marketing?type=VOUCHER - danh sách chương trình khuyến mãi.
 * Chỉ trả cấu hình vận hành (tên, thời gian, trạng thái). Ngân sách đã chi
 * và hiệu quả (ROAS) là dữ liệu tài chính, chỉ hiện ở tab Chủ.
 * POST /api/shopee/marketing { type, name, config, startAt, endAt } - tạo mới (lưu nháp).
 * API Shopee thật (VoucherManager/DiscountManager/...) chưa research xong,
 * hiện lưu local trước, đẩy lên sàn ở bước sau.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const type = new URL(req.url).searchParams.get('type') || '';
    const rows = type
      ? await db.select().from(shopeeMarketing).where(eq(shopeeMarketing.type, type)).orderBy(desc(shopeeMarketing.createdAt))
      : await db.select().from(shopeeMarketing).orderBy(desc(shopeeMarketing.createdAt));
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        typeLabel: TYPE_LABEL[r.type] || r.type,
        statusLabel: STATUS_LABEL[r.status] || r.status,
        config: (() => { try { return JSON.parse(r.configJson || '{}'); } catch { return {}; } })(),
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_WAREHOUSE',
      'ROLE_SHOPEE_OPS',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as {
      type?: string;
      name?: string;
      config?: Record<string, unknown>;
      startAt?: string;
      endAt?: string;
    };
    const type = `${body.type || ''}`.toUpperCase();
    if (!['VOUCHER', 'DISCOUNT', 'BUNDLE', 'ADDON', 'FLASH_SALE'].includes(type)) {
      return NextResponse.json({ success: false, error: 'Loại chương trình không hợp lệ.' }, { status: 400 });
    }
    const name = `${body.name || ''}`.trim();
    if (!name) {
      return NextResponse.json({ success: false, error: 'Thiếu tên chương trình.' }, { status: 400 });
    }
    const id = `mkt-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    await db.insert(shopeeMarketing).values({
      id,
      type,
      name,
      configJson: JSON.stringify(body.config || {}),
      status: 'DRAFT',
      startAt: body.startAt || null,
      endAt: body.endAt || null,
      createdBy: session.actorId || null,
    });
    return NextResponse.json({ success: true, data: { id } });
  } catch (e) {
    return handleApiError(e);
  }
}
