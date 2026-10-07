import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { ContractService } from '@/services/contract.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/contracts/documents/[id] — chi tiết. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ROLES);
    const { id } = await params;
    const data = await ContractService.getDocumentById(decodeURIComponent(id || '').trim());
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** PUT /api/contracts/documents/[id] — sửa khi DRAFT (service chặn trạng thái khác). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const allowed = ['title', 'payloadData', 'partnerId', 'workId', 'signedDate', 'effectiveDate', 'expiryDate', 'totalAmount', 'notes', 'status'];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    if (Object.keys(patch).length === 0) throw AppError.invalid('Không có gì để cập nhật.');
    const data = await ContractService.updateDocument(decodeURIComponent(id || '').trim(), patch);
    await recordAuditLog({
      action: 'CONTRACT_DOCUMENT' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/documents', details: `Sửa HĐ ${id} (${Object.keys(patch).join(', ')}).`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** DELETE /api/contracts/documents/[id] — chỉ xóa khi DRAFT/CANCELLED. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const docId = decodeURIComponent(id || '').trim();
    const doc: any = await ContractService.getDocumentById(docId);
    if (doc.status !== 'DRAFT' && doc.status !== 'CANCELLED') {
      throw AppError.conflict(`Hợp đồng ${doc.status} không được xóa (chỉ DRAFT/CANCELLED).`);
    }
    const { db, contractDocuments } = await import('@/db');
    const { eq } = await import('drizzle-orm');
    await db.delete(contractDocuments).where(eq(contractDocuments.id, docId));
    await recordAuditLog({
      action: 'CONTRACT_DOCUMENT' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/documents', details: `Xóa HĐ nháp ${doc.contractNumber}.`,
    });
    return NextResponse.json({ success: true, data: { id: docId, deleted: true } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
