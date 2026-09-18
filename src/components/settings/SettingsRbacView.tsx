'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Keyboard,
  Sun,
  Moon,
  Monitor,
  Volume2,
  VolumeX,
  Printer,
  Globe,
  Bell,
  CheckCircle2,
  Check,
  RotateCcw,
  Sparkles,
  Command,
  Save,
} from 'lucide-react';
import { USER_ROLES, UserRole } from '@/lib/roles';
import { StaffManager } from './StaffManager';

interface SettingsRbacViewProps {
  currentRole: UserRole;
  sessionRole?: UserRole;
  onRoleChange: (role: UserRole) => void;
}

export function SettingsRbacView({ currentRole, sessionRole, onRoleChange }: SettingsRbacViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'roles' | 'shortcuts' | 'appearance' | 'language' | 'sound' | 'printer'>('roles');

  // Cấu hình lưu trữ cục bộ (Settings State)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('light');
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [enableShortcuts, setEnableShortcuts] = useState(true);
  const [enableSound, setEnableSound] = useState(true);
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [printerPaper, setPrinterPaper] = useState<'K80' | 'K57'>('K80');
  const [autoPrintOnCheckout, setAutoPrintOnCheckout] = useState(false);
  const [lowStockAlertThreshold, setLowStockAlertThreshold] = useState(15);
  const [receiptFooterText, setReceiptFooterText] = useState('Cảm ơn quý độc giả đã đồng hành cùng formapubli!');
  const [savedNotification, setSavedNotification] = useState(false);
  const [lastKeyPressed, setLastKeyPressed] = useState<string | null>(null);

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('formapubli_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.themeMode) setThemeMode(parsed.themeMode);
        if (parsed.tableDensity) setTableDensity(parsed.tableDensity);
        if (parsed.enableShortcuts !== undefined) setEnableShortcuts(parsed.enableShortcuts);
        if (parsed.enableSound !== undefined) setEnableSound(parsed.enableSound);
        if (parsed.language) setLanguage(parsed.language);
        if (parsed.printerPaper) setPrinterPaper(parsed.printerPaper);
        if (parsed.autoPrintOnCheckout !== undefined) setAutoPrintOnCheckout(parsed.autoPrintOnCheckout);
        if (parsed.lowStockAlertThreshold) setLowStockAlertThreshold(parsed.lowStockAlertThreshold);
        if (parsed.receiptFooterText) setReceiptFooterText(parsed.receiptFooterText);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Save settings
  const handleSaveSettings = () => {
    try {
      const data = {
        themeMode,
        tableDensity,
        enableShortcuts,
        enableSound,
        language,
        printerPaper,
        autoPrintOnCheckout,
        lowStockAlertThreshold,
        receiptFooterText,
      };
      localStorage.setItem('formapubli_settings', JSON.stringify(data));
      setSavedNotification(true);
      setTimeout(() => setSavedNotification(false), 2500);

      // Phát âm thanh phản hồi nếu bật
      if (enableSound) {
        playSuccessTone();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Hàm phát âm thanh synthesizer Web Audio API
  const playSuccessTone = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      // Audio context might be restricted
    }
  };

  // Keyboard shortcut tester listener
  useEffect(() => {
    const handleTestKey = (e: KeyboardEvent) => {
      let keyStr = '';
      if (e.ctrlKey) keyStr += 'Ctrl + ';
      if (e.altKey) keyStr += 'Alt + ';
      if (e.shiftKey) keyStr += 'Shift + ';
      keyStr += e.key.toUpperCase();
      setLastKeyPressed(keyStr);
    };
    window.addEventListener('keydown', handleTestKey);
    return () => window.removeEventListener('keydown', handleTestKey);
  }, []);

  const shortcutList = [
    {
      key: '/',
      scope: 'Toàn hệ thống & POS',
      action: 'Nhảy nhanh vào thanh tìm kiếm sách (không cần dùng chuột)',
      safety: 'Tự động bỏ qua khi đang gõ trong ô nhập liệu khác',
    },
    {
      key: 'Esc',
      scope: 'Toàn hệ thống',
      action: 'Xóa nhanh từ khóa tìm kiếm / Đóng các cửa sổ popup modal',
      safety: 'Chuẩn UX phổ quát của mọi trình duyệt',
    },
    {
      key: 'Alt + Shift + V',
      scope: 'POS & Kho hàng',
      action: 'Bật / Tắt Microphone nhận diện giọng nói tiếng Việt tức thì',
      safety: 'Không xung đột với phím tắt tab trình duyệt',
    },
    {
      key: 'Ctrl + Enter',
      scope: 'Quầy POS & Form kho',
      action: 'Thanh toán & Khấu trừ kho tức thì (hoặc Ghi sổ cái bất biến)',
      safety: 'Bảo vệ xác nhận trước khi thực thi',
    },
    {
      key: 'Alt + Shift + T',
      scope: 'Kho hàng',
      action: 'Mở nhanh Phiếu Chuyển Kho (Âu Cơ <-> Quỳnh Mai <-> Hội Chợ)',
      safety: 'Không bị Chrome/Edge chặn (thay thế cho Ctrl+T)',
    },
    {
      key: 'Alt + Shift + R',
      scope: 'Kho hàng',
      action: 'Mở nhanh Phiếu Nhập In từ Nhà in',
      safety: 'Không xung đột F5 Reload (thay thế cho Ctrl+R)',
    },
    {
      key: 'Alt + Shift + X',
      scope: 'Kho hàng',
      action: 'Mở nhanh Phiếu Xuất Bán / Điều chuyển',
      safety: 'Không xung đột Bookmark (thay thế cho Ctrl+D)',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Cài Đặt Hệ Thống & Phân Quyền Vai Trò
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản trị 5 vai trò nhân sự, tùy biến phím tắt, giao diện hiển thị, thông báo và máy in nhiệt
          </p>
        </div>

        <button
          onClick={handleSaveSettings}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all active:scale-95"
        >
          <Save className="w-4 h-4" />
          <span>Lưu Cấu Hình</span>
        </button>
      </div>

      {/* Save Success Banner */}
      {savedNotification && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2 font-bold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Đã lưu thành công các thiết lập tùy biến vào trình duyệt!</span>
        </div>
      )}

      {/* Settings Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-200/80 rounded-2xl overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('roles')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeSubTab === 'roles'
              ? 'bg-white text-indigo-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>1. Phân Quyền 5 Roles</span>
        </button>

        <button
          onClick={() => setActiveSubTab('shortcuts')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeSubTab === 'shortcuts'
              ? 'bg-white text-indigo-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Keyboard className="w-3.5 h-3.5" />
          <span>2. Nút Bấm Tắt</span>
        </button>

        <button
          onClick={() => setActiveSubTab('appearance')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeSubTab === 'appearance'
              ? 'bg-white text-indigo-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sun className="w-3.5 h-3.5" />
          <span>3. Giao Diện & Mật Độ</span>
        </button>

        <button
          onClick={() => setActiveSubTab('sound')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeSubTab === 'sound'
              ? 'bg-white text-indigo-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>4. Âm Thanh & Cảnh Báo</span>
        </button>

        <button
          onClick={() => setActiveSubTab('printer')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeSubTab === 'printer'
              ? 'bg-white text-indigo-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Printer className="w-3.5 h-3.5" />
          <span>5. Máy In Nhiệt</span>
        </button>

        <button
          onClick={() => setActiveSubTab('language')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeSubTab === 'language'
              ? 'bg-white text-indigo-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>6. Ngôn Ngữ</span>
        </button>
      </div>

      {/* TAB 1: ROLES & RBAC SIMULATION */}
      {activeSubTab === 'roles' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div>
              <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-600" />
                Mô Phỏng Trực Tiếp Quyền Hạn (RBAC 5 Roles)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Chạm vào một vai trò bên dưới để kiểm tra ngay lập tức giao diện thay đổi theo quyền tương ứng:
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.values(USER_ROLES).map((role) => {
                const isSelected = currentRole === role.id;
                return (
                  <div
                    key={role.id}
                    onClick={() => {
                      onRoleChange(role.id);
                      if (enableSound) playSuccessTone();
                    }}
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
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white flex items-center gap-1">
                            <Check className="w-3 h-3" /> Đang kích hoạt
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-extrabold text-slate-900">{role.label}</h4>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {role.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-medium text-slate-400">
                      <span>Phân hệ truy cập:</span>
                      <span className="font-bold text-slate-700">{role.allowedNavItems.length} / 7</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quản trị tài khoản ca — chỉ session thật OWNER/MANAGER (không theo preview mô phỏng) */}
          {(sessionRole === 'ROLE_OWNER' || sessionRole === 'ROLE_MANAGER') && (
            <StaffManager canManagePrivileged={sessionRole === 'ROLE_OWNER'} />
          )}
        </div>
      )}

      {/* TAB 2: KEYBOARD SHORTCUTS */}
      {activeSubTab === 'shortcuts' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-emerald-600" />
                  Danh Mục Phím Tắt Hệ Thống (Không Xung Đột Chrome/Edge)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tối ưu 100% cho thao tác bán hàng hội chợ và nhập xuất kho không cần đụng chuột
                </p>
              </div>

              {/* Shortcut Enable Switch */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableShortcuts}
                  onChange={(e) => setEnableShortcuts(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-xs font-bold text-slate-700">Kích hoạt phím tắt</span>
              </label>
            </div>

            {/* Interactive Key Tester Box */}
            <div className="p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                  Khu Vực Kiểm Thử Phím Tắt (Keypress Tester)
                </span>
                <span className="text-xs text-slate-300">
                  Thử bấm bất kỳ phím nào trên bàn phím của bạn:
                </span>
              </div>
              <div className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 font-mono font-black text-sm text-emerald-400 min-w-[120px] text-center">
                {lastKeyPressed || 'Chưa bấm phím'}
              </div>
            </div>

            {/* Table of Shortcuts */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                  <tr>
                    <th className="p-3 w-40">Phím Tắt</th>
                    <th className="p-3 w-36">Phạm Vi</th>
                    <th className="p-3">Hành Động Thực Thi</th>
                    <th className="p-3 w-64">Cơ Chế An Toàn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shortcutList.map((sc) => (
                    <tr key={sc.key} className="hover:bg-slate-50/70">
                      <td className="p-3">
                        <kbd className="px-2 py-1 bg-slate-100 border border-slate-300 rounded-lg font-mono font-black text-xs text-slate-900 shadow-sm inline-block">
                          {sc.key}
                        </kbd>
                      </td>
                      <td className="p-3 font-semibold text-slate-700">
                        {sc.scope}
                      </td>
                      <td className="p-3 font-medium text-slate-900">
                        {sc.action}
                      </td>
                      <td className="p-3 text-slate-500 text-[11px]">
                        {sc.safety}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: THEME & DENSITY */}
      {activeSubTab === 'appearance' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500" />
              Giao Diện & Mật Độ Hiển Thị
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tùy biến độ sáng và mật độ bảng phù hợp với thiết bị máy tính quầy hoặc điện thoại di động
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Theme Mode */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">
                Chế Độ Màu (Theme Mode):
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'light', label: 'Sáng (Light)', icon: Sun },
                  { id: 'dark', label: 'Tối (Dark)', icon: Moon },
                  { id: 'system', label: 'Tự động (OS)', icon: Monitor },
                ].map((t) => {
                  const Icon = t.icon;
                  const isSelected = themeMode === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setThemeMode(t.id as any)}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-2 font-bold text-xs transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Table Density */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">
                Mật Độ Hiển Thị Bảng (Table Density):
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTableDensity('comfortable')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 font-bold text-xs transition-all ${
                    tableDensity === 'comfortable'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Thoải mái (Comfortable)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Tối ưu cho cảm ứng tablet</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTableDensity('compact')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 font-bold text-xs transition-all ${
                    tableDensity === 'compact'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Gọn gàng (Compact)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Nhiều dòng trên màn hình PC</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SOUND & NOTIFICATIONS */}
      {activeSubTab === 'sound' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-emerald-600" />
              Âm Thanh Phản Hồi & Cảnh Báo Vận Hành
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Phát âm thanh bíp khi quét barcode, thanh toán đơn hàng và thông báo tồn kho
            </p>
          </div>

          <div className="space-y-4 max-w-xl">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <p className="text-xs font-bold text-slate-900">Âm thanh phản hồi khi thao tác</p>
                <p className="text-[11px] text-slate-500">Phát tiếng khi thêm sách hoặc thanh toán thành công</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEnableSound(!enableSound);
                  if (!enableSound) playSuccessTone();
                }}
                className={`p-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors ${
                  enableSound
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {enableSound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span>{enableSound ? 'Đang Bật' : 'Đã Tắt'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <p className="text-xs font-bold text-slate-900">Ngưỡng cảnh báo sách sắp hết hàng</p>
                <p className="text-[11px] text-slate-500">Hiển thị cảnh báo đỏ khi tồn kho dưới ngưỡng này</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={lowStockAlertThreshold}
                  onChange={(e) => setLowStockAlertThreshold(parseInt(e.target.value, 10) || 15)}
                  className="w-20 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-center outline-none"
                />
                <span className="text-xs text-slate-500 font-bold">cuốn</span>
              </div>
            </div>

            <button
              type="button"
              onClick={playSuccessTone}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-2"
            >
              <Volume2 className="w-4 h-4 text-emerald-600" />
              <span>Bấm Nghe Thử Âm Thanh Phản Hồi</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 5: THERMAL PRINTER */}
      {activeSubTab === 'printer' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <Printer className="w-4 h-4 text-sky-600" />
              Cấu Hình Máy In Hóa Đơn & Biên Nhận Nhiệt
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Hỗ trợ máy in bill quầy K80 (80mm) và máy in nhiệt mini cầm tay K57 (57mm)
            </p>
          </div>

          <div className="space-y-4 max-w-xl">
            {/* Paper Size */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">Khổ giấy in biên nhận:</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPrinterPaper('K80')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1 font-bold text-xs ${
                    printerPaper === 'K80'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Khổ K80 (80mm)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Chuẩn máy in quầy thu ngân</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrinterPaper('K57')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1 font-bold text-xs ${
                    printerPaper === 'K57'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Khổ K57 (57mm)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Máy in Bluetooth cầm tay hội chợ</span>
                </button>
              </div>
            </div>

            {/* Auto Print */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <p className="text-xs font-bold text-slate-900">Tự động bật hộp thoại in bill</p>
                <p className="text-[11px] text-slate-500">Mở lệnh in ngay sau khi nhấn thanh toán thành công</p>
              </div>
              <input
                type="checkbox"
                checked={autoPrintOnCheckout}
                onChange={(e) => setAutoPrintOnCheckout(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
            </div>

            {/* Receipt Footer Message */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Lời cảm ơn in chân trang:</label>
              <input
                type="text"
                value={receiptFooterText}
                onChange={(e) => setReceiptFooterText(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: LANGUAGE & LOCALIZATION */}
      {activeSubTab === 'language' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div>
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <Globe className="w-4 h-4 text-purple-600" />
              Ngôn Ngữ & Định Dạng Số Chuẩn Việt Nam
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Hệ thống được thiết kế đo ni đóng giày cho quy chuẩn xuất bản Việt Nam
            </p>
          </div>

          <div className="space-y-4 max-w-xl">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLanguage('vi')}
                className={`p-3.5 rounded-xl border flex items-center justify-between font-bold text-xs ${
                  language === 'vi'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 shadow-sm'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>🇻🇳 Tiếng Việt (Mặc định)</span>
                {language === 'vi' && <Check className="w-4 h-4 text-purple-600" />}
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`p-3.5 rounded-xl border flex items-center justify-between font-bold text-xs ${
                  language === 'en'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 shadow-sm'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>🇬🇧 English</span>
                {language === 'en' && <Check className="w-4 h-4 text-purple-600" />}
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Định dạng tiền tệ:</span>
                <span className="font-mono font-bold text-slate-900">36.000 đ (VNĐ)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Múi giờ vận hành:</span>
                <span className="font-mono font-bold text-slate-900">GMT+7 (Asia/Ho_Chi_Minh)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Quy chuẩn mã sách:</span>
                <span className="font-mono font-bold text-slate-900">ISBN-13 & SKU H01-H81</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
