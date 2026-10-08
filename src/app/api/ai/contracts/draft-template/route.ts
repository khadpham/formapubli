import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { draftTemplateFromDescription, CONTRACT_CATEGORIES, ContractAIError } from '@/services/ai/contract-ai.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** POST /api/ai/contracts/draft-template — AI soạn nháp mẫu từ lời mô tả. */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const category = `${body.category || ''}`.trim();
    const description = `${body.description || ''}`.trim();
    if (!CONTRACT_CATEGORIES.includes(category as never)) throw AppError.invalid('Loại hợp đồng không hợp lệ.');
    if (description.length < 10) throw AppError.invalid('Mô tả quá ngắn — hãy mô tả rõ hơn nhu cầu hợp đồng.');
    const draft = await draftTemplateFromDescription({ category, description });
    return NextResponse.json({ success: true, data: draft });
  } catch (error: any) {
    if (error instanceof ContractAIError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 422 });
    }
    return handleApiError(error);
  }
}
