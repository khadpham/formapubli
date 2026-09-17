'use client';

import React, { useState } from 'react';
import { Shield, KeyRound, User, Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';

interface LoginModalProps {
  onLoginSuccess: (session: { role: UserRole; actorId: string; expiresAt: number }) => void;
  onCancel?: () => void;
  isClosable?: boolean;
}

export function LoginModal({ onLoginSuccess, onCancel, isClosable = false }: LoginModalProps) {
  const [selectedRole, setSelectedRole] = useState<UserRole>('ROLE_CASHIER');
  const [actorId, setActorId] = useState('');
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorId.trim()) {
      setError('Vui lòng nhập Tên hoặc Mã nhân viên (ví dụ: ThuNgân-01, Kho-Nam).');
      return;
    }
    if (!passcode.trim()) {
      setError('Vui lòng nhập mã Passcode ca làm việc.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: selectedRole,
          actorId: actorId.trim(),
          passcode: passcode.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Đăng nhập không thành công.');
        if (json.remainingAttempts !== undefined) {
          setRemainingAttempts(json.remainingAttempts);
        }
        if (json.locked) {
          setIsLocked(true);
        }
        return;
      }

      // Đăng nhập thành công
      onLoginSuccess(json.data);
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối máy chủ xác thực.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200/80 space-y-6 animate-in fade-in zoom-in-95">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/30">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Đăng Nhập Ca Làm Việc
          </h2>
          <p className="text-xs text-slate-500">
            formapubli OS — Xác thực phiên làm việc an toàn 12 giờ
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-700 flex items-start gap-2 animate-shake">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{error}</p>
              {remainingAttempts !== null && remainingAttempts > 0 && !isLocked && (
                <p className="text-[11px] text-rose-600/80 mt-0.5">
                  Cảnh báo: Sai 5 lần sẽ khóa 15 phút để chống tấn công brute-force.
                </p>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Chọn vai trò */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              Vai trò tác nghiệp
            </label>
            <select
              value={selectedRole}
              disabled={isLocked}
              onChange={(e) => setSelectedRole(e.target.value as UserRole)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition cursor-pointer"
            >
              {Object.values(USER_ROLES).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Nhập Tên / Mã nhân viên */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              Tên / Mã định danh nhân viên
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="VD: ThuNgân-HộiChợ, Kho-QuỳnhMai..."
                value={actorId}
                disabled={isLocked}
                onChange={(e) => setActorId(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
              />
            </div>
          </div>

          {/* Nhập Passcode */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block flex items-center justify-between">
              <span>Mã Passcode vai trò</span>
              <span className="text-[10px] text-slate-400 font-normal">
                {selectedRole === 'ROLE_OWNER' ? 'Tối thiểu 6 ký tự' : 'Mã PIN ca 4 số'}
              </span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                placeholder="••••••"
                value={passcode}
                disabled={isLocked}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono tracking-widest text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2 flex gap-2">
            {isClosable && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Hủy
              </button>
            )}
            <button
              type="submit"
              disabled={loading || isLocked}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-extrabold rounded-xl text-xs transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <span>Đang xác thực...</span>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Mở Ca & Đăng Nhập</span>
                </>
              )}
            </button>
          </div>
        </form>

        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          🔒 Phiên đăng nhập được mã hóa HMAC-SHA256 & lưu trong HttpOnly Cookie. Đăng xuất khi kết thúc ca để đảm bảo tính toàn vẹn sổ sách.
        </p>
      </div>
    </div>
  );
}
