import { NextRequest, NextResponse } from 'next/server';
import { ReaderProfileService } from '@/services/reader-profile.service';
import { requireSessionRole } from '@/lib/auth-session';
import { recordAuditLog } from '@/lib/rbac-guard';
import { handleApiError } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

/**
 * 5.4 — READER PERSONA (route read-only).
 * GET /api/ai/reader-persona?customerId=<id> — hồ sơ 360°.
 * GET /api/ai/reader-persona?matchForEdition=<editionId>&limit=50 — gợi ý độc giả.
 * RBAC: OWNER/MANAGER/CASHIER (thu ngân tra cứu ở quầy). P1b default-deny.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER']);

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customerId') || undefined;
    const matchForEdition = searchParams.get('matchForEdition') || undefined;
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));

    if (!customerId && !matchForEdition) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: 'Thiếu customerId hoặc matchForEdition.' },
        { status: 400 }
      );
    }
    if (customerId && matchForEdition) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: 'Chỉ dùng một trong customerId hoặc matchForEdition mỗi lần gọi.' },
        { status: 400 }
      );
    }

    if (customerId) {
      const profile = await ReaderProfileService.getReaderProfile(customerId);
      await recordAuditLog({
        action: 'VIEW_READER_PROFILE',
        actorRole: session.role,
        actorId: session.actorId,
        resource: '/api/ai/reader-persona',
        details: `Xem hồ sơ độc giả ${customerId}`.slice(0, 500),
      });
      return NextResponse.json({ success: true, data: profile });
    }

    const matches = await ReaderProfileService.matchReadersForEdition(matchForEdition as string, limit);
    await recordAuditLog({
      action: 'VIEW_READER_PROFILE',
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/ai/reader-persona',
      details: `Gợi ý độc giả cho ấn bản ${matchForEdition}: ${matches.length} người`.slice(0, 500),
    });
    return NextResponse.json({ success: true, data: matches });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
