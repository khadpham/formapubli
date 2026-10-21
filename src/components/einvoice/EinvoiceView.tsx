'use client';

import React, { useState, useEffect } from 'react';
import { FileText, Plus, Send, CheckCircle, XCircle, RefreshCw, Eye } from 'lucide-react';

interface Invoice {
  id: string;
  orderId: string | null;
  invoiceKind: string;
  buyerTaxCode: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  status: string;
  invoiceNumber: string | null;
  invoiceSerial: string | null;
  lookupCode: string | null;
  consolidatedDate: string | null;
  sourceOrderIds: string | null;
  createdAt: string;
}

interface PendingOrder {
  id: string;
  orderCode: string;
  customerName: string;
  finalAmount: number;
  invoiceTaxCode: string;
  invoiceCompanyName: string;
  createdAt: string;
}

interface OnlineQueueItem {
  id: string;
  orderCode: string;
  channel: string;
  customerName: string;
  finalAmount: number;
  fiscalScope: string;
  deliveryConfirmedAt: string | null;
  deliveryConfirmedBy: string | null;
  einvoiceId: string | null;
  einvoiceStatus: string | null;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PREPARED: { label: 'Chờ đẩy', color: 'bg-amber-100 text-amber-800' },
  SYNCED: { label: 'Đã đẩy', color: 'bg-blue-100 text-blue-800' },
  SYNC_FAILED: { label: 'Đẩy lỗi', color: 'bg-rose-100 text-rose-800' },
  SIGNED: { label: 'Đã ký', color: 'bg-green-100 text-green-800' },
  CANCELLED: { label: 'Đã hủy', color: 'bg-rose-100 text-rose-800' },
  REJECTED: { label: 'Từ chối', color: 'bg-slate-100 text-slate-600' },
  DRAFT: { label: 'Nháp', color: 'bg-slate-100 text-slate-600' },
};

/** Định dạng ngày giờ VN dd/mm/yyyy. */
function formatVnDate(v: any): string {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + d.getFullYear();
}

/** Dịch trạng thái MS-Invoice sang tiếng Việt. */
const MS_STATUS_LABEL: Record<string, string> = {
  InvoiceFinalized: 'Đã hoàn thiện (chưa ký)',
  InvoiceCancelled: 'Đã hủy',
  InvoicedIssued: 'Đã phát hành',
  InvoiceReopened: 'Mở lại',
};

export default function EinvoiceView() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [onlineQueue, setOnlineQueue] = useState<{ awaitingDelivery: OnlineQueueItem[]; readyToIssue: OnlineQueueItem[] }>({ awaitingDelivery: [], readyToIssue: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConsolidate, setShowConsolidate] = useState(false);
  const [consolidateDate, setConsolidateDate] = useState(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  );
  // Mirror MS-Invoice
  const [view, setView] = useState<'erp' | 'ms'>('erp');
  const [msInvoices, setMsInvoices] = useState<any[]>([]);
  const [msLoading, setMsLoading] = useState(false);
  const [msError, setMsError] = useState<string | null>(null);
  const [msMock, setMsMock] = useState(false);
  const [msFrom, setMsFrom] = useState(() => {
    const d = new Date(Date.now() + 7 * 3600 * 1000 - 30 * 24 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [msTo, setMsTo] = useState(() => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10));

  const loadMs = async () => {
    setMsLoading(true);
    setMsError(null);
    try {
      const res = await fetch(`/api/invoices/ms-list?from=${msFrom}&to=${msTo}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Không tải được danh sách MS-Invoice');
      setMsMock(!!data.data.mock);
      setMsInvoices(data.data.invoices || []);
    } catch (e: any) {
      setMsError(e.message);
    } finally {
      setMsLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, ordRes, oqRes] = await Promise.all([
        fetch('/api/invoices?limit=100'),
        fetch('/api/invoices/pending-orders'),
        fetch('/api/invoices/online-queue'),
      ]);
      const invData = await invRes.json();
      if (invData.ok) setInvoices(invData.data);
      const ordData = await ordRes.json();
      if (ordData.ok) setPendingOrders(ordData.data);
      const oqData = await oqRes.json();
      if (oqData.ok) setOnlineQueue(oqData.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePrepare = async (orderId: string) => {
    setActionLoading(orderId);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', orderId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmDelivery = async (orderId: string) => {
    setActionLoading(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm-delivery`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePush = async (invoiceId: string) => {
    setActionLoading(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push' }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkSigned = async (invoiceId: string) => {
    setActionLoading(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', status: 'SIGNED' }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConsolidate = async () => {
    setActionLoading('consolidate');
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'consolidate', date: consolidateDate }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setShowConsolidate(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = filter === 'ALL' ? invoices : invoices.filter((i) => i.status === filter);
  const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Hóa đơn điện tử
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Chuẩn bị từ đơn hàng, đẩy sang MS-Invoice, kế toán ký trên MS-Invoice
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConsolidate(true)}
            className="px-4 py-2 bg-slate-600 text-white rounded-xl text-sm font-bold hover:bg-slate-700"
          >
            Gom HĐ tổng hợp
          </button>
          <button
            onClick={load}
            className="p-2 border border-slate-300 rounded-xl hover:bg-slate-50"
            title="Làm mới"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Chuyển view: ERP / Mirror MS-Invoice */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('erp')}
          className={`px-4 py-2 rounded-xl text-sm font-bold ${view === 'erp' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300'}`}
        >
          Hóa đơn ERP
        </button>
        <button
          onClick={() => { setView('ms'); if (msInvoices.length === 0) void loadMs(); }}
          className={`px-4 py-2 rounded-xl text-sm font-bold ${view === 'ms' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300'}`}
        >
          Trên MS-Invoice
        </button>
      </div>

      {view === 'ms' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Từ ngày</label>
              <input type="date" value={msFrom} onChange={(e) => setMsFrom(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Đến ngày</label>
              <input type="date" value={msTo} onChange={(e) => setMsTo(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm" />
            </div>
            <button onClick={() => void loadMs()} disabled={msLoading}
              className="px-4 py-2 bg-slate-700 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50">
              {msLoading ? 'Đang tải...' : 'Tải từ MS-Invoice'}
            </button>
          </div>
          {msError && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">
              Không kết nối được MS-Invoice: {msError}. Kiểm tra lại sau ít phút.
            </div>
          )}
          {msMock && !msError && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              Chưa cấu hình MSINVOICE_* nên chưa có dữ liệu thật từ MS-Invoice.
            </div>
          )}
          {!msLoading && !msError && msInvoices.length === 0 && (
            <p className="text-sm text-slate-400">Không có hóa đơn nào trong khoảng ngày này trên MS-Invoice.</p>
          )}
          {msInvoices.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-bold text-slate-600">Ký hiệu</th>
                    <th className="px-3 py-2 font-bold text-slate-600">Số HĐ</th>
                    <th className="px-3 py-2 font-bold text-slate-600">Ngày</th>
                    <th className="px-3 py-2 font-bold text-slate-600">Người mua</th>
                    <th className="px-3 py-2 font-bold text-slate-600">MST</th>
                    <th className="px-3 py-2 font-bold text-slate-600 text-right">Tổng tiền</th>
                    <th className="px-3 py-2 font-bold text-slate-600">Trạng thái MS</th>
                    <th className="px-3 py-2 font-bold text-slate-600">Đồng bộ ERP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {msInvoices.map((inv: any) => (
                    <tr key={inv.msinvoiceId || inv.number}>
                      <td className="px-3 py-2 font-mono">{inv.serial || '-'}</td>
                      <td className="px-3 py-2 font-mono">{inv.number || '-'}</td>
                      <td className="px-3 py-2">{formatVnDate(inv.date)}</td>
                      <td className="px-3 py-2">{inv.buyerName || '-'}</td>
                      <td className="px-3 py-2 font-mono">{inv.buyerTaxCode || '-'}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmt(Number(inv.totalAmount || 0))}</td>
                      <td className="px-3 py-2">{MS_STATUS_LABEL[inv.status] || inv.status || '-'}</td>
                      <td className="px-3 py-2">
                        {inv.sync?.matched ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800">
                            Đã có trên ERP ({STATUS_LABEL[inv.sync.localStatus]?.label || inv.sync.localStatus})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                            Chưa có trên ERP
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Đơn chờ chuẩn bị hóa đơn */}
      {pendingOrders.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <h3 className="font-bold text-amber-900 mb-3">
            Đơn chờ chuẩn bị hóa đơn ({pendingOrders.length})
          </h3>
          <div className="space-y-2">
            {pendingOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between bg-white rounded-xl p-3">
                <div>
                  <span className="font-mono text-sm font-bold">{o.orderCode}</span>
                  <span className="text-sm text-slate-600 ml-3">{o.customerName}</span>
                  <span className="text-sm text-slate-500 ml-3">{fmt(o.finalAmount)}</span>
                </div>
                <button
                  onClick={() => handlePrepare(o.id)}
                  disabled={actionLoading === o.id}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 disabled:opacity-50"
                >
                  {actionLoading === o.id ? 'Đang...' : 'Chuẩn bị'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hàng đợi hóa đơn đơn online (D1): chỉ phát hành khi khách đã nhận hàng */}
      {(onlineQueue.awaitingDelivery.length > 0 || onlineQueue.readyToIssue.length > 0) && (
        <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5">
          <h3 className="font-bold text-sky-900 mb-1">
            Hóa đơn đơn online ({onlineQueue.awaitingDelivery.length + onlineQueue.readyToIssue.length})
          </h3>
          <p className="text-xs text-sky-700 mb-3">
            Đơn online chỉ phát hành hóa đơn sau khi xác nhận khách đã nhận hàng.
          </p>
          <div className="space-y-2">
            {onlineQueue.awaitingDelivery.map((o) => (
              <div key={o.id} className="flex items-center justify-between bg-white rounded-xl p-3">
                <div>
                  <span className="font-mono text-sm font-bold">{o.orderCode}</span>
                  <span className="text-xs font-bold text-sky-700 bg-sky-100 rounded px-1.5 py-0.5 ml-2">{o.channel === 'SHOPEE' ? 'Shopee' : 'Portal'}</span>
                  <span className="text-sm text-slate-600 ml-3">{o.customerName}</span>
                  <span className="text-sm text-slate-500 ml-3">{fmt(o.finalAmount)}</span>
                  <span className="text-xs text-amber-700 font-bold ml-3">Chờ khách nhận hàng</span>
                </div>
                <button
                  onClick={() => handleConfirmDelivery(o.id)}
                  disabled={actionLoading === o.id}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {actionLoading === o.id ? 'Đang...' : 'Đã nhận hàng'}
                </button>
              </div>
            ))}
            {onlineQueue.readyToIssue.map((o) => (
              <div key={o.id} className="flex items-center justify-between bg-white rounded-xl p-3">
                <div>
                  <span className="font-mono text-sm font-bold">{o.orderCode}</span>
                  <span className="text-xs font-bold text-sky-700 bg-sky-100 rounded px-1.5 py-0.5 ml-2">{o.channel === 'SHOPEE' ? 'Shopee' : 'Portal'}</span>
                  <span className="text-sm text-slate-600 ml-3">{o.customerName}</span>
                  <span className="text-sm text-slate-500 ml-3">{fmt(o.finalAmount)}</span>
                  <span className="text-xs text-emerald-700 font-bold ml-3">
                    Đã nhận hàng{o.deliveryConfirmedBy ? ` - ${o.deliveryConfirmedBy}` : ''}
                  </span>
                </div>
                {o.fiscalScope === 'INTERNAL_MANAGEMENT' ? (
                  <span className="text-xs text-slate-500">Sẽ gom vào hóa đơn tổng hợp cuối ngày</span>
                ) : o.einvoiceId ? (
                  <button
                    onClick={() => handlePush(o.einvoiceId!)}
                    disabled={actionLoading === o.einvoiceId}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {actionLoading === o.einvoiceId ? 'Đang...' : 'Phát hành'}
                  </button>
                ) : (
                  <button
                    onClick={() => handlePrepare(o.id)}
                    disabled={actionLoading === o.id}
                    className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {actionLoading === o.id ? 'Đang...' : 'Chuẩn bị'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bộ lọc */}
      <div className="flex gap-2 flex-wrap">
        {['ALL', 'PREPARED', 'SYNCED', 'SIGNED', 'CANCELLED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              filter === s ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300'
            }`}
          >
            {s === 'ALL' ? 'Tất cả' : STATUS_LABEL[s]?.label || s}
          </button>
        ))}
      </div>

      {/* Danh sách hóa đơn */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-bold">Loại</th>
              <th className="px-4 py-3 text-left font-bold">Người mua</th>
              <th className="px-4 py-3 text-left font-bold">MST</th>
              <th className="px-4 py-3 text-right font-bold">Tổng tiền</th>
              <th className="px-4 py-3 text-center font-bold">Trạng thái</th>
              <th className="px-4 py-3 text-center font-bold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Đang tải...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Chưa có hóa đơn</td></tr>
            ) : (
              filtered.map((inv) => {
                const st = STATUS_LABEL[inv.status] || { label: inv.status, color: 'bg-slate-100' };
                return (
                  <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-bold">{inv.invoiceKind === 'CONSOLIDATED' ? 'Tổng hợp' : 'Đơn lẻ'}</span>
                      {inv.invoiceKind === 'CONSOLIDATED' && inv.consolidatedDate && (
                        <div className="text-xs text-slate-500">{inv.consolidatedDate}</div>
                      )}
                      {inv.invoiceNumber && (
                        <div className="text-xs text-slate-500 font-mono">{inv.invoiceSerial}-{inv.invoiceNumber}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{inv.buyerName || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{inv.buyerTaxCode || '-'}</td>
                    <td className="px-4 py-3 text-right font-bold">{fmt(inv.totalAmount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => setSelected(inv)}
                          title="Xem chi tiết"
                          className="p-1.5 hover:bg-slate-200 rounded"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {(inv.status === 'PREPARED' || inv.status === 'SYNC_FAILED') && (
                          <button
                            onClick={() => handlePush(inv.id)}
                            disabled={actionLoading === inv.id}
                            title={inv.status === 'SYNC_FAILED' ? 'Thử đẩy lại sang MS-Invoice' : 'Đẩy sang MS-Invoice'}
                            className="p-1.5 hover:bg-blue-100 text-blue-600 rounded disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {inv.status === 'SYNCED' && (
                          <button
                            onClick={() => handleMarkSigned(inv.id)}
                            disabled={actionLoading === inv.id}
                            title="Đánh dấu đã ký (giả lập kế toán)"
                            className="p-1.5 hover:bg-green-100 text-green-600 rounded disabled:opacity-50"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal chi tiết */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Chi tiết hóa đơn</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Loại:</span><span className="font-bold">{selected.invoiceKind === 'CONSOLIDATED' ? 'Tổng hợp' : 'Đơn lẻ'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Người mua:</span><span>{selected.buyerName || '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">MST:</span><span className="font-mono">{selected.buyerTaxCode || '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Địa chỉ:</span><span>{selected.buyerAddress || '-'}</span></div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between"><span className="text-slate-500">Tiền hàng:</span><span>{fmt(selected.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">VAT ({Math.round(selected.vatRate * 100)}%):</span><span>{fmt(selected.vatAmount)}</span></div>
                <div className="flex justify-between font-bold text-base"><span>Tổng cộng:</span><span>{fmt(selected.totalAmount)}</span></div>
              </div>
              {selected.invoiceNumber && (
                <div className="border-t pt-2">
                  <div className="flex justify-between"><span className="text-slate-500">Số HĐ:</span><span className="font-mono">{selected.invoiceSerial}-{selected.invoiceNumber}</span></div>
                  {selected.lookupCode && <div className="flex justify-between"><span className="text-slate-500">Mã tra cứu:</span><span className="font-mono">{selected.lookupCode}</span></div>}
                </div>
              )}
              {selected.sourceOrderIds && (
                <div className="border-t pt-2">
                  <span className="text-slate-500">Gom từ {JSON.parse(selected.sourceOrderIds).length} đơn</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setSelected(null)}
              className="mt-4 w-full px-4 py-2 bg-slate-100 rounded-xl font-bold"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Modal gom tổng hợp */}
      {showConsolidate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowConsolidate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">Gom hóa đơn tổng hợp</h3>
            <label className="text-sm font-bold text-slate-600">Ngày (YYYY-MM-DD)</label>
            <input
              type="date"
              value={consolidateDate}
              onChange={(e) => setConsolidateDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl mt-1"
            />
            <p className="text-xs text-slate-500 mt-2">
              Gom tất cả đơn INTERNAL_MANAGEMENT đã hoàn thành trong ngày thành 1 hóa đơn.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowConsolidate(false)}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-xl font-bold"
              >
                Hủy
              </button>
              <button
                onClick={handleConsolidate}
                disabled={actionLoading === 'consolidate'}
                className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-xl font-bold disabled:opacity-50"
              >
                {actionLoading === 'consolidate' ? 'Đang gom...' : 'Gom'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
