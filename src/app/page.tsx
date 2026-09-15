import { cookies } from 'next/headers';
import { db, warehouses, partners } from '@/db';
import { InventoryService } from '@/services/inventory.service';
import { MasterAppShell } from '@/components/layout/MasterAppShell';
import { verifySessionCookie, isAuthStrict, SESSION_COOKIE_NAME, SessionPayload } from '@/lib/auth-session';

export const revalidate = 0; // Dynamic real-time server rendering

export default async function HomePage() {
  const cookieStore = cookies();
  const sessionRaw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookie(sessionRaw);

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
    // Phân quyền dữ liệu theo role của session
    const isTaxRole = session?.role === 'ROLE_TAX';

    matrixBooks = await InventoryService.getStockMatrix();
    // Kế toán thuế không được xem thẻ kho chi tiết nội bộ
    ledgerList = isTaxRole ? [] : await InventoryService.getLedgerHistory(25);
    warehouseList = await db.select().from(warehouses);
    partnerList = await db.select().from(partners);
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

