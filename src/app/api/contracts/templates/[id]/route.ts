import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { db, contractTemplates } from '@/db';
import { eq } from 'drizzle-orm';
import { ContractEngineService } from '@/services/contract-engine.service';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/contracts/templates/[id] — chi tiết mẫu. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ROLES);
    const { id } = await params;
    const [row] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, id)).limit(1);
    if (!row) return NextResponse.json({ success: false, error: 'Không tìm thấy mẫu.' }, { status: 404 });
    return NextResponse.json({ success: true, data: row });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** PUT /api/contracts/templates/[id] — sửa; gửi file mới thì version + 1. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const [row] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, id)).limit(1);
    if (!row) return NextResponse.json({ success: false, error: 'Không tìm thấy mẫu.' }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, any> = {};
    if (body.title !== undefined) {
      if (!`${body.title}`.trim()) throw AppError.invalid('Tiêu đề mẫu không được để trống.');
      patch.title = `${body.title}`.trim().slice(0, 300);
    }
    if (body.description !== undefined) patch.description = `${body.description || ''}`.trim() || null;
    if (body.schemaFields !== undefined) {
      const sf = typeof body.schemaFields === 'string' ? body.schemaFields : JSON.stringify(body.schemaFields);
      try { JSON.parse(sf); } catch { throw AppError.invalid('schema_fields phải là JSON hợp lệ.'); }
      patch.schemaFields = sf;
    }
    if (body.isActive !== undefined) patch.isActive = body.isActive === true;
    if (body.templateData) {
      const check = ContractEngineService.validateTemplate(`${body.templateData}`);
      if (!check.isValid) {
        return NextResponse.json(
          { success: false, code: 'INVALID_TEMPLATE', error: 'File Word mới lỗi cú pháp placeholder.', details: check.errors },
          { status: 400 }
        );
      }
      patch.templateData = `${body.templateData}`;
      if (body.templateFilename) patch.templateFilename = `${body.templateFilename}`.slice(0, 200);
      patch.version = Number(row.version ?? 1) + 1;
    }
    if (Object.keys(patch).length === 0) throw AppError.invalid('Không có gì để cập nhật.');
    await db.update(contractTemplates).set(patch).where(eq(contractTemplates.id, id));
    const [after] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, id)).limit(1);
    await recordAuditLog({
      action: 'CONTRACT_TEMPLATE' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/templates', details: `Sửa mẫu ${row.code} (${Object.keys(patch).join(', ')}).`,
    });
    return NextResponse.json({ success: true, data: after });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** DELETE /api/contracts/templates/[id] — ngưng dùng (không xóa cứng). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { id } = await params;
    const [row] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, id)).limit(1);
    if (!row) return NextResponse.json({ success: false, error: 'Không tìm thấy mẫu.' }, { status: 404 });
    await db.update(contractTemplates).set({ isActive: false }).where(eq(contractTemplates.id, id));
    await recordAuditLog({
      action: 'CONTRACT_TEMPLATE' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/templates', details: `Ngưng dùng mẫu ${row.code}.`,
    });
    return NextResponse.json({ success: true, data: { id, isActive: false } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
