'use client';

import React, { useEffect, useState } from 'react';
import { Truck, Printer, Package, RefreshCw, Search, Zap, ChevronDown, X } from 'lucide-react';

/**
 * Quản lý đơn hàng Shopee kiểu Seller Center (bản lite cho thủ kho).
 * Tập trung: tab Chờ lấy hàng, ưu tiên đơn hỏa tốc, Mass Ship / Arrange Shipment.
 */

interface OrderItem {
  name: string;
  quantity: number;
}

interface ShopeeOrder {
  id: string;
  orderCode: string;
  orderSn: string;
  customerName: string;
  finalAmount: number;
  status: string;
  shippingStatus: string;
  carrier: string | null;
  trackingCode: string | null;
  createdAt: string;
  items: OrderItem[];
  isInstant?: boolean;
  pickupAddress?: string;
  shipperName?: string;
  shipperPhone?: string;
}

const TABS: Array<{ key: string; label: string; highlight?: boolean; apiTab: string; countKey: string }> = [
  { key: 'all', label: 'Tất cả', apiTab: 'all', countKey: 'all' },
  { key: 'to_ship', label: 'Chờ lấy hàng', highlight: true, apiTab: 'moi', countKey: 'moi' },
  { key: 'shipping', label: 'Đang giao', apiTab: 'dang_giao', countKey: 'dang_giao' },
  { key: 'completed', label: 'Đã giao', apiTab: 'hoan_thanh', countKey: 'hoan_thanh' },
  { key: 'cancelled', label: 'Đã hủy', apiTab: 'huy_hoan_tra', countKey: 'huy_hoan_tra' },
];

export function ShopeeOrdersSellerCenter() {
  const [activeTab, setActiveTab] = useState<string>('to_ship');
  const [orders, setOrders] = useState<ShopeeOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailOrder, setDetailOrder] = useState<ShopeeOrder | null>(null);
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Trạng thái con trong tab Chờ lấy hàng: cho_xac_nhan (Chưa xử lý) / da_xu_ly (Đã xử lý)
  const [subTab, setSubTab] = useState<string>('all');

  const loadOrders = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const currentTab = TABS.find(t => t.key === activeTab);
      let apiTab = currentTab?.apiTab || 'all';
      // Trong tab Chờ lấy hàng, dùng trạng thái con nếu đã chọn
      if (activeTab === 'to_ship' && (subTab === 'cho_xac_nhan' || subTab === 'da_xu_ly')) {
        apiTab = subTab;
      }
      const res = await fetch(`/api/shopee/orders?tab=${apiTab}&channel=SHOPEE&q=${encodeURIComponent(search)}`);
      const data = await res.json();
      if (data?.success) {
        // API trả về { orders: [...], counts: {...} } - đã sắp xếp theo createdAt mới nhất trước
        const orderList = data.data?.orders || [];
        setOrders(orderList);
        setCounts(data.data?.counts || {});
        setLastUpdated(new Date());
      }
    } catch {}
    if (!silent) setLoading(false);
  };

  useEffect(() => { loadOrders(); }, [activeTab, subTab]);

  // Tự động làm mới mỗi 30 giây khi bật auto-refresh và tab đang hiển thị
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      // Chỉ refresh khi tab trình duyệt đang active để đỡ tốn tài nguyên
      if (!document.hidden) {
        loadOrders(true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab, subTab, search]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === orders.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(orders.map(o => o.id)));
  };

  const [shipping, setShipping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shipDialog, setShipDialog] = useState<{ orderSn: string } | null>(null);
  const [shipMode, setShipMode] = useState<'pickup' | 'dropoff'>('pickup');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const handleMassShip = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Xác nhận giao ${selectedIds.size} đơn đã chọn cho đơn vị vận chuyển?`)) return;
    setShipping(true);
    const selectedOrders = orders.filter(o => selectedIds.has(o.id));
    let success = 0;
    let failed = 0;
    for (const o of selectedOrders) {
      try {
        const res = await fetch('/api/shopee/ship', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderSn: o.orderSn }),
        });
        const data = await res.json();
        if (data?.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setShipping(false);
    setSelectedIds(new Set());
    showToast(`Đã giao: ${success} thành công, ${failed} thất bại`);
    loadOrders();
  };

  const handleArrangeShipment = (orderSn: string) => {
    setShipDialog({ orderSn });
    setShipMode('pickup');
  };

  const confirmArrangeShipment = async () => {
    if (!shipDialog) return;
    const orderSn = shipDialog.orderSn;
    setShipDialog(null);
    try {
      const res = await fetch('/api/shopee/ship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderSn, mode: shipMode }),
      });
      const data = await res.json();
      if (data?.success) {
        showToast(`Đã chuẩn bị đơn ${orderSn}, Shopee đang điều phối shipper`);
        loadOrders();
      } else {
        showToast(`Lỗi: ${data?.error || 'Không rõ'}`);
      }
    } catch (e: any) {
      showToast(`Lỗi: ${e.message}`);
    }
  };

  const handlePrintAwb = async () => {
    if (selectedIds.size === 0) return;
    // Mở tab mới in phiếu hàng loạt
    const ids = Array.from(selectedIds).join(',');
    window.open(`/api/shopee/awb/bulk?ids=${ids}`, '_blank');
  };

  const fmtMoney = (n: number) => n.toLocaleString('vi-VN') + 'đ';
  const fmtTime = (s: string) => new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg z-50 max-w-sm">
          {toast}
        </div>
      )}
      {/* Tabs kiểu Seller Center */}
      <div className="flex gap-2 border-b overflow-x-auto">
        {TABS.map(t => {
          const c = counts[t.countKey];
          return (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setSubTab('all'); }}
            className={`px-4 py-2 whitespace-nowrap font-medium ${
              activeTab === t.key
                ? 'text-orange-600 border-b-2 border-orange-600'
                : 'text-gray-600 hover:text-gray-900'
            } ${'highlight' in t && t.highlight ? 'bg-orange-50' : ''}`}
          >
            {t.label}{typeof c === 'number' ? ` (${c})` : ''}
            {'highlight' in t && t.highlight && <span className="ml-1 text-orange-600">★</span>}
          </button>
          );
        })}
      </div>

      {/* Trạng thái con trong tab Chờ lấy hàng: Chờ xác nhận / Đã xử lý */}
      {activeTab === 'to_ship' && (
        <div className="flex gap-2 items-center py-2">
          <span className="text-sm text-gray-600">Trạng thái đơn hàng:</span>
          {[
            { key: 'all', label: 'Tất cả', countKey: 'moi' },
            { key: 'cho_xac_nhan', label: 'Chờ xác nhận', countKey: 'cho_xac_nhan' },
            { key: 'da_xu_ly', label: 'Đã xử lý', countKey: 'da_xu_ly' },
          ].map(s => {
            const c = counts[s.countKey];
            return (
            <button
              key={s.key}
              onClick={() => setSubTab(s.key)}
              className={`px-3 py-1 text-sm rounded-full border ${
                subTab === s.key
                  ? 'text-orange-600 border-orange-600 bg-orange-50'
                  : 'text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
            >
              {s.label}{typeof c === 'number' ? ` (${c})` : ''}
            </button>
            );
          })}
        </div>
      )}

      {/* Thanh công cụ: tìm kiếm + nút hành động */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadOrders()}
            placeholder="Tìm mã đơn, tên khách..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <button onClick={() => loadOrders()} className="px-4 py-2 border rounded-lg flex items-center gap-2 hover:bg-gray-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
        <label className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-gray-50 text-sm">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="w-4 h-4"
          />
          Tự động cập nhật
        </label>
        {lastUpdated && (
          <span className="text-xs text-gray-500">
            Cập nhật: {lastUpdated.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
          </span>
        )}
        {activeTab === 'to_ship' && (
          <>
            <button
              onClick={handleMassShip}
              disabled={selectedIds.size === 0 || shipping}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg flex items-center gap-2 hover:bg-orange-700 disabled:opacity-50"
            >
              <Truck className="w-4 h-4" />
              {shipping ? 'Đang tìm shipper...' : `Tìm shipper (${selectedIds.size})`}
            </button>
            <button
              onClick={handlePrintAwb}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 border border-orange-600 text-orange-600 rounded-lg flex items-center gap-2 hover:bg-orange-50 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              In phiếu hàng loạt ({selectedIds.size})
            </button>
          </>
        )}
      </div>

      {/* Danh sách đơn */}
      <div className="space-y-3">
        {orders.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-500">Không có đơn hàng</div>
        )}
        {orders.map(o => (
          <div
            key={o.id}
            className={`border rounded-lg p-4 bg-white ${o.isInstant ? 'border-orange-400 ring-1 ring-orange-200' : ''}`}
          >
            <div className="flex items-start gap-3">
              {activeTab === 'to_ship' && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(o.id)}
                  onChange={() => toggleSelect(o.id)}
                  className="mt-1 w-4 h-4"
                />
              )}
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {o.isInstant && (
                    <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded flex items-center gap-1">
                      <Zap className="w-3 h-3" /> HỎA TỐC
                    </span>
                  )}
                  <span className="font-mono font-medium">{o.orderSn}</span>
                  <span className="text-gray-500 text-sm">{o.orderCode}</span>
                  <span className="ml-auto font-bold text-orange-600">{fmtMoney(o.finalAmount)}</span>
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  <div>Khách: {o.customerName}</div>
                  <div className="mt-1">
                    {o.items.map((it, i) => (
                      <span key={i} className="mr-3">{it.name} x{it.quantity}</span>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    <span>ĐVVC: {o.carrier || '-'}</span>
                    {o.trackingCode && <span>Mã vận đơn: <span className="font-mono">{o.trackingCode}</span></span>}
                    <span>{fmtTime(o.createdAt)}</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setDetailOrder(o)}
                    className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                  >
                    Chi tiết
                  </button>
                  {activeTab === 'to_ship' && (
                    <button
                      onClick={() => handleArrangeShipment(o.orderSn)}
                      className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700"
                    >
                      Chuẩn bị đơn hàng
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal chi tiết đơn */}
      {detailOrder && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4"
          onClick={() => setDetailOrder(null)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Chi tiết đơn hàng</h3>
                <button onClick={() => setDetailOrder(null)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="font-medium text-gray-500 text-sm">Mã đơn Shopee</div>
                  <div className="font-mono">{detailOrder.orderSn}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-500 text-sm">Mã ERP</div>
                  <div className="font-mono">{detailOrder.orderCode}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-500 text-sm">Khách hàng</div>
                  <div>{detailOrder.customerName}</div>
                </div>
                <div>
                  <div className="font-medium text-gray-500 text-sm">Sản phẩm</div>
                  {detailOrder.items.map((it, i) => (
                    <div key={i} className="flex justify-between py-1 border-b">
                      <span>{it.name}</span>
                      <span>x{it.quantity}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4">
                  <div className="font-bold mb-2 flex items-center gap-2">
                    <Truck className="w-4 h-4" /> Thông tin vận chuyển
                    {!detailOrder.trackingCode && (
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/shopee/sync-tracking', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ orderSn: detailOrder.orderSn }),
                            });
                            const data = await res.json();
                            if (data?.success) {
                              showToast('Đã lấy mã vận đơn');
                              setDetailOrder({ ...detailOrder, trackingCode: data.data.trackingCode });
                              loadOrders(true);
                            } else {
                              showToast(`Lỗi: ${data?.error || 'Không rõ'}`);
                            }
                          } catch (e: any) {
                            showToast(`Lỗi: ${e.message}`);
                          }
                        }}
                        className="ml-2 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Lấy mã vận đơn
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500">Đơn vị vận chuyển</div>
                      <div className="font-medium">{detailOrder.carrier || '-'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Mã vận đơn</div>
                      <div className="font-mono">{detailOrder.trackingCode || '-'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Địa chỉ lấy hàng</div>
                      <div>{detailOrder.pickupAddress || '-'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Shipper</div>
                      <div>{detailOrder.shipperName || '-'}</div>
                      {detailOrder.shipperPhone && <div className="text-sm">{detailOrder.shipperPhone}</div>}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <button
                    onClick={() => setDetailOrder(null)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dialog Chuẩn bị đơn hàng: chọn Pickup hoặc Drop-off */}
      {shipDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold mb-4">Chuẩn bị đơn hàng {shipDialog.orderSn}</h3>
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="shipMode"
                  checked={shipMode === 'pickup'}
                  onChange={() => setShipMode('pickup')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Shipper đến lấy hàng</div>
                  <div className="text-sm text-gray-600">Shopee sẽ điều phối shipper đến địa chỉ kho để lấy kiện hàng.</div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="shipMode"
                  checked={shipMode === 'dropoff'}
                  onChange={() => setShipMode('dropoff')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Tự mang ra bưu cục</div>
                  <div className="text-sm text-gray-600">Bạn tự mang kiện hàng ra điểm gửi của đơn vị vận chuyển.</div>
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShipDialog(null)}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                onClick={confirmArrangeShipment}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
