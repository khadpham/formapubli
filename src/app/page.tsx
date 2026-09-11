import { db, warehouses, partners } from '@/db';
import { InventoryService } from '@/services/inventory.service';
import { MasterAppShell } from '@/components/layout/MasterAppShell';

export const revalidate = 0; // Dynamic real-time server rendering

export default async function HomePage() {
  let matrixBooks: any[] = [];
  let warehouseList: any[] = [];
  let partnerList: any[] = [];
  let ledgerList: any[] = [];
  let dbStatus = 'Hoạt động';

  try {
    matrixBooks = await InventoryService.getStockMatrix();
    ledgerList = await InventoryService.getLedgerHistory(25);
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
    />
  );
}
