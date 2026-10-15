/**
 * GET /api/warehouse-documents - Danh sách chứng từ
 * POST /api/warehouse-documents - Tạo chứng từ mới
 */

import { NextRequest, NextResponse } from 'next/server';
import { createDocument, listDocuments, getDocTypeName } from '@/services/warehouse-document.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const docs = await listDocuments({
      docType: searchParams.get('docType') || undefined,
      status: searchParams.get('status') || undefined,
      limit: parseInt(searchParams.get('limit') || '50'),
    });
    return NextResponse.json({
      ok: true,
      data: docs.map(d => ({ ...d, docTypeName: getDocTypeName(d.docType) })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { docType, warehouseId, toWarehouseId, partnerId, partnerName, items, note, ledgerRefs } = body;

    if (!docType || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: 'Thiếu docType hoặc items' }, { status: 400 });
    }

    const result = await createDocument({
      docType,
      warehouseId,
      toWarehouseId,
      partnerId,
      partnerName,
      items,
      note,
      ledgerRefs,
      createdBy: 'system',
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
