import { NextRequest, NextResponse } from 'next/server';
import { db, deliveryOrders, einvoices, partners } from '@/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireSessionRole } from '@/lib/auth-session';
import { MSInvoiceService } from '@/services/msinvoice.service';

/**
 * POST /api/delivery-orders/[id]/create-invoice
 * Tạo hóa đơn điện tử bổ sung cho phiếu xuất kho cũ đã duyệt.
 * Body: { taxCode, companyName, address } - thông tin người mua (bắt buộc)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Lấy phiếu xuất kho
  const orderRows = await db.select().from(deliveryOrders).where(eq(deliveryOrders.id, id)).limit(1);
  const order: any = orderRows[0];
  if (!order) {
    return NextResponse.json({ error: 'Không tìm thấy phiếu xuất kho' }, { status: 404 });
  }

  // Tự điền từ hồ sơ đối tác nếu body không gửi
  let taxCode = body.taxCode;
  let companyName = body.companyName;
  let address = body.address;
  if ((!taxCode || !companyName) && order.partnerId) {
    const partnerRows = await db.select().from(partners).where(eq(partners.id, order.partnerId)).limit(1);
    const partner: any = partnerRows[0];
    if (partner) {
      if (!taxCode) taxCode = partner.taxCode;
      if (!companyName) companyName = partner.name;
      if (!address) address = partner.address;
    }
  }

  if (!taxCode || !companyName) {
    return NextResponse.json(
      { error: 'Thiếu MST hoặc tên công ty người mua' },
      { status: 400 }
    );
  }

  // Kiểm tra đã có hóa đơn chưa
  const existing = await db.select().from(einvoices).where(eq(einvoices.sourceOrderIds, JSON.stringify([`delivery:${id}`]))).limit(1);
  // Tìm theo LIKE vì sourceOrderIds là JSON string
  const allInvoices = await db.select({ id: einvoices.id, sourceOrderIds: einvoices.sourceOrderIds }).from(einvoices);
  const alreadyHas = allInvoices.some((inv: any) => {
    try {
      const ids = JSON.parse(inv.sourceOrderIds || '[]');
      return ids.includes(`delivery:${id}`);
    } catch { return false; }
  });
  if (alreadyHas) {
    return NextResponse.json({ error: 'Phiếu này đã có hóa đơn' }, { status: 400 });
  }

  // Lưu lại thông tin hóa đơn vào phiếu xuất kho để lần sau tự điền
  await db.update(deliveryOrders).set({
    invoiceTaxCode: taxCode,
    invoiceCompanyName: companyName,
    invoiceAddress: address || '',
    updatedAt: new Date().toISOString(),
  } as any).where(eq(deliveryOrders.id, id));

  // Cập nhật hồ sơ đối tác nếu thông tin mới chính xác hơn
  if (order.partnerId) {
    const partnerRows = await db.select().from(partners).where(eq(partners.id, order.partnerId)).limit(1);
    const partner: any = partnerRows[0];
    if (partner) {
      const patch: any = {};
      if (taxCode && taxCode !== partner.taxCode) patch.taxCode = taxCode;
      if (companyName && companyName !== partner.name) patch.name = companyName;
      if (address && address !== partner.address) patch.address = address;
      if (Object.keys(patch).length > 0) {
        await db.update(partners).set(patch).where(eq(partners.id, order.partnerId));
      }
    }
  }

  // Tạo einvoice
  const totalAmount = Number(order.finalAmount || 0);
  const vatRate = 0.05;
  const subtotal = Math.round(totalAmount / (1 + vatRate));
  const vatAmount = totalAmount - subtotal;
  const discountPercent = Number(order.discountRate || 0) * 100; // discountRate lưu dạng 0.35
  const discountAmount = Math.round(Number(order.subtotal || 0) * Number(order.discountRate || 0));
  const invoiceId = randomUUID();
  const now = new Date().toISOString();

  await db.insert(einvoices).values({
    id: invoiceId,
    invoiceKind: 'SINGLE',
    buyerTaxCode: taxCode,
    buyerName: companyName,
    buyerAddress: address || '',
    subtotal,
    vatRate,
    vatAmount,
    totalAmount,
    discountPercent,
    discountAmount,
    status: 'PREPARED',
    sourceOrderIds: JSON.stringify([`delivery:${id}`]),
    createdBy: (session as any).actorId || 'system',
    createdAt: now,
    updatedAt: now,
  } as any);

  // Đẩy lên MS-Invoice (fire-and-forget)
  try {
    await MSInvoiceService.pushInvoice(invoiceId);
  } catch (e: any) {
    console.error('[create-invoice] Đẩy MS-Invoice lỗi:', e.message);
  }

  return NextResponse.json({ ok: true, invoiceId });
}
