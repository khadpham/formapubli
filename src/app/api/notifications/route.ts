import { NextRequest, NextResponse } from 'next/server';
import { db, discountApprovalRequests, cashboxSessions, orders, staffAccounts } from '@/db';
import { desc, eq } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

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
      title: string; body: string; at: string; href?: string;
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
          id: `ord-${o.id}`, kind: 'order', severity: 'warn',
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
        id: `shift-${s.id}`, kind: 'shift',
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
          id: `staff-${s.id}`, kind: 'staff', severity: 'info',
          title: `Tài khoản mới: ${s.name} (${s.id})`, body: 'Đã tạo, nhớ đổi PIN mặc định.',
          at: `${s.at || ''}`, href: 'settings',
        });
      }
    }

    items.sort((a, b) => `${b.at}`.localeCompare(`${a.at}`));
    return NextResponse.json({
      success: true,
      data: { items: items.slice(0, 40), serverTime: nowIso, count: items.length },
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
