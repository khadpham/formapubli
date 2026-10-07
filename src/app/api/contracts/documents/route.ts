import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole, resolveActorId } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { ContractService } from '@/services/contract.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];
const CATEGORIES = ['TAC_QUYEN', 'DAI_LY', 'IN_AN', 'DICH_THUAT', 'KHAC'];

/** GET /api/contracts/documents — danh sách (?status=&partnerId=). */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const { searchParams } = new URL(req.url);
    const data = await ContractService.listDocuments({
      status: searchParams.get('status') || undefined,
      partnerId: searchParams.get('partnerId') || undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/contracts/documents — soạn mới: cấp số + snapshot trong 1 tx. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    if (!body.templateId) throw AppError.invalid('Thiếu mẫu hợp đồng (templateId).');
    if (!`${body.title || ''}`.trim()) throw AppError.invalid('Thiếu tiêu đề hợp đồng.');
    const category = `${body.category || 'TAC_QUYEN'}`.trim();
    if (!CATEGORIES.includes(category)) throw AppError.invalid(`Loại hợp đồng không hợp lệ: ${category}.`);
    if (body.payloadData === undefined || body.payloadData === null || typeof body.payloadData !== 'object') {
      throw AppError.invalid('Thiếu dữ liệu biến (payloadData object).');
    }
    const doc: any = await ContractService.createDocument({
      templateId: body.templateId,
      title: `${body.title}`.trim().slice(0, 300),
      category,
      payloadData: body.payloadData,
      partnerId: body.partnerId || undefined,
      workId: body.workId || undefined,
      signedDate: body.signedDate || undefined,
      effectiveDate: body.effectiveDate || undefined,
      expiryDate: body.expiryDate || undefined,
      totalAmount: body.totalAmount !== undefined ? Number(body.totalAmount) : undefined,
      createdBy: resolveActorId(session, body.createdBy),
      notes: body.notes || undefined,
    });
    await recordAuditLog({
      action: 'CONTRACT_DOCUMENT' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/documents', details: `Soạn HĐ ${doc.contractNumber}: ${doc.title}.`,
    });
    return NextResponse.json({ success: true, data: doc }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
