'use client';

import React, { useEffect, useState } from 'react';
import { PlugZap, CheckCircle2 } from 'lucide-react';
import type { UserRole } from '@/lib/roles';

interface ShopeePanelProps {
  sessionRole: UserRole;
}

interface StatusData {
  uiEnabled: boolean;
  connected: boolean;
  shopId: number | null;
  warehouseId: string | null;
  codEnabled: boolean;
}

/**
 * Mục Shopee trong Cài Đặt — ẨN khi cờ server SHOPEE_UI_ENABLED tắt.
 * - Chủ: kết nối, kho xuất, cờ COD.
 * - Chủ/Quản lý: gán phạm vi kho cho nhân viên Shopee (multi-select,
 *   hiệu lực ngay — server đọc DB mỗi request).
 * Vận hành hàng ngày (đơn cần gói, giao/in, đơn lỗi) ở tab Shopee riêng.
 */
export function ShopeePanel({ sessionRole }: ShopeePanelProps) {
  const isOwner = sessionRole === 'ROLE_OWNER';
  const canAssignScope = isOwner || sessionRole === 'ROLE_MANAGER';
  const [status, setStatus] = useState<StatusData | null>(null);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [opsWarehouseIds, setOpsWarehouseIds] = useState<string[]>([]);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = async () => {
    try {
      const st = await fetch('/api/shopee/status').then((r) => r.json());
      if (st?.success) setStatus(st.data);
      if (!st?.data?.uiEnabled) return;
      if (canAssignScope) {
        const wh = await fetch('/api/warehouses?all=true').then((r) => r.json());
        if (wh?.success && Array.isArray(wh.data)) setWarehouses(wh.data);
        const cfg = await fetch('/api/shopee/config').then((r) => r.json());
        if (cfg?.success && Array.isArray(cfg.data?.opsWarehouseIds)) {
          setOpsWarehouseIds(cfg.data.opsWarehouseIds.map((id: any) => String(id)));
        }
      }
    } catch {
      /* panel ẩn im lặng khi chưa bật cờ */
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status?.uiEnabled) return null;

  const connectShop = async () => {
    try {
      const r = await fetch('/api/shopee/auth-url').then((x) => x.json());
      if (r?.success && r.data?.url) window.location.href = r.data.url;
      else showToast(r?.error || 'Chưa cấu hình key Shopee.');
    } catch {
      showToast('Không lấy được link ủy quyền.');
    }
  };

  const saveConfig = async (patch: { warehouseId?: string; codEnabled?: boolean }) => {
    try {
      const r = await fetch('/api/shopee/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((x) => x.json());
      if (r?.success) {
        setStatus((s) => (s ? { ...s, ...r.data } : s));
        showToast('Đã lưu cấu hình Shopee.');
      } else showToast(r?.error || 'Lưu thất bại.');
    } catch {
      showToast('Lưu thất bại.');
    }
  };

  const saveScope = async (ids: string[]) => {
    setScopeSaving(true);
    try {
      const r = await fetch('/api/shopee/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opsWarehouseIds: ids }),
      }).then((x) => x.json());
      if (r?.success) {
        setOpsWarehouseIds(r.data?.opsWarehouseIds || ids);
        showToast('Đã cấp kho cho nhân viên Shopee.');
      } else showToast(r?.error || 'Lưu thất bại.');
    } catch {
      showToast('Lưu thất bại.');
    } finally {
      setScopeSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
          {toast}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Vận hành đơn Shopee (gói, giao, in vận đơn, đơn lỗi) làm ở tab Shopee.
      </p>

      {isOwner && (
        <section aria-label="Kết nối gian hàng Shopee" className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3">
          <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-orange-600" />
            Kết Nối Gian Hàng Shopee
          </h3>
          <div className="flex items-center gap-2 text-xs">
            {status.connected ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                <CheckCircle2 className="w-4 h-4" /> Đã nối shop {status.shopId}
              </span>
            ) : (
              <>
                <span className="text-slate-500 font-bold">Chưa nối gian hàng.</span>
                <button
                  type="button"
                  onClick={connectShop}
                  className="px-3 py-2 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[44px]"
                >
                  Ủy Quyền Ngay
                </button>
              </>
            )}
          </div>
          <label className="block text-xs font-bold text-slate-600">
            Kho xuất hàng Shopee
            <select
              value={status.warehouseId || ''}
              onChange={(e) => saveConfig({ warehouseId: e.target.value })}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[44px]"
            >
              <option value="">— Chọn kho —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 min-h-[44px]">
            <input
              type="checkbox"
              checked={status.codEnabled}
              onChange={(e) => saveConfig({ codEnabled: e.target.checked })}
              className="w-5 h-5"
            />
            Cho phép đơn COD (mặc định tắt)
          </label>
        </section>
      )}

      {canAssignScope && (
        <section aria-label="Phạm vi kho nhân viên Shopee" className="p-4 bg-white border border-slate-200 rounded-2xl space-y-2">
          <h3 className="text-sm font-extrabold text-slate-800">
            Kho nhân viên Shopee được thấy
          </h3>
          <p className="text-[11px] text-slate-500">
            Chọn nhiều kho (giữ Ctrl/Cmd khi bấm). Nhân viên Shopee chỉ thấy đơn
            trong các kho được cấp — hiệu lực ngay.
          </p>
          <select
            multiple
            value={opsWarehouseIds}
            disabled={scopeSaving}
            onChange={(e) => {
              const ids = Array.from(e.target.selectedOptions).map((o) => o.value);
              setOpsWarehouseIds(ids);
              saveScope(ids);
            }}
            aria-label="Chọn phạm vi kho cho nhân viên Shopee"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs min-h-[88px]"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </section>
      )}
    </div>
  );
}
