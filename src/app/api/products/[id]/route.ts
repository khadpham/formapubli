import { NextRequest, NextResponse } from 'next/server';
import { ProductService } from '@/services/product.service';
import { recordAuditLog } from '@/lib/rbac-guard';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * Sửa hàng hóa.
 * PATCH /api/products/:id { name?, sellingPrice?, costPrice?, barcode?, description?, isGiftItem?, isActive? }
 *
 * KHÔNG cho đổi `code` sau khi đã nhập: mã là mã vạch người bán dán lên sản
 * phẩm, đổi giữa chừng làm hàng cũ không tra được. Muốn đổi thì tạo mới.
 *
 * `costPrice` KHÔNG còn được nhận — xem giải thích ở `/api/products/route.ts`.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { id } = await ctx.params;
    const body = await req.json();

    if (body.code !== undefined) {
      return NextResponse.json(
        { success: false, error: 'Không đổi được mã sản phẩm sau khi đã nhập.' },
        { status: 400 }
      );
    }

    const updated = await ProductService.update(id, {
      name: body.name,
      sellingPrice: body.sellingPrice ?? body.price,
      // Không truyền `costPrice`: đã chốt không nhập giá vốn lúc này.
      barcode: body.barcode,
      description: body.description,
      isGiftItem: body.isGiftItem,
      isActive: body.isActive,
    });

    await recordAuditLog({
      // Xem giải thích ở /api/products/route.ts — `ADJUST_STOCK`, không tự thêm action.
      action: 'ADJUST_STOCK',
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/products',
      details: `Sửa hàng hóa ${updated.code} — ${updated.name}.`,
    });

    return NextResponse.json({ success: true, product: updated });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}