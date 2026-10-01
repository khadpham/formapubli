/**
 * Chụp biểu đồ ra SVG/HTML tĩnh để soi bằng mắt.
 *
 * Vì sao cần: `verify-pos-live.ts` chỉ chạy được với localhost/LAN và cần đăng nhập
 * thật; còn suite render chỉ đo toạ độ, không bắt được "trông như thế nào". Script này
 * dựng đúng component với dữ liệu thật của một ngày bán hàng rồi ghi ra file để mở
 * xem/thả vào trình duyệt. Không assert gì — đây là công cụ soi, không phải test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { HourlyOrdersChart, type HourlyBucket } from '../src/components/pos/HourlyOrdersChart';

/** Một ngày hội chợ mẫu: cao điểm chiều, nghỉ trưa không đơn. */
const BAY: HourlyBucket[] = [
  { hour: 8, orders: 3, sales: 640_000 },
  { hour: 9, orders: 7, sales: 1_580_000 },
  { hour: 10, orders: 12, sales: 2_940_000 },
  { hour: 11, orders: 9, sales: 2_210_000 },
  { hour: 12, orders: 2, sales: 390_000 },
  { hour: 13, orders: 5, sales: 1_120_000 },
  { hour: 14, orders: 11, sales: 2_680_000 },
  { hour: 15, orders: 8, sales: 1_940_000 },
  { hour: 16, orders: 6, sales: 1_450_000 },
  { hour: 17, orders: 14, sales: 3_920_000 },
  { hour: 18, orders: 10, sales: 2_760_000 },
  { hour: 19, orders: 4, sales: 880_000 },
  { hour: 20, orders: 2, sales: 410_000 },
  { hour: 21, orders: 1, sales: 190_000 },
];

const markup = renderToStaticMarkup(
  React.createElement(HourlyOrdersChart, { rows: BAY, startHour: 8, endHour: 21 })
);

// Tailwind không có trong file tĩnh ⇒ nhét CSS thiết yếu để mở lên thấy đúng màu,
// đúng bo góc, đúng cỡ chữ. Chỉ phục vụ soi, không đi vào app.
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Soi biểu đồ đơn theo giờ</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{background:#e2e8f0;padding:24px;font-family:ui-sans-serif,system-ui,sans-serif}</style>
</head><body>
<div class="mx-auto space-y-8">
  <div class="max-w-3xl mx-auto">${markup}</div>
  <!-- Khung 24 GIỜ: trường hợp xấu nhất (nhãn giờ chồng nhau, cột quá mảnh). Cùng
       dữ liệu nhưng bỏ bớt số giờ trống và nhân đơn lên cho giống ca bán dài. -->
  <div class="max-w-3xl mx-auto">${renderToStaticMarkup(
    React.createElement(HourlyOrdersChart, {
      rows: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        orders: h === 4 || h === 17 ? 0 : 1 + ((h * 3) % 9),
        sales: (1 + ((h * 3) % 9)) * 210_000,
      })),
      startHour: 0,
      endHour: 23,
    })
  )}</div>
  <!-- Bản hẹp 340px: màn trên điện thoại, nơi nhãn dễ chồng nhất. -->
  <div class="max-w-[340px] mx-auto">${markup}</div>
  <!-- Ngày không có đơn. -->
  <div class="max-w-3xl mx-auto">${renderToStaticMarkup(
    React.createElement(HourlyOrdersChart, {
      rows: [{ hour: 8, orders: 0, sales: 0 }, { hour: 9, orders: 0, sales: 0 }],
      startHour: 8,
      endHour: 9,
    })
  )}</div>
</div></body></html>`;

const out = path.resolve(process.cwd(), 'reports/hourly-chart-preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log(`Đã ghi: ${out}`);
console.log(`Mở bằng: Start-Process ${out}`);