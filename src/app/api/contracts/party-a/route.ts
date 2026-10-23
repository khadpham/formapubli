import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/contracts/party-a - danh sách bên A. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const rows = await db.execute(sql`
      SELECT id, name, representative, position, address, tax_code, phone, email, is_default,
             created_at, updated_at
      FROM contract_party_a
      ORDER BY is_default DESC, name ASC
    `);
    return NextResponse.json({ success: true, data: rows.rows || [] });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/contracts/party-a - thêm bên A mới. */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const { name, representative, position, address, tax_code, phone, email, is_default } = body;
    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'Tên bên A không được để trống.' }, { status: 400 });
    }
    const id = `party-a-${Date.now().toString(36)}`;
    // Nếu đặt làm mặc định, bỏ mặc định của các bên khác
    if (is_default) {
      await db.execute(sql`UPDATE contract_party_a SET is_default = 0`);
    }
    await db.execute(sql`
      INSERT INTO contract_party_a (id, name, representative, position, address, tax_code, phone, email, is_default)
      VALUES (${id}, ${name.trim()}, ${representative || ''}, ${position || 'Giám đốc'},
              ${address || ''}, ${tax_code || ''}, ${phone || ''}, ${email || ''}, ${is_default ? 1 : 0})
    `);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
