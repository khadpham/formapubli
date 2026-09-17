import { NextRequest, NextResponse } from 'next/server';
import { db, customers } from '@/db';
import { or, like, desc, sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

// GET /api/customers?q=sdt-hoac-ten&limit=50 — danh bạ read-only GĐ1 (không tạo/sửa ở ticket này).
export async function GET(req: NextRequest) {
  try {
    // P1b: Default-Deny — bắt buộc session cookie hợp lệ.
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));

    let rows;
    if (q) {
      const pattern = `%${q}%`;
      rows = await db
        .select()
        .from(customers)
        .where(
          or(
            like(customers.phone, pattern),
            like(customers.fullName, pattern),
            like(customers.code, pattern),
            like(customers.email, pattern)
          )
        )
        .orderBy(desc(customers.createdAt))
        .limit(limit);
    } else {
      rows = await db.select().from(customers).orderBy(desc(customers.createdAt)).limit(limit);
    }

    const totalRow = await db.select({ n: sql<number>`COUNT(*)` }).from(customers);
    return NextResponse.json({ success: true, data: rows, total: Number(totalRow[0]?.n || 0) });
  } catch (error: any) {
    return handleApiError(error);
  }
}

