import { NextRequest, NextResponse } from 'next/server';
import { db, deliveryOrders, partners } from '@/db';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';

/**
 * GET /api/delivery-orders/[id]/invoice-prefill
 * Lấy sẵn thông tin MST/tên/địa chỉ từ hồ sơ đối tác của phiếu xuất kho
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE']);

  const { id } = await params;
  const orderRows = await db.select().from(deliveryOrders).where(eq(deliveryOrders.id, id)).limit(1);
  const order: any = orderRows[0];
  if (!order) {
    return NextResponse.json({ error: 'Không tìm thấy phiếu' }, { status: 404 });
  }

  // Ưu tiên thông tin đã lưu trên phiếu (nếu có)
  if (order.invoiceTaxCode && order.invoiceCompanyName) {
    return NextResponse.json({
      taxCode: order.invoiceTaxCode,
      companyName: order.invoiceCompanyName,
      address: order.invoiceAddress || '',
    });
  }

  // Fallback: lấy từ hồ sơ đối tác
  if (order.partnerId) {
    const partnerRows = await db.select().from(partners).where(eq(partners.id, order.partnerId)).limit(1);
    const partner: any = partnerRows[0];
    if (partner) {
      return NextResponse.json({
        taxCode: partner.taxCode || '',
        companyName: partner.name || '',
        address: partner.address || '',
      });
    }
  }

  return NextResponse.json({ taxCode: '', companyName: '', address: '' });
}
