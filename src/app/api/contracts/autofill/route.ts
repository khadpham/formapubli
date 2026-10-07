import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { ContractService } from '@/services/contract.service';

export const dynamic = 'force-dynamic';

/** GET /api/contracts/autofill?partnerId=&workId=&editionId= — dữ liệu tự điền (override được). */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const data = await ContractService.getAutoFillData({
      partnerId: searchParams.get('partnerId') || undefined,
      workId: searchParams.get('workId') || undefined,
      editionId: searchParams.get('editionId') || undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
