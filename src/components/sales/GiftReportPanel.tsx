'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Gift, RefreshCw } from 'lucide-react';
import { UserRole } from '@/lib/roles';

interface GiftReportPanelProps {
  currentRole: UserRole;
  /** Ngày nghiệp vụ VN 'YYYY-MM-DD' từ tab; rỗng = không lọc ngày. */
  from: string;
  to: string;
}

/** Một dòng của `GiftReportService.summary` (Task 2 đã khóa shape). */
interface GiftRow {
  productId: string;
  /** Có thể null: dòng quà gắn product đã xoá khỏi danh mục. */
  productName: string | null;
  /** Số DÒNG quà của sản phẩm này (khác tổng số phần). */
  lineCount: number;
  totalQty: number;
}

const ROLE_CAN_VIEW = ['ROLE_OWNER', 'ROLE_MANAGER'];

export function GiftReportPanel({ currentRole, from, to }: GiftReportPanelProps) {
  // Server chỉ cho OWNER/MANAGER. Trước đây panel vẫn gọi API với mọi vai nên
  // thu ngân/kế toán thuế thấy HỘP ĐỎ 403 — thông báo lỗi cho người không có
  // quyền xem là vô nghĩa. Ẩn hẳn thay vì báo lỗi.
  const canView = ROLE_CAN_VIEW.includes(currentRole);
  const [inStock, setInStock] = useState<GiftRow[]>([]);
  const [shortfall, setShortfall] = useState<GiftRow[]>([]);
  const [totalDelivered, setTotalDelivered] = useState(0);
  const [totalShortfall, setTotalShortfall] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const fetchGifts = useCallback(async () => {
    if (!canView) return;
    // Bấm preset ngày liên tiếp thì response cũ vẫn bay về và ghi đè số của kỳ
    // trước. Huỷ request trước đó thay vì so timestamp (cùng mẫu Top/Revenue).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      // from/to = bộ lọc NGÀY của tab Doanh Số (không gửi 'ALL'/chuỗi rỗng:
      // server hiểu null = không lọc ngày).
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const res = await fetch(`/api/reports/gifts${qs ? `?${qs}` : ''}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !json?.success) {
        // Số cũ thuộc KỲ CŨ: giữ nó cạnh nhãn kỳ mới là nói dối. Xoá luôn.
        setInStock([]);
        setShortfall([]);
        setTotalDelivered(0);
        setTotalShortfall(0);
        setError(json?.error || 'Máy chủ không phản hồi đúng.');
        return;
      }
      setInStock(Array.isArray(json.inStock) ? json.inStock : []);
      setShortfall(Array.isArray(json.shortfall) ? json.shortfall : []);
      setTotalDelivered(Number(json.totalDelivered || 0));
      setTotalShortfall(Number(json.totalShortfall || 0));
    } catch {
      if (controller.signal.aborted) return;
      setInStock([]);
      setShortfall([]);
      setTotalDelivered(0);
      setTotalShortfall(0);
      setError('Lỗi kết nối.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, from, to]);

  useEffect(() => {
    fetchGifts();
    return () => abortRef.current?.abort();
  }, [fetchGifts]);

  if (!canView) return null;

  const rangeLabel = from || to ? `${from || 'đầu kỳ'} → ${to || 'nay'}` : 'toàn bộ thời gian';

  const renderRows = (rows: GiftRow[], emptyText: string) =>
    rows.length === 0 ? (
      <p className="text-slate-400">{emptyText}</p>
    ) : (
      rows.map((r) => (
        <p key={r.productId} className="text-slate-700 flex items-baseline justify-between gap-2 py-0.5">
          <span>
            {r.productName || '—'}
            <span className="text-[11px] text-slate-400"> • {Number(r.lineCount || 0)} dòng</span>
          </span>
          <b className="font-mono">{Number(r.totalQty || 0).toLocaleString('vi-VN')} phần</b>
        </p>
      ))
    );

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
            <Gift className="w-4 h-4 text-amber-600" />
            Quà Tặng — đã phát {totalDelivered.toLocaleString('vi-VN')} phần
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Hết tồn chưa phát: <b className={totalShortfall > 0 ? 'text-rose-700' : ''}>{totalShortfall.toLocaleString('vi-VN')} phần</b>{' '}
            • Kỳ {rangeLabel}
          </p>
        </div>
        <button
          onClick={() => fetchGifts()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Tải lại
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between gap-2">
          <p className="text-xs text-rose-800 font-semibold">{error}</p>
          <button
            onClick={() => fetchGifts()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition disabled:opacity-50 shrink-0"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Lỗi ⇒ KHÔNG vẽ "không có quà": lúc đó ta chưa biết là rỗng hay tải hỏng. */}
      {!error &&
        (loading && inStock.length === 0 && shortfall.length === 0 ? (
          <p className="text-xs text-slate-500">Đang tải báo cáo quà...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-bold text-emerald-700 mb-1">Quà đã phát (còn tồn)</p>
              {renderRows(inStock, 'Không có quà đã phát trong kỳ này.')}
            </div>
            <div>
              <p className="font-bold text-rose-700 mb-1">Quà hết tồn chưa phát</p>
              {renderRows(shortfall, 'Không có quà hết tồn trong kỳ này.')}
            </div>
          </div>
        ))}

      <p className="text-[11px] text-slate-400">
        Chỉ tính đơn hoàn tất, theo đúng khoảng ngày đang lọc ở bảng Doanh Số.
      </p>
    </div>
  );
}
