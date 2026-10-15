import { NextRequest, NextResponse } from 'next/server';
import { issueDocument } from '@/services/warehouse-document.service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { html } = await req.json();
    if (!html) {
      return NextResponse.json({ ok: false, error: 'Thiếu nội dung HTML' }, { status: 400 });
    }
    const result = await issueDocument(id, html, 'system');
    return NextResponse.json({ ok: true, data: result, message: 'Đã phát hành và lưu trữ lên R2' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
