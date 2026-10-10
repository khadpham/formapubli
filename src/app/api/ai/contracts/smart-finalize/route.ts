import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { finalizeAiTemplate, hashContent, CONTRACT_CATEGORIES, ContractAIError } from '@/services/ai/contract-ai.service';
import { ContractService } from '@/services/contract.service';
import { db, contractTemplates } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];
const CATEGORIES = [...CONTRACT_CATEGORIES, 'TAC_QUYEN', 'DAI_LY', 'IN_AN', 'DICH_THUAT', 'KHAC'];

/**
 * POST /api/ai/contracts/smart-finalize - chốt bản soạn thông minh thành hợp đồng.
 * Tạo mẫu AI one-off từ văn bản cuối (đã áp dụng adjustments được duyệt) rồi tạo document.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const templateId = `${body.templateId || ''}`.trim();
    const title = `${body.title || ''}`.trim();
    const finalText = `${body.finalText || ''}`.trim();
    const category = `${body.category || ''}`.trim();
    if (!templateId) throw AppError.invalid('Thiếu mẫu gốc.');
    if (!title) throw AppError.invalid('Thiếu tiêu đề hợp đồng.');
    if (!finalText) throw AppError.invalid('Thiếu văn bản đã chốt.');
    if (!CATEGORIES.includes(category)) throw AppError.invalid('Loại hợp đồng không hợp lệ.');

    const [parent] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, templateId)).limit(1);
    if (!parent) throw new ContractAIError('MAU_KHONG_TON_TAI', 'Không tìm thấy mẫu gốc.');

    // Áp adjustments được duyệt vào văn bản (thay original → proposed)
    const accepted: { original: string; proposed: string }[] = Array.isArray(body.acceptedAdjustments)
      ? body.acceptedAdjustments
      : [];
    let text = finalText;
    for (const adj of accepted) {
      if (adj.original && adj.proposed && text.includes(adj.original)) {
        text = text.replace(adj.original, adj.proposed);
      }
    }

    // Tạo mẫu AI one-off từ văn bản cuối
    const placeholders = Array.from(text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1]);
    const oneOffCode = `AI-${Date.now().toString(36).toUpperCase()}`;
    const oneOffId = await finalizeAiTemplate({
      code: oneOffCode,
      title: `AI: ${title}`.slice(0, 300),
      category: parent.category,
      bodyText: text,
      placeholders: [...new Set(placeholders)],
      sourceUrl: undefined,
    });
    // Ghi chú mẫu gốc vào description
    await db.update(contractTemplates)
      .set({ description: `Soạn thông minh từ mẫu ${parent.code} - ${accepted.length} điều chỉnh được duyệt.` })
      .where(eq(contractTemplates.id, oneOffId));

    const fieldValues: Record<string, string> =
      body.fieldValues && typeof body.fieldValues === 'object'
        ? Object.fromEntries(Object.entries(body.fieldValues).map(([k, v]) => [`${k}`, `${v ?? ''}`]))
        : {};
    const doc: any = await ContractService.createDocument({
      templateId: oneOffId,
      title: title.slice(0, 300),
      category,
      payloadData: fieldValues,
      partnerId: body.partnerId || undefined,
      totalAmount: body.totalAmount !== undefined ? Number(body.totalAmount) : undefined,
      createdBy: session.actorId,
      notes: `Soạn bằng AI từ mẫu ${parent.code}.`,
    });
    await import('@/lib/rbac-guard').then((m) => m.recordAuditLog({
      action: 'CONTRACT_AI_SMART' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/ai/contracts/smart-finalize',
      details: `AI soạn HĐ ${doc.contractNumber} từ mẫu ${parent.code}: sha256=${hashContent(text).slice(0, 16)}.`,
    }));
    return NextResponse.json({ success: true, data: { documentId: doc.id, contractNumber: doc.contractNumber } }, { status: 201 });
  } catch (error: any) {
    if (error instanceof ContractAIError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 422 });
    }
    return handleApiError(error);
  }
}
