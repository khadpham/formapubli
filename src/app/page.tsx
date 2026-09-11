import { db, works, editions, warehouses, partners } from '@/db';
import { eq, asc } from 'drizzle-orm';
import { CatalogTable } from '@/components/CatalogTable';
import { BookOpen, Warehouse, Users, Database } from 'lucide-react';

export const revalidate = 0; // Dynamic server rendering

export default async function HomePage() {
  let allBooks: any[] = [];
  let warehouseList: any[] = [];
  let partnerList: any[] = [];
  let dbStatus = 'Hoạt động';

  try {
    const rawBooks = await db
      .select({
        code: editions.code,
        title: editions.title,
        isbn: editions.isbn,
        isbnLast4: editions.isbnLast4,
        coverPrice: editions.coverPrice,
        status: editions.status,
        publisher: editions.publisher,
        author: works.author,
        translator: works.translator,
        category: works.category,
        shortCode: works.shortCode,
      })
      .from(editions)
      .innerJoin(works, eq(editions.workId, works.id))
      .orderBy(asc(editions.code));

    allBooks = rawBooks.map((b) => ({
      ...b,
      title: b.title || 'Chưa đặt tên',
      status: b.status || 'IN_STOCK',
    }));

    warehouseList = await db.select().from(warehouses);
    partnerList = await db.select().from(partners);
  } catch (error: any) {
    dbStatus = 'Lỗi kết nối: ' + error.message;
  }

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
            <p className="text-2xl font-bold text-slate-900 mt-0.5">{allBooks.length} Ấn bản</p>
            <p className="text-xs text-slate-500">80 Tác phẩm gốc (H01-H81)</p>
          </div>
        </div>

        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Warehouse className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Kho vật lý</h3>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">{warehouseList.length} Kho</p>
            <p className="text-xs text-slate-500">Âu Cơ, Quỳnh Mai, Dự phòng</p>
          </div>
        </div>

        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Đối tác phân phối</h3>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">{partnerList.length} Đối tác</p>
            <p className="text-xs text-slate-500">Ký gửi, Bán lẻ, Thư viện</p>
          </div>
        </div>

        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Hạ tầng 0 VNĐ</h3>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">D1 + SQLite</p>
            <p className="text-xs text-slate-500">5GB Edge + Auto Backup Drive</p>
          </div>
        </div>
      </section>

      {/* Catalog Table with Fast Search */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Danh Mục Ấn Phẩm & Tra Cứu Kho Nhanh</h2>
            <p className="text-xs text-slate-500">
              Hỗ trợ thủ kho tra cứu bằng bàn phím (Keyboard-First): 4 số cuối ISBN hoặc tên viết tắt 2-3 chữ cái
            </p>
          </div>
        </div>

        <CatalogTable
          initialBooks={allBooks}
          warehouseCount={warehouseList.length}
          partnerCount={partnerList.length}
        />
      </section>
    </main>
  );
}
