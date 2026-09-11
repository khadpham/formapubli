'use client';

import React from 'react';
import { Users, Building2, Percent, Phone, Mail } from 'lucide-react';

interface PartnerItem {
  id: string;
  code: string;
  name: string;
  type: string;
  contactInfo: string | null;
  discountRate: number | null;
}

interface PartnersListViewProps {
  partners: PartnerItem[];
}

export function PartnersListView({ partners }: PartnersListViewProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600" />
            Đối Tác & Kênh Phân Phối Sỉ (Partners & B2B)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý mạng lưới đối tác phát hành, nhà in ấn, NXB liên kết và các đại lý sỉ Đinh Lễ
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {partners.map((p) => (
          <div
            key={p.id}
            className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-50 text-purple-700 border border-purple-200">
                  {p.code}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                  {p.type}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-slate-900">{p.name}</h3>
              <p className="text-xs text-slate-500 mt-1">
                {p.contactInfo || 'Chưa cập nhật thông tin liên hệ'}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">Mức chiết khấu sỉ:</span>
              <span className="text-sm font-black text-purple-700 font-mono">
                {Math.round((p.discountRate || 0) * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
