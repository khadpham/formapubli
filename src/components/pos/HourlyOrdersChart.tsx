'use client';

/**
 * BIỂU ĐỒ CỘT "SỐ ĐƠN THEO GIỜ" cho tab Doanh Số của báo cáo chốt ngày.
 *
 * Vì sao tự dựng SVG mà không dùng thư viện:
 * - Repo không cài sẵn chart lib nào (recharts/chart.js/victory… đều không có), thêm
 *   một cái chỉ để vẽ 24 cột là đánh đổi 200kB bundle cho một màn hình.
 * - `src/components/pos/DailyFairSettlementModal.tsx:1340` đã có dải giờ SVG in
 *   được trên A4 (Chrome không in màu nền CSS khi tắt "Background graphics").
 *   Dùng chung ngôn ngữ `<rect>`/`<text>` ⇒ in khỏi lo mất biểu đồ.
 *
 * Dữ liệu vào là `data.ordersByHour` — service ĐÃ gom sẵn 24 bucket theo giờ Việt
 * Nam (`daily-settlement.service.ts:355`), không query thêm.
 */
import React, { useMemo, useState } from 'react';
import { BarChart3, Flame, Clock, TrendingUp } from 'lucide-react';

/** Một giờ trong ngày: số đơn + tiền thu được, đã quy về giờ Việt Nam. */
export interface HourlyBucket {
  hour: number;
  orders?: number | null;
  sales?: number | null;
}

/** viewBox cố định nên co giãn tỉ lệ gần 1:1 với khung modal (max-w-4xl). */
const W = 720;
const H = 208;
const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 24;
const PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const BASE_Y = PAD_T + PLOT_H;

/**
 * Trần trục Y là số tròn thuận tiện (1/2/5×10ⁿ) để mốc lưới luôn là số dễ đọc,
 * không phải 7 hay 13 đơn.
 */
function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const mag = 10 ** Math.floor(Math.log10(n));
  const r = n / mag;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
  return step * mag;
}

export function HourlyOrdersChart({
  rows,
  startHour,
  endHour,
  className = '',
}: {
  rows: HourlyBucket[];
  startHour: number;
  endHour: number;
  className?: string;
}) {
  const [locked, setLocked] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const list = (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        hour: Number(r?.hour),
        orders: Math.max(0, Number(r?.orders || 0)),
        sales: Math.max(0, Number(r?.sales || 0)),
      }))
      .filter((r) => Number.isFinite(r.hour))
      .sort((a, b) => a.hour - b.hour);

    const totalOrders = list.reduce((s, r) => s + r.orders, 0);
    const totalSales = list.reduce((s, r) => s + r.sales, 0);
    const maxOrders = list.reduce((m, r) => Math.max(m, r.orders), 0);
    const yMax = niceCeil(maxOrders);
    // `peak` = giờ nhiều đơn nhất; luôn có mặt để dùng làm mốc khi chưa chọn giờ.
    const peak = list.reduce<HourlyBucket & { orders: number } | null>(
      (best, r) => (best == null || r.orders > best.orders ? r : best),
      null
    );
    // Giờ có đơn nhưng ít nhất — "giờ lãng phí", có ích khi xếp ca/tăng người.
    const quiet = list.filter((r) => r.orders > 0).reduce<typeof list[number] | null>(
      (best, r) => (best == null || r.orders < best.orders ? r : best),
      null
    );

    const n = Math.max(1, list.length);
    const slot = PLOT_W / n;
    const barW = Math.max(5, Math.min(34, slot * 0.6));
    // Nhãn giờ mỗi `labelStep` giờ một nhãn để không chồng lên nhau khi khung 24h.
    const labelStep = Math.max(1, Math.ceil(n / 15));

    return { list, totalOrders, totalSales, maxOrders, yMax, peak, quiet, slot, barW, labelStep };
  }, [rows]);

  const { list, totalOrders, totalSales, maxOrders, yMax, peak, quiet, slot, barW, labelStep } = model;

  const activeHour = hover ?? locked ?? peak?.hour ?? null;
  const active = activeHour == null ? null : list.find((r) => r.hour === activeHour) ?? null;

  const money = (n: number) => n.toLocaleString('vi-VN');
  const hourLabel = (h: number) => `${h}h`;
  const rangeLabel = `${startHour}h–${endHour}h`;

  if (!list.length || totalOrders === 0) {
    return (
      <div className={`bg-white rounded-2xl border border-slate-200 p-5 ${className}`}>
        <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-indigo-600" />
          Đơn Hàng Theo Giờ
        </h4>
        <p className="mt-4 text-xs text-slate-500 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-300" />
          Ngày này chưa có đơn nào để vẽ biểu đồ.
        </p>
      </div>
    );
  }

  const avgPerHour = totalOrders / list.length;
  const peakShare = peak && peak.orders > 0 ? Math.round((peak.orders / totalOrders) * 100) : 0;

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 space-y-4 ${className}`}>
      {/* Đầu: tiêu đề + khung giờ đang xét */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            Đơn Hàng Theo Giờ
          </h4>
          <p className="text-[11px] text-slate-400 mt-1">
            Số đơn mỗi giờ · {rangeLabel} · giờ Việt Nam
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
          Tổng {totalOrders} đơn
        </span>
      </div>

      {/* Ô số tóm tắt — đọc được ngay không cần nhìn biểu đồ */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl px-3 py-2">
          <p className="text-[10px] font-bold text-amber-700 flex items-center gap-1">
            <Flame className="w-3 h-3" /> Giờ cao điểm
          </p>
          <p className="text-sm font-black font-mono text-amber-800 mt-0.5">
            {peak ? hourLabel(peak.hour) : '—'}
            {peak && peak.orders > 0 ? (
              <span className="text-[10px] font-bold ml-1 text-amber-700">{peak.orders} đơn</span>
            ) : null}
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Bình quân
          </p>
          <p className="text-sm font-black font-mono text-slate-800 mt-0.5">
            {avgPerHour.toFixed(1)}
            <span className="text-[10px] font-bold ml-1 text-slate-500">đơn/giờ</span>
          </p>
        </div>
        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl px-3 py-2">
          <p className="text-[10px] font-bold text-emerald-700">Doanh thu theo giờ</p>
          <p className="text-sm font-black font-mono text-emerald-800 mt-0.5">
            {money(totalSales)}
            <span className="text-[10px] font-bold ml-0.5">đ</span>
          </p>
        </div>
      </div>

      {/* Biểu đồ cột */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Biểu đồ số đơn hàng theo từng giờ từ ${startHour}h đến ${endHour}h giờ Việt Nam. Giờ cao điểm ${peak?.hour ?? 0}h với ${peak?.orders ?? 0} đơn.`}
      >
        {/* Lưới ngang + nhãn trục Y. Đường 0 luôn kẻ đậm hơn: đó là mặt đất. */}
        {[0, 0.5, 1].map((f) => {
          const y = BASE_Y - PLOT_H * f;
          const v = Math.round(yMax * f);
          return (
            <g key={`grid-${f}`}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke={f === 0 ? '#cbd5e1' : '#e2e8f0'}
                strokeWidth={f === 0 ? 1.5 : 1}
                strokeDasharray={f === 0 ? undefined : '3 3'}
              />
              <text
                x={PAD_L - 6}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                fontWeight="600"
                fill="#94a3b8"
                fontFamily="monospace"
              >
                {v}
              </text>
            </g>
          );
        })}

        {list.map((r, i) => {
          const cx = PAD_L + i * slot + slot / 2;
          const x = cx - barW / 2;
          const isPeak = peak != null && r.hour === peak.hour && r.orders > 0;
          const isActive = r.hour === activeHour;
          const barH =
            r.orders > 0 ? Math.max(5, (r.orders / yMax) * PLOT_H) : 2;
          return (
            <g key={r.hour}>
              {/* Vùng bấm rộng = cả cột chiều cao: chạm chỗ trống phía trên cột vẫn
                  đọc được giờ đó, không bắt buộc trúng đúng thanh. */}
              <rect
                x={PAD_L + i * slot}
                y={PAD_T}
                width={slot}
                height={PLOT_H}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHover(r.hour)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setLocked((p) => (p === r.hour ? null : r.hour))}
              />
              {r.orders > 0 ? (
                <rect
                  x={x}
                  y={BASE_Y - barH}
                  width={barW}
                  height={barH}
                  rx={Math.min(4, barW / 2)}
                  fill={isActive ? '#4338ca' : isPeak ? '#f59e0b' : '#6366f1'}
                  stroke={isActive ? '#1e1b4b' : isPeak ? '#b45309' : 'none'}
                  strokeWidth={isActive ? 1.5 : isPeak ? 1 : 0}
                  pointerEvents="none"
                />
              ) : (
                <rect
                  x={x}
                  y={BASE_Y - 2}
                  width={barW}
                  height={2}
                  rx={1}
                  fill="#e2e8f0"
                  pointerEvents="none"
                />
              )}
              {r.orders > 0 && (
                <text
                  x={cx}
                  y={BASE_Y - barH - 5}
                  textAnchor="middle"
                  fontSize={isPeak ? '11' : '10'}
                  fontWeight="700"
                  fill={isActive ? '#1e1b4b' : '#475569'}
                  pointerEvents="none"
                >
                  {r.orders}
                </text>
              )}
              {i % labelStep === 0 && (
                <text
                  x={cx}
                  y={BASE_Y + 15}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight={isActive ? '800' : '500'}
                  fill={isActive ? '#4338ca' : '#94a3b8'}
                  pointerEvents="none"
                >
                  {hourLabel(r.hour)}
                </text>
              )}
            </g>
          );
        })}

        {/* Vạch nhắc giờ đang xem — đọc giá trị khi rê chuột/bấm ở dải số bên dưới */}
        {active && (
          <line
            x1={PAD_L + list.findIndex((r) => r.hour === active.hour) * slot + slot / 2}
            x2={PAD_L + list.findIndex((r) => r.hour === active.hour) * slot + slot / 2}
            y1={PAD_T - 6}
            y2={BASE_Y + 4}
            stroke="#4338ca"
            strokeWidth="1"
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        )}
      </svg>

      {/* Dải số giờ đang xem — thay cho tooltip bay (không tràn ra ngoài modal) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-[11px]">
        {active ? (
          <>
            <span className="font-black font-mono text-slate-900 text-sm">{hourLabel(active.hour)}</span>
            <span className="text-slate-600">
              <strong className="font-bold text-slate-800">{active.orders}</strong> đơn
            </span>
            <span className="text-slate-600">
              <strong className="font-bold text-slate-800">{money(active.sales)}</strong> đ
            </span>
            <span className="text-slate-600">
              chiếm{' '}
              <strong className="font-bold text-slate-800">
                {totalOrders > 0 ? Math.round((active.orders / totalOrders) * 100) : 0}%
              </strong>{' '}
              tổng đơn
            </span>
          </>
        ) : (
          <span className="text-slate-400">Rê chuột hoặc bấm vào một cột để xem chi tiết giờ đó.</span>
        )}
      </div>

      {/* Nhận xét đọc được ngay: cao điểm chiếm bao nhiêu, giờ nào vắng */}
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {peak && peak.orders > 0 ? (
          <>
            Giờ <strong className="font-bold text-slate-700">{hourLabel(peak.hour)}</strong> bán nhiều nhất (
            <strong className="font-bold text-slate-700">{peakShare}%</strong> tổng đơn)
            {quiet && quiet.hour !== peak.hour ? (
              <>
                {' · '}
                giờ vắng nhất là <strong className="font-bold text-slate-700">{hourLabel(quiet.hour)}</strong> (
                {quiet.orders} đơn)
              </>
            ) : null}
            .
          </>
        ) : null}
        {locked != null ? (
          <span className="text-indigo-600"> Đang Ghim giờ {hourLabel(locked)} — bấm lại để bỏ ghim.</span>
        ) : null}
      </p>
    </div>
  );
}