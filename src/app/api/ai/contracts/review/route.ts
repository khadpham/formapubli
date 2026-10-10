import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { reviewContract, extractDocxText, hashContent, CONTRACT_CATEGORIES, ContractAIError } from '@/services/ai/contract-ai.service';
import { db, contractReviews } from '@/db';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { resolveGeminiModel } from '@/services/ai/llm-client';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];
const MAX_BYTES = 5 * 1024 * 1024;

/** POST /api/ai/contracts/review - AI phản biện theo checklist loại hợp đồng. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const category = `${body.category || ''}`.trim();
    if (!CONTRACT_CATEGORIES.includes(category as never)) throw AppError.invalid('Loại hợp đồng không hợp lệ.');

    let text = `${body.text || ''}`.trim();
    let sourceName = 'văn bản dán trực tiếp';
    const fileBase64 = `${body.fileBase64 || ''}`.trim();
    if (!text && fileBase64) {
      if (fileBase64.length > MAX_BYTES * 1.4) throw new ContractAIError('FILE_QUA_LON', 'File quá lớn (tối đa 5MB).');
      const fileName = `${body.fileName || 'file'}`.trim().toLowerCase();
      if (fileName.endsWith('.docx')) text = extractDocxText(fileBase64);
      else if (fileName.endsWith('.txt')) text = Buffer.from(fileBase64, 'base64').toString('utf8').trim();
      else throw new ContractAIError('DINH_DANG_KHONG_HO_TRO', 'GĐ2 hỗ trợ file .docx và .txt (chưa hỗ trợ PDF).');
      sourceName = `${body.fileName || 'file'}`.trim();
    }
    if (!text) throw new ContractAIError('THIEU_DU_LIEU', 'Chưa có file hoặc văn bản để phản biện.');

    const { issues } = await reviewContract(text, category);
    await db.insert(contractReviews).values({
      id: `crev-${generateUUIDv7()}`,
      sourceName,
      category,
      summary: null,
      issues: JSON.stringify(issues),
      aiModel: resolveGeminiModel(),
      contentHash: hashContent(text),
      createdBy: session.actorId,
    });
    return NextResponse.json({
      success: true,
      data: { issues, disclaimer: 'Kết quả chỉ mang tính tham khảo - cần người có trách nhiệm duyệt trước khi quyết định.' },
    });
  } catch (error: any) {
    if (error instanceof ContractAIError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 422 });
    }
    return handleApiError(error);
  }
}
