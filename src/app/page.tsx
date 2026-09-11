import { db, warehouses, partners } from '@/db';
import { InventoryService } from '@/services/inventory.service';
import { StockOverviewMatrix } from '@/components/StockOverviewMatrix';
import { BookOpen, Warehouse, ShieldCheck, Database, Layers } from 'lucide-react';

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

  const totalSystemStock = matrixBooks.reduce((sum, b) => sum + (b.totalStock || 0), 0);
  const totalAuCo = matrixBooks.reduce((sum, b) => sum + (b.stockAuCo || 0), 0);
  const totalQuynhMai = matrixBooks.reduce((sum, b) => sum + (b.stockQuynhMai || 0), 0);
  const totalDuPhong = matrixBooks.reduce((sum, b) => sum + (b.stockDuPhong || 0), 0);

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-7xl mx-auto bg-slate-50/50">
      {/* Header */}
      <header className="border-b border-slate-200 pb-5 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">formapubli ERP</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
              v0.1.0 Alpha
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Hệ Điều Hành Quản Trị Xuất Bản, Kho Vận Kép & Phát Hành Theo Mùa
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-semibold text-emerald-800">Dual-Engine: {dbStatus}</span>
          </div>
        </div>
      </header>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Danh mục sách</h3>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">{matrixBooks.length} Ấn bản</p>
            <p className="text-xs text-slate-500">80 Tác phẩm gốc (H01-H81)</p>
          </div>
        </div>

        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tổng tồn 3 Kho</h3>
            <p className="text-2xl font-bold text-slate-900 mt-0.5 font-mono">
              {totalSystemStock.toLocaleString('vi-VN')} cuốn
            </p>
            <p className="text-[11px] text-slate-500 font-mono">
              Âu Cơ: {totalAuCo} | QM: {totalQuynhMai} | DP: {totalDuPhong}
            </p>
          </div>
        </div>

        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
            <Warehouse className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Kho Vật Lý</h3>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">{warehouseList.length} Kho</p>
            <p className="text-xs text-slate-500">Âu Cơ, Quỳnh Mai, Dự phòng</p>
          </div>
        </div>

        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sổ cái Bất biến</h3>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">{ledgerList.length} Bút toán</p>
            <p className="text-xs text-slate-500">Append-only | Chặn âm kho</p>
          </div>
        </div>
      </section>

      {/* Stock Matrix & Ledger Management */}
      <section>
        <div className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Quản Lý Kho Vận 3 Kho & Sổ Cái Biến Động Thời Gian Thực
            </h2>
            <p className="text-xs text-slate-500">
              Theo dõi phân bổ hàng tồn tại Kho 1 (Âu Cơ - Sách lẻ), Kho 2 (Quỳnh Mai - Kiện lưu), Kho 3 (Dự phòng). Hỗ trợ chuyển kho và nhập xuất nhanh.
            </p>
          </div>
        </div>

        <StockOverviewMatrix
          initialBooks={matrixBooks}
          warehouses={warehouseList}
          initialLedger={ledgerList}
        />
      </section>
    </main>
  );
}

