import { NextRequest, NextResponse } from 'next/server';
import { db, discountApprovalRequests, cashboxSessions, orders, staffAccounts } from '@/db';
import { desc, eq, sql } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

let dismissalsEnsured = false;
async function ensureDismissalsTable() {
  if (dismissalsEnsured) return;
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS notification_dismissals (
      actor_id text NOT NULL,
      item_id text NOT NULL,
      dismissed_at text NOT NULL,
      PRIMARY KEY (actor_id, item_id)
    )
  `);
  dismissalsEnsured = true;
}

/**
 * Chuông thông báo — việc CẦN NGƯỜI DÙNG XỬ LÝ, hai chiều:
 * - Quản lý/Owner: thấy yêu cầu duyệt đang chờ, đơn chờ xác nhận, ca chưa chốt.
 * - Thu ngân: thấy trạng thái yêu cầu DUYỆT CỦA MÌNH (đã gửi / được duyệt / bị từ chối).
 * Người ngoài cuộc không thấy gì của người khác.
 * Client hỏi mỗi 5s (ngân sách trễ 5–6s như yêu cầu). Lịch sử đầy đủ: /api/activity-log.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX',
    ] as UserRole[]);
    const isManager = session.role === 'ROLE_OWNER' || session.role === 'ROLE_MANAGER';
    const items: Array<{
      id: string; kind: string; severity: 'info' | 'warn' | 'danger';
      title: string; body: string; at: string; href?: string; area: string;
    }> = [];

    // 1) Yêu cầu duyệt chiết khấu.
    const approvalRows = await db
      .select()
      .from(discountApprovalRequests)
      .orderBy(desc(discountApprovalRequests.createdAt))
      .limit(30);
    const nowIso = new Date().toISOString();
    for (const r of approvalRows) {
      const mine = r.cashierId === session.actorId;
      // Quản lý thấy mọi yêu cầu; thu ngân chỉ thấy yêu cầu của mình.
      if (!isManager && !mine) continue;
      if (r.status === 'PENDING') {
        items.push({
          id: `apv-${r.id}`,
          kind: 'approval',
          area: 'Duyệt chiết khấu',
          severity: isManager ? 'warn' : 'info',
          title: isManager
            ? `Cần duyệt chiết khấu — đơn ${r.orderCode}`
            : `Đã gửi yêu cầu duyệt chiết khấu — đơn ${r.orderCode}`,
          body: isManager
            ? `${r.cashierId} xin duyệt, hạn ${r.expiresAt}`
            : `Đang chờ quản lý duyệt, hạn ${r.expiresAt}`,
          at: `${r.createdAt || ''}`,
          href: isManager ? 'pos' : undefined,
        });
        if (nowIso > `${r.expiresAt}`) {
          items[items.length - 1].severity = 'danger';
          items[items.length - 1].body += ' — ĐÃ HẾT HẠN';
        }
      } else if (mine && (r.status === 'APPROVED' || r.status === 'REJECTED')) {
        items.push({
          id: `apv-done-${r.id}`,
          kind: 'approval-result',
          area: 'Duyệt chiết khấu',
          severity: r.status === 'APPROVED' ? 'info' : 'danger',
          title: r.status === 'APPROVED'
            ? `Yêu cầu duyệt chiết khấu ĐÃ ĐƯỢC DUYỆT — đơn ${r.orderCode}`
            : `Yêu cầu duyệt chiết khấu BỊ TỪ CHỐI — đơn ${r.orderCode}`,
          body: `${r.approvedBy || 'quản lý'} · ${r.rejectedReason || 'không có lý do'}`,
          at: `${r.updatedAt || r.createdAt || ''}`,
        });
      }
    }

    // 2) Đơn online chờ xác nhận (quản lý + thủ kho xử lý).
    if (isManager || session.role === 'ROLE_WAREHOUSE') {
      const pendingOrders = await db
        .select({ id: orders.id, code: orders.orderCode, at: orders.createdAt })
        .from(orders)
        .where(eq(orders.status, 'PENDING_CONFIRMATION'))
        .orderBy(desc(orders.createdAt))
        .limit(20);
      for (const o of pendingOrders) {
        items.push({
          id: `ord-${o.id}`, kind: 'order', severity: 'warn', area: 'Đơn hàng',
          title: `Đơn ${o.code} chờ xác nhận`, body: 'Khách đặt online, cần vào xác nhận.',
          at: `${o.at || ''}`, href: 'sales',
        });
      }
    }

    // 3) Ca của chính người dùng / ca đang mở (quản lý thấy hết).
    const sessionRows = await db
      .select()
      .from(cashboxSessions)
      .where(eq(cashboxSessions.status, 'OPEN'))
      .orderBy(desc(cashboxSessions.openedAt))
      .limit(20);
    for (const s of sessionRows) {
      if (!isManager && s.cashierId !== session.actorId) continue;
      items.push({
        id: `shift-${s.id}`, kind: 'shift', area: 'Ca làm',
        severity: s.cashierId === session.actorId ? 'info' : 'warn',
        title: `Ca đang mở — ${s.cashierId}`,
        body: `Từ ${s.openedAt || '?'} · ${s.totalOrdersCount || 0} đơn. Nhớ chốt ca khi xong.`,
        at: `${s.openedAt || ''}`, href: 'sales',
      });
    }

    // 4) Nhân sự mới tạo (quản lý cần biết).
    if (isManager) {
      const newStaff = await db
        .select({ id: staffAccounts.staffId, name: staffAccounts.fullName, at: staffAccounts.createdAt })
        .from(staffAccounts)
        .orderBy(desc(staffAccounts.createdAt))
        .limit(3);
      for (const s of newStaff) {
        items.push({
          id: `staff-${s.id}`, kind: 'staff', severity: 'info', area: 'Nhân sự',
          title: `Tài khoản mới: ${s.name} (${s.id})`, body: 'Đã tạo, nhớ đổi PIN mặc định.',
          at: `${s.at || ''}`, href: 'settings',
        });
      }
    }

    items.sort((a, b) => `${b.at}`.localeCompare(`${a.at}`));

    // Loại các mục người dùng đã ẩn/xóa (bảng dismissal, xem POST bên dưới).
    await ensureDismissalsTable();
    const hidden = new Set(
      ((await db.run(sql`SELECT item_id AS itemId FROM notification_dismissals WHERE actor_id = ${session.actorId}`))
        .rows ?? []).map((r: any) => `${r.itemId}`),
    );
    const visible = items.filter((i) => !hidden.has(i.id));

    return NextResponse.json({
      success: true,
      data: { items: visible.slice(0, 40), serverTime: nowIso, count: visible.length },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * Ẩn thông báo — vì thông báo SUY RA từ bảng nghiệp vụ (không có dòng lưu riêng),
 * ta ghi danh sách id bị ẩn vào bảng nhỏ `notification_dismissals` (mẫu customer_tags).
 * action = 'dismiss' (ẩn 1 mục) | 'clear' (ẩn toàn bộ mục client đang hiện).
 *
 * ponytail: bảng được CREATE IF NOT EXISTS ngay trong route vì phạm vi sửa file
 * của đợt này không cho thêm migration. Cần thêm migration 0025_notification_dismissals.sql
 * (mẫu: 0013_customer_tags.sql) và khai báo trong src/db/schema.ts khi được mở quyền sửa.
 * Trần: client chỉ gửi tối đa 200 id/lần, và chỉ id đang hiện — không phình vô hạn.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSessionRole(req, [
      'ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX',
    ] as UserRole[]);
    const body = (await req.json().catch(() => ({}))) as { action?: string; itemIds?: string[] };
    const action = body?.action === 'clear' ? 'clear' : 'dismiss';
    const raw = Array.isArray(body?.itemIds) ? body.itemIds : [];
    const itemIds = raw
      .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120)
      .filter((x, idx, arr) => arr.indexOf(x) === idx) // bỏ trùng, không cần Set (target ES5)
      .slice(0, 200);

    if (itemIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Không có thông báo nào để ẩn.' },
        { status: 400 },
      );
    }

    await ensureDismissalsTable();
    for (const itemId of itemIds) {
      await db.run(sql`
        INSERT OR IGNORE INTO notification_dismissals (actor_id, item_id, dismissed_at)
        VALUES (${session.actorId}, ${itemId}, ${new Date().toISOString()})
      `);
    }

    return NextResponse.json({ success: true, data: { action, count: itemIds.length } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
