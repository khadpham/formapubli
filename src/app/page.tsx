import { cookies } from 'next/headers';
import { db, warehouses, partners } from '@/db';
import { InventoryService } from '@/services/inventory.service';
import { MasterAppShell } from '@/components/layout/MasterAppShell';
import {
  verifySessionCookie,
  validateSessionAccount,
  isAuthStrict,
  SESSION_COOKIE_NAME,
  SessionPayload,
} from '@/lib/auth-session';

export const revalidate = 0; // Dynamic real-time server rendering

export default async function HomePage() {
  const cookieStore = cookies();
  const sessionRaw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  let session: SessionPayload | null = await verifySessionCookie(sessionRaw);

  // Kiểm tra thời gian thực trạng thái tài khoản
  if (session) {
    try {
      await validateSessionAccount(session);
    } catch {
      session = null;
    }
  }

  // LÁ CHẮN BẢO MẬT SSR (Data Leakage Guard):
  // Khi ở chế độ strict mà chưa có session hợp lệ:
  // TUYỆT ĐỐI KHÔNG truy vấn CSDL để tránh rò rỉ dữ liệu qua SSR HTML payload.
  if (isAuthStrict() && !session) {
    return (
      <MasterAppShell
        matrixBooks={[]}
        warehouseList={[]}
        partnerList={[]}
        ledgerList={[]}
        dbStatus="Yêu cầu đăng nhập ca làm việc"
        initialSession={null}
        requiresAuth={true}
      />
    );
  }

  let matrixBooks: any[] = [];
  let warehouseList: any[] = [];
  let partnerList: any[] = [];
  let ledgerList: any[] = [];
  let dbStatus = 'Hoạt động';

  try {
    const role = session?.role;
    const isTaxRole = role === 'ROLE_TAX';
    const isCashierRole = role === 'ROLE_CASHIER';

    matrixBooks = await InventoryService.getStockMatrix();
    // ROLE_TAX và ROLE_CASHIER không xem thẻ kho chi tiết nội bộ
    ledgerList = isTaxRole || isCashierRole ? [] : await InventoryService.getLedgerHistory(25);
    warehouseList = await db.select().from(warehouses);
    // ROLE_TAX và ROLE_CASHIER không load danh sách đối tác nhà cung cấp nhạy cảm
    partnerList = isTaxRole || isCashierRole ? [] : await db.select().from(partners);
  } catch (error: any) {
    dbStatus = 'Lỗi kết nối: ' + error.message;
  }

  return (
    <MasterAppShell
      matrixBooks={matrixBooks}
      warehouseList={warehouseList}
      partnerList={partnerList}
      ledgerList={ledgerList}
      dbStatus={dbStatus}
      initialSession={session}
      requiresAuth={isAuthStrict() && !session}
    />
  );
}


