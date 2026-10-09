'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BarChart3, Download, RefreshCw, Wallet, Store, Truck, Globe, Gift } from 'lucide-react';
import { TableExpandOverlay } from './TableExpandOverlay';
import { UserRole } from '@/lib/roles';
import { appendExportWatermark } from '@/lib/export-hash';
import { channelLabel, fiscalScopeLabel } from '@/lib/sales-view';

interface RevenueAnalyticsPanelProps {
  currentRole: UserRole;
  /** Ngày nghiệp vụ VN 'YYYY-MM-DD'; rỗng = không lọc ngày. */
  startDate: string;
  endDate: string;
  /** 'ALL' = không lọc kho. */
  warehouseId: string;
  /** undefined = không lọc sổ (API chỉ nhận đúng 2 giá trị này). */
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
  /** Mã nhân viên THẬT đóng watermark — lấy từ Sổ Kép, KHÔNG ghi hằng số. */
  actorId: string;
}

/** Một dòng của `AnalyticsService.byChannel`. */
interface ChannelRow {
  channel: string;
  orders: number;
  revenue: number;
  subtotal: number;
  share: number;
}

/** `GET /api/analytics?view=cashflow` — server đã loại SPONSORSHIP khỏi `salesRevenue`. */
interface Cashflow {
  channels: ChannelRow[];
  salesRevenue: number;
  netRevenue: number;
  codPending: number;
  codReceived: number;
  sponsorshipDrawnValue: number;
  sponsorshipDrawnQty: number;
}

const SOURCE_GROUPS: { id: string; label: string; channels: string[]; icon: any }[] = [
  { id: 'retail', label: 'Bán lẻ', channels: ['FAIR_EVENT', 'RETAIL_OFFICE'], icon: Store },
  { id: 'wholesale', label: 'Bán đại lý', channels: ['WHOLESALE_PARTNER'], icon: Truck },
  { id: 'online', label: 'Bán online', channels: ['ONLINE', 'RETAIL_ONLINE_WEB', 'RETAIL_ONLINE_SOCIAL'], icon: Globe },
  { id: 'gift', label: 'Tặng / Tài trợ', channels: ['SPONSORSHIP'], icon: Gift },
];

/** Nhóm bán hàng THẬT — nhóm tặng/tài trợ hiện dòng riêng, ngoài doanh thu. */
const SELL_GROUPS = SOURCE_GROUPS.filter((g) => g.id !== 'gift');
const GIFT_GROUP = SOURCE_GROUPS.find((g) => g.id === 'gift')!;

const CSV_HEADERS = ['Nhóm nguồn', 'Kênh', 'Số đơn', 'Doanh thu (VND)', 'Tỷ trọng (%)'];

export function RevenueAnalyticsPanel({
  currentRole,
  startDate,
  endDate,
  warehouseId,
  fiscalScope,
  actorId,
}: RevenueAnalyticsPanelProps) {
  const canView = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);
  const [consignment, setConsignment] = useState<any[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async () => {
    if (!canView) return;
    // Bấm liên tiếp nhiều preset/kho thì response cũ vẫn bay về và ghi đè kết
    // quả mới. Huỷ request trước đó thay vì so timestamp.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      // Kho + sổ: chỉ cashflow nhận (kho ký gửi là tồn vật lý, không chia sổ).
      const scope = new URLSearchParams();
      if (startDate) scope.set('startDate', startDate);
      if (endDate) scope.set('endDate', endDate);
      if (warehouseId && warehouseId !== 'ALL') scope.set('warehouseId', warehouseId);
      if (fiscalScope) scope.set('fiscalScope', fiscalScope);
      const range = new URLSearchParams();
      if (startDate) range.set('startDate', startDate);
      if (endDate) range.set('endDate', endDate);
      const url = (view: string, q: URLSearchParams) =>
        `/api/analytics?view=${view}${q.toString() ? `&${q.toString()}` : ''}`;

      const [fRes, sRes] = await Promise.all([
        fetch(url('cashflow', scope), { signal: controller.signal })
          .then((r) => r.json())
          .catch(() => null),
        fetch(url('consignment', range), { signal: controller.signal })
          .then((r) => r.json())
          .catch(() => null),
      ]);
      if (controller.signal.aborted) return;
      const failed: string[] = [];
      // `cashflow.channels` CHÍNH LÀ breakdown kênh đã lọc — dùng lại thay vì
      // gọi thêm `view=channels` (hai nguồn cùng câu truy vấn, dễ lệch nhau).
      if (fRes?.success) setCashflow(fRes.data || null);
      else failed.push('dòng tiền');
      if (sRes?.success) setConsignment(sRes.data || []);
      else failed.push('ký gửi');
      if (failed.length > 0) {
        setLoadError(`Không tải được số liệu ${failed.join(', ')} — kiểm tra mạng rồi bấm Tải lại.`);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, currentRole, startDate, endDate, warehouseId, fiscalScope]);

  useEffect(() => {
    fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  if (!canView) return null;

  const channels = cashflow?.channels || [];
  // Mẫu số tỷ trọng = doanh thu bán của SERVER (đã loại tài trợ). Trước đây
  // panel tự cộng `byChannel` nên tài trợ nằm trong mẫu số ⇒ tổng tỷ trọng <100%
  // mà không có dòng nào giải thích.
  const salesRevenue = Number(cashflow?.salesRevenue || 0);
  const netRevenue = Number(cashflow?.netRevenue || 0);

  const groups = SELL_GROUPS.map((g) => {
    const rows = channels.filter((c) => g.channels.includes(c.channel));
    const revenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const orders = rows.reduce((s, r) => s + Number(r.orders || 0), 0);
    return { ...g, rows, revenue, orders, share: salesRevenue > 0 ? revenue / salesRevenue : 0 };
  }).sort((a, b) => b.revenue - a.revenue);

  const giftRows = channels.filter((c) => GIFT_GROUP.channels.includes(c.channel));
  const gift = {
    ...GIFT_GROUP,
    rows: giftRows,
    orders: giftRows.reduce((s, r) => s + Number(r.orders || 0), 0),
    // Nếu server trả tiền cho đơn tài trợ (0đ theo nghiệp vụ) thì hiện đúng số
    // thật, nhưng KHÔNG cộng vào doanh thu bán.
    revenue: giftRows.reduce((s, r) => s + Number(r.revenue || 0), 0),
  };

  const totalOrders = groups.reduce((s, g) => s + g.orders, 0);
  const showLoading = loading && !cashflow;
  const showEmpty = !loading && !loadError && channels.length === 0;

  const exportSourceCsv = () => {
    if (channels.length === 0) {
      alert('Chưa có dữ liệu nguồn doanh thu để xuất.');
      return;
    }
    if (!actorId) {
      alert('Chưa đọc được người đăng nhập nên chưa xuất được. Tải lại trang rồi thử lại.');
      return;
    }
    // Chặn Excel formula injection ở tên nhóm/kênh.
    const cell = (v: string | number) => {
      const s = `${v ?? ''}`;
      return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`;
    };
    const rawObjects: Record<string, unknown>[] = [];
    const rows: string[] = [];
    const push = (
      groupLabel: string,
      channel: string,
      orders: number,
      revenue: number,
      sharePct: number
    ) => {
      rawObjects.push({ group: groupLabel, channel, orders, revenue, sharePct });
      rows.push(
        [cell(groupLabel), cell(channelLabel(channel)), orders, revenue, sharePct.toFixed(2)].join(',')
      );
    };
    for (const g of groups) {
      for (const r of g.rows) {
        // Tỷ trọng TÍNH LẠI trên `salesRevenue` (mẫu số như dòng TỔNG) chứ không
        // dùng `share` của server — server chia trên TỔNG CẢ kênh kể cả tài trợ.
        const rev = Number(r.revenue || 0);
        push(g.label, r.channel, Number(r.orders || 0), rev, salesRevenue > 0 ? (rev / salesRevenue) * 100 : 0);
      }
    }
    // Dòng tài trợ RIÊNG, KHÔNG gộp vào doanh thu bán — và LUÔN có mặt (kể cả
    // khi 0đ) để file khớp đúng bảng trên màn hình, nơi dòng này hiện hoài.
    push('Tặng / Tài trợ (ngoài doanh thu)', 'SPONSORSHIP', gift.orders, gift.revenue, 0);
    push('TỔNG', '', totalOrders, salesRevenue, salesRevenue > 0 ? 100 : 0);

    const rangeLabel = startDate || endDate ? `${startDate || 'đầu kỳ'} → ${endDate || 'nay'}` : 'toàn bộ thời gian';
    const baseCsv = [CSV_HEADERS.join(','), ...rows].join('\r\n');
    const watermarked = appendExportWatermark(baseCsv, rawObjects, {
      actorId,
      actorRole: currentRole,
      reportName: `Phân tích nguồn doanh thu & dòng tiền — ${rangeLabel} — ${fiscalScope ? fiscalScopeLabel(fiscalScope) : 'mọi sổ'}`,
      fiscalScope: fiscalScope || 'ALL',
    });
    const blob = new Blob(['\uFEFF' + watermarked], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Nguon_Doanh_Thu_${startDate || 'all'}_${endDate || 'nay'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            Phân Tích Nguồn Doanh Thu & Dòng Tiền
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Bán lẻ • Đại lý • Online • Tặng/đối tác — kèm tỷ trọng %, COD và ký gửi. Chỉ Chủ sở hữu / Quản lý.
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Số liệu theo đúng bộ lọc của bảng trên: kho, ngày, sổ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
          <button
            onClick={exportSourceCsv}
            disabled={!actorId}
            title={actorId ? 'Xuất báo cáo nguồn doanh thu' : 'Chưa đọc được người đăng nhập — tải lại trang'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất Excel/CSV
          </button>
        </div>
      </div>

      {/* Bao loi tai — phan biet "tai loi" voi "khong co du lieu" */}
      {loadError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-2">
          <span className="font-medium">{loadError}</span>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition disabled:opacity-50 shrink-0"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Trạng thái tải / rỗng RIÊNG — không hiện 0 đ giả khi chưa có số liệu */}
      {showLoading && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
          Đang tải số liệu theo bộ lọc kho/ngày/sổ…
        </div>
      )}
      {showEmpty && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
          Chưa có đơn hoàn tất trong khoảng lọc này. Đổi kho hoặc khoảng ngày ở bảng trên rồi bấm “Tải lại”.
        </div>
      )}

      {cashflow && !showEmpty && (
        <>
          {/* Tổng quan dòng tiền — số lấy thẳng từ cashflow, không cộng lại client */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
              <p className="text-[11px] font-bold text-emerald-700 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Doanh thu bán hàng</p>
              <p className="text-lg font-black text-emerald-900 font-mono mt-1">{salesRevenue.toLocaleString('vi-VN')} đ</p>
              <p className="text-[11px] text-emerald-700">Đã trừ tặng/tài trợ 0đ</p>
            </div>
            <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200">
              <p className="text-[11px] font-bold text-indigo-700">Doanh thu thuần (trừ hoàn)</p>
              <p className="text-lg font-black text-indigo-900 font-mono mt-1">{netRevenue.toLocaleString('vi-VN')} đ</p>
              <p className="text-[11px] text-indigo-700">Hoàn đã duyệt đã trừ</p>
            </div>
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-[11px] font-bold text-amber-700">COD chờ về</p>
              <p className="text-lg font-black text-amber-900 font-mono mt-1">{Number(cashflow.codPending || 0).toLocaleString('vi-VN')} đ</p>
              <p className="text-[11px] text-amber-700">Đã về: {Number(cashflow.codReceived || 0).toLocaleString('vi-VN')} đ</p>
            </div>
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
              <p className="text-[11px] font-bold text-rose-700">Sách tặng / tài trợ đã rút</p>
              <p className="text-lg font-black text-rose-900 font-mono mt-1">{Number(cashflow.sponsorshipDrawnQty || 0).toLocaleString('vi-VN')} cuốn</p>
              <p className="text-[11px] text-rose-700">Trị giá bìa: {Number(cashflow.sponsorshipDrawnValue || 0).toLocaleString('vi-VN')} đ</p>
            </div>
          </div>

          {/* Bảng theo nhóm nguồn — dòng tài trợ RIÊNG, dòng TỔNG ở cuối */}
          <TableExpandOverlay title="Nguồn doanh thu" onExport={exportSourceCsv} exportLabel="Xuất Excel/CSV">
          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                <tr>
                  <th className="p-3">Nhóm nguồn</th>
                  <th className="p-3">Số đơn</th>
                  <th className="p-3">Doanh thu</th>
                  <th className="p-3">Tỷ trọng</th>
                  <th className="p-3">Chi tiết kênh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((g) => {
                  const Icon = g.icon;
                  return (
                    <tr key={g.id} className="hover:bg-slate-50/70">
                      <td className="p-3 font-extrabold text-slate-900 flex items-center gap-1.5">
                        <Icon className="w-4 h-4 text-indigo-600" />
                        {g.label}
                      </td>
                      <td className="p-3 font-mono font-bold">{g.orders.toLocaleString('vi-VN')}</td>
                      <td className="p-3 font-mono font-bold text-emerald-700">{g.revenue.toLocaleString('vi-VN')} đ</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(g.share * 100)}%` }} />
                          </div>
                          <span className="font-mono font-bold text-slate-800">{(g.share * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-600">
                        {g.rows.length === 0 ? (
                          <span className="text-slate-400">Chưa phát sinh</span>
                        ) : (
                          g.rows.map((r: ChannelRow) => (
                            <div key={r.channel} className="flex justify-between gap-3 py-0.5">
                              <span>{channelLabel(r.channel)} ({Number(r.orders || 0)} đơn)</span>
                              <span className="font-mono font-semibold">{Number(r.revenue || 0).toLocaleString('vi-VN')} đ</span>
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-amber-50/60">
                  <td className="p-3 font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-amber-600" />
                    Tặng / Tài trợ (ngoài doanh thu)
                  </td>
                  <td className="p-3 font-mono font-bold">{gift.orders.toLocaleString('vi-VN')}</td>
                  <td className="p-3 font-mono font-bold text-amber-700">{gift.revenue.toLocaleString('vi-VN')} đ</td>
                  <td className="p-3 font-mono text-slate-500">—</td>
                  <td className="p-3 text-slate-600">
                    {gift.rows.length === 0 ? (
                      <span className="text-slate-400">Chưa phát sinh</span>
                    ) : (
                      gift.rows.map((r: ChannelRow) => (
                        <div key={r.channel} className="flex justify-between gap-3 py-0.5">
                          <span>{channelLabel(r.channel)} ({Number(r.orders || 0)} đơn)</span>
                          <span className="font-mono font-semibold">{Number(r.revenue || 0).toLocaleString('vi-VN')} đ</span>
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr>
                  <td className="p-3 font-black text-slate-900">TỔNG</td>
                  <td className="p-3 font-mono font-black">{totalOrders.toLocaleString('vi-VN')}</td>
                  <td className="p-3 font-mono font-black text-emerald-700">{salesRevenue.toLocaleString('vi-VN')} đ</td>
                  <td className="p-3 font-mono font-black text-slate-800">100%</td>
                  <td className="p-3 text-slate-500">Không gồm dòng tặng / tài trợ</td>
                </tr>
              </tfoot>
            </table>
          </div>
          </TableExpandOverlay>
        </>
      )}

      {/* Ký gửi đại lý — tồn vật lý, KHÔNG chia theo kho/sổ nên chỉ lọc ngày */}
      {consignment.length > 0 && (
        <div className="overflow-x-auto">
          <h4 className="text-xs font-extrabold text-slate-900 mb-2">Hàng ký gửi tại các đại lý</h4>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
              <tr>
                <th className="p-3">Kho ký gửi</th>
                <th className="p-3">Đang giữ (cuốn)</th>
                <th className="p-3">Giá trị bìa ước tính</th>
                <th className="p-3">Đã bán kỳ này</th>
                <th className="p-3">Số SKU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {consignment.map((c: any) => (
                <tr key={c.warehouseId} className="hover:bg-slate-50/70">
                  <td className="p-3 font-bold text-slate-900">{c.warehouseName || c.warehouseId}</td>
                  <td className="p-3 font-mono">{Number(c.heldQty || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 font-mono">{Number(c.heldValue || 0).toLocaleString('vi-VN')} đ</td>
                  <td className="p-3 font-mono font-bold text-emerald-700">{Number(c.soldQty || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 font-mono">{Number(c.skuCount || 0).toLocaleString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-400 mt-1">
            Kho ký gửi là tồn vật lý nên không chia theo kho/sổ: dòng này luôn là tổng các kho ký gửi, chỉ lọc theo ngày.
          </p>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Nguồn số liệu: đơn COMPLETED (trừ SPONSORSHIP khỏi doanh thu bán), COD theo trạng thái, tặng theo quỹ tài trợ rút. File xuất kèm hash kiểm toàn vẹn.
      </p>
    </div>
  );
}
