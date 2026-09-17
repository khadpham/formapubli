'use client';

import React from 'react';
import { BookOpenCheck } from 'lucide-react';
import { CustomersDirectory } from './CustomersDirectory';

export function CustomersListView() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <BookOpenCheck className="w-5 h-5 text-rose-600" />
            Độc Giả 360° & Quản Trị Đăng Ký Gói Mùa (CRM)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản trị độc giả thân thiết, theo dõi tủ sách đã sở hữu và gói đăng ký theo mùa (Xuân/Hạ/Thu/Đông)
          </p>
        </div>
      </div>

      <CustomersDirectory />

      <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-center">
        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-white text-amber-800 border border-amber-200">
          GĐ1 read-only đã xong • GĐ2 POS + GĐ3 Gói Mùa để sprint sau
        </span>
      </div>
    </div>
  );
}
