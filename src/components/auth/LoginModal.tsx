'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, KeyRound, User, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';

interface LoginModalProps {
  onLoginSuccess: (session: { role: UserRole; actorId: string; expiresAt: number }) => void;
  onCancel?: () => void;
  isClosable?: boolean;
}

interface AccountTile {
  staffId: string;
  fullName: string;
  role: UserRole;
}

const ROLE_ORDER: UserRole[] = ['ROLE_OWNER', 'ROLE_MANAGER', 'ROLE_CASHIER', 'ROLE_WAREHOUSE', 'ROLE_TAX'];

// Vai trò ẩn khỏi màn hình chạm-chọn (vẫn đăng nhập được bằng nhập tay nếu cần).
// Thủ kho + Kế toán thuế không dùng ở quầy hội chợ.
const HIDDEN_PICKER_ROLES: UserRole[] = ['ROLE_WAREHOUSE', 'ROLE_TAX'];

export function LoginModal({ onLoginSuccess, onCancel, isClosable = false }: LoginModalProps) {
  const [accounts, setAccounts] = useState<AccountTile[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isClosable && !loading) {
        setShowPasscode(false);
        onCancel?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClosable, loading, onCancel]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/accounts', { cache: 'no-store' });
        const json = await res.json();
        if (alive && res.ok && json.success && Array.isArray(json.data)) {
          const visible = (json.data as AccountTile[]).filter(
            (a) => !HIDDEN_PICKER_ROLES.includes(a.role)
          );
          setAccounts(visible);
          const firstCashier =
            visible.find((a: AccountTile) => a.role === 'ROLE_CASHIER') || visible[0];
          if (firstCashier) setSelectedId(firstCashier.staffId);
        }
      } catch {
        // Rớt list -> vẫn cho nhập tay, không chặn quầy.
      } finally {
        if (alive) setListLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => accounts.find((a) => a.staffId === selectedId),
    [accounts, selectedId]
  );

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const orderA = ROLE_ORDER.indexOf(a.role);
      const orderB = ROLE_ORDER.indexOf(b.role);
      const diff = (orderA === -1 ? 99 : orderA) - (orderB === -1 ? 99 : orderB);
      if (diff !== 0) return diff;
      return a.fullName.localeCompare(b.fullName, 'vi');
    });
  }, [accounts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const staffId = manualMode ? manualId.trim() : selectedId;
    if (!staffId) {
      setError(manualMode ? 'Vui lòng nhập Mã nhân viên.' : 'Vui lòng chạm chọn tài khoản của bạn.');
      return;
    }
    if (!passcode.trim()) {
      setError('Vui lòng nhập mã PIN ca làm việc.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: selected?.role,
          staffId,
          actorId: staffId,
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

      onLoginSuccess(json.data);
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối máy chủ xác thực.');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={(event) => {
        if (event.target === event.currentTarget && isClosable && !loading) {
          setShowPasscode(false);
          onCancel?.();
        }
      }}
    >
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md sm:max-w-xl w-full shadow-2xl border border-slate-200/80 space-y-5 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/30">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Đăng Nhập Ca Làm Việc
          </h2>
          <p className="text-xs text-slate-500">
            Chạm chọn tên bạn → nhập PIN → mở ca (phiên 12 giờ)
          </p>
        </div>

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
          {listLoading ? (
            <p className="text-xs text-slate-500 text-center py-4">Đang tải danh sách ca...</p>
          ) : !manualMode && accounts.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Chọn nhân viên ({sortedAccounts.length})</span>
                <span className="text-[10px] font-normal text-slate-400">Chạm để chọn</span>
              </div>
              <div className="max-h-[195px] sm:max-h-[250px] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {sortedAccounts.map((a) => {
                    const active = a.staffId === selectedId;
                    return (
                      <button
                        key={a.staffId}
                        type="button"
                        disabled={isLocked}
                        onClick={() => {
                          setSelectedId(a.staffId);
                          setShowPasscode(false);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between min-h-[58px] ${
                          active
                            ? 'border-indigo-600 bg-indigo-50 shadow-sm ring-1 ring-indigo-600'
                            : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-white'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <User className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {a.fullName}
                          </span>
                        </span>
                        <div className="flex items-center justify-between mt-1 text-[10px] w-full gap-1">
                          <span className="font-mono text-slate-400 truncate">
                            {a.staffId}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${
                              a.role === 'ROLE_OWNER'
                                ? 'bg-purple-100 text-purple-700'
                                : a.role === 'ROLE_MANAGER'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {a.role === 'ROLE_OWNER' ? 'Chủ' : a.role === 'ROLE_MANAGER' ? 'Quản lý' : 'Thu ngân'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Tên / Mã định danh nhân viên
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="VD: NV1, KHO1..."
                  value={manualId}
                  disabled={isLocked}
                  onChange={(e) => {
                    setManualId(e.target.value);
                    setShowPasscode(false);
                  }}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block flex items-center justify-between">
              <span>
                Mã PIN{selected ? ` — ${selected.fullName}` : ''}
              </span>
              <span className="text-[10px] text-slate-400 font-normal">PIN 4+ ký tự mọi vai trò</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPasscode ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="off"
                placeholder="••••"
                value={passcode}
                disabled={isLocked}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono tracking-widest text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
              />
              <button
                type="button"
                disabled={isLocked}
                onClick={() => setShowPasscode((prev) => !prev)}
                aria-label={showPasscode ? 'Ẩn mã PIN' : 'Hiện mã PIN'}
                aria-pressed={showPasscode}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:text-indigo-600 rounded-lg transition disabled:opacity-40 cursor-pointer"
              >
                {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            {isClosable && onCancel && (
              <button
                type="button"
                onClick={() => {
                  setShowPasscode(false);
                  onCancel?.();
                }}
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

          {accounts.length > 0 && (
            <button
              type="button"
              disabled={isLocked}
              onClick={() => {
                setManualMode(!manualMode);
                setShowPasscode(false);
              }}
              className="w-full text-center text-[11px] text-indigo-600 hover:text-indigo-500 font-semibold cursor-pointer"
            >
              {manualMode ? '← Quay lại chạm-chọn tài khoản' : 'Không thấy tên? Nhập tay mã NV →'}
            </button>
          )}
        </form>

        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          🔒 Phiên đăng nhập được mã hóa HMAC-SHA256 & lưu trong HttpOnly Cookie. Đăng xuất khi kết thúc ca để đảm bảo tính toàn vẹn sổ sách.
        </p>
      </div>
    </div>,
    document.body
  );
}
