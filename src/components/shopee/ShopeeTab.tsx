'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Store } from 'lucide-react';
import type { UserRole } from '@/lib/roles';
import { PortalOrdersPanel } from './PortalOrdersPanel';
import { ShopeeOrdersHub } from './ShopeeOrdersHub';
import { ShopeeOverviewPanel } from './ShopeeOverviewPanel';
import { ShopeeProductsPanel } from './ShopeeProductsPanel';
import { ShopeeReturnsPanel } from './ShopeeReturnsPanel';
import { ShopeeMarketingPanel } from './ShopeeMarketingPanel';

interface ConfirmOrder {
  id: string;
  orderSn: string;
  customerName: string;
  finalAmount: number;
  trackingCode: string | null;
}

interface QuarantineItem {
  id: string;
  orderSn: string;
  sku: string;
  reason: string;
}

/**
 * Hub Đơn online - quản lý tập trung đơn portal + Shopee (TÁCH RIÊNG theo kênh).
 * Quyết định 2026-10-21 (chủ hệ thống): đơn hàng tách riêng kênh nào ra kênh nấy
 * do khối lượng tác vụ Shopee lớn, luồng thao tác riêng.
 * 7 mục con: Tổng quan | Đơn Shopee | Đơn Portal | Trả hàng | Sản phẩm kênh | Marketing | Hóa đơn.
 * GĐ4: đã xóa mục Tài chính khỏi hub - dữ liệu escrow/phí/lãi chuyển sang tab Chủ (OwnerShopeePnl).
 */
interface ShopeeStatus {
  connected: boolean;
  shopId: number | null;
  warehouseId: string | null;
  codEnabled: boolean;
}

const HUB_TABS = [
  { key: 'tong_quan', label: 'Tổng quan' },
  { key: 'don_shopee', label: 'Đơn Shopee' },
  { key: 'don_portal', label: 'Đơn Portal' },
  { key: 'tra_hang', label: 'Trả hàng' },
  { key: 'san_pham', label: 'Sản phẩm kênh' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'hoa_don', label: 'Hóa đơn' },
] as const;

export function ShopeeTab({ sessionRole }: { sessionRole: UserRole }) {
  const [status, setStatus] = useState<ShopeeStatus | null>(null);
  const [uiEnabled, setUiEnabled] = useState(false);
  const [hubTab, setHubTab] = useState<string>('tong_quan');
  const [toConfirm, setToConfirm] = useState<ConfirmOrder[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadAll = async () => {
    try {
      const st = await fetch('/api/shopee/status').then((r) => r.json());
      if (st?.success) {
        setUiEnabled(!!st.data?.uiEnabled);
        setStatus({
          connected: !!st.data?.connected,
          shopId: st.data?.shopId ?? null,
          warehouseId: st.data?.warehouseId ?? null,
          codEnabled: !!st.data?.codEnabled,
        });
      }
      if (!st?.data?.uiEnabled) return;
      const q = await fetch('/api/shopee/queue').then((r) => r.json());
      if (q?.success) {
        setToConfirm(q.data.toConfirm || []);
        setQuarantine(q.data.quarantine || []);
      }
    } catch {
      /* cờ tắt: tab hiện thông báo chờ, không thao tác */
    }
  };

  useEffect(() => {
    loadAll();
    // Sau ủy quyền Shopee, callback redirect về /?shopee=ok - đón cờ để báo
    // thành công rồi xóa khỏi URL cho sạch (tránh F5 hiện lại).
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('shopee') === 'ok') {
        showToast('Đã kết nối gian hàng Shopee thành công.');
        sp.delete('shopee');
        const qs = sp.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
        loadAll();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectShop = async () => {
    try {
      const r = await fetch('/api/shopee/auth-url').then((x) => x.json());
      if (r?.success && r.data?.url) window.location.href = r.data.url;
      else showToast(r?.error || 'Chưa cấu hình key Shopee.');
    } catch {
      showToast('Không lấy được link ủy quyền.');
    }
  };

  const confirmDelivery = async (o: ConfirmOrder) => {
    setConfirmingId(o.id);
    try {
      const r = await fetch(`/api/orders/${o.id}/confirm-delivery`, { method: 'POST' }).then((x) => x.json());
      if (r?.ok) {
        showToast(`Đã xác nhận khách nhận hàng - đơn ${o.orderSn}. Hóa đơn giờ đã phát hành được.`);
        loadAll();
      } else showToast(r?.error || 'Xác nhận thất bại.');
    } catch {
      showToast('Xác nhận thất bại.');
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold">
          {toast}
        </div>
      )}

      {!uiEnabled ? (
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm text-xs text-slate-500">
          Tính năng đồng bộ sàn Shopee đang tắt (chờ quản lý bật).
        </div>
      ) : (
        <>
          <section aria-label="Kết nối Shopee" className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Store className="w-5 h-5 text-orange-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-slate-800">
                  {status?.connected ? `Đã kết nối shop Shopee #${status.shopId}` : 'Chưa kết nối shop Shopee'}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  Kho xuất: {status?.warehouseId || 'chưa cấu hình'} · COD: {status?.codEnabled ? 'bật' : 'tắt'}
                </p>
              </div>
            </div>
            {!status?.connected && sessionRole === 'ROLE_OWNER' && (
              <button
                type="button"
                onClick={connectShop}
                aria-label="Kết nối gian hàng Shopee"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-orange-600 text-orange-700 text-xs font-bold min-h-[44px] shrink-0"
              >
                <Store className="w-4 h-4" />
                Kết nối gian hàng
              </button>
            )}
          </section>
          {/* Điều hướng 8 mục con của hub Đơn online */}
          <nav aria-label="Mục hub đơn online" className="flex gap-1.5 flex-wrap">
            {HUB_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setHubTab(t.key)}
                aria-current={hubTab === t.key ? 'page' : undefined}
                className={`px-3 py-2 rounded-xl text-xs font-bold min-h-[40px] ${
                  hubTab === t.key
                    ? 'bg-orange-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {hubTab === 'tong_quan' && <ShopeeOverviewPanel onToast={showToast} />}
          {hubTab === 'don_shopee' && <ShopeeOrdersHub onToast={showToast} />}
          {hubTab === 'don_portal' && <PortalOrdersPanel currentRole={sessionRole} />}
          {hubTab === 'tra_hang' && <ShopeeReturnsPanel onToast={showToast} />}
          {hubTab === 'san_pham' && <ShopeeProductsPanel onToast={showToast} sessionRole={sessionRole} />}
          {hubTab === 'marketing' && <ShopeeMarketingPanel onToast={showToast} />}
          {hubTab === 'hoa_don' && (
            <section aria-label="Hóa đơn đơn online" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Hóa đơn đơn online
              </h2>
              <p className="text-xs text-slate-500">
                Đơn online chỉ phát hành hóa đơn sau khi xác nhận khách đã nhận hàng (quyết định D1).
                Xem chi tiết và phát hành tại tab Hóa đơn điện tử.
              </p>
              <a
                href="/?tab=einvoice"
                className="inline-block px-4 py-2.5 rounded-xl bg-orange-600 text-white text-xs font-bold min-h-[44px]"
              >
                Mở tab Hóa đơn điện tử
              </a>
            </section>
          )}

      {toConfirm.length > 0 && (
        <section aria-label="Chờ xác nhận khách nhận hàng" className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            Chờ xác nhận khách nhận hàng ({toConfirm.length})
          </h2>
          <p className="text-[11px] text-slate-500">
            Hóa đơn của các đơn này chỉ phát hành sau khi xác nhận khách đã nhận hàng. Bấm xác nhận khi đơn vị vận chuyển báo đã giao thành công.
          </p>
          {toConfirm.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-slate-800 truncate">#{o.orderSn} - {o.customerName}</p>
                <p className="text-[11px] text-slate-500">
                  {Number(o.finalAmount || 0).toLocaleString('vi-VN')}đ · Vận đơn {o.trackingCode || '-'}
                </p>
              </div>
              <button
                type="button"
                disabled={confirmingId === o.id}
                onClick={() => confirmDelivery(o)}
                aria-label={`Xác nhận khách đã nhận hàng đơn ${o.orderSn}`}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold min-h-[44px] disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {confirmingId === o.id ? 'Đang xác nhận…' : 'Đã nhận hàng'}
              </button>
            </div>
          ))}
        </section>
      )}

      {quarantine.length > 0 && (
        <section aria-label="Đơn Shopee lỗi chờ xử lý" className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
          <h3 className="text-sm font-extrabold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Đơn Lỗi Cần Xử Lý ({quarantine.length})
          </h3>
          {quarantine.map((q) => (
            <p key={q.id} className="text-xs text-amber-800">
              <span className="font-extrabold">#{q.orderSn}</span> - {q.reason}
              {q.sku ? ` (SKU: ${q.sku})` : ''}
            </p>
          ))}
        </section>
      )}
        </>
      )}
    </div>
  );
}