/**
 * GET /api/warehouse-documents/[id] - Chi tiết chứng từ
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDocument, getDocTypeName } from '@/services/warehouse-document.service';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doc = await getDocument(id);
    if (!doc) {
      return NextResponse.json({ ok: false, error: 'Không tìm thấy' }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      data: { ...doc, docTypeName: getDocTypeName(doc.docType) },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
