'use client';

import { Megaphone } from 'lucide-react';
import { fmtCompactVnd, shiftVnDay, vnBusinessDay } from '@/lib/vn-time';

/** Nhãn tiếng Việt có dấu cho kênh bán. Kênh lạ sẽ in nguyên giá trị thay vì ném lỗi. */
const CHANNEL_LABELS: Record<string, string> = {
  FAIR_EVENT: 'Hội chợ',
  RETAIL_OFFICE: 'Quầy văn phòng',
  WHOLESALE_PARTNER: 'Đại lý sỉ',
  ONLINE: 'Online',
  SPONSORSHIP: 'Tài trợ',
};

/** Bảng màu phân bố theo thứ tự ưu tiên; vượt quá số màu thì quay vòng về đầu. */
const PALETTE = ['bg-indigo-600', 'bg-amber-500', 'bg-emerald-600', 'bg-rose-500', 'bg-slate-400'];

/**
 * Khoá ngày nghiệp vụ VN của 7 ngày gần nhất — ĐÚNG cửa sổ với biểu đồ doanh thu 7 ngày.
 * Dùng `vnBusinessDay` + `shiftVnDay` để không lệch 7 tiếng với ngày người đọc.
 */
function recentDayKeys(now: Date = new Date()): Set<string> {
  const today = vnBusinessDay(now);
  const keys = new Set<string>();
  if (!today) return keys;
  for (let i = 0; i < 7; i++) keys.add(shiftVnDay(today, -i));
  return keys;
}

interface ChannelRow {
  key: string;
  label: string;
  orders: number;
  money: number;
  moneyPct: number;
  orderPct: number;
}

function buildRows(orders: any[], now: Date = new Date()): ChannelRow[] {
  const window7 = recentDayKeys(now);
  const acc = new Map<string, { orders: number; money: number }>();
  for (const o of orders as any[]) {
    // Bỏ đơn nằm ngoài 7 ngày để hai thẻ (kênh bán / thanh toán) cùng nói một câu chuyện.
    if (!window7.has(vnBusinessDay(o?.createdAt) || '')) continue;
    const key = String(o?.channel ?? 'UNKNOWN');
    const cur = acc.get(key) || { orders: 0, money: 0 };
    cur.orders += 1;
    cur.money += Number(o?.finalAmount || 0);
    acc.set(key, cur);
  }
  const totalOrders = Array.from(acc.values()).reduce((s, v) => s + v.orders, 0);
  const totalMoney = Array.from(acc.values()).reduce((s, v) => s + v.money, 0);
  return Array.from(acc.entries())
    .map(([key, v]) => ({
      key,
      label: CHANNEL_LABELS[key] || key,
      orders: v.orders,
      money: v.money,
      moneyPct: totalMoney > 0 ? Math.round((v.money / totalMoney) * 100) : 0,
      orderPct: totalOrders > 0 ? Math.round((v.orders / totalOrders) * 100) : 0,
    }))
    .sort((a, b) => b.money - a.money);
}

/**
 * Nhận xét chân thẻ — CHỈ dùng số đã tính ở trên, không bịa thêm số liệu nào.
 */
function footnote(rows: ChannelRow[], totalOrders: number): string {
  if (rows.length === 0) return '';
  const top = rows[0];
  if (rows.length === 1) {
    return `${top.label} là kênh duy nhất: ${top.orders} đơn · ${fmtCompactVnd(top.money)} đ.`;
  }
  return `${top.label} dẫn đầu: ${fmtCompactVnd(top.money)} đ (${top.moneyPct}% tiền) nhưng chỉ ${top.orderPct}% đơn trong ${totalOrders} đơn.`;
}

export function ChannelMixCard({ orders, className = '' }: { orders: any[]; className?: string }) {
  const list = Array.isArray(orders) ? orders : [];
  const rows = buildRows(list);
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
  const maxMoney = Math.max(1, ...rows.map((r) => r.money));
  const colorOf = (i: number) => PALETTE[i % PALETTE.length];

  return (
    <div
      className={`rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 hover:shadow-md transition-shadow ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Megaphone className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            Cơ cấu kênh bán
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Thanh dài theo tiền, 7 ngày qua
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center">
          <Megaphone className="w-6 h-6 mx-auto text-slate-300" aria-hidden="true" />
          <p className="text-xs text-slate-400 mt-2">Chưa có đơn nào trong 7 ngày qua.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Mở Quầy POS và chốt một đơn, thẻ này sẽ tự cập nhật.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-2.5">
            {rows.map((r, i) => (
              <div key={r.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${colorOf(i)}`} aria-hidden="true" />
                    <span className="text-xs font-semibold text-slate-700 truncate">{r.label}</span>
                  </span>
                  <span
                    className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0"
                    title={`${r.money.toLocaleString('vi-VN')} đ`}
                  >
                    {r.orders} đơn · {fmtCompactVnd(r.money)} đ · {r.moneyPct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${colorOf(i)}`}
                    style={{ width: `${Math.max(2, Math.round((r.money / maxMoney) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
            {footnote(rows, totalOrders)}
          </p>
        </>
      )}
    </div>
  );
}