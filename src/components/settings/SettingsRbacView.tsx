'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  Volume2,
  VolumeX,
  Printer,
  Globe,
  CheckCircle2,
  Check,
  Save,
  Users,
  Landmark,
} from 'lucide-react';
import { UserRole, getSettingsAccess } from '@/lib/roles';
import { StaffManager } from './StaffManager';
import { BankAccountsManager } from './BankAccountsManager';

interface SettingsRbacViewProps {
  sessionRole?: UserRole;
}

type SettingsTab = 'staff' | 'banks' | 'appearance' | 'language' | 'sound' | 'printer';

export function SettingsRbacView({ sessionRole }: SettingsRbacViewProps) {
  const { canManageAccounts, canManageBanks, canManagePrinter } = getSettingsAccess(sessionRole);
  const [activeSubTab, setActiveSubTab] = useState<SettingsTab>(canManageAccounts ? 'staff' : 'appearance');

  useEffect(() => {
    setActiveSubTab((prev) => {
      if (prev === 'staff' && !canManageAccounts) return 'appearance';
      if (prev === 'banks' && !canManageBanks) return 'appearance';
      if (prev === 'printer' && !canManagePrinter) return 'appearance';
      return prev;
    });
  }, [canManageAccounts, canManageBanks, canManagePrinter]);

  // Cấu hình lưu trữ cục bộ (Settings State)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('light');
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [enableSound, setEnableSound] = useState(true);
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const [printerPaper, setPrinterPaper] = useState<'K80' | 'K57'>('K80');
  const [autoPrintOnCheckout, setAutoPrintOnCheckout] = useState(false);
  const [receiptFooterText, setReceiptFooterText] = useState('Cảm ơn quý độc giả đã đồng hành cùng formapubli!');
  const [savedNotification, setSavedNotification] = useState(false);

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('formapubli_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.themeMode && ['light', 'dark', 'system'].includes(parsed.themeMode)) setThemeMode(parsed.themeMode);
        if (parsed.tableDensity && ['comfortable', 'compact'].includes(parsed.tableDensity)) setTableDensity(parsed.tableDensity);
        if (typeof parsed.enableSound === 'boolean') setEnableSound(parsed.enableSound);
        if (parsed.language && ['vi', 'en'].includes(parsed.language)) setLanguage(parsed.language);
        if (parsed.printerPaper && ['K80', 'K57'].includes(parsed.printerPaper)) setPrinterPaper(parsed.printerPaper);
        if (typeof parsed.autoPrintOnCheckout === 'boolean') setAutoPrintOnCheckout(parsed.autoPrintOnCheckout);
        if (typeof parsed.receiptFooterText === 'string' && parsed.receiptFooterText.length <= 200) setReceiptFooterText(parsed.receiptFooterText);
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
        enableSound,
        language,
        printerPaper,
        autoPrintOnCheckout,
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

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="hidden md:block">
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Cài Đặt Hệ Thống & Vai Trò
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
             Tùy biến ngôn ngữ, giao diện và âm thanh. Thu ngân và quản lý được thêm máy in; quản lý thêm tài khoản và ngân hàng.
          </p>
        </div>

        <button
          onClick={handleSaveSettings}
          className="flex min-h-11 items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all active:scale-95"
        >
          <Save className="w-4 h-4" />
          <span>Lưu Cấu Hình</span>
        </button>
      </div>

      {/* Save Success Banner */}
      {savedNotification && (
        <div role="status" aria-live="polite" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2 font-bold animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Đã lưu thành công các thiết lập tùy biến vào trình duyệt!</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)] md:items-start">
        <nav className="space-y-3" aria-label="Nhóm cài đặt">
          <div className="space-y-1.5">
            <p className="px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Cá nhân & Thiết bị</p>
            {[
              { id: 'appearance' as SettingsTab, label: 'Giao Diện', icon: Sun },
              { id: 'sound' as SettingsTab, label: 'Âm Thanh', icon: Volume2 },
              { id: 'language' as SettingsTab, label: 'Ngôn Ngữ', icon: Globe },
              ...(canManagePrinter ? [{ id: 'printer' as SettingsTab, label: 'Máy In Nhiệt', icon: Printer }] : []),
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeSubTab === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setActiveSubTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center gap-2 min-h-11 px-3 rounded-xl text-left text-xs font-bold transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {(canManageAccounts || canManageBanks) && (
            <div className="space-y-1.5">
              <p className="px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Quản trị</p>
              {canManageAccounts && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('staff')}
                  aria-current={activeSubTab === 'staff' ? 'page' : undefined}
                  className={`w-full flex items-center gap-2 min-h-11 px-3 rounded-xl text-left text-xs font-bold transition-colors ${
                    activeSubTab === 'staff' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Tài Khoản Nhân Sự
                </button>
              )}
              {canManageBanks && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('banks')}
                  aria-current={activeSubTab === 'banks' ? 'page' : undefined}
                  className={`w-full flex items-center gap-2 min-h-11 px-3 rounded-xl text-left text-xs font-bold transition-colors ${
                    activeSubTab === 'banks' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Landmark className="w-4 h-4" />
                  Tài Khoản Ngân Hàng
                </button>
              )}
            </div>
          )}
        </nav>

        <div className="min-w-0">
      {/* TAB: TAI KHOAN NHAN SU */}
      {activeSubTab === 'staff' && canManageAccounts && (
        <StaffManager canManagePrivileged={sessionRole === 'ROLE_OWNER'} />
      )}

      {/* TAB: TAI KHOAN NGAN HANG */}
      {activeSubTab === 'banks' && canManageBanks && (
        <BankAccountsManager sessionRole={sessionRole} />
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
                      aria-pressed={isSelected}
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
                  aria-pressed={tableDensity === 'comfortable'}
                  onClick={() => setTableDensity('comfortable')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 font-bold text-xs transition-all ${
                    tableDensity === 'comfortable'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Thoải mái</span>
                  <span className="text-[10px] text-slate-400 font-normal">Tối ưu cho cảm ứng tablet</span>
                </button>
                <button
                  type="button"
                  aria-pressed={tableDensity === 'compact'}
                  onClick={() => setTableDensity('compact')}
                  className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 font-bold text-xs transition-all ${
                    tableDensity === 'compact'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>Gọn gàng</span>
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
                aria-pressed={enableSound}
                onClick={() => {
                  setEnableSound(!enableSound);
                  if (!enableSound) playSuccessTone();
                }}
                 className={`min-h-11 min-w-11 p-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors ${
                  enableSound
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {enableSound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span>{enableSound ? 'Đang Bật' : 'Đã Tắt'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={playSuccessTone}
              className="min-h-11 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-2"
            >
              <Volume2 className="w-4 h-4 text-emerald-600" />
              <span>Bấm Nghe Thử Âm Thanh Phản Hồi</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 5: THERMAL PRINTER */}
      {activeSubTab === 'printer' && canManagePrinter && (
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
                  aria-pressed={printerPaper === 'K80'}
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
                  aria-pressed={printerPaper === 'K57'}
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
              <label className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl hover:bg-white">
                <input
                  type="checkbox"
                  aria-label="Tự động bật hộp thoại in bill"
                  checked={autoPrintOnCheckout}
                  onChange={(e) => setAutoPrintOnCheckout(e.target.checked)}
                  className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500"
                />
              </label>
            </div>

            {/* Receipt Footer Message */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Lời cảm ơn in chân trang:</label>
               <input
                  type="text"
                  maxLength={200}
                  aria-label="Lời cảm ơn in chân trang"
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
                  aria-pressed={language === 'vi'}
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
                  aria-pressed={language === 'en'}
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
      </div>
    </div>
  );
}
