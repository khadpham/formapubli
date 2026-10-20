import { NextRequest, NextResponse } from 'next/server';
import { voidDocument } from '@/services/warehouse-document.service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { reason } = await req.json();
    if (!reason) {
      return NextResponse.json({ ok: false, error: 'Thiếu lý do hủy' }, { status: 400 });
    }
    await voidDocument(id, reason, 'system');
    return NextResponse.json({ ok: true, message: 'Đã hủy chứng từ' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
