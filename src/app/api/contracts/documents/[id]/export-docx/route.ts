import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { ContractService } from '@/services/contract.service';

export const dynamic = 'force-dynamic';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function asciiFilename(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'hop-dong.docx';
}

/** GET /api/contracts/documents/[id]/export-docx - final ?? rendered ?? re-render. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { id } = await params;
    const docId = decodeURIComponent(id || '').trim();
    const bytes = await ContractService.exportDocx(docId);
    const doc: any = await ContractService.getDocumentById(docId);
    const name = asciiFilename(doc.finalFilename || `${doc.contractNumber}.docx`);
    const body = Uint8Array.from(bytes).buffer as ArrayBuffer;
    return new Response(body, {
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
