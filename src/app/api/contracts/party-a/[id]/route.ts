import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import type { UserRole } from '@/lib/roles';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** PUT /api/contracts/party-a/[id] - sửa bên A. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ROLES);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { name, representative, position, address, tax_code, phone, email, is_default } = body;
    if (!name?.trim()) {
      return NextResponse.json({ success: false, error: 'Tên bên A không được để trống.' }, { status: 400 });
    }
    if (is_default) {
      await db.execute(sql`UPDATE contract_party_a SET is_default = 0 WHERE id != ${id}`);
    }
    await db.execute(sql`
      UPDATE contract_party_a
      SET name = ${name.trim()},
          representative = ${representative || ''},
          position = ${position || 'Giám đốc'},
          address = ${address || ''},
          tax_code = ${tax_code || ''},
          phone = ${phone || ''},
          email = ${email || ''},
          is_default = ${is_default ? 1 : 0},
          updated_at = datetime('now', 'localtime')
      WHERE id = ${id}
    `);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** DELETE /api/contracts/party-a/[id] - xóa bên A (không xóa bên mặc định). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ROLES);
    const { id } = await params;
    const check = await db.execute(sql`SELECT is_default FROM contract_party_a WHERE id = ${id}`);
    const row = (check.rows || [])[0] as any;
    if (row?.is_default) {
      return NextResponse.json({ success: false, error: 'Không xóa được bên A mặc định.' }, { status: 400 });
    }
    await db.execute(sql`DELETE FROM contract_party_a WHERE id = ${id}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error);
  }
}
