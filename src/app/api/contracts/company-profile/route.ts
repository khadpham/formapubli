import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { ContractService } from '@/services/contract.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/contracts/company-profile — thông tin công ty Bên A. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const data = await ContractService.getCompanyProfile();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** PUT /api/contracts/company-profile — sửa toàn phần, không khóa field nào (D8). */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const allowed = ['tenCongTy', 'daiDien', 'chucVu', 'diaChi', 'mst', 'sdt', 'email'] as const;
    const patch: Record<string, any> = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    const data = await ContractService.updateCompanyProfile(patch);
    await recordAuditLog({
      action: 'CONTRACT_PROFILE' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/company-profile', details: `Sửa thông tin công ty (${Object.keys(patch).join(', ')}).`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
