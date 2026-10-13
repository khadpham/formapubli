import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { PublishingService } from '@/services/publishing.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/publishing-projects/[id]/check - kiểm tra timeline (không lưu). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSessionRole(req, ROLES);
    const { id } = await params;
    const violations = await PublishingService.checkTimeline(id);
    return NextResponse.json({ success: true, data: { violations } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
