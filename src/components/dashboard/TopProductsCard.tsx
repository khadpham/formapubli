'use client';

import React from 'react';
import { Package, RefreshCw } from 'lucide-react';

type TopProduct = {
  editionId?: string | null;
  code?: string | null;
  title?: string | null;
  qty?: number | null;
  revenue?: number | null;
};

/**
 * Thay ô donut Sổ Thuế/Nội bộ: bảng quản trị cần câu "khách mua gì nhiều nhất"
 * nhiều hơn câu "tiền thuế chia bao nhiêu" - donut bị bỏ và tiền của nó đã lên
 * thẻ Sổ kế toán khác.
 */
export function TopProductsCard({
  warehouseId,
  className = '',
}: {
  warehouseId?: string;
  className?: string;
}) {
  const [items, setItems] = React.useState<TopProduct[]>([]);
  const [totalGiftQty, setTotalGiftQty] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Mỗi lần bấm "Thử lại" tăng counter -> useEffect gọi lại fetch, không cần
  // nhét hàm vào dependency (hàm mới mỗi render sẽ fetch vô hạn).
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      view: 'top-editions',
      top: '10',
      excludeGifts: '1',
    });
    if (warehouseId) params.set('warehouseId', warehouseId);

    setLoading(true);
    setError(null);

    fetch(`/api/analytics?${params.toString()}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json?.success) {
          setError('Không tải được danh sách bản bán');
          return;
        }
        setItems(Array.isArray(json.data?.items) ? json.data.items : []);
        setTotalGiftQty(Number(json.data?.totalGiftQty || 0));
      })
      .catch(() => {
        if (!cancelled) setError('Không tải được danh sách bản bán');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [warehouseId, reloadKey]);

  // Chia theo số cuốn (không phải tiền) vì tiêu đề thẻ là "bán chạy" - một cuốn
  // rẻ bán 200 lượt vẫn là "bán chạy" hơn một cuốn đắt bán 3 lượt.
  const maxQty = Math.max(1, ...items.map((it) => Number(it.qty || 0)));

  return (
    <div
      className={`rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 hover:shadow-md transition-shadow ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Package className="w-4 h-4 text-indigo-500" />
            Top 10 bản bán chạy
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Thanh ngang theo số cuốn đã bán, không tính dòng quà tặng
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2.5 min-h-[132px]">
        {loading ? (
          <p className="text-[11px] text-slate-400">Đang tải…</p>
        ) : error ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              aria-label="Tải lại danh sách bản bán chạy"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-indigo-200 bg-indigo-50 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Thử lại
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <Package className="w-6 h-6 text-slate-300" />
            <p className="text-xs text-slate-400 mt-1.5">
              Chưa có dòng hàng nào được bán trong kỳ này.
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Mở POS và bán cuốn đầu tiên để thẻ này có số liệu.
            </p>
          </div>
        ) : (
          items.map((it, i) => {
            const qty = Number(it.qty || 0);
            const revenue = Number(it.revenue || 0);
            // API đã fallback '-' khi không có tên; ở đây chỉ chặn rỗng/null.
            const title = String(it.title || '-');
            const pct = Math.max(4, Math.round((qty / maxQty) * 100));
            return (
              <div key={String(it.editionId || i)}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    className="font-semibold text-slate-700 truncate"
                    title={title}
                  >
                    {title}
                  </span>
                  <span className="font-mono tabular-nums text-slate-600 shrink-0">
                    {qty.toLocaleString('vi-VN')} cuốn ·{' '}
                    {revenue.toLocaleString('vi-VN')} đ
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`${title}: ${qty.toLocaleString('vi-VN')} cuốn`}
                  className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {totalGiftQty > 0 && (
        <p className="text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-100">
          Kèm {totalGiftQty.toLocaleString('vi-VN')} cuốn quà tặng đã phát (không
          tính vào bán chạy)
        </p>
      )}
    </div>
  );
}