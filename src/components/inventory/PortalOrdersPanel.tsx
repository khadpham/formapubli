'use client';

import { useEffect, useState } from 'react';

interface PickingItem {
  editionId: string;
  code: string;
  name: string;
  quantity: number;
  isGift: boolean;
}

interface PickingOrder {
  id: string;
  orderCode: string;
  portalRef: string | null;
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
  NONE: 'Đóng gói',
  CREATED: 'Gửi hàng',
  PICKED_UP: 'Gửi hàng',
  IN_TRANSIT: 'Đã giao',
};

/** Mã hiển thị: ưu tiên mã portal (khách tra theo mã này), mã nội bộ nhỏ phụ. */
function displayCode(o: PickingOrder): { main: string; sub: string } {
  if (o.portalRef) return { main: o.portalRef, sub: o.orderCode };
  return { main: o.orderCode, sub: '' };
}

export function PortalOrdersPanel() {
  const [orders, setOrders] = useState<PickingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PickingOrder | null>(null);
  const [trackingInput, setTrackingInput] = useState('');
  /** Đang hỏi mã vận đơn cho đơn nào (chỉ hiện khi bấm Gửi hàng). */
  const [trackingFor, setTrackingFor] = useState<string | null>(null);
  const [trackingValue, setTrackingValue] = useState('');
  /** Toast thông báo trong nền tảng (thay alert). */
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null);
  /** Dialog xác nhận trong nền tảng (thay window.confirm). */
  const [confirmDlg, setConfirmDlg] = useState<{ msg: string; onOk: () => void } | null>(null);

  const showToast = (msg: string, type: 'error' | 'success' = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchOrders = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/portal-orders/picking', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setOrders(data.data);
        setUpdatedAt(new Date());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Real-time: poll 5s, CHỈ khi tab đang mở (chống 1102 — không poll nền).
  useEffect(() => {
    fetchOrders();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') fetchOrders();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Duyệt đơn portal: trừ kho thực tế (giữ đơn ở PENDING để tiếp tục giao hàng). */
  const approveOrder = async (orderId: string, orderCode: string) => {
    setConfirmDlg({
      msg: `Duyệt đơn ${orderCode}? Hệ thống sẽ trừ kho thực tế.`,
      onOk: async () => {
        setConfirmDlg(null);
        const res = await fetch(`/api/portal-orders/${orderId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (data.success) {
          fetchOrders();
          showToast(
            data.data?.alreadyApproved ? 'Đơn đã được duyệt trước đó.' : 'Đã duyệt đơn, trừ kho thành công.',
            'success'
          );
        } else {
          showToast('Lỗi: ' + (data.error || 'Không duyệt được đơn'));
        }
      },
    });
  };

  const updateStatus = async (orderId: string, newStatus: string, trackingCode?: string) => {
    const body: any = { shippingStatus: newStatus };
    if (newStatus === 'IN_TRANSIT' && trackingCode?.trim()) {
      body.trackingCode = trackingCode.trim();
    }
    const res = await fetch(`/api/portal-orders/${orderId}/shipping`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      setTrackingInput('');
      setTrackingFor(null);
      setTrackingValue('');
      setSelected(null);
      fetchOrders();
      showToast('Đã cập nhật trạng thái đơn.', 'success');
    } else {
      showToast('Lỗi: ' + (data.error || 'Không cập nhật được'));
    }
  };

  /** Nút nhanh ngoài bảng: Đóng gói / Đã giao bấm là xong. Gửi hàng hỏi mã. */
  const quickAction = (o: PickingOrder) => {
    const next = NEXT_STATUS[o.shippingStatus];
    if (!next) return;
    if (next === 'IN_TRANSIT') {
      setTrackingFor(o.id);
      setTrackingValue(o.trackingCode || '');
      return;
    }
    setConfirmDlg({
      msg: `${NEXT_LABEL[o.shippingStatus]} đơn ${displayCode(o).main}?`,
      onOk: () => {
        setConfirmDlg(null);
        updateStatus(o.id, next);
      },
    });
  };

  const confirmTracking = (o: PickingOrder) => {
    if (!trackingValue.trim()) {
      showToast('Cần nhập mã vận đơn khi gửi hàng.');
      return;
    }
    updateStatus(o.id, 'IN_TRANSIT', trackingValue);
  };

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.orderCode.toLowerCase().includes(q) ||
      (o.portalRef || '').toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.phone.includes(q) ||
      (o.note || '').toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="p-4 text-slate-500">Đang tải đơn hàng...</div>;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 relative">
      {/* Toast thông báo */}
      {toast && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
      {/* Dialog xác nhận */}
      {confirmDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmDlg(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-slate-900 font-medium mb-4">{confirmDlg.msg}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDlg(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={confirmDlg.onOk}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">Đơn Online Cần Soạn</h3>
          <p className="text-xs text-slate-500">
            {filtered.length} đơn chờ xử lý — tự cập nhật mỗi 5s, không cần bấm
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {updatedAt && (
            <span className="text-[11px] text-slate-400 whitespace-nowrap">
              Cập nhật {updatedAt.toLocaleTimeString('vi-VN')}
            </span>
          )}
          <button
            type="button"
            onClick={fetchOrders}
            disabled={refreshing}
            aria-label="Làm mới danh sách đơn online"
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 active:scale-[0.99] transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {refreshing ? 'Đang tải…' : '↻ Làm mới'}
          </button>
          <input
            type="text"
            placeholder="Tìm mã portal, mã đơn, tên, SĐT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-4 py-2 border border-slate-300 rounded-xl text-sm w-80 max-w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
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
                <th className="pb-2">Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const code = displayCode(o);
                const next = NEXT_STATUS[o.shippingStatus];
                const isTrackingFor = trackingFor === o.id;
                return (
                  <tr
                    key={o.id}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setSelected(o)}
                  >
                    <td className="py-3 pr-4">
                      <div className="font-mono font-bold text-slate-900">{code.main}</div>
                      {code.sub && <div className="font-mono text-[11px] text-slate-400">{code.sub}</div>}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium">{o.customerName}</div>
                      <div className="text-xs text-slate-500">{o.phone}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="text-xs space-y-0.5">
                        {o.items.map((it, i) => (
                          <div key={i}>
                            <span className="font-bold text-slate-900">{it.name || it.editionId}</span>
                            {it.isGift && ' 🎁'}
                            <span className="text-slate-400 font-mono"> · {it.code || it.editionId} × {it.quantity}</span>
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
                    <td className="py-3" onClick={(e) => e.stopPropagation()}>
                      {isTrackingFor ? (
                        <div className="flex items-center gap-1 min-w-[11rem]">
                          <input
                            type="text"
                            value={trackingValue}
                            onChange={(e) => setTrackingValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && confirmTracking(o)}
                            placeholder="Mã vận đơn"
                            aria-label="Mã vận đơn"
                            autoFocus
                            className="w-24 px-2 py-1.5 border border-indigo-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={() => confirmTracking(o)}
                            className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                          >
                            Gửi
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrackingFor(null)}
                            className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold cursor-pointer"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <>
                          {o.shippingStatus === 'NONE' && (
                            <button
                              type="button"
                              onClick={() => approveOrder(o.id, displayCode(o).main)}
                              title="Duyệt đơn: trừ kho thực tế (giữ đơn để tiếp tục giao hàng)"
                              className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap bg-amber-500 hover:bg-amber-600 text-white mr-1"
                            >
                              Duyệt đơn
                            </button>
                          )}
                          {next ? (
                            <button
                              type="button"
                              onClick={() => quickAction(o)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${
                            next === 'IN_TRANSIT'
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              : next === 'DELIVERED'
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                            >
                              {NEXT_LABEL[o.shippingStatus]} →
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Xong</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
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
                <h3 className="text-xl font-extrabold">
                  {displayCode(selected).main}
                  {displayCode(selected).sub && (
                    <span className="ml-2 text-sm font-mono font-normal text-slate-400">
                      {displayCode(selected).sub}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-slate-500">
                  {new Date(selected.createdAt).toLocaleString('vi-VN')} •{' '}
                  {selected.paymentMethod === 'COD' ? 'Thu hộ COD' : 'Chuyển khoản'}
                  {selected.trackingCode && ` • Vận đơn: ${selected.trackingCode}`}
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
                    className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-100 last:border-0"
                  >
                    <span className="font-medium min-w-0">
                      <span className="block truncate">{it.name || it.editionId}</span>
                      <span className="block text-[11px] font-mono text-slate-400">{it.code || it.editionId}</span>
                      {it.isGift && <span className="mt-0.5 inline-block text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">🎁 Quà tặng</span>}
                    </span>
                    <span className="font-bold text-lg shrink-0">× {it.quantity}</span>
                  </div>
                ))}
              </div>
            </div>

            {NEXT_STATUS[selected.shippingStatus] && (
              <div className="border-t border-slate-200 pt-4">
                {NEXT_STATUS[selected.shippingStatus] === 'IN_TRANSIT' && (
                  <div className="mb-3">
                    <label className="text-xs text-slate-500 uppercase block mb-1">Mã vận đơn (khi gửi hàng)</label>
                    <input
                      type="text"
                      value={trackingInput}
                      onChange={(e) => setTrackingInput(e.target.value)}
                      placeholder="Nhập mã vận đơn..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm"
                    />
                  </div>
                )}
                <button
                  onClick={() => updateStatus(selected.id, NEXT_STATUS[selected.shippingStatus]!, trackingInput)}
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
