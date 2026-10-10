import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { fetchGdocText, structureGdocTemplate, ContractAIError } from '@/services/ai/contract-ai.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** POST /api/ai/contracts/import-gdoc - nhập mẫu thật từ link Google Docs, AI cấu trúc hóa. */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const gdocUrl = `${body.gdocUrl || ''}`.trim();
    if (!gdocUrl) throw AppError.invalid('Thiếu link Google Docs.');
    const rawText = await fetchGdocText(gdocUrl);
    const structured = await structureGdocTemplate(rawText);
    return NextResponse.json({ success: true, data: { ...structured, sourceUrl: gdocUrl } });
  } catch (error: any) {
    if (error instanceof ContractAIError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 422 });
    }
    return handleApiError(error);
  }
}
