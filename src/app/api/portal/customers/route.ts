import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { customers } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { handleApiError } from '@/lib/api-response';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

function checkAuth(req: NextRequest) {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) return false;
  return req.headers.get('authorization') === `Bearer ${apiKey}`;
}

function isValidPhone(phone: string): boolean {
  const clean = phone.replace(/[\s\-\.]/g, '');
  return /^(0|\+84)(3|5|7|8|9)\d{8}$/.test(clean);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /api/portal/customers - Tao hoac cap nhat khach hang (upsert theo SDT).
 */
export async function POST(req: NextRequest) {
  try {
    if (!checkAuth(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || '').trim();
    const phone = String(body?.phone || '').replace(/[\s\-\.]/g, '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const address = body?.address || {};

    if (name.length < 2) {
      return NextResponse.json(
        { error: 'Vui lòng nhập họ tên.' },
        { status: 400 }
      );
    }
    if (!isValidPhone(phone)) {
      return NextResponse.json(
        { error: 'Số điện thoại không hợp lệ.' },
        { status: 400 }
      );
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Email không hợp lệ.' },
        { status: 400 }
      );
    }

    // Tim khach hien tai theo SDT
    const existing = await db
      .select()
      .from(customers)
      .where(eq(customers.phone, phone))
      .limit(1);

    let customer;
    let isNew = false;

    if (existing[0]) {
      // Cap nhat
      customer = existing[0];
      await db
        .update(customers)
        .set({
          fullName: name,
          email: email || customer.email,
          addressProvince: address.province || customer.addressProvince,
          addressDistrict: address.district || customer.addressDistrict,
          addressWard: address.ward || customer.addressWard,
          addressDetail: address.detail || customer.addressDetail,
          channel: 'PORTAL',
        })
        .where(eq(customers.id, customer.id));
      customer = { ...customer, fullName: name };
    } else {
      // Tao moi
      isNew = true;
      const id = randomUUID();
      // Tao ma khach hang
      const countResult = await db
        .select({ cnt: eq(customers.id, customers.id) })
        .from(customers);
      const code = `CUST-${String(Date.now()).slice(-6)}`;

      await db.insert(customers).values({
        id,
        code,
        fullName: name,
        phone,
        email: email || null,
        channel: 'PORTAL',
        segment: 'RETAIL',
        addressProvince: address.province || null,
        addressDistrict: address.district || null,
        addressWard: address.ward || null,
        addressDetail: address.detail || null,
      });
      customer = { id, fullName: name, phone, email: email || null };
    }

    return NextResponse.json({
      id: customer.id,
      name: customer.fullName,
      phone: customer.phone,
      email: customer.email,
      isNew,
    });
  } catch (e) {
    console.error(`[portal/customers] 500 ${(e as Error)?.message || e}`);
    return handleApiError(e);
  }
}
