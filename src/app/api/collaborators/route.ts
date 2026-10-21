/**
 * GET /api/collaborators - Danh sách cộng tác viên.
 *
 * Query: ?q= từ khóa tìm theo tên / bút danh / vai trò
 *        &type= loại cộng tác (thiet_ke_bia | dich_gia | bien_tap | doc_morat | hanh_chinh | dai_dien_ben_a | ben_b | khac)
 *        &active= 1 (mặc định) | 0 | all
 * Chỉ OWNER/MANAGER được xem (chứa thông tin định danh nhạy cảm).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, collaborators } from '@/db';
import { eq, and, or, like, asc } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim() || '';
    const type = searchParams.get('type')?.trim() || '';
    const active = searchParams.get('active')?.trim() || '1';

    const conds: any[] = [];
    if (active === '1') conds.push(eq(collaborators.isActive, true));
    if (active === '0') conds.push(eq(collaborators.isActive, false));
    if (type) conds.push(eq(collaborators.collabType, type));
    if (q) {
      const pat = `%${q}%`;
      conds.push(
        or(
          like(collaborators.fullName, pat),
          like(collaborators.penName, pat),
          like(collaborators.roleTitle, pat)
        )
      );
    }

    const rows = await db
      .select()
      .from(collaborators)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(collaborators.fullName));

    return NextResponse.json({ success: true, data: rows, total: rows.length });
  } catch (error: any) {
    return handleApiError(error);
  }
}
