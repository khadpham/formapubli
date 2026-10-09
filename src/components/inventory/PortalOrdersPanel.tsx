'use client';

import { useEffect, useState } from 'react';

interface PickingItem {
  editionId: string;
  quantity: number;
  isGift: boolean;
}

interface PickingOrder {
  id: string;
  orderCode: string;
  customerName: string;
  phone: string;
  address: string;
  paymentMethod: string;
  shippingStatus: string;
  trackingCode: string | null;
  createdAt: string;
  finalAmount?: number;
  note?: string;
  items: PickingItem[];
}

const STATUS_LABELS: Record<string, string> = {
  NONE: 'Mới nhận',
  CREATED: 'Đã đóng gói',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đã gửi hàng',
  DELIVERED: 'Đã giao',
};

const STATUS_COLORS: Record<string, string> = {
  NONE: 'bg-slate-100 text-slate-700 border-slate-300',
  CREATED: 'bg-blue-50 text-blue-700 border-blue-300',
  PICKED_UP: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  IN_TRANSIT: 'bg-amber-50 text-amber-700 border-amber-300',
  DELIVERED: 'bg-green-50 text-green-700 border-green-300',
};

const NEXT_STATUS: Record<string, string | null> = {
  NONE: 'CREATED',
  CREATED: 'IN_TRANSIT',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'DELIVERED',
  DELIVERED: null,
};

const NEXT_LABEL: Record<string, string> = {
  NONE: 'Xác nhận đóng gói',
  CREATED: 'Xác nhận đã gửi',
  PICKED_UP: 'Xác nhận đã gửi',
  IN_TRANSIT: 'Xác nhận đã giao',
};

export function PortalOrdersPanel() {
  const [orders, setOrders] = useState<PickingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PickingOrder | null>(null);
  const [trackingInput, setTrackingInput] = useState('');

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/portal-orders/picking');
      const data = await res.json();
      if (data.success) setOrders(data.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const updateStatus = async (orderId: string, newStatus: string) => {
    const body: any = { shippingStatus: newStatus };
    if (newStatus === 'IN_TRANSIT' && trackingInput.trim()) {
      body.trackingCode = trackingInput.trim();
    }
    const res = await fetch(`/api/portal-orders/${orderId}/shipping`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      setTrackingInput('');
      setSelected(null);
      fetchOrders();
    } else {
      alert('Lỗi: ' + (data.error || 'Không cập nhật được'));
    }
  };

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.orderCode.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.phone.includes(q) ||
      (o.note || '').toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="p-4 text-slate-500">Đang tải đơn hàng...</div>;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Đơn Online Cần Soạn</h3>
          <p className="text-xs text-slate-500">
            {filtered.length} đơn chờ xử lý — bấm vào đơn để xem chi tiết và cập nhật trạng thái
          </p>
        </div>
        <input
          type="text"
          placeholder="Tìm theo mã đơn, tên, SĐT, ghi chú..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-4 py-2 border border-slate-300 rounded-xl text-sm w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-slate-400">Không có đơn nào chờ xử lý 🎉</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                <th className="pb-2 pr-4">Mã đơn</th>
                <th className="pb-2 pr-4">Khách hàng</th>
                <th className="pb-2 pr-4">Sản phẩm</th>
                <th className="pb-2 pr-4">Ghi chú</th>
                <th className="pb-2 pr-4">Trạng thái</th>
                <th className="pb-2">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setSelected(o)}
                >
                  <td className="py-3 pr-4 font-mono font-bold text-slate-900">{o.orderCode}</td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{o.customerName}</div>
                    <div className="text-xs text-slate-500">{o.phone}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-xs">
                      {o.items.map((it, i) => (
                        <div key={i}>
                          {it.editionId} × {it.quantity}
                          {it.isGift && ' 🎁'}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 pr-4 max-w-xs">
                    <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 truncate" title={o.note}>
                      {o.note || <span className="text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block px-2 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[o.shippingStatus] || STATUS_COLORS.NONE}`}
                    >
                      {STATUS_LABELS[o.shippingStatus] || o.shippingStatus}
                    </span>
                  </td>
                  <td className="py-3">
                    <button
                      className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(o);
                      }}
                    >
                      Chi tiết →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal chi tiết */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-extrabold">{selected.orderCode}</h3>
                <p className="text-sm text-slate-500">
                  {new Date(selected.createdAt).toLocaleString('vi-VN')} •{' '}
                  {selected.paymentMethod === 'COD' ? 'Thu hộ COD' : 'Chuyển khoản'}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div>
                <div className="text-xs text-slate-500 uppercase mb-1">Người nhận</div>
                <div className="font-medium">{selected.customerName}</div>
                <div className="text-slate-600">{selected.phone}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase mb-1">Địa chỉ giao</div>
                <div className="text-slate-700">{selected.address}</div>
              </div>
            </div>

            {selected.note && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="text-xs font-bold text-amber-800 uppercase mb-1">⚠️ Ghi chú của khách</div>
                <div className="text-sm text-amber-900 whitespace-pre-wrap">{selected.note}</div>
              </div>
            )}

            <div className="mb-4">
              <div className="text-xs text-slate-500 uppercase mb-2">Sản phẩm cần đóng ({selected.items.length} loại)</div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                {selected.items.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-2 border-b border-slate-100 last:border-0"
                  >
                    <span className="font-medium">
                      {it.editionId}
                      {it.isGift && <span className="ml-2 text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">🎁 Quà tặng</span>}
                    </span>
                    <span className="font-bold text-lg">× {it.quantity}</span>
                  </div>
                ))}
              </div>
            </div>

            {NEXT_STATUS[selected.shippingStatus] && (
              <div className="border-t border-slate-200 pt-4">
                {(selected.shippingStatus === 'CREATED' || selected.shippingStatus === 'NONE') && (
                  <div className="mb-3">
                    <label className="text-xs text-slate-500 uppercase block mb-1">
                      Mã vận đơn (khi gửi hàng)
                    </label>
                    <input
                      type="text"
                      value={trackingInput}
                      onChange={(e) => setTrackingInput(e.target.value)}
                      placeholder="Nhập mã tracking SPX..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                    />
                  </div>
                )}
                <button
                  onClick={() => updateStatus(selected.id, NEXT_STATUS[selected.shippingStatus]!)}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition"
                >
                  {NEXT_LABEL[selected.shippingStatus]}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
