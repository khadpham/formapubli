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
  baseline,
  currentHour,
  hideHeader = false,
  className = '',
}: {
  rows: HourlyBucket[];
  startHour: number;
  endHour: number;
  /**
   * Số đơn BÌNH QUÂN của các ngày trước, index = giờ 0..23; `null` = giờ đó
   * không có dữ liệu để so ⇒ không vẽ. Không truyền ⇒ không vẽ gì thêm, giữ
   * nguyên hành vi cũ cho báo cáo chốt ngày.
   */
  baseline?: Array<number | null>;
  /**
   * Giờ hiện tại 0..23. Giờ LỚN HƠN ⇒ "chưa tới": chỉ vẽ khung đứt, không tô màu,
   * không ghi số 0 — vì 0 ở đó là "chưa bán", khác hẳn 0 ở giờ đã qua là "hết giờ
   * mà không ai mua". Không truyền ⇒ không phân biệt, mọi giờ coi như đã qua.
   */
  currentHour?: number | null;
  /**
   * Giấu khối tiêu đề bên trong. Thẻ bọc (`HourlyTodayCard` trên bảng quản trị)
   * đã có tiêu đề riêng kèm chú giải về đường TB và khung "chưa tới" — để cả hai
   * cùng hiện thì thẻ có hai tiêu đề chồng nhau. Không truyền ⇒ giữ nguyên, báo
   * cáo chốt ngày không đổi.
   */
  hideHeader?: boolean;
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

    // Đường TB các ngày trước, theo đúng thứ tự cột đang vẽ. `-1` = giờ đó không
    // có số để so (`null` trong `baseline`) — giữ lỗ hổng thay vì điền 0, vì 0
    // là một con số thật (không ai mua ở giờ đó), điền 0 sẽ kéo đường xuống sát
    // đáy rồi bịa ra "giờ đó không bán được" trong khi dữ liệu chỉ thiếu.
    const baseValues: number[] = list.map((r) => {
      const raw = Array.isArray(baseline) ? baseline[r.hour] : null;
      const v = raw == null ? null : Number(raw);
      return v != null && Number.isFinite(v) && v > 0 ? v : -1;
    });

    // Trần trục Y phải chứa cả đường TB: một ngày đông hơn mức TB nhiều (ví dụ
    // 4 đơn so TB 6) mà trục chỉ kéo tới 4 thì đường TB vẽ ra ngoài khung.
    const baseMax = baseValues.reduce((m, v) => Math.max(m, v), 0);
    const yMax = niceCeil(Math.max(maxOrders, baseMax));
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

    // Số giờ THỰC SỰ bán hàng — mẫu số cho "tiền bình quân mỗi giờ". Cố ý KHÔNG
    // chia cho `list.length`: khung giờ luôn kéo từ giờ mở cửa tới giờ chốt ca
    // nên có cả giờ nghỉ trưa không ai mua. Chia 14 giờ (8h–21h) trong khi chỉ
    // 10 giờ bán được ra con số nhỏ giả tỉnh, đọc dễ tưởng buổi nghỉ cũng bán
    // nhiều. Mẫu số phải là số giờ CÓ ĐƠN thì "bình quân" mới là con số so
    // sánh được giữa các ca và các quầy.
    const openHours = list.filter((r) => r.orders > 0).length;
    const salesPerOpenHour = openHours > 0 ? Math.round(totalSales / openHours) : 0;

    const n = Math.max(1, list.length);
    const slot = PLOT_W / n;
    const barW = Math.max(5, Math.min(34, slot * 0.6));
    // Nhãn giờ mỗi `labelStep` giờ một nhãn để không chồng lên nhau khi khung 24h.
    const labelStep = Math.max(1, Math.ceil(n / 15));

    // Cắt đường thành từng đoạn LIÊN TỤC có số. Một `<polyline>` duy nhất bỏ
    // luôn các giờ trống sẽ nối thẳng từ giờ có dữ liệu sang giờ có dữ liệu
    // kế tiếp, tạo ra một đoạn thẳng đi xuyên qua giờ không có dữ liệu.
    const baselineRuns: Array<Array<{ x: number; y: number }>> = [];
    let run: Array<{ x: number; y: number }> = [];
    baseValues.forEach((v, i) => {
      if (v < 0) {
        if (run.length) baselineRuns.push(run);
        run = [];
        return;
      }
      run.push({
        x: PAD_L + i * slot + slot / 2,
        y: BASE_Y - (v / yMax) * PLOT_H,
      });
    });
    if (run.length) baselineRuns.push(run);

    return {
list, totalOrders, maxOrders, yMax, peak, quiet,
      openHours, salesPerOpenHour, slot, barW, labelStep,
      baselineRuns,
      baselineTotal: baseValues.reduce((s, v) => s + Math.max(0, v), 0),
    };
  }, [rows, baseline]);

  const {
    list, totalOrders, maxOrders, yMax, peak, quiet,
    openHours, salesPerOpenHour, slot, barW, labelStep,
    baselineRuns, baselineTotal,
  } = model;

  const hasBaseline = baselineRuns.length > 0;

  const activeHour = hover ?? locked ?? peak?.hour ?? null;
  const active = activeHour == null ? null : list.find((r) => r.hour === activeHour) ?? null;

  const money = (n: number) => n.toLocaleString('vi-VN');
  // TB là số thập phân ⇒ ép tối đa 1 chữ số sau dấu phẩy để không in "12,333333".
  const money1 = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  const hourLabel = (h: number) => `${h}h`;
  const rangeLabel = `${startHour}h–${endHour}h`;
  const nowHour = typeof currentHour === 'number' && Number.isFinite(currentHour) ? currentHour : null;

  // Chỉ mở trạng thái rỗng khi KHÔNG có gì để vẽ. Có đường TB mà bỏ trống thì
  // mất đúng thứ người xem cần: hôm nay chưa bán được gì so với mức thường ngày.
  if (!list.length || (totalOrders === 0 && !hasBaseline)) {
    return (
      <div className={`bg-white rounded-2xl border border-slate-200 p-5 ${className}`}>
        <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-indigo-600" />
          Đơn Theo Giờ
        </h4>
        <p className="mt-4 text-xs text-slate-500 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-300" />
          Ngày này chưa có đơn nào để vẽ biểu đồ.
        </p>
      </div>
    );
  }

  // Cùng mẫu số với ô tiền bên dưới: số giờ THỰC SỰ CÓ ĐƠN. Chia `list.length`
  // (độ dài khung giờ) làm bình quân đơn luôn thấp hơn thực tế, vì khung kéo từ
  // giờ mở cửa tới giờ chốt ca nên có cả giờ nghỉ trưa không ai mua.
  const avgPerHour = openHours > 0 ? totalOrders / openHours : 0;
  const peakShare = peak && peak.orders > 0 ? Math.round((peak.orders / totalOrders) * 100) : 0;

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 space-y-4 ${className}`}>
      {/* Đầu: tiêu đề + khung giờ đang xét. `hideHeader` chỉ giấu TIÊU ĐỀ, vẫn
          giữ ô "Tổng N đơn" — thẻ bọc không có ô đó. */}
      <div className={`flex items-start justify-between gap-3 ${hideHeader ? '' : ''}`}>
        {hideHeader ? (
          <span className="sr-only">
            Đơn Theo Giờ · {rangeLabel} · giờ Việt Nam
          </span>
        ) : (
          <div>
            <h4 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              Đơn Theo Giờ
            </h4>
            <p className="text-[11px] text-slate-400 mt-1">
              Số đơn mỗi giờ · {rangeLabel} · giờ Việt Nam
            </p>
          </div>
        )}
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
        {/* Ô số này KHÔNG lặp lại tổng doanh thu (đã có ở KPI "Thực thu" phía
            trên và ở bản in) — lặp lại chỉ tốn chỗ. Thay bằng TIỀN BÌNH QUÂN
            MỘT GIỜ BÁN, chia cho số giờ THỰC SỰ CÓ ĐƠN (xem `openHours`). */}
        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl px-3 py-2">
          <p className="text-[10px] font-bold text-emerald-700">Doanh thu mỗi giờ bán</p>
          <p className="text-sm font-black font-mono text-emerald-800 mt-0.5 break-words leading-tight">
            {money(salesPerOpenHour)}
            <span className="text-[10px] font-bold ml-0.5">đ</span>
          </p>
          {/* Nói rõ mẫu số, không thì "bình quân" bị đọc nhầm là chia hết khung giờ
              — mà khung giờ luôn kéo từ giờ mở cửa tới giờ chốt ca, có cả giờ
              nghỉ trưa không ai mua. */}
          <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
            {openHours} giờ có đơn
          </p>
        </div>
      </div>

      {/* Biểu đồ cột */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Biểu đồ số đơn theo từng giờ từ ${startHour}h đến ${endHour}h giờ Việt Nam. Giờ cao điểm ${peak?.hour ?? 0}h với ${peak?.orders ?? 0} đơn.${hasBaseline ? ` Đường nét đứt là số đơn bình quân của các ngày trước, tổng ${money1(baselineTotal)} đơn trong khung giờ này.` : ''}${nowHour != null ? ` Các giờ sau ${nowHour}h là chưa tới.` : ''}`}
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
          // "Chưa tới": giờ chưa tới nắm. Giờ đã qua không có đơn vẫn giữ vạch
          // xám 2px như cũ — đó là "đã bán 0", khác hẳn "chưa bán được gì".
          const isFuture = nowHour != null && r.hour > nowHour;
          const isNow = nowHour != null && r.hour === nowHour;
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
              {/* Khung đứt của giờ chưa tới: chỉ viền, không tô, không ghi số 0 —
                  người xem phải hiểu đây là "chưa có dữ liệu", không phải "bán 0". */}
              {isFuture ? (
                <rect
                  x={x}
                  y={PAD_T}
                  width={barW}
                  height={PLOT_H}
                  rx={Math.min(4, barW / 2)}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  pointerEvents="none"
                />
              ) : null}
              {r.orders > 0 ? (
                <rect
                  x={x}
                  y={BASE_Y - barH}
                  width={barW}
                  height={barH}
                  rx={Math.min(4, barW / 2)}
                  fill={isActive ? '#4338ca' : isPeak ? '#f59e0b' : '#6366f1'}
                  stroke={isActive || isNow ? '#4338ca' : isPeak ? '#b45309' : 'none'}
                  strokeWidth={isActive || isNow ? 1.5 : isPeak ? 1 : 0}
                  pointerEvents="none"
                />
              ) : (
                <rect
                  x={x}
                  y={BASE_Y - 2}
                  width={barW}
                  height={2}
                  rx={1}
                  fill={isNow ? '#4338ca' : '#e2e8f0'}
                  pointerEvents="none"
                />
              )}
              {r.orders > 0 && !isFuture && (
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
                  fill={isActive ? '#4338ca' : isFuture ? '#cbd5e1' : '#94a3b8'}
                  pointerEvents="none"
                >
                  {hourLabel(r.hour)}
                </text>
              )}
            </g>
          );
        })}

        {/* Đường TB các ngày trước — vẽ SAU (trên mặt) các cột, không vẽ trước:
            cột cao hơn sẽ che mất đoạn đường, mà đường mới là đường cần đọc. */}
        {baselineRuns.map((run, ri) => (
          <polyline
            key={`baseline-${ri}`}
            points={run.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        ))}


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
        {/* Chú giải + đối chiếu. Chỉ hiện khi THỰC SỰ có đường TB: một đường nét
            đứt không có nhãn thì người xạ tưởng là lỗi vẽ. */}
        {hasBaseline ? (
          <>
            <span className="inline-flex items-center gap-1 text-slate-500">
              <svg width="18" height="6" aria-hidden="true" className="shrink-0">
                <line x1="0" y1="3" x2="18" y2="3" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 3" />
              </svg>
              TB các ngày trước
            </span>
            <span className="text-slate-600">
              Hôm nay: <strong className="font-bold font-mono text-slate-800">{totalOrders}</strong> đơn · TB:{' '}
              <strong className="font-bold font-mono text-slate-800">{money1(baselineTotal)}</strong> đơn
              <strong
                className="font-bold font-mono ml-1"
                style={{ color: totalOrders - baselineTotal >= 0 ? '#059669' : '#e11d48' }}
              >
                {totalOrders - baselineTotal >= 0 ? '+' : '-'}
                {money1(Math.abs(totalOrders - baselineTotal))}
              </strong>
            </span>
          </>
        ) : null}
      </div>

      {/* Nhận xét đọc được ngay: cao điểm chiếm bao nhiêu, giờ nào vắng */}
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {totalOrders === 0 ? (
          <>
            Hôm nay chưa có đơn nào
            {hasBaseline ? '. Đường nét đứt là mức bình quân các ngày trước.' : '.'}
          </>
        ) : null}
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