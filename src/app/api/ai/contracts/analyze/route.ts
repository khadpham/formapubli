import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { analyzeContract, extractDocxText, hashContent, ContractAIError } from '@/services/ai/contract-ai.service';
import { db, contractReviews } from '@/db';
import { generateUUIDv7 } from '@/lib/uuidv7';
import { resolveGeminiModel } from '@/services/ai/llm-client';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];
const MAX_BYTES = 5 * 1024 * 1024;

function getText(body: any): { text: string; sourceName: string } {
  const direct = `${body.text || ''}`.trim();
  if (direct) return { text: direct, sourceName: 'văn bản dán trực tiếp' };
  const fileBase64 = `${body.fileBase64 || ''}`.trim();
  const fileName = `${body.fileName || 'file'}`.trim();
  if (!fileBase64) throw new ContractAIError('THIEU_DU_LIEU', 'Chưa có file hoặc văn bản để phân tích.');
  if (fileBase64.length > MAX_BYTES * 1.4) throw new ContractAIError('FILE_QUA_LON', 'File quá lớn (tối đa 5MB).');
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return { text: extractDocxText(fileBase64), sourceName: fileName };
  if (lower.endsWith('.txt')) {
    try {
      return { text: Buffer.from(fileBase64, 'base64').toString('utf8').trim(), sourceName: fileName };
    } catch {
      throw new ContractAIError('FILE_KHONG_DOC_DUOC', 'Không đọc được file text.');
    }
  }
  throw new ContractAIError('DINH_DANG_KHONG_HO_TRO', 'GĐ2 hỗ trợ file .docx và .txt (chưa hỗ trợ PDF).');
}

/** POST /api/ai/contracts/analyze - AI đọc hiểu: tóm tắt + trích xuất thực thể. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const { text, sourceName } = getText(body);
    const analysis = await analyzeContract(text);
    const contentHash = hashContent(text);
    await db.insert(contractReviews).values({
      id: `crev-${generateUUIDv7()}`,
      sourceName,
      category: null,
      summary: JSON.stringify(analysis),
      issues: null,
      aiModel: resolveGeminiModel(),
      contentHash,
      createdBy: session.actorId,
    });
    return NextResponse.json({ success: true, data: analysis });
  } catch (error: any) {
    if (error instanceof ContractAIError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: 422 });
    }
    return handleApiError(error);
  }
}
