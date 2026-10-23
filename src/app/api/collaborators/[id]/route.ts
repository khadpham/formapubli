/**
 * PUT /api/collaborators/[id] - Cập nhật cộng tác viên.
 * Chỉ OWNER/MANAGER.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, collaborators } from '@/db';
import { eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const FIELDS = [
  'fullName', 'penName', 'roleTitle', 'collabType', 'dob', 'idNumber',
  'idIssuedDate', 'idIssuedPlace', 'taxId', 'address', 'phone', 'email',
  'bankAccount', 'bankName', 'bankOwner', 'notes',
] as const;

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const id = decodeURIComponent(params.id);
    const body = await req.json();
    const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
    for (const f of FIELDS) {
      if (f in body) {
        const s = `${body[f] ?? ''}`.trim();
        patch[f] = s ? s : null;
      }
    }
    if ('isActive' in body) patch.isActive = !!body.isActive;
    if (patch.fullName === null) {
      return NextResponse.json({ success: false, error: 'Họ tên không được trống.' }, { status: 400 });
    }
    await db.update(collaborators).set(patch).where(eq(collaborators.id, id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error);
  }
}
