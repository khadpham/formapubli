/**
 * POST /api/partners - Tạo đối tác mới (OWNER/MANAGER)
 * Body: { name*, type*, code?, discountRate?, address?, phone?, email?, taxCode?, receiverName?, shipNote?, creditLimit?, paymentDueDays?, paymentNote? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { db } from '@/db';
import { partners } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { recordAuditLog } from '@/lib/rbac-guard';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['CONSIGNMENT', 'WHOLESALE', 'PRINTER', 'LIBRARY', 'INTERNAL'];

export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER']);
    const body = await req.json().catch(() => ({}));

    const name = `${body.name || ''}`.trim();
    const type = `${body.type || ''}`.trim().toUpperCase();
    if (!name) {
      return NextResponse.json({ success: false, error: 'Thiếu tên đối tác' }, { status: 400 });
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ success: false, error: 'Loại đối tác không hợp lệ' }, { status: 400 });
    }

    // Tự sinh mã nếu không có: DT-<timestamp>
    let code = `${body.code || ''}`.trim().toUpperCase();
    if (!code) {
      code = 'DT-' + Date.now().toString().slice(-6);
    }
    // Kiểm tra trùng mã
    const dup = await db.select().from(partners).where(eq(partners.code, code)).limit(1);
    if (dup.length > 0) {
      return NextResponse.json({ success: false, error: `Mã ${code} đã tồn tại` }, { status: 400 });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(partners).values({
      id,
      code,
      name,
      type,
      discountRate: Number(body.discountRate) || 0,
      address: body.address || null,
      phone: body.phone || null,
      email: body.email || null,
      taxCode: body.taxCode || null,
      receiverName: body.receiverName || null,
      shipNote: body.shipNote || null,
      creditLimit: Number(body.creditLimit) || 0,
      paymentDueDays: Number(body.paymentDueDays) || 30,
      paymentNote: body.paymentNote || null,
      createdAt: now,
    });

    await recordAuditLog({
      action: 'PARTNER_CREATED' as any,
      actorRole: session.role,
      actorId: session.actorId,
      resource: '/api/partners',
      details: `Tạo đối tác ${code} - ${name} (${type}).`,
    });

    const rows = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error: any) {
    return handleApiError(error);
  }
}
