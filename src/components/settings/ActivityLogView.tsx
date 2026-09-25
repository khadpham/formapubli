'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';

type LogRow = {
  id: string;
  action: string;
  actorId: string;
  actorRole: string;
  resource: string;
  details: string | null;
  at: string;
};

const ACTION_LABEL: Record<string, string> = {
  WAREHOUSE_CREATED: 'Mở kho',
  WAREHOUSE_UPDATED: 'Sửa kho',
  WAREHOUSE_DELETED: 'Xóa kho',
  STAFF_UPDATED: 'Sửa nhân sự',
  STAFF_CREATED: 'Tạo nhân viên',
  TRANSFER_BATCH: 'Chuyển kho',
  BATCH_TRANSFER: 'Chuyển kho',
  LOGIN_FAILED: 'Đăng nhập sai',
  LOGOUT: 'Đăng xuất',
  LOGIN: 'Đăng nhập',
};

const ROLE_LABEL: Record<string, string> = {
  ROLE_OWNER: 'Owner',
  ROLE_MANAGER: 'Quản lý',
  ROLE_CASHIER: 'Thu ngân',
  ROLE_WAREHOUSE: 'Thủ kho',
  ROLE_TAX: 'Kế toán',
};

/**
 * Sổ cái lịch trình — mọi thao tác đã xảy ra, lưu lâu trong DB.
 * Quản lý/Owner xem toàn bộ; nhân viên chỉ xem việc của chính mình.
 */
export function ActivityLogView() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/activity-log?limit=150', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Không tải được nhật ký.');
      setRows(json.data || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            Nhật Ký Hoạt Động (Sổ Cái Lịch Trình)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Ai làm gì, lúc nào — lưu lâu trong hệ thống, đóng app vẫn còn, dùng để đối soát.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
          title="Tải lại"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">{error}</p>}

      {loading ? (
        <p className="text-xs text-slate-500 py-4 text-center">Đang tải nhật ký...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">Chưa có hoạt động nào được ghi nhận.</p>
      ) : (
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 sticky top-0">
              <tr>
                <th className="px-3 py-2">Thời điểm</th>
                <th className="px-3 py-2">Ai</th>
                <th className="px-3 py-2">Việc</th>
                <th className="px-3 py-2">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 align-top">
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500 whitespace-nowrap">
                    {String(r.at || '').replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="font-bold text-slate-800">{r.actorId}</span>
                    <span className="block text-[10px] text-slate-400">{ROLE_LABEL[r.actorRole] || r.actorRole}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                      {ACTION_LABEL[r.action] || r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.details || r.resource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
