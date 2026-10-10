import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { smartDraft, ContractAIError } from '@/services/ai/contract-ai.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** POST /api/ai/contracts/smart-draft - AI điền placeholder + đề xuất điều chỉnh (chờ duyệt). */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const templateId = `${body.templateId || ''}`.trim();
    if (!templateId) throw new ContractAIError('THIEU_MAU', 'Chưa chọn mẫu hợp đồng.');
    const fieldValues: Record<string, string> =
      body.fieldValues && typeof body.fieldValues === 'object'
        ? Object.fromEntries(Object.entries(body.fieldValues).map(([k, v]) => [`${k}`, `${v ?? ''}`]))
        : {};
    const result = await smartDraft({ templateId, fieldValues, notes: `${body.notes || ''}`.trim() });
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof ContractAIError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 422 });
    }
    return handleApiError(error);
  }
}
