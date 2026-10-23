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

/**
 * POST /api/collaborators - Thêm cộng tác viên mới.
 * Body: { fullName (bắt buộc), collabType, penName, roleTitle, dob, idNumber,
 *   idIssuedDate, idIssuedPlace, taxId, address, phone, email,
 *   bankAccount, bankName, bankOwner, notes }
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const body = await req.json();
    const fullName = `${body.fullName || ''}`.trim();
    if (!fullName) {
      return NextResponse.json({ success: false, error: 'Thiếu họ tên.' }, { status: 400 });
    }
    const slug = fullName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ctv';
    const id = `ctv-${slug}-${Date.now().toString(36)}`;
    const str = (v: any) => {
      const s = `${v ?? ''}`.trim();
      return s ? s : null;
    };
    await db.insert(collaborators).values({
      id,
      fullName,
      penName: str(body.penName),
      roleTitle: str(body.roleTitle),
      collabType: str(body.collabType) || 'khac',
      dob: str(body.dob),
      idNumber: str(body.idNumber),
      idIssuedDate: str(body.idIssuedDate),
      idIssuedPlace: str(body.idIssuedPlace),
      taxId: str(body.taxId),
      address: str(body.address),
      phone: str(body.phone),
      email: str(body.email),
      bankAccount: str(body.bankAccount),
      bankName: str(body.bankName),
      bankOwner: str(body.bankOwner),
      notes: str(body.notes),
      isActive: true,
    });
    return NextResponse.json({ success: true, data: { id } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
