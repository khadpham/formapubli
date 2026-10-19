import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole, resolveActorId } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { ContractService } from '@/services/contract.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** POST /api/contracts/documents/[id]/status - đánh dấu đã ký / đã hủy (F2).
 * Body: { status: 'SIGNED' | 'CANCELLED' }. Chỉ Owner/Manager. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const status = `${body.status || ''}`.trim();
    if (status !== 'SIGNED' && status !== 'CANCELLED') {
      throw AppError.invalid('Trạng thái chỉ nhận SIGNED hoặc CANCELLED.');
    }
    const doc: any = await ContractService.transitionStatus(
      decodeURIComponent(id || '').trim(),
      status as 'SIGNED' | 'CANCELLED'
    );
    await recordAuditLog({
      action: 'CONTRACT_DOCUMENT' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/documents', details: `Đánh dấu HĐ ${doc.contractNumber} → ${status}.`,
    });
    return NextResponse.json({ success: true, data: doc });
  } catch (error: any) {
    return handleApiError(error);
  }
}
