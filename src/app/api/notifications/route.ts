import { NextRequest, NextResponse } from 'next/server';
import { db, discountApprovalRequests, cashboxSessions, orders, staffAccounts, notificationDismissals } from '@/db';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { requireSessionRole } from '@/lib/auth-session';
import { handleApiError } from '@/lib/api-response';
import { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

// Bảng `notification_dismissals` do migration 0025_notification_dismissals.sql tạo
// (cột `expires_at` do 0026 thêm), khai báo Drizzle ở src/db/schema.ts.
// KHÔNG tạo bảng trong route: schema phải khai báo qua migration chain để
// migrate-fresh và drill go-live kiểm được.

/** Giấu một mục tối đa 7 ngày rồi tự hiện lại (xem `DISMISS_TTL_MS`). */
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Đưa mọi mốc thời gian trong DB về cùng một đơn vị (epoch ms) trước khi so sánh.
 *
 * Cột `*_at` của các bảng nghiệp vụ có CẢ HAI kiểu giá trị đang tồn tại ngoài đời:
 * service POS ghi ISO-8601 (`2026-09-28T16:08:16.294Z`), còn cột có
 * `.default(sql\`CURRENT_TIMESTAMP\`)` mặc định là SQLite `YYYY-MM-DD HH:MM:SS`
 * (UTC, KHÔNG có `T`/`Z`). So sánh chuỗi giữa hai kiểu này là vô nghĩa —
 * `'2026-09-28 16:08:16' > '2026-09-28T16:08:16.294Z'` luôn sai vì `' '` < `'T'`.
 */
function toEpoch(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0;
  // SQLite CURRENT_TIMESTAMP: thay khoảng trắng thành 'T' và gắn 'Z' vì đó là UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
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

    // 1) Yêu cầu duyệt chiết khấu. Tách 2 truy vấn vì `createRequest` liên tục
    // SUPERSEDE dòng cũ và dòng cũ chuyển EXPIRED: gộp chung `limit(30)` thì sau ~30
    // lần giao dịch cửa sổ có thể KHÔNG còn dòng PENDING nào dù đang có.
    const pendingApprovals = await db
      .select()
      .from(discountApprovalRequests)
      .where(eq(discountApprovalRequests.status, 'PENDING'))
      .orderBy(desc(discountApprovalRequests.createdAt))
      .limit(30);
    // Kết quả duyệt chỉ quan tới người tạo yêu cầu (kể cả khi người đó là quản lý).
    const myResults = await db
      .select()
      .from(discountApprovalRequests)
      .where(and(
        inArray(discountApprovalRequests.status, ['APPROVED', 'REJECTED']),
        eq(discountApprovalRequests.cashierId, session.actorId),
      ))
      .orderBy(desc(discountApprovalRequests.updatedAt))
      .limit(15);

    const nowMs = Date.now();
    for (const r of pendingApprovals) {
      const mine = r.cashierId === session.actorId;
      // Quản lý thấy mọi yêu cầu; thu ngân chỉ thấy yêu cầu của mình.
      if (!isManager && !mine) continue;
      const expired = toEpoch(r.expiresAt) > 0 && toEpoch(r.expiresAt) <= nowMs;
      items.push({
        id: `apv-${r.id}`,
        kind: 'approval',
        area: 'Duyệt chiết khấu',
        severity: expired ? 'danger' : (isManager ? 'warn' : 'info'),
        title: isManager
          ? `Cần duyệt chiết khấu — đơn ${r.orderCode}`
          : `Đã gửi yêu cầu duyệt chiết khấu — đơn ${r.orderCode}`,
        body: (isManager
          ? `${r.cashierId} xin duyệt, hạn ${r.expiresAt}`
          : `Đang chờ quản lý duyệt, hạn ${r.expiresAt}`) + (expired ? ' — ĐÃ HẾT HẠN' : ''),
        at: `${r.createdAt || ''}`,
        href: isManager ? 'pos' : undefined,
      });
    }
    for (const r of myResults) {
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

    // Sắp xếp theo thời gian thật (epoch ms), không so chuỗi thô.
    items.sort((a, b) => toEpoch(b.at) - toEpoch(a.at));

    // Loại các mục người dùng đã ẩn/xóa (bảng dismissal, xem POST bên dưới).
    // ĐỒNG BỘ: bảng này chỉ là bộ lọc phụ. Nếu đọc lỗi (bảng chưa được migrate trên
    // DB nào đó) thì coi như CHƯA ẩn gì cả và vẫn trả về đủ thông báo — tuyệt đối
    // không để một bảng phụ làm sập toàn bộ endpoint.
    let hidden = new Set<string>();
    try {
      const now = Date.now();
      const dismissals = await db
        .select({ itemId: notificationDismissals.itemId, expiresAt: notificationDismissals.expiresAt })
        .from(notificationDismissals)
        .where(eq(notificationDismissals.actorId, session.actorId));
        hidden = new Set(
        dismissals
          // expires_at NULL = bản ghi ghi từ trước 0026, giữ nguyên nghĩa cũ (đã ẩn).
          // NULL sẽ tự hết hiệu lực lần ghi đầu tiên sau này (POST luôn set expires_at).
          .filter((d) => d.expiresAt == null || toEpoch(d.expiresAt) > now)
          .map((d) => d.itemId),
      );
    } catch (err: any) {
      console.warn('[notifications] Không đọc được notification_dismissals — coi như chưa ẩn mục nào:', err?.message ?? err);
    }
    const visible = items.filter((i) => !hidden.has(i.id));

    const nowIso = new Date().toISOString();
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
 * Mỗi lần ẩn ghi kèm `expires_at` = nay + DISMISS_TTL_MS. Nếu không có hạn, quản lý
 * bấm "Xóa tất cả" lúc đang có yêu cầu duyệt sẽ không bao giờ thấy lại yêu cầu đó,
 * kể cả sau khi mở lại trang. Đây là dữ liệu dùng để giảm ồn trên UI, KHÔNG phải
 * audit log nên hết hạn là hành vi đúng — muốn duyệt thì phải còn thấy việc cần làm.
 *
 * ponytail: trần client gửi tối đa 200 id/lần và chỉ id đang hiện — không phình vô hạn.
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

    const expiresAt = new Date(Date.now() + DISMISS_TTL_MS).toISOString();
    for (const itemId of itemIds) {
      // REPLACE (không phải INSERT OR IGNORE) để ẩn lại làm gia hạn mốc hạn mới.
      await db
        .insert(notificationDismissals)
        .values({ actorId: session.actorId, itemId, dismissedAt: new Date().toISOString(), expiresAt })
        .onConflictDoUpdate({
          target: [notificationDismissals.actorId, notificationDismissals.itemId],
          set: { dismissedAt: new Date().toISOString(), expiresAt },
        });
    }

    return NextResponse.json({ success: true, data: { action, count: itemIds.length } });
  } catch (error: any) {
    return handleApiError(error);
  }
}
