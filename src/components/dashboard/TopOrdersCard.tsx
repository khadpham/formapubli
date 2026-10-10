'use client';

import React from 'react';
import { Receipt } from 'lucide-react';

/**
 * Nâng cấp thẻ "Top 10 đơn giá trị cao" cũ (ExecutiveDashboard dòng 767-791):
 * thêm số cuốn mỗi đơn để người đọc biết đơn đắt vì nhiều cuốn hay vì một món
 * đắt - trước đó chỉ có mã đơn + tiền, không đủ để hành động.
 */
export function TopOrdersCard({
  orders,
  className = '',
  onSelectOrder,
}: {
  orders: any[];
  className?: string;
  onSelectOrder?: (orderId: string) => void;
}) {
  const top = React.useMemo(
    () =>
      [...(orders || [])]
        .sort((a, b) => Number(b.finalAmount || 0) - Number(a.finalAmount || 0))
        .slice(0, 10),
    [orders]
  );

  const maxAmount = Math.max(1, ...top.map((o: any) => Number(o.finalAmount || 0)));

  return (
    <div
      className={`rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 hover:shadow-md transition-shadow ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Receipt className="w-4 h-4 text-amber-500" />
            Top 10 đơn giá trị cao
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Thanh ngang theo thực thu {onSelectOrder ? '(bấm mã đơn để xem chi tiết)' : 'kèm số cuốn trong đơn'}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2 min-h-[132px]">
        {top.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <Receipt className="w-6 h-6 text-slate-300" />
            <p className="text-xs text-slate-400 mt-1.5">
              Chưa có đơn nào đã chốt.
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Mở POS tạo đơn đầu tiên để thẻ này có số liệu.
            </p>
          </div>
        ) : (
          top.map((o: any, i: number) => {
            const amount = Number(o.finalAmount || 0);
            // Đơn cũ hoặc API chưa trả 3 trường mới -> undefined. Number(undefined
            // || 0) = 0 an toàn, nhưng phải chặn NaN từ chuỗi rác ở tầng API.
            const qty = toCount(o.itemQty);
            const lines = toCount(o.itemLines);
            const giftQty = toCount(o.giftQty);
            // Chỉ hiện "N cuốn" khi đơn thực sự có dòng hàng; đơn 0 dòng thì con số
            // 0 chỉ gây nhiễu, và "0 cuốn" dễ bị đọc nhầm là đơn lỗi.
            const parts: string[] = [];
            if (lines > 0) parts.push(`${qty.toLocaleString('vi-VN')} cuốn`);
            if (giftQty > 0)
              parts.push(`${giftQty.toLocaleString('vi-VN')} cuốn quà`);
            const pct = Math.max(4, Math.round((amount / maxAmount) * 100));
            const orderId = o.id ? String(o.id) : null;

            return (
              <div key={String(o.id ?? i)}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  {onSelectOrder && orderId ? (
                    <button
                      type="button"
                      onClick={() => onSelectOrder(orderId)}
                      className="font-mono font-bold text-indigo-700 hover:text-indigo-900 hover:underline cursor-pointer truncate text-left flex items-center gap-1 group transition-colors"
                      title={`Bấm để xem chi tiết đơn ${String(o.orderCode || '')}`}
                    >
                      <span className="truncate group-hover:underline">
                        {String(o.orderCode || '-')}
                      </span>
                      {parts.length > 0 && (
                        <span className="font-sans font-normal text-slate-500 shrink-0">
                          {' '}
                          · {parts.join(', ')}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="font-mono font-bold text-indigo-700 truncate">
                      {String(o.orderCode || '-')}
                      {parts.length > 0 && (
                        <span className="font-sans font-normal text-slate-500">
                          {' '}
                          · {parts.join(', ')}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="font-mono tabular-nums text-slate-600 shrink-0">
                    {amount.toLocaleString('vi-VN')} đ
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`Đơn ${String(o.orderCode || '')}: ${amount.toLocaleString('vi-VN')} đồng`}
                  className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Đếm an toàn: null/undefined/rác -> 0, không bao giờ NaN (NaN làm vỡ toLocaleString). */
function toCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}