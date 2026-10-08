import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { finalizeAiTemplate, hashContent, ContractAIError } from '@/services/ai/contract-ai.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** POST /api/ai/contracts/finalize-template — chốt nháp thành mẫu chính thức (ai_generated=1, legal_reviewed=0). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const placeholders = Array.isArray(body.placeholders) ? body.placeholders.map((p: unknown) => `${p}`.trim()).filter(Boolean) : [];
    const templateId = await finalizeAiTemplate({
      code: `${body.code || ''}`,
      title: `${body.title || ''}`,
      category: `${body.category || ''}`,
      bodyText: `${body.bodyText || ''}`,
      placeholders,
      sourceUrl: `${body.sourceUrl || ''}` || undefined,
    });
    // Audit: chỉ log hash nội dung, KHÔNG log nội dung hợp đồng.
    await import('@/lib/rbac-guard').then((m) => m.recordAuditLog({
      action: 'CONTRACT_AI_TEMPLATE' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/ai/contracts/finalize-template',
      details: `AI chốt mẫu ${body.code}: sha256=${hashContent(`${body.bodyText || ''}`).slice(0, 16)}.`,
    }));
    return NextResponse.json({ success: true, data: { templateId } });
  } catch (error: any) {
    if (error instanceof ContractAIError) {
      const status = error.code === 'TRUNG_CODE' ? 409 : 422;
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status });
    }
    return handleApiError(error);
  }
}
