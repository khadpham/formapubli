'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, Download, RefreshCw, TrendingUp } from 'lucide-react';
import { UserRole } from '@/lib/roles';
import { appendExportWatermark } from '@/lib/export-hash';
import { useSortable, SortableTh } from '@/lib/table-ux';
import { TableExpandOverlay } from './TableExpandOverlay';

interface TopEditionsPanelProps {
  currentRole: UserRole;
  /** Ngày nghiệp vụ VN 'YYYY-MM-DD' từ tab; rỗng = không lọc ngày. */
  startDate: string;
  endDate: string;
  /** Kho đang lọc ở tab Doanh Số; 'ALL' = không lọc kho. */
  warehouseId: string;
  /** Tên kho THẬT (từ /api/warehouses) để ghi ra CSV, không bịa. */
  warehouseLabel: string;
  /** Sổ đang lọc ở tab; undefined = cả hai sổ. */
  fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT';
  /** Mã nhân viên THẬT đóng watermark — lấy từ Sổ Kép, KHÔNG ghi hằng số. */
  actorId: string;
  /** Bấm dòng sản phẩm → mở Nhịp Bán (timeline 1 món); null = mở danh sách. */
  onPickProduct?: (productId: string | null) => void;
}

/** Một dòng của `AnalyticsService.topEditions` (Task 3 đã khóa shape). */
interface TopEditionRow {
  editionId: string | null;
  productId?: string | null;
  code: string | null;
  title: string | null;
  qty: number;
  orders: number;
  revenue: number;
  qtyShare: number;
}

const CSV_HEADERS = [
  'Hạng',
  'Mã',
  'Tiêu đề',
  'Số lượng (cuốn)',
  'Số đơn',
  'Doanh thu (VND)',
  'Tỷ trọng SL (%)',
  'Kỳ lọc',
  'Kho',
];

export function TopEditionsPanel({
  currentRole,
  startDate,
  endDate,
  warehouseId,
  warehouseLabel,
  fiscalScope,
  actorId,
  onPickProduct,
}: TopEditionsPanelProps) {
  const canView = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const [topN, setTopN] = useState(20);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<TopEditionRow[]>([]);
  const [totals, setTotals] = useState({ totalQty: 0, totalRevenue: 0, totalGiftQty: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const fetchTop = useCallback(async () => {
    if (!canView) return;
    // Bấm liên tiếp nhiều bộ lọc/kho thì response cũ vẫn bay về và ghi đè kết
    // quả mới (bảng hiện số của kỳ trước). Huỷ request trước đó thay vì so timestamp.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('view', 'top-editions');
      // Khoảng ngày LẤY TỪ TAB (giống RevenueAnalyticsPanel). Panel KHÔNG có preset
      // riêng: hai bộ nút ngày trên một màn thì số của panel lệch với bảng đang
      // lọc mà không ai biết vì sao. Rỗng = không lọc ngày.
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      params.set('top', String(topN));
      // Mặc định của API đã loại dòng quà; gửi tường minh để đọc file là biết
      // bảng này cố tình không có quà.
      params.set('excludeGifts', '1');
      // Kho đang chọn ở tab: bỏ trống = không lọc kho (không gửi 'ALL' lên API).
      if (warehouseId && warehouseId !== 'ALL') params.set('warehouseId', warehouseId);
      // Sổ đang lọc ở tab: bỏ trống = cả hai sổ.
      if (fiscalScope) params.set('fiscalScope', fiscalScope);
      const res = await fetch(`/api/analytics?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (json?.success) {
        setItems(json.data?.items || []);
        setTotals({
          totalQty: Number(json.data?.totalQty || 0),
          totalRevenue: Number(json.data?.totalRevenue || 0),
          // Quà đã phát không nằm trong bảng (dòng quà 0đ, khách không chọn) —
          // nhưng phải hiện riêng, không giấu: không có thì "Top bán chạy" nghe
          // như hết tặng quà.
          totalGiftQty: Number(json.data?.totalGiftQty || 0),
        });
      } else {
        setItems([]);
        setLoadError('Không tải được số liệu sách bán chạy — kiểm tra mạng rồi bấm Tải lại.');
      }
    } catch {
      if (controller.signal.aborted) return;
      setItems([]);
      setLoadError('Không tải được số liệu sách bán chạy — kiểm tra mạng rồi bấm Tải lại.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, currentRole, startDate, endDate, topN, warehouseId, fiscalScope]);

  useEffect(() => {
    fetchTop();
    return () => abortRef.current?.abort();
  }, [fetchTop]);

  // Sắp xếp client trên dòng đã tải (server trả đúng topN theo SL bán).
  // Nhãn ghi rõ để không ai tưởng đang xếp toàn bộ danh mục.
  const {
    sorted: sortedItems,
    sortKey,
    sortDir,
    toggleSort,
  } = useSortable(items, 'qty', 'desc', (it: TopEditionRow, key: string) => {
    if (key === 'qty') return Number(it.qty || 0);
    if (key === 'orders') return Number(it.orders || 0);
    if (key === 'revenue') return Number(it.revenue || 0);
    return 0;
  });

  if (!canView) return null;

  // Nhãn kỳ LẤY TỪ BỘ LỌC CỦA TAB, không suy ra từ preset nội bộ: rỗng = không
  // lọc ngày, và nhãn phải khớp đúng cái bảng Sổ Kép đang hiện.
  const rangeLabel = startDate || endDate ? `${startDate || 'đầu kỳ'} → ${endDate || 'nay'}` : 'toàn bộ thời gian';
  const csvRange = startDate && endDate ? `${startDate}_${endDate}` : startDate || endDate || 'all';

  const exportCsv = () => {
    if (items.length === 0) {
      alert('Chưa có dữ liệu sách bán chạy để xuất.');
      return;
    }
    if (!actorId) {
      alert('Chưa đọc được người đăng nhập nên chưa xuất được. Tải lại trang rồi thử lại.');
      return;
    }
    // Chặn Excel formula injection ở Mã/Tiêu đề.
    const cell = (v: string | number) => {
      const s = `${v ?? ''}`;
      return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`;
    };
    // Watermark hash trên DỮ LIỆU THÔ (chưa escape) — số phải khớp số thứ tự
    // trên bảng nên map kèm index.
    const rawObjects = items.map((it, i) => ({
      rank: i + 1,
      code: it.code ?? '',
      title: it.title ?? '',
      qty: Number(it.qty || 0),
      orders: Number(it.orders || 0),
      revenue: Number(it.revenue || 0),
      qtySharePct: Number(it.qtyShare || 0) * 100,
      period: rangeLabel,
      warehouse: warehouseLabel,
    }));
    const rows = items.map((it, i) => [
      i + 1,
      cell(it.code || '—'),
      cell(it.title || '—'),
      Number(it.qty || 0),
      Number(it.orders || 0),
      Number(it.revenue || 0),
      (Number(it.qtyShare || 0) * 100).toFixed(2),
      cell(rangeLabel),
      cell(warehouseLabel),
    ]);
    const baseCsv = [CSV_HEADERS.join(','), ...rows.map((x) => x.join(','))].join('\r\n');
    const watermarked = appendExportWatermark(baseCsv, rawObjects, {
      actorId,
      actorRole: currentRole,
      reportName: `SÁCH BÁN CHẠY NHẤT — ${rangeLabel} — ${warehouseLabel}`,
      fiscalScope: 'ALL',
    });
    const blob = new Blob(['\uFEFF' + watermarked], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Sach_Ban_Chay_${csvRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            Sách Bán Chạy Nhất
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Kỳ {rangeLabel} • {warehouseLabel} • Tổng{' '}
            {totals.totalQty.toLocaleString('vi-VN')} cuốn / {totals.totalRevenue.toLocaleString('vi-VN')} đ
          </p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            Đã tặng {totals.totalGiftQty.toLocaleString('vi-VN')} cuốn trong kỳ này (không tính vào bảng bán chạy)
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Số liệu theo đúng bộ lọc của bảng trên: kho, ngày.
            {sortKey !== 'qty' ? ` Đang xếp theo cột đã chọn trong ${sortedItems.length} dòng đã tải.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor="top-editions-n" className="text-[11px] font-bold text-slate-500">
            Số dòng
          </label>
          <select
            id="top-editions-n"
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="bg-slate-50 border border-slate-300 text-xs font-bold rounded-xl px-2.5 py-1.5 outline-none cursor-pointer"
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100 (tối đa)</option>
          </select>
          <button
            onClick={() => fetchTop()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </button>
          <button
            onClick={exportCsv}
            disabled={!actorId}
            title={actorId ? 'Xuất báo cáo sách bán chạy' : 'Chưa đọc được người đăng nhập — tải lại trang'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất Excel/CSV
          </button>
          {onPickProduct && (
            <button
              onClick={() => onPickProduct(null)}
              title="Mở Nhịp Bán: xem từng thời điểm bán ra của 1 món trong kỳ"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Nhịp Bán
            </button>
          )}
        </div>
      </div>

      <TableExpandOverlay title="Sách bán chạy nhất" onExport={exportCsv} exportLabel="Xuất Excel/CSV">
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-slate-100 rounded-xl table-scroll">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100 sticky top-0 z-10">
            <tr>
              <th className="p-3 w-12">#</th>
              <th className="p-3">Đầu sách</th>
              <SortableTh label="SL bán" sortKey="qty" activeKey={sortKey} activeDir={sortDir} onToggle={(k) => toggleSort(k, 'desc')} align="right" />
              <SortableTh label="Số đơn" sortKey="orders" activeKey={sortKey} activeDir={sortDir} onToggle={(k) => toggleSort(k, 'desc')} align="right" />
              <SortableTh label="Doanh thu" sortKey="revenue" activeKey={sortKey} activeDir={sortDir} onToggle={(k) => toggleSort(k, 'desc')} align="right" />
              <th className="p-3 w-40">Tỷ trọng SL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loadError ? (
              <tr>
                <td colSpan={6} className="p-8 text-center">
                  <p className="text-rose-700 font-medium">{loadError}</p>
                  <button
                    onClick={() => fetchTop()}
                    disabled={loading}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition disabled:opacity-50"
                  >
                    Thử lại
                  </button>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  {loading ? 'Đang tải số liệu...' : 'Chưa phát sinh đơn bán trong kỳ này.'}
                </td>
              </tr>
            ) : (
              sortedItems.map((it, i) => {
                const pid = it.productId || it.editionId;
                return (
                <tr key={it.editionId || `${it.code}-${i}`} className="hover:bg-slate-50/80">
                  <td className="p-3 font-black text-slate-400 font-mono">{i + 1}</td>
                  <td className="p-3">
                    {onPickProduct && pid ? (
                      <button
                        type="button"
                        onClick={() => pid && onPickProduct(pid)}
                        title="Mở Nhịp Bán của món này"
                        className="text-left hover:underline cursor-pointer"
                      >
                        <span className="font-mono font-bold text-indigo-700">{it.code || '—'}</span>
                        <span className="text-slate-600"> — {it.title || '—'}</span>
                      </button>
                    ) : (
                      <>
                        <span className="font-mono font-bold text-indigo-700">{it.code || '—'}</span>
                        <span className="text-slate-600"> — {it.title || '—'}</span>
                      </>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono font-bold">{Number(it.qty || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 text-right font-mono">{Number(it.orders || 0).toLocaleString('vi-VN')}</td>
                  <td className="p-3 text-right font-mono font-bold text-emerald-700">{Number(it.revenue || 0).toLocaleString('vi-VN')} đ</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.round(Number(it.qtyShare || 0) * 100)}%` }} />
                      </div>
                      <span className="font-mono font-bold text-slate-800 w-12 text-right">{(Number(it.qtyShare || 0) * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      </TableExpandOverlay>
    </div>
  );
}
