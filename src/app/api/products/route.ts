import { NextRequest, NextResponse } from 'next/server';
import { ProductService } from '@/services/product.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Danh mục hàng hóa.
 * GET  /api/products?search=&includeInactive=&limit=
 * POST /api/products { code, name, sellingPrice, costPrice?, barcode?, description?, isGiftItem? }
 *
 * Chỉ Chủ sở hữu / Quản lý được nhập — thu ngân KHÔNG tạo được hàng hóa.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { searchParams } = new URL(req.url);
    const items = await ProductService.listGoods({
      search: searchParams.get('search') || '',
      includeInactive: searchParams.get('includeInactive') === 'true',
      limit: parseInt(searchParams.get('limit') || '200', 10) || 200,
    });
    return NextResponse.json({ success: true, products: items, total: items.length });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const body = await req.json();

    const created = await ProductService.create({
      code: body.code,
      name: body.name,
      kind: body.kind,
      sellingPrice: body.sellingPrice ?? body.price ?? 0,
      costPrice: body.costPrice,
      barcode: body.barcode,
      description: body.description,
      isGiftItem: body.isGiftItem === true,
    });

    await recordAuditLog({
      // `ADJUST_STOCK` là action gần nhất đúng nghĩa: thêm/sửa mặt hàng trong
      // kho. KHÔNG tự thêm action mới vào union `AuditLogParams` — phải kiểm tra
      // CHECK constraint trên `audit_logs.action` trước, nếu không sẽ ghi log
      // hỏng ngay lúc nhập hàng hóa.
      action: 'ADJUST_STOCK',
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/products',
      details: `Tạo hàng hóa ${created.code} — ${created.name}.`,
    });

    return NextResponse.json({ success: true, product: created }, { status: 201 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}