'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, Lock, Unlock, KeyRound, ShieldCheck, Pencil } from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';

interface StaffRow {
  staffId: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  assignedWarehouseId?: string | null;
  allowedWarehouseIds?: string[] | null;
  createdAt?: string;
  sessionVersion?: number;
  lease?: {
    sessionId: string;
    startedAt?: string;
    leaseExpiresAt?: string;
    deviceLabel?: string | null;
  } | null;
}

interface StaffManagerProps {
  canManagePrivileged: boolean;
}

const CREATABLE_BY_MANAGER: UserRole[] = ['ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];
const ALL_ROLES: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];

export function StaffManager({ canManagePrivileged }: StaffManagerProps) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ staffId: '', fullName: '', role: 'ROLE_CASHIER' as UserRole, passcode: '' });
  const [creating, setCreating] = useState(false);
  const [resetId, setResetId] = useState('');
  const [resetPin, setResetPin] = useState('');
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [releaseId, setReleaseId] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; code: string; warehouseType?: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/staff', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Không tải được danh sách tài khoản.');
        return;
      }
      setRows(json.data);
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Danh sách kho để gán phụ trách (thu ngân hội chợ / kho cố định).
    fetch('/api/warehouses?all=true', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j?.data)) setWarehouses(j.data); })
      .catch(() => {});
  }, [load]);

  const mutate = async (staffId: string, body: Record<string, unknown>, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(staffId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Thao tác thất bại.');
        return;
      }
      setNotice(`Đã cập nhật ${staffId}: ${(json.data?.updated || []).join(', ')}.`);
      setResetId('');
      setResetPin('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối.');
    }
  };

  // S-01: force-release lease cashier (máy kẹt/không logout được).
  // Gửi expected session+version để chống hủy nhầm phiên mới (409 → tải lại).
  const forceRelease = async (row: StaffRow) => {
    if (!row.lease) return;
    setError(null);
    setNotice(null);
    setReleasing(true);
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(row.staffId)}/release-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: releaseReason.trim(),
          expectedSessionId: row.lease.sessionId,
          expectedSessionVersion: row.sessionVersion,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Buộc đăng xuất thất bại.');
        await load();
        return;
      }
      setNotice(`Đã buộc đăng xuất máy của ${row.staffId}.`);
      setReleaseId('');
      setReleaseReason('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối.');
    } finally {
      setReleasing(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {    e.preventDefault();
    setError(null);
    setNotice(null);
    setCreating(true);
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Tạo tài khoản thất bại.');
        return;
      }
      setNotice(`Đã tạo ${json.data.staffId} (${json.data.fullName}).`);
      setForm({ staffId: '', fullName: '', role: 'ROLE_CASHIER', passcode: '' });
      await load();
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối.');
    } finally {
      setCreating(false);
    }
  };

  const roleOptions = canManagePrivileged ? ALL_ROLES : CREATABLE_BY_MANAGER;

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <div>
        <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600" />
          Quản Trị Tài Khoản Ca Làm Việc
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {canManagePrivileged
            ? 'Owner: toàn quyền thêm / khóa / reset PIN mọi tài khoản (không tự khóa chính mình).'
            : 'Manager: chỉ quản lý Thu ngân / Thủ kho / Kế toán thuế.'}{' '}
          Không xóa cứng nhân viên — dùng nút Khóa (vô hiệu hóa), giữ nguyên két ca & lịch sử bán.
        </p>
      </div>

      {error && (
        <p className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">{error}</p>
      )}
      {notice && (
        <p className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-semibold">{notice}</p>
      )}

      <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-5 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <input
          value={form.staffId}
          onChange={(e) => setForm({ ...form, staffId: e.target.value })}
          placeholder="Mã NV (VD: NV3)"
          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          placeholder="Tên hiển thị"
          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
        >
          {roleOptions.map((r) => (
            <option key={r} value={r}>{USER_ROLES[r]?.label || r}</option>
          ))}
        </select>
        <input
          type="password"
          value={form.passcode}
          onChange={(e) => setForm({ ...form, passcode: e.target.value })}
          placeholder="PIN (≥4 ký tự)"
          autoComplete="new-password"
          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={creating}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5" /> Thêm
        </button>
      </form>

      {loading ? (
        <p className="text-xs text-slate-500 text-center py-3">Đang tải...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
              <tr>
                <th className="px-3 py-2">Mã NV</th>
                <th className="px-3 py-2">Tên</th>
                <th className="px-3 py-2">Vai trò</th>
                <th className="px-3 py-2">Kho phụ trách</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staffId} className="border-b border-slate-50">
                  <td className="px-3 py-2 font-mono font-bold text-slate-800">{r.staffId}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {editId === r.staffId ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Tên hiển thị"
                        autoFocus
                        className="w-40 px-2 py-1.5 bg-white border border-indigo-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ) : (
                      r.fullName
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editId === r.staffId && canManagePrivileged ? (
                      <select
                        value={r.role}
                        onChange={(e) => mutate(
                          r.staffId,
                          { role: e.target.value },
                          `Đổi vai trò ${r.staffId} sang ${USER_ROLES[e.target.value as UserRole]?.label || e.target.value}?`
                        )}
                        className="px-2 py-1.5 bg-white border border-indigo-300 rounded-lg text-xs font-semibold outline-none"
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>{USER_ROLES[role]?.label || role}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-500">{USER_ROLES[r.role]?.label || r.role}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={r.assignedWarehouseId || ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        const wh = warehouses.find((w) => w.id === id);
                        mutate(
                          r.staffId,
                          { assignedWarehouseId: id || null },
                          id ? `Gán ${r.staffId} phụ trách kho [${wh?.name || id}]?` : `Bỏ gán kho cho ${r.staffId}?`
                        );
                      }}
                      className="px-2 py-1.5 bg-white border border-indigo-300 rounded-lg text-[11px] font-semibold outline-none max-w-[190px] mb-1"
                      title="Gán nhân viên phụ trách kho nào (quản lý trở lên)"
                    >
                      <option value="">— Chưa gán —</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}{w.warehouseType === 'FAIR_EVENT' ? ' (hội chợ)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="max-w-[190px] space-y-1">
                      {warehouses.filter((w) => (w as any).isActive !== false).map((w) => {
                        const cur: string[] = Array.isArray((r as any).allowedWarehouseIds)
                          ? (r as any).allowedWarehouseIds
                          : [];
                        const checked = cur.includes(w.id);
                        return (
                          <label key={w.id} className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked ? [...cur, w.id] : cur.filter((x) => x !== w.id);
                                mutate(
                                  r.staffId,
                                  { allowedWarehouseIds: next },
                                  next.length > 0
                                    ? `Cho ${r.staffId} bán ở ${next.length} kho?`
                                    : `Bỏ giới hạn kho cho ${r.staffId} (bán mọi kho)?`
                                );
                              }}
                              className="w-4 h-4 accent-indigo-600"
                            />
                            <span className="truncate">{w.name}</span>
                          </label>
                        );
                      })}
                      <p className="text-[10px] text-slate-400">Trống = bán mọi kho.</p>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.isActive ? (
                      <span className="text-emerald-700 font-bold">Đang hoạt động</span>
                    ) : (
                      <span className="text-rose-600 font-bold">Đã khóa</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {resetId === r.staffId ? (
                        <>
                          <input
                            type="password"
                            value={resetPin}
                            onChange={(e) => setResetPin(e.target.value)}
                            placeholder="PIN mới"
                            autoComplete="new-password"
                            className="w-24 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <button
                            onClick={() => mutate(r.staffId, { passcode: resetPin }, `Reset PIN cho ${r.staffId}?`)}
                            className="px-2.5 py-1.5 bg-indigo-600 text-white font-bold rounded-lg text-[11px] cursor-pointer"
                          >
                            Lưu
                          </button>
                          <button
                            onClick={() => { setResetId(''); setResetPin(''); }}
                            className="px-2.5 py-1.5 bg-slate-100 text-slate-600 font-bold rounded-lg text-[11px] cursor-pointer"
                          >
                            Hủy
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            title="Sửa tên / vai trò"
                            onClick={() => { setEditId(r.staffId); setEditName(r.fullName); }}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {editId === r.staffId && (
                            <>
                              <button
                                onClick={() => mutate(r.staffId, { fullName: editName }, `Đổi tên ${r.staffId} thành "${editName}"?`)}
                                className="px-2.5 py-1.5 bg-indigo-600 text-white font-bold rounded-lg text-[11px] cursor-pointer"
                              >
                                Lưu tên
                              </button>
                              <button
                                onClick={() => { setEditId(''); setEditName(''); }}
                                className="px-2.5 py-1.5 bg-slate-100 text-slate-600 font-bold rounded-lg text-[11px] cursor-pointer"
                              >
                                Hủy
                              </button>
                            </>
                          )}
                          <button
                            title="Đổi PIN"
                            onClick={() => { setResetId(r.staffId); setResetPin(''); }}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          {r.isActive ? (
                            <button
                              title="Khóa tài khoản"
                              onClick={() => mutate(r.staffId, { isActive: false }, `Khóa ${r.staffId}? Người này sẽ không đăng nhập được nữa.`)}
                              className="p-1.5 bg-amber-100 hover:bg-amber-200 rounded-lg text-amber-700 cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              title="Mở khóa"
                              onClick={() => mutate(r.staffId, { isActive: true }, `Mở khóa ${r.staffId}?`)}
                              className="p-1.5 bg-emerald-100 hover:bg-emerald-200 rounded-lg text-emerald-700 cursor-pointer"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {r.lease && (
                            <button
                              title={`Buộc đăng xuất máy đang mở phiên (từ ${r.lease.startedAt || 'không rõ'})`}
                              aria-label={`Buộc đăng xuất máy của ${r.staffId}`}
                              onClick={() => { setReleaseId(r.staffId); setReleaseReason(''); }}
                              className="px-2.5 py-1.5 bg-rose-100 hover:bg-rose-200 rounded-lg text-rose-700 text-[11px] font-bold cursor-pointer flex items-center gap-1.5"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" /> Buộc đăng xuất
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.map((r) =>
                releaseId === r.staffId ? (
                  <tr key={`${r.staffId}-release`} className="bg-rose-50/40">
                    <td colSpan={6} className="px-3 pb-3">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <span className="text-[11px] text-slate-500">Bắt buộc nhập lý do (để ghi audit) để đuổi máy của {r.staffId}.</span>
                        <input
                          aria-label="Lý do buộc đăng xuất"
                          value={releaseReason}
                          onChange={(e) => setReleaseReason(e.target.value)}
                          placeholder="Lý do buộc đăng xuất"
                          autoFocus
                          className="w-56 px-2 py-1.5 bg-white border border-rose-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-rose-500"
                        />
                        <button
                          onClick={() => forceRelease(r)}
                          disabled={!releaseReason.trim() || releasing}
                          className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] transition disabled:opacity-50 cursor-pointer"
                        >
                          Xác nhận
                        </button>
                        <button
                          onClick={() => { setReleaseId(''); setReleaseReason(''); }}
                          disabled={releasing}
                          className="px-2.5 py-1.5 bg-slate-100 text-slate-600 font-bold rounded-lg text-[11px] disabled:opacity-50 cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" />
        Mọi thao tác thêm / reset PIN / khóa-mở đều ghi audit. PIN chỉ lưu dạng băm, không ai đọc lại được.
      </p>
    </div>
  );
}
