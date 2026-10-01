/**
 * RENDER THẬT biểu đồ ra HTML rồi đo — không chỉ đọc source.
 *
 * Suite `test-settlement-hourly-chart.ts` khóa source (có rect, có niceCeil…); suite
 * này khóa HÀNH VI: dựng SVG với dữ liệu giả rồi kiểm tra toạ độ thật. Mục đích bắt
 * được lỗi mà đọc source không thấy: cột cao vượt mặt đất, nhãn chồng lên nhau, cột
 * 0 đơn bị vẽ thành cột đầy, trần trục Y không bao giờ nhỏ hơn cột cao nhất.
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { HourlyOrdersChart, type HourlyBucket } from '../src/components/pos/HourlyOrdersChart';

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

/** viewBox của biểu đồ phải khớp hằng số trong component để đọc toạ độ. */
const W = 720;
const H = 208;
const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 24;
const PAD_B = 28;
const PLOT_H = H - PAD_T - PAD_B;
const BASE_Y = PAD_T + PLOT_H;

function build(rows: HourlyBucket[], startHour: number, endHour: number): string {
  return renderToStaticMarkup(
    React.createElement(HourlyOrdersChart, { rows, startHour, endHour })
  );
}

/** Các attr của mọi <rect> trong SVG, theo thứ tự phát sinh. */
function rects(html: string): { x: number; y: number; width: number; height: number; fill: string }[] {
  const out: { x: number; y: number; width: number; height: number; fill: string }[] = [];
  for (const m of Array.from(html.matchAll(/<rect([^>]*)>/g))) {
    const attrs = m[1];
    const num = (k: string) => {
      const r = new RegExp(`${k}="([\\d.]+)"`).exec(attrs);
      return r ? Number(r[1]) : NaN;
    };
    const f = /fill="([^"]+)"/.exec(attrs);
    out.push({ x: num('x'), y: num('y'), width: num('width'), height: num('height'), fill: f ? f[1] : '' });
  }
  return out;
}

// --- Bộ dữ liệu thật hơn: 14 giờ, đỉnh ở giữa, có giờ 0 đơn -------------------
const BAY: HourlyBucket[] = [
  { hour: 8, orders: 2, sales: 400_000 },
  { hour: 9, orders: 5, sales: 1_200_000 },
  { hour: 10, orders: 9, sales: 2_100_000 },
  { hour: 11, orders: 7, sales: 1_800_000 },
  { hour: 12, orders: 0, sales: 0 },
  { hour: 13, orders: 3, sales: 700_000 },
  { hour: 14, orders: 6, sales: 1_500_000 },
  { hour: 15, orders: 4, sales: 950_000 },
  { hour: 16, orders: 1, sales: 180_000 },
  { hour: 17, orders: 11, sales: 3_300_000 },
  { hour: 18, orders: 8, sales: 2_400_000 },
  { hour: 19, orders: 5, sales: 1_100_000 },
  { hour: 20, orders: 2, sales: 420_000 },
  { hour: 21, orders: 1, sales: 200_000 },
];
const html = build(BAY, 8, 21);

// --- 1. Cột cao nhất phải chạm đúng trần, không tràn khung -------------------
const bars = rects(html).filter((r) => r.fill !== 'transparent');
ok(bars.length === BAY.length, `phải vẽ đúng ${BAY.length} cột, thực tế ${bars.length}`);
const tallest = bars.reduce((a, b) => (b.height > a.height ? b : a));
ok(
  tallest.height <= PLOT_H,
  `cột cao nhất (${tallest.height}) không được vượt vùng vẽ (${PLOT_H})`
);
ok(
  tallest.y >= PAD_T - 1,
  `đỉnh cột cao nhất (y=${tallest.y}) không được chui lên trên vùng vẽ (${PAD_T})`
);
ok(
  bars.every((b) => b.y + b.height <= BASE_Y + 0.01),
  'mọi cột phải đứng trên mặt đất, không cột nào chui xuống dưới'
);

// --- 2. Cột 0 đơn phải là vạch mảnh, KHÔNG phải cột đầy ---------------------
const zeroBar = bars[4]; // giờ 12
ok(zeroBar.height <= 2, `giờ 0 đơn phải là vạch mảnh (≤2), thực tế ${zeroBar.height}`);
ok(zeroBar.fill === '#e2e8f0', 'giờ 0 đơn phải tô xám, không tô màu như cột có đơn');

// --- 3. Thứ tự chiều cao phải đúng số đơn ------------------------------------
const heights = bars.map((b) => b.height);
const expectPeakIdx = BAY.findIndex((r) => r.orders === 11);
ok(
  heights[expectPeakIdx] === Math.max(...heights),
  'cột cao nhất phải đúng là giờ nhiều đơn nhất (17h)'
);
ok(
  heights.indexOf(Math.max(...heights)) === expectPeakIdx,
  'phải đúng MỘT cột cao nhất, không lệch chỗ'
);

// --- 4. Trần trục Y là số tròn thuận tiện ----------------------------------
// 11 đơn → niceCeil = 20 ⇒ cột đỉnh chiếm 11/20 = 55% vùng vẽ.
ok(
  Math.abs(tallest.height - (11 / 20) * PLOT_H) < 0.6,
  `trần trục Y phải là mốc tròn (11 đơn → 20), thực tế cao ${tallest.height}`
);
const yLabels = Array.from(
  html.matchAll(/<text[^>]*text-anchor="end"[^>]*font-family="monospace"[^>]*>([^<]*)</g)
).map((m) => m[1]);
ok(
  yLabels.join(',') === '0,10,20',
  `trục Y phải có nhãn 0 / 10 / 20, thực tế ${yLabels.join(',')}`
);

// --- 5. Nhãn giờ không chồng nhau -------------------------------------------
const hourLabels = Array.from(
  html.matchAll(/<text[^>]*text-anchor="middle"[^>]*font-size="10"[^>]*>([0-9]+h)</g)
).map((m) => m[1]);
ok(hourLabels.length > 0, 'phải có nhãn giờ dưới trục');
ok(
  hourLabels.every((l) => /^[0-9]+h$/.test(l)),
  `nhãn giờ phải có dạng "8h", thực tế ${hourLabels.join(',')}`
);
const uniq = new Set(hourLabels);
ok(uniq.size === hourLabels.length, `nhãn giờ không được lặp: ${hourLabels.join(',')}`);
// 14 cột / 15 ⇒ labelStep = 1 ⇒ ra đủ 14 nhãn.
ok(hourLabels.length === 14, `14 cột thì phải ra 14 nhãn giờ, thực tế ${hourLabels.length}`);

// --- 6. Vùng bấm phủ trọn chiều cao để rê chỗ trống cũng ăn ------------------
const hits = rects(html).filter((r) => r.fill === 'transparent');
ok(
  hits.length === BAY.length,
  `mỗi cột phải có vùng bấm cao bằng cả vùng vẽ, thực tế ${hits.length}`
);
ok(
  hits.every((h) => h.height >= PLOT_H - 0.01),
  'vùng bấm phải phủ hết chiều cao vùng vẽ'
);

// --- 7. Ngày không có đơn: nói rõ, không vẽ cột nào --------------------------
const empty = build([{ hour: 8, orders: 0, sales: 0 }, { hour: 9, orders: 0, sales: 0 }], 8, 9);
ok(!/<rect/.test(empty), 'ngày 0 đơn không được vẽ cột nào');
ok(/chưa có đơn nào để vẽ biểu đồ/.test(empty), 'ngày 0 đơn phải nói rõ');
ok(!/NaN/.test(empty), 'không được lọt NaN lên UI khi tổng bằng 0');

// --- 8. Dữ liệu rác không làm sập biểu đồ ----------------------------------
const junk = build(
  [
    { hour: 8, orders: null, sales: null },
    { hour: 9, orders: -5, sales: -100 },
    { hour: 10, orders: 3, sales: 500 },
  ] as HourlyBucket[],
  8,
  10
);
ok(!/NaN/.test(junk), 'orders/sales null hoặc âm không được sinh NaN');
const junkBars = rects(junk).filter((r) => r.fill !== 'transparent');
ok(
  junkBars.every((b) => b.y + b.height <= BASE_Y + 0.01),
  'cột rác vẫn phải nằm trên mặt đất'
);

// --- 9. Khung 24 giờ: nhãn giờ phải tự giãn, không chồng ------------------------
const full = build(
  Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: h % 5, sales: h * 1000 })),
  0,
  23
);
const fullLabels = Array.from(
  full.matchAll(/<text[^>]*text-anchor="middle"[^>]*font-size="10"[^>]*>([0-9]+h)</g)
).map((m) => m[1]);
ok(
  fullLabels.length < 24,
  `24 cột thì phải bớt nhãn giờ, thực tế vẫn ${fullLabels.length} nhãn`
);
ok(new Set(fullLabels).size === fullLabels.length, 'nhãn giờ ở khung 24h không được lặp');
const fullBars = rects(full).filter((r) => r.fill !== 'transparent');
ok(fullBars.length === 24, `khung 24h phải vẽ 24 cột, thực tế ${fullBars.length}`);
ok(
  fullBars.every((b) => b.width >= 5),
  'cột ở khung 24h không được nhỏ hơn 5 đơn vị để còn bấm được'
);

console.log(`\n=== BIỂU ĐỒ GIỜ — ĐO TOẠ ĐỘ THẬT: ${checks} assertions PASS ===\n`);