import { NextRequest, NextResponse } from 'next/server';
import { db, einvoices } from '@/db';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';

/**
 * GET /api/einvoices/[id]/pdf
 * Lấy PDF hóa đơn từ MS-Invoice để xem trước trong ERP
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_TAX']);

  const { id } = await params;
  const rows = await db.select().from(einvoices).where(eq(einvoices.id, id)).limit(1);
  const inv: any = rows[0];
  if (!inv) {
    return NextResponse.json({ error: 'Không tìm thấy hóa đơn' }, { status: 404 });
  }
  if (!inv.msinvoiceId) {
    return NextResponse.json({ error: 'Hóa đơn chưa đẩy lên MS-Invoice' }, { status: 400 });
  }

  const baseUrl = process.env.MSINVOICE_BASE_URL || 'https://hoadon.msinvoice.vn';
  const pdfUrl = `${baseUrl}/api/rest/s1/iam-invoice/invoices/${inv.msinvoiceId}/pdf`;

  try {
    // Lấy token đăng nhập MS-Invoice
    const username = process.env.MSINVOICE_USERNAME;
    const password = process.env.MSINVOICE_PASSWORD;
    const loginRes = await fetch(`${baseUrl}/erp/rest/s1/iam-invoice/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const loginData = await loginRes.json();
    const token = loginData.token || loginData.accessToken || loginData.data?.token;
    if (!token) throw new Error('Không đăng nhập được MS-Invoice');

    const pdfRes = await fetch(pdfUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pdfRes.ok) throw new Error('Không tải được PDF');

    const buffer = await pdfRes.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="hoadon-${inv.msinvoiceId}.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
