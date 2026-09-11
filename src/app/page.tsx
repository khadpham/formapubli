import { db, works, editions, warehouses } from '@/db';

export default async function HomePage() {
  // Query initial master data to verify database connection
  let worksList: any[] = [];
  let dbStatus = 'Connected';
  try {
    worksList = await db.select().from(works).limit(5);
  } catch (error: any) {
    dbStatus = 'Connecting: ' + error.message;
  }

  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto">
      <header className="border-b pb-4 mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">formapubli ERP</h1>
          <p className="text-sm text-slate-500">Hệ Điều Hành Quản Trị Xuất Bản & Kho Vận Chuyên Dụng</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-xs font-medium text-slate-600">Dual-Engine Active: {dbStatus}</span>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mô Hình CSDL</h3>
          <p className="text-lg font-bold text-slate-700 mt-1">Cloudflare D1 & SQLite</p>
          <p className="text-xs text-slate-500 mt-1">0 VNĐ Vĩnh viễn | 5 GB Cloud</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Kho Vật Lý</h3>
          <p className="text-lg font-bold text-slate-700 mt-1">3 Kho (Tây Hồ, QM, DP)</p>
          <p className="text-xs text-slate-500 mt-1">Sách Rời vs Lưu Kiện Lớn</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Chuẩn Nhập Liệu</h3>
          <p className="text-lg font-bold text-slate-700 mt-1">Keyboard-First (4 Số)</p>
          <p className="text-xs text-slate-500 mt-1">Tra cứu ISBN & Tên Tắt 2-3s</p>
        </div>
      </section>

      <section className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-2">Trạng Thái Khởi Tạo Phase 1</h2>
        <p className="text-sm text-slate-600 mb-4">
          Cơ sở dữ liệu kép đã được cấu hình với 11 bảng lõi: Works (Tác phẩm), Editions (Ấn bản/ISBN), Warehouses, Partners, Customers (CRM 360), Seasonal Bundles (Gói mùa), Subscriptions, Inventory Ledger (Append-Only) và Stock Balances.
        </p>
        <div className="bg-slate-50 p-4 rounded border text-xs font-mono text-slate-700 overflow-x-auto">
          Database Engine: LibSQL / SQLite Client<br />
          Database URL: file:formapubli.db<br />
          Schema Version: 3.0 (Master Comprehensive)<br />
          Works Count: {worksList.length} (Ready for Phase 1 Data Seeding)
        </div>
      </section>
    </main>
  );
}
