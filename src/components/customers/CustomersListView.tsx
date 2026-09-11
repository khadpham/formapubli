'use client';

import React from 'react';
import { BookOpenCheck, Sparkles, UserCheck, Calendar } from 'lucide-react';

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

      <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
          <Sparkles className="w-6 h-6" />
        </div>
        <h3 className="text-base font-extrabold text-slate-900">
          Module CRM & Gói Phát Hành Theo Mùa (Phase 3)
        </h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Bao gồm hồ sơ 360 độ của độc giả, cơ chế tự động chống tặng trùng sách đã có trong tủ sách cá nhân, và quản lý đăng ký đặt trước mùa Hạ/mùa Xuân.
        </p>
        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
          Đang chuẩn bị dữ liệu Phase 3
        </span>
      </div>
    </div>
  );
}
