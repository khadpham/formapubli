import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { db, contractTemplates } from '@/db';
import { eq } from 'drizzle-orm';
import { ContractEngineService } from '@/services/contract-engine.service';

export const dynamic = 'force-dynamic';

/** POST /api/contracts/preview - merge template + data, trả bytes docx (D1, debounce 400ms ở client). */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = await req.json().catch(() => ({}));
    if (!body.templateId) throw AppError.invalid('Thiếu mẫu hợp đồng (templateId).');
    if (!body.data || typeof body.data !== 'object') throw AppError.invalid('Thiếu dữ liệu biến (data object).');
    const [tpl] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, body.templateId)).limit(1);
    if (!tpl) return NextResponse.json({ success: false, error: 'Không tìm thấy mẫu.' }, { status: 404 });
    const bytes = ContractEngineService.generateDocx(tpl.templateData, body.data);
    // Copy sang ArrayBuffer mới: .buffer của Uint8Array có thể là SharedArrayBuffer (tsc từ chối làm BodyInit).
    const bodyBuf = Uint8Array.from(bytes).buffer as ArrayBuffer;
    return new Response(bodyBuf, {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
