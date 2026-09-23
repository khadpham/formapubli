import { NextRequest, NextResponse } from 'next/server';
import { WarehouseService } from '@/services/warehouse.service';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { AppError } from '@/services/app-error';
import { UserRole } from '@/lib/roles';
import { db, bankAccounts, warehouses } from '@/db';
import { and, eq } from 'drizzle-orm';
import { generateUUIDv7 } from '@/lib/uuidv7';

export const dynamic = 'force-dynamic';

/** VietQR offline per-kho: trả default + list TK active để POS chọn/override. */
export async function GET(req: NextRequest) {
  try {
    await requireSessionRole(req, [
      'ROLE_OWNER',
      'ROLE_MANAGER',
      'ROLE_CASHIER',
      'ROLE_WAREHOUSE',
    ] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get('warehouseId') || '';
    const { default: def, list } = await WarehouseService.getDefaultBankAccount(warehouseId);
    return NextResponse.json({ success: true, data: { default: def || null, list } });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** Thêm TK nhận tiền mới (Owner/Manager). */
export async function POST(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = await req.json();
    const bankBin = `${body.bankBin || ''}`.trim();
    const accountNo = `${body.accountNo || ''}`.replace(/[\s-]/g, '').trim();
    const label = `${body.label || ''}`.trim();
    if (!/^\d{6}$/.test(bankBin)) {
      return NextResponse.json({ success: false, error: 'bankBin phải đúng 6 chữ số (VD: 970405).' }, { status: 400 });
    }
    if (!/^\d{6,19}$/.test(accountNo)) {
      return NextResponse.json({ success: false, error: 'Số tài khoản 6-19 chữ số.' }, { status: 400 });
    }
    if (!label) {
      return NextResponse.json({ success: false, error: 'Thiếu tên gợi nhớ (label).' }, { status: 400 });
    }
    const dup = await db.select({ id: bankAccounts.id }).from(bankAccounts)
      .where(and(eq(bankAccounts.bankBin, bankBin), eq(bankAccounts.accountNo, accountNo))).limit(1);
    if (dup[0]) throw AppError.conflict('Tài khoản này đã tồn tại.');
    const row = {
      id: `bank-${generateUUIDv7().slice(-8)}`,
      label,
      bankBin,
      accountNo,
      accountName: `${body.accountName || ''}`.trim() || null,
      isActive: true,
    };
    await db.insert(bankAccounts).values(row);
    return NextResponse.json({ success: true, data: row }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** Gán TK mặc định cho kho: { warehouseId, bankAccountId | null } (Owner/Manager). */
export async function PATCH(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = await req.json();
    if (!body.warehouseId) {
      return NextResponse.json({ success: false, error: 'Thiếu warehouseId.' }, { status: 400 });
    }
    const updated = await WarehouseService.setDefaultBankAccount(
      body.warehouseId,
      body.bankAccountId || null
    );
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** Chỉnh sửa thông tin TK nhận tiền (Owner/Manager). */
export async function PUT(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const body = await req.json();
    const id = `${body.id || ''}`.trim();
    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu mã tài khoản (id).' }, { status: 400 });
    }
    const bankBin = `${body.bankBin || ''}`.trim();
    const accountNo = `${body.accountNo || ''}`.replace(/[\s-]/g, '').trim();
    const label = `${body.label || ''}`.trim();

    if (!/^\d{6}$/.test(bankBin)) {
      return NextResponse.json({ success: false, error: 'bankBin phải đúng 6 chữ số (VD: 970405).' }, { status: 400 });
    }
    if (!/^\d{6,19}$/.test(accountNo)) {
      return NextResponse.json({ success: false, error: 'Số tài khoản phải từ 6-19 chữ số.' }, { status: 400 });
    }
    if (!label) {
      return NextResponse.json({ success: false, error: 'Thiếu tên gợi nhớ (label).' }, { status: 400 });
    }

    // Kiểm tra trùng lặp với tài khoản khác
    const dup = await db.select({ id: bankAccounts.id }).from(bankAccounts)
      .where(and(eq(bankAccounts.bankBin, bankBin), eq(bankAccounts.accountNo, accountNo))).limit(2);
    if (dup.some((it) => it.id !== id)) {
      throw AppError.conflict('Tài khoản ngân hàng với số TK và BIN này đã tồn tại ở bản ghi khác.');
    }

    const existing = await db.select({ id: bankAccounts.id }).from(bankAccounts)
      .where(eq(bankAccounts.id, id)).limit(1);
    if (!existing[0]) throw AppError.invalid('Tài khoản không tồn tại.');

    const updateData = {
      label,
      bankBin,
      accountNo,
      accountName: `${body.accountName || ''}`.trim() || null,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    };

    await db.update(bankAccounts).set(updateData).where(eq(bankAccounts.id, id));
    return NextResponse.json({ success: true, data: { id, ...updateData } });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/** Xóa TK nhận tiền (Owner/Manager). */
export async function DELETE(req: NextRequest) {
  try {
    await requireSessionRole(req, ['ROLE_OWNER', 'ROLE_MANAGER'] as UserRole[]);
    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const id = searchParams.get('id') || body.id;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu mã tài khoản (id).' }, { status: 400 });
    }

    const existing = await db.select({ id: bankAccounts.id }).from(bankAccounts)
      .where(eq(bankAccounts.id, id)).limit(1);
    if (!existing[0]) throw AppError.invalid('Tài khoản không tồn tại.');

    // Kiểm tra xem có kho nào đang đặt TK này làm mặc định không
    const linkedWarehouses = await db.select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses).where(eq(warehouses.defaultBankAccountId, id));

    if (linkedWarehouses.length > 0) {
      const names = linkedWarehouses.map((w) => w.name).join(', ');
      throw AppError.conflict(`Không thể xóa: Tài khoản đang được gán làm mặc định cho ${linkedWarehouses.length} kho (${names}). Vui lòng gán tài khoản khác cho các kho này trước khi xóa.`);
    }

    await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
    return NextResponse.json({ success: true, message: 'Đã xóa tài khoản nhận tiền thành công.' });
  } catch (error: any) {
    return handleApiError(error);
  }
}
