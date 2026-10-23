import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { ContractService } from '@/services/contract.service';
import { ContractEngineService } from '@/services/contract-engine.service';

export const dynamic = 'force-dynamic';

function asciiFilename(name: string): string {
  const ext = (name.split('.').pop() || 'docx').toLowerCase();
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || `hop-dong.${ext}`;
}

/** GET /api/contracts/documents/[id]/export-docx - final ?? rendered ?? re-render.
 * Trả đúng MIME theo loại file gốc (docx/xls/pdf/ảnh...). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { id } = await params;
    const docId = decodeURIComponent(id || '').trim();
    const { bytes, filename } = await ContractService.exportDocx(docId);
    const name = asciiFilename(filename);
    const mime = ContractEngineService.getMimeType(filename);
    const body = Uint8Array.from(bytes).buffer as ArrayBuffer;
    return new Response(body, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
