import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { PublishingService } from '@/services/publishing.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/publishing-projects - danh sách dự án xuất bản. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const list = await PublishingService.list();
    return NextResponse.json({ success: true, data: list });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/publishing-projects - tạo dự án mới (tự sinh 5 giai đoạn). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const result = await PublishingService.create({
      bookTitle: body.bookTitle,
      originalTitle: body.originalTitle,
      author: body.author,
      translator: body.translator,
      bookSize: body.bookSize,
      pageCount: body.pageCount ? Number(body.pageCount) : undefined,
      coverPrice: body.coverPrice ? Number(body.coverPrice) : undefined,
      plannedPrintDate: body.plannedPrintDate,
      notes: body.notes,
      createdBy: (session as any).userId,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return handleApiError(error);
  }
}
