'use client';

import React from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import {
  dayLabelVn,
  fmtCompactVnd,
  shiftVnDay,
  vnBusinessDay,
} from '@/lib/vn-time';

/** Một cột của biểu đồ: đã gom sẵn theo ngày nghiệp vụ VN. */
interface DayBucket {
  key: string;
  label: string;
  weekday: string;
  revenue: number;
  qty: number;
  orders: number;
}

type Mode = 'revenue' | 'qty';

/** Bố cục SVG cố định — không đo bằng DOM nên không nhảy khi đổi số liệu. */
const W = 420;
const H = 196;
const PLOT_TOP = 26;
const PLOT_BOTTOM = 150;
const SLOT = (W - 16) / 7;
const BAR_W = 26;

function ddmm(key: string): string {
  const [, mm, dd] = key.split('-');
  return `${Number(dd)}/${Number(mm)}`;
}

/**
 * Gom 7 ngày nghiệp vụ VN gần nhất từ danh sách đơn.
 *
 * VÌ SAO không dùng `toISOString().slice(0,10)`: cột thời gian trong DB là UTC
 * còn người đọc đếm ngày theo giờ VN (+7). Bản ghi 06:30 sáng 10/3 có UTC là
 * 23:30 ngày 9/3 nên sẽ rơi nhầm sang cột hôm qua và cột "Hôm nay" hụt trọn
 * ca sáng. `vnBusinessDay` đọc đúng lịch Việt Nam cho cả hai kiểu chuỗi DB.
 * Đơn thiếu/hỏng `createdAt` bị bỏ qua thay vì làm hỏng cả biểu đồ.
 */
export function buildRevenue7Days(orders: any[], now: Date = new Date()): DayBucket[] {
  const today = vnBusinessDay(now);
  if (!today) return [];

  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const key = shiftVnDay(today, -i);
    days.push({ key, label: ddmm(key), weekday: dayLabelVn(key), revenue: 0, qty: 0, orders: 0 });
  }
  const map = new Map(days.map((d) => [d.key, d]));
  for (const o of orders as any[]) {
    const bucket = map.get(vnBusinessDay(o?.createdAt) || '');
    if (!bucket) continue;
    bucket.revenue += Number(o?.finalAmount || 0);
    bucket.qty += Number(o?.itemQty || 0);
    bucket.orders += 1;
  }
  return days;
}

export function Revenue7DaysChart({ orders, className = '' }: { orders: any[]; className?: string }) {
  const days = React.useMemo(() => buildRevenue7Days(orders), [orders]);
  const [mode, setMode] = React.useState<Mode>('revenue');
  const [hover, setHover] = React.useState<number | null>(null);
  const [pinned, setPinned] = React.useState<number | null>(null);

  const totalOrders = days.reduce((s, d) => s + d.orders, 0);

  if (days.length === 0 || totalOrders === 0) {
    return (
      <section
        className={`rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 hover:shadow-md transition-shadow ${className}`}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-indigo-500" aria-hidden="true" />
              Doanh thu 7 ngày
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Rê chuột vào từng cột để xem số chi tiết.</p>
          </div>
        </header>
        <div className="mt-6 flex flex-col items-center gap-2 py-6">
          <BarChart3 className="w-8 h-8 text-slate-300" aria-hidden="true" />
          <p className="text-xs text-slate-400">Chưa có đơn nào trong 7 ngày gần nhất.</p>
          <p className="text-xs text-slate-400">Mở Quầy POS và chốt một đơn để biểu đồ hiện số.</p>
        </div>
      </section>
    );
  }

  const valueOf = (d: DayBucket) => (mode === 'revenue' ? d.revenue : d.qty);
  const values = days.map(valueOf);
  const max = Math.max(1, ...values);
  const avg = values.reduce((s, v) => s + v, 0) / days.length;
  const maxIndex = values.indexOf(Math.max(...values));

  const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);
  const totalQty = days.reduce((s, d) => s + d.qty, 0);
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const y = (v: number) => PLOT_BOTTOM - (v / max) * (PLOT_BOTTOM - PLOT_TOP);
  const avgY = y(avg);

  const activeIndex = pinned ?? hover;
  const active = activeIndex == null ? null : days[activeIndex];

  const metricName = mode === 'revenue' ? 'doanh thu' : 'số cuốn';
  const topLabel = `${days[maxIndex].label}: ${
    mode === 'revenue'
      ? `${fmtCompactVnd(days[maxIndex].revenue)} đ`
      : `${days[maxIndex].qty} cuốn`
  }`;
  const ariaLabel =
    mode === 'revenue'
      ? `Biểu đồ cột doanh thu 7 ngày nghiệp vụ gần nhất. Cao nhất ${topLabel}. Tổng ${fmtCompactVnd(totalRevenue)} đ. Trung bình ${fmtCompactVnd(avg)} đ mỗi ngày.`
      : `Biểu đồ cột số cuốn bán 7 ngày nghiệp vụ gần nhất. Cao nhất ${topLabel}. Tổng ${totalQty} cuốn. Trung bình ${Math.round(avg)} cuốn mỗi ngày.`;

  const fmtTop = (v: number) => (mode === 'revenue' ? `${fmtCompactVnd(v)}đ` : String(v));

  const delta =
    activeIndex == null || activeIndex === 0 || !active
      ? null
      : {
          pct: (() => {
            const prev = valueOf(days[activeIndex - 1]);
            const cur = valueOf(active);
            if (prev <= 0) return null;
            return ((cur - prev) / prev) * 100;
          })(),
          prevLabel: days[activeIndex - 1].label,
        };

  return (
    <section
      className={`rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 hover:shadow-md transition-shadow ${className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-indigo-500" aria-hidden="true" />
            Doanh thu 7 ngày
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {mode === 'revenue'
              ? 'Cột cao nhất được tô màu. Rê chuột để xem chi tiết từng ngày.'
              : 'Đổi sang số cuốn để thấy lượng hàng thực bán ra.'}
          </p>
        </div>
        <div role="group" aria-label="Chọn số liệu hiển thị" className="inline-flex rounded-lg bg-slate-100 border border-slate-200 p-0.5 shrink-0">
          {(['revenue', 'qty'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              aria-label={m === 'revenue' ? 'Hiển thị theo doanh thu' : 'Hiển thị theo số cuốn'}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors focus-visible:ring-2 ring-indigo-500 ${
                mode === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {m === 'revenue' ? 'Doanh thu' : 'Số cuốn'}
            </button>
          ))}
        </div>
      </header>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto mt-3"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Đường trung bình 7 ngày — vẽ trước để cột đè lên, không che số trên cột. */}
        <line x1={8} y1={avgY} x2={W - 8} y2={avgY} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />
        <text
          x={W - 8}
          y={Math.max(10, avgY - 4)}
          textAnchor="end"
          fontSize={10}
          fill="#94a3b8"
          className="font-mono"
        >
          TB
        </text>

        {days.map((d, i) => {
          const v = valueOf(d);
          const cx = 8 + SLOT * i + SLOT / 2;
          const isToday = d.key === days[days.length - 1].key;
          const isMax = i === maxIndex && v > 0;
          const barH = v > 0 ? Math.max(3, PLOT_BOTTOM - y(v)) : 0;
          const barY = PLOT_BOTTOM - barH;
          const numY = Math.max(12, barY - 5);

          return (
            <g key={d.key}>
              {v > 0 ? (
                <>
                  <rect
                    x={cx - BAR_W / 2}
                    y={barY}
                    width={BAR_W}
                    height={barH}
                    rx={3}
                    fill={isMax ? '#f59e0b' : '#6366f1'}
                    opacity={isMax ? 0.95 : 0.9}
                    stroke={isToday ? '#4338ca' : 'none'}
                    strokeWidth={isToday ? 2 : 0}
                  />
                  <text
                    x={cx}
                    y={numY}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={isMax ? '#b45309' : '#334155'}
                    className="font-mono"
                  >
                    {fmtTop(v)}
                  </text>
                </>
              ) : (
                // Cột 0 đơn: vạch mảnh thay vì để trống, để người đọc biết ngày đó
                // có chỗ trong biểu đồ thay vì tưởng dữ liệu thiếu.
                <rect x={cx - 1} y={PLOT_BOTTOM - 2} width={2} height={2} fill="#e2e8f0" rx={1} />
              )}

              <text
                x={cx}
                y={165}
                textAnchor="middle"
                fontSize={10}
                fontWeight={isToday ? 700 : 500}
                fill={isToday ? '#4338ca' : '#64748b'}
                className="font-mono"
              >
                {isToday ? 'Hôm nay' : d.label}
              </text>
              <text x={cx} y={177} textAnchor="middle" fontSize={9} fill="#94a3b8" className="font-mono">
                {d.weekday}
              </text>

              <rect
                x={cx - SLOT / 2}
                y={0}
                width={SLOT}
                height={H}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`Ngày ${d.label}: ${d.orders.toLocaleString('vi-VN')} đơn, ${d.revenue.toLocaleString('vi-VN')} đ, ${d.qty} cuốn`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => setPinned((p) => (p === i ? null : i))}
                className="cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </g>
          );
        })}
      </svg>

      <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" aria-hidden="true" />
          Ngày thường
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" aria-hidden="true" />
          Cao nhất
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-0 border-t border-dashed border-slate-400 inline-block" aria-hidden="true" />
          Trung bình
        </span>
      </div>

      {/* Dải số chi tiết: hiện khi rê hoặc khi đã ghim một cột. */}
      <div className="mt-2 min-h-[52px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {active ? (
          <>
            <span className="text-xs font-black text-slate-900 font-mono">{active.label}</span>
            <span className="text-xs text-slate-600 font-mono">
              {active.revenue.toLocaleString('vi-VN')} đ
            </span>
            <span className="text-xs text-slate-600 font-mono">{active.qty} cuốn</span>
            <span className="text-xs text-slate-600 font-mono">{active.orders} đơn</span>
            {delta?.pct == null ? (
              <span className="text-xs text-slate-400">Không có ngày liền trước để so</span>
            ) : (
              <span
                className="text-xs font-bold font-mono"
                style={{ color: delta.pct >= 0 ? '#059669' : '#e11d48' }}
              >
                {delta.pct >= 0 ? '▲' : '▼'} {Math.abs(delta.pct).toFixed(1)}% {metricName} so với{' '}
                {delta.prevLabel}
              </span>
            )}
            {pinned != null && (
              <button
                type="button"
                onClick={() => setPinned(null)}
                className="ml-auto text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded-md focus-visible:ring-2 ring-indigo-500"
              >
                Bỏ ghim
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-slate-400 inline-flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
            Rê chuột hoặc bấm vào một cột để xem số chi tiết.
          </span>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2.5">
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <p className="text-[10px] font-bold text-slate-500">Tổng 7 ngày</p>
          <p className="text-sm font-black font-mono text-slate-900 tabular-nums">
            {fmtCompactVnd(totalRevenue)}đ
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <p className="text-[10px] font-bold text-slate-500">TB mỗi ngày</p>
          <p className="text-sm font-black font-mono text-slate-900 tabular-nums">
            {mode === 'revenue' ? `${fmtCompactVnd(avg)}đ` : `${Math.round(avg)} cuốn`}
          </p>
        </div>
        {totalOrders > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <p className="text-[10px] font-bold text-slate-500">TB mỗi đơn</p>
            <p className="text-sm font-black font-mono text-slate-900 tabular-nums">
              {fmtCompactVnd(aov)}đ
            </p>
          </div>
        )}
      </div>
    </section>
  );
}