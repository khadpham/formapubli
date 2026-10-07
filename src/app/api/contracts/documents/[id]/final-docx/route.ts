import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { ContractService } from '@/services/contract.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

/** PUT /api/contracts/documents/[id]/final-docx — upload bản cuối sau khi sửa ngoài Word (D9). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const base64 = `${body.base64 || ''}`.trim();
    if (!base64) throw AppError.invalid('Thiếu nội dung file Word (base64).');
    if (base64.length > 15 * 1024 * 1024) throw AppError.invalid('File Word quá lớn (tối đa ~15MB).');
    const data = await ContractService.uploadFinalDocx(
      decodeURIComponent(id || '').trim(),
      base64,
      `${body.filename || 'final.docx'}`
    );
    await recordAuditLog({
      action: 'CONTRACT_DOCUMENT' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/documents', details: `Tải bản cuối HĐ ${id} → FINALIZED.`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
