import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { parseMbStatement, importStatements } from '@/services/bank-reconciliation.service';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/finance/bank-statements/import - Import file xlsx sao ke MB Bank.
 * Multipart field `file`. Parse + auto-match ngay, tra tom tat.
 * Quyen: chu/quan ly (ke toan).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ success: false, error: 'Thieu file sao ke (.xlsx).' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'File vuot 10MB.' }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    let rows;
    try {
      rows = parseMbStatement(buf);
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e?.message || 'File khong dung mau sao ke.' }, { status: 400 });
    }
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'File khong co dong giao dich nao.' }, { status: 400 });
    }
    const result = await importStatements(rows, session.actorId);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleApiError(e);
  }
}
