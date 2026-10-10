import { NextRequest, NextResponse } from 'next/server';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';
import { AppError } from '@/services/app-error';
import { ContractService } from '@/services/contract.service';

export const dynamic = 'force-dynamic';

const ROLES = ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[];

/** GET /api/contracts/presets - { active, all } (D11). */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, ROLES);
    const all = await ContractService.listPresets();
    return NextResponse.json({ success: true, data: { active: all.filter((p: any) => p.isActive), all } });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** POST /api/contracts/presets - { label, valuesJson, sortOrder? }. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    const data = await ContractService.createPreset({
      label: body.label,
      valuesJson: typeof body.valuesJson === 'string' ? body.valuesJson : JSON.stringify(body.valuesJson ?? {}),
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
    });
    const { recordAuditLog } = await import('@/lib/rbac-guard');
    await recordAuditLog({
      action: 'CONTRACT_PRESET' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/presets', details: `Tạo preset: ${data.label}.`,
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** PUT /api/contracts/presets - { id, label?, valuesJson?, sortOrder?, isActive? }. */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const body = await req.json().catch(() => ({}));
    if (!body.id) throw AppError.invalid('Thiếu id preset.');
    const data = await ContractService.updatePreset(body.id, {
      label: body.label,
      valuesJson: body.valuesJson !== undefined
        ? (typeof body.valuesJson === 'string' ? body.valuesJson : JSON.stringify(body.valuesJson))
        : undefined,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      isActive: body.isActive !== undefined ? body.isActive === true : undefined,
    });
    const { recordAuditLog } = await import('@/lib/rbac-guard');
    await recordAuditLog({
      action: 'CONTRACT_PRESET' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/presets', details: `Sửa preset ${body.id}.`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** DELETE /api/contracts/presets?id= - xóa preset. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, ROLES);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') || '';
    if (!id) throw AppError.invalid('Thiếu id preset.');
    const data = await ContractService.deletePreset(id);
    const { recordAuditLog } = await import('@/lib/rbac-guard');
    await recordAuditLog({
      action: 'CONTRACT_PRESET' as any, actorRole: session.role, actorId: session.actorId,
      resource: '/api/contracts/presets', details: `Xóa preset ${id}.`,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return handleApiError(error);
  }
}
