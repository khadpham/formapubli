import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { db, contractTemplates } from '@/db';
import { desc, eq } from 'drizzle-orm';
import { ContractEngineService } from '@/services/contract-engine.service';
import { generateUUIDv7 } from '@/lib/uuidv7';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];
const CATEGORIES = ['TAC_QUYEN', 'DAI_LY', 'IN_AN', 'DICH_THUAT', 'KHAC'];

/** GET /api/contracts/templates — danh sách mẫu (?activeOnly=0 để lấy cả ngưng dùng). */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const { searchParams } = new URL(req.url);
    const rows = await db.select().from(contractTemplates).orderBy(desc(contractTemplates.createdAt));
    const list = searchParams.get('activeOnly') === '0' ? rows : rows.filter((r) => r.isActive);
    return NextResponse.json({ success: true, data: list });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/contracts/templates — tạo mẫu: validate + sinh schema_fields từ placeholder. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const code = `${body.code || ''}`.trim();
    const title = `${body.title || ''}`.trim();
    const templateFilename = `${body.templateFilename || ''}`.trim();
    const templateData = `${body.templateData || ''}`.trim();
    if (!code) throw AppError.invalid('Thiếu mã mẫu (code).');
    if (!title) throw AppError.invalid('Thiếu tiêu đề mẫu.');
    if (!templateFilename.toLowerCase().endsWith('.docx')) throw AppError.invalid('File mẫu phải là .docx.');
    if (!templateData) throw AppError.invalid('Thiếu nội dung file Word (base64).');
    const category = `${body.category || 'TAC_QUYEN'}`.trim();
    if (!CATEGORIES.includes(category)) throw AppError.invalid(`Loại mẫu không hợp lệ: ${category}.`);
    const check = ContractEngineService.validateTemplate(templateData);
    if (!check.isValid) {
      return NextResponse.json(
        { success: false, code: 'INVALID_TEMPLATE', error: 'File Word lỗi cú pháp placeholder.', details: check.errors },
        { status: 400 }
      );
    }
    let schemaFields = body.schemaFields;
    if (!schemaFields) {
      schemaFields = JSON.stringify(check.placeholders.map((key) => ({ key, label: key, type: 'text', required: false })));
    } else if (typeof schemaFields !== 'string') {
      schemaFields = JSON.stringify(schemaFields);
    }
    try {
      JSON.parse(schemaFields);
    } catch {
      throw AppError.invalid('schema_fields phải là JSON hợp lệ.');
    }
    const [dup] = await db.select({ id: contractTemplates.id }).from(contractTemplates).where(eq(contractTemplates.code, code)).limit(1);
    if (dup) throw AppError.conflict(`Mã mẫu ${code} đã tồn tại.`);
    const [row] = await db.insert(contractTemplates).values({
      id: `ctpl-${generateUUIDv7()}`,
      code,
      title,
      category,
      description: `${body.description || ''}`.trim() || null,
      templateFilename,
      templateData,
      schemaFields,
      version: 1,
      isActive: true,
    }).returning();
    await import('@/lib/rbac-guard').then((m) => m.recordAuditLog({
      action: 'CONTRACT_TEMPLATE' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/templates', details: `Tạo mẫu ${code}: ${title}.`,
    }));
    return NextResponse.json({ success: true, data: row }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}
