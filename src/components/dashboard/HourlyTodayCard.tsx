'use client';

/**
 * THẺ "BÁN HÀNG THEO GIỜ" — bảng quản trị.
 *
 * Vì sao có riêng một thẻ bọc `HourlyOrdersChart` (đã tồn tại cho báo cáo chốt
 * ngày) mà không sửa thẳng vào đó: báo cáo chốt ngày vẽ MỘT ngày đã chốt, còn ở
 * đây cần SO SÁNH hôm nay với các ngày trước và phân biệt "chưa bán" với
 * "chưa tới". Hai nhu cầu đó là hai prop optional, không phải một biểu đồ khác.
 * Nhờ vậy báo cáo chốt ngày giữ nguyên 100% hành vi cũ.
 *
 * Ba điều dễ sai ở đây, đã xử lý:
 * 1. Ngày lấy theo GIỜ VIỆT. `created_at` trong DB là UTC; dùng `toISOString()`
 *    là cột "hôm nay" mất trọn ca 00:00–07:00 và nuốt 17:00–24:00 của hôm qua.
 * 2. Khung giờ CỐ ĐỊNH theo dữ liệu 7 ngày, không cắt bám hôm nay. Nếu hôm nay
 *    mới bán tới 11h mà cắt ở 11h thì trục X đổi hình mỗi ngày ⇒ không so được
 *    với đường TB của 6 ngày trước.
 * 3. TB 6 ngày chia cho SỐ NGÀY THẬT SỰ CÓ ĐƠN ở giờ đó, không chia đông cứng
 *    cho 6. Ngày quầy đóng cửa không phải là "ngày bán được 0 đơn", kéo mẫu số
 *    về 6 làm TB luôn thấp hơn thực tế.
 */
import React, { useMemo } from 'react';
import { BarChart3, Clock } from 'lucide-react';
import { HourlyOrdersChart, type HourlyBucket } from '@/components/pos/HourlyOrdersChart';
import { vnBusinessDay, vnHourOf, shiftVnDay } from '@/lib/vn-time';

/** Hôm nay + 6 ngày trước: vừa là mẫu số của đường TB, vừa là nguồn chọn khung giờ. */
const WINDOW_DAYS = 7;
/** Khung giờ khi quầy chưa có đơn nào trong 7 ngày (mở cửa 8h, chốt 21h). */
const FALLBACK_START = 8;
const FALLBACK_END = 21;

interface HourCell {
  orders: number;
  sales: number;
}

export function HourlyTodayCard({
  orders,
  className = '',
}: {
  orders: any[];
  className?: string;
}) {
  const model = useMemo(() => {
    const today = vnBusinessDay(new Date());

    // Ngày VN theo thứ tự cũ → mới: 6 ngày trước rồi tới hôm nay.
    const days: string[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const d = today ? shiftVnDay(today, -i) : '';
      if (d) days.push(d);
    }
    const inWindow = new Set(days);

    // Gom một lần theo NGÀY VN × GIỜ VN; mọi phép tính phía sau đọc từ đây.
    const buckets = new Map<string, Map<number, HourCell>>();
    for (const o of (Array.isArray(orders) ? orders : []) as any[]) {
      const at = o?.createdAt ?? null;
      const day = vnBusinessDay(at);
      const hour = vnHourOf(at);
      if (!day || hour == null || !inWindow.has(day)) continue;
      let byHour = buckets.get(day);
      if (!byHour) {
        byHour = new Map<number, HourCell>();
        buckets.set(day, byHour);
      }
      const cell = byHour.get(hour) ?? { orders: 0, sales: 0 };
      cell.orders += 1;
      cell.sales += Number(o?.finalAmount || 0);
      byHour.set(hour, cell);
    }

    // KHUNG GIỜ từ dữ liệu 7 ngày (kể cả hôm nay) để mọi ngày cùng một trục X.
    // Cắt bám hôm nay thì lúc 11h trục là 8h–11h, tối 20h là 8h–20h ⇒ không so
    // được với đường TB 6 ngày trước vốn vẽ trên khung cố định.
    let minHour: number | null = null;
    let maxHour: number | null = null;
    for (const day of days) {
      // `forEach` chứ không `for…of` trên Map: tsconfig đang target ES5, không bật
      // downlevelIteration nên toán tử `for…of` trên Map là lỗi TypeScript.
      buckets.get(day)?.forEach((cell, hour) => {
        if (cell.orders <= 0) return;
        if (minHour == null || hour < minHour) minHour = hour;
        if (maxHour == null || hour > maxHour) maxHour = hour;
      });
    }
    let startHour = minHour ?? FALLBACK_START;
    let endHour = maxHour ?? FALLBACK_END;
    // Ít nhất 2 cột: khung 1 cột thì "cao điểm / thấp điểm" là cùng một giờ.
    if (endHour < startHour + 1) endHour = Math.min(23, startHour + 1);

    const todayCell = (hour: number): HourCell => (today ? buckets.get(today)?.get(hour) : undefined) ?? { orders: 0, sales: 0 };

    const rows: HourlyBucket[] = [];
    for (let hour = startHour; hour <= endHour; hour++) {
      const cell = todayCell(hour);
      rows.push({ hour, orders: cell.orders, sales: cell.sales });
    }
    const todayOrders = rows.reduce((s, r) => s + Number(r.orders || 0), 0);

    // TB các ngày trước: mẫu số là SỐ NGÀY THẬT SỰ CÓ ĐƠN Ở GIỜ ĐÓ (tối đa 6),
    // không phải 6 cứng — ngày không bán được gì ở giờ đó không có mặt trong TB.
    const prevDays = days.slice(0, -1);
    const baseline: Array<number | null> = Array.from({ length: 24 }, (_, hour) => {
      let sum = 0;
      let withData = 0;
      for (const day of prevDays) {
        const cell = buckets.get(day)?.get(hour);
        if (cell && cell.orders > 0) {
          sum += cell.orders;
          withData += 1;
        }
      }
      return withData > 0 ? sum / withData : null;
    });

    // Không tự tính cao điểm/thấp điểm ở đây: `HourlyOrdersChart` đã có sẵn ô
    // "Giờ cao điểm" và dòng nhận xét kèm giờ vắng nhất. Tính lần thứ hai ở thẻ
    // bọc chỉ để có hai nơi hiện cùng một con số — sửa ở một chỗ, hai nơi lệch nhau.
    return {
      rows,
      baseline,
      startHour,
      endHour,
      todayOrders,
      hasBaseline: baseline.some((v) => v != null),
      // "Chưa tới" chỉ có nghĩa khi hôm nay ĐÃ bán; hôm nay 0 đơn thì mọi giờ đều
      // "chưa tới" ⇒ vẽ khung đứt cả dải, người xem tưởng hỏng dữ liệu.
      currentHour: todayOrders > 0 ? vnHourOf(new Date()) : undefined,
    };
  }, [orders]);

  const {
    rows, baseline, startHour, endHour, todayOrders, hasBaseline, currentHour,
  } = model;

  return (
    <>
      <div className={`rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 hover:shadow-md transition-shadow ${className}`}>
        {/* 1.2 — đầu thẻ: tiêu đề + phụ đề nói rõ cách đọc, không lặp lại số liệu */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              Bán hàng theo giờ
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Mỗi cột là số đơn trong một giờ
              {hasBaseline ? ' · nét đứt là mức bình quân của 6 ngày trước' : ''}
              {currentHour != null ? ` · khung đứt là giờ chưa tới sau ${currentHour}h` : ''}.
            </p>
          </div>
        </div>

        {/* 1.7 — trạng thái rỗng: icon + một câu + hướng dẫn hành động. Chỉ hiện
            khi KHÔNG còn gì để vẽ; nếu còn đường TB thì biểu đồ vẫn đứng được. */}
        {todayOrders === 0 && !hasBaseline ? (
          <p className="mt-4 text-xs text-slate-400 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-300" />
            Hôm nay chưa có đơn nào. Bán được đơn đầu tiên thì cột bắt đầu nhảy.
          </p>
        ) : (
          <>
            {todayOrders === 0 ? (
              <p className="mt-3 text-xs text-slate-400 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-300" />
                Hôm nay chưa có đơn nào. Đường nét đứt là mức bình quân 6 ngày trước.
              </p>
            ) : null}
            {/* Bỏ viền/đệm của vỏ thẻ bên trong: thẻ này đã có vỏ riêng, để cả hai
                là ra hai khung trắng lồng nhau trông như lỗi bố cục. `hideHeader`
                để không có hai tiêu đề chồng nhau; biểu đồ bên trong vẫn giữ ô
                "Tổng N đơn" và dòng nhận xét cao điểm / giờ vắng nhất của riêng nó,
                nên thẻ bọc KHÔNG lặp lại dòng tóm tắt đó. */}
            <div className="mt-3 [&>div]:border-0 [&>div]:shadow-none [&>div]:bg-transparent [&>div]:rounded-none [&>div]:p-0">
              <HourlyOrdersChart
                rows={rows}
                startHour={startHour}
                endHour={endHour}
                baseline={baseline}
                currentHour={currentHour}
                hideHeader
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
