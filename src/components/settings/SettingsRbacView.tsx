'use client';

import React from 'react';
import { Settings, Shield, Key, Check, X } from 'lucide-react';
import { USER_ROLES, UserRole } from '@/lib/roles';

interface SettingsRbacViewProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
}

export function SettingsRbacView({ currentRole, onRoleChange }: SettingsRbacViewProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-700" />
            Phân Quyền Người Dùng & Cài Đặt Hệ Thống (RBAC)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản trị 5 vai trò nhân sự và cơ chế bảo mật cách ly dữ liệu Sổ Kép
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-600" />
          Chuyển Đổi Vai Trò Trực Tiếp (Mô Phỏng Trải Nghiệm Thực Tế)
        </h3>
        <p className="text-xs text-slate-500">
          Chọn một vai trò bên dưới để kiểm tra trực tiếp giao diện và quyền truy cập dữ liệu:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.values(USER_ROLES).map((role) => {
            const isSelected = currentRole === role.id;
            return (
              <div
                key={role.id}
                onClick={() => onRoleChange(role.id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer select-none flex flex-col justify-between ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-50/50 shadow-md ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-[10px] font-bold text-slate-400">
                      {role.id}
                    </span>
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white">
                        Đang chọn
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-extrabold text-slate-900">{role.label}</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {role.description}
                  </p>
                </div>

                <div className="mt-4 pt-2 border-t border-slate-100 text-[11px] font-medium text-slate-400">
                  Truy cập: {role.allowedNavItems.length} Phân hệ
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
