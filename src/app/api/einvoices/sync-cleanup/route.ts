import { NextRequest, NextResponse } from 'next/server';
import { db, einvoices } from '@/db';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';

/**
 * POST /api/einvoices/sync-cleanup
 * Kiểm tra các hóa đơn SYNCED trên MS-Invoice, xóa bản ghi local nếu đã xóa trên portal
 */
export async function POST(req: NextRequest) {
  await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);

  const baseUrl = process.env.MSINVOICE_BASE_URL || 'https://hoadon.msinvoice.vn';
  const username = process.env.MSINVOICE_USERNAME;
  const password = process.env.MSINVOICE_PASSWORD;

  // Đăng nhập MS-Invoice
  const loginRes = await fetch(`${baseUrl}/erp/rest/s1/iam-invoice/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginData = await loginRes.json();
  const token = loginData.token || loginData.accessToken || loginData.data?.token;
  if (!token) {
    return NextResponse.json({ error: 'Không đăng nhập được MS-Invoice' }, { status: 500 });
  }

  // Lấy tất cả einvoices đã SYNCED
  const synced = await db.select().from(einvoices).where(eq(einvoices.status, 'SYNCED'));
  let cleaned = 0;

  for (const inv: any of synced) {
    if (!inv.msinvoiceId) continue;
    try {
      // Kiểm tra hóa đơn có còn trên portal không
      const checkRes = await fetch(
        `${baseUrl}/api/rest/s1/iam-invoice/invoices/${inv.msinvoiceId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (checkRes.status === 404) {
        // Đã xóa trên portal -> xóa local
        await db.delete(einvoices).where(eq(einvoices.id, inv.id));
        cleaned++;
      }
    } catch {}
  }

  return NextResponse.json({ ok: true, cleaned, checked: synced.length });
}
