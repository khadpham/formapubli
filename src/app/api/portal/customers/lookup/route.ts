import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { customers } from '@/db/schema';
import { eq, or } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

/**
 * GET /api/portal/customers/lookup?phone=...&email=...
 * Tra cuu khach hang theo SDT hoac email. Uu tien email truoc.
 */
export async function GET(req: NextRequest) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone')?.trim() || '';
    const email = searchParams.get('email')?.trim().toLowerCase() || '';

    if (!phone && !email) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp số điện thoại hoặc email.' },
        { status: 400 }
      );
    }

    let customer = null;
    if (email) {
      const rows = await db
        .select()
        .from(customers)
        .where(eq(customers.email, email))
        .limit(1);
      customer = rows[0] || null;
    }
    if (!customer && phone) {
      // Chuan hoa SDT: bo khoang trang, dau gach
      const normalizedPhone = phone.replace(/[\s\-\.]/g, '');
      const rows = await db
        .select()
        .from(customers)
        .where(eq(customers.phone, normalizedPhone))
        .limit(1);
      customer = rows[0] || null;
    }

    if (!customer) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({
      found: true,
      customer: {
        id: customer.id,
        name: customer.fullName,
        phone: customer.phone,
        email: customer.email,
        addresses: [
          {
            id: customer.id,
            label: 'Địa chỉ đã lưu',
            province: customer.addressProvince || '',
            district: customer.addressDistrict || '',
            ward: customer.addressWard || '',
            detail: customer.addressDetail || '',
            isDefault: true,
          },
        ],
      },
    });
  } catch (e) {
    console.error(`[portal/customers/lookup] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
