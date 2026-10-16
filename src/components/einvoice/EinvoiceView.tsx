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

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PREPARED: { label: 'Chờ đẩy', color: 'bg-amber-100 text-amber-800' },
  SYNCED: { label: 'Đã đẩy', color: 'bg-blue-100 text-blue-800' },
  SYNC_FAILED: { label: 'Đẩy lỗi', color: 'bg-rose-100 text-rose-800' },
  SIGNED: { label: 'Đã ký', color: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Từ chối', color: 'bg-slate-100 text-slate-600' },
  DRAFT: { label: 'Nháp', color: 'bg-slate-100 text-slate-600' },
};

export default function EinvoiceView() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConsolidate, setShowConsolidate] = useState(false);
  const [consolidateDate, setConsolidateDate] = useState(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, ordRes] = await Promise.all([
        fetch('/api/invoices?limit=100'),
        fetch('/api/invoices/pending-orders'),
      ]);
      const invData = await invRes.json();
      if (invData.ok) setInvoices(invData.data);
      const ordData = await ordRes.json();
      if (ordData.ok) setPendingOrders(ordData.data);
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

      {/* Bộ lọc */}
      <div className="flex gap-2 flex-wrap">
        {['ALL', 'PREPARED', 'SYNCED', 'SIGNED'].map((s) => (
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
                        {inv.status === 'PREPARED' && (
                          <button
                            onClick={() => handlePush(inv.id)}
                            disabled={actionLoading === inv.id}
                            title="Đẩy sang MS-Invoice"
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
    </div>
  );
}
