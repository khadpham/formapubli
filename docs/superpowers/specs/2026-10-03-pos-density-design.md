# POS Density & Space Spec — 2026-10-03

## 1. Mục tiêu
- Tận dụng tối đa không gian POS (ưu tiên 1), sau đó desktop, rồi mobile modal.
- Không còn `...` trên nhãn đã biết (tab Tiền & Két / Kiểm Kê / Chiết Khấu đã fix bằng `fit-bar`).
- UX trực quan: filter 1 dòng, cart luôn thấy, lưới sản phẩm dày hơn.

## 2. Phạm vi
- IN: `PosCheckoutTerminal.tsx`, `DailyFairSettlementModal.tsx`, `globals.css` (token dùng chung).
- OUT: virtualization danh sách, restructure Dashboard/kho (đợt sau).

## 3. Thiết kế
### Pha 1 — Token mật độ dùng chung (10 phút)
- Mở rộng `fit-bar` đã có: thêm `.density-compact` (`gap:8px`, `padding:12px`).
- Quy tắc: `gap-6→gap-4`, `p-5→p-4`, `space-y-6→space-y-4` trong vùng POS dày.
- Nhãn ngắn tiếng Việt có dấu; nguyên tắc fit-bar: dọn padding trước, thu font `clamp(10px,3.5cqi,12px)` sau, `...` cuối cùng.

### Pha 2 — POS 2-pane (30-60 phút)
- Lưới chính: `grid-cols-1 lg:grid-cols-12 gap-6` → `gap-4`; products `lg:col-span-7`, cart `lg:col-span-5` giữ tỉ lệ nhưng cart `sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto` rộng 380px.
- Lưới sản phẩm: `grid-cols-2 gap-2 sm:gap-3` → `grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2`; card `min-h-[110px] p-2.5 sm:p-3.5` → `min-h-[96px] p-2.5`.
- Header filter: `p-3 md:p-5 gap-3 md:gap-4` → `p-3 gap-2`, 1 dòng trên desktop (`flex-row`, search co giãn, nút lọc gọn).
- Cart items `max-h-[220px]` giữ; nút thanh toán sticky đáy cart.

## 4. Ràng buộc
- `main` là nguồn sự thật, commit thẳng khi làm một mình.
- Sửa `.css` phải `npm run build` (tsc không validate CSS).
- Hằng giá trị tra `schema.ts`/migration, test không dùng chung hằng với code.
- Không commit secret; `certificates/` gitignore.
- Verify: `npx tsc --noEmit` + `npm run build` + `verify-pos-live.ts` + screenshot thật (dev:https cho camera, dev:lan cho còn lại).

## 5. Nghiệm thu
1. Tab báo cáo đủ chữ ở 320px (không `...`).
2. Desktop 1366px: ≥24 sản phẩm trong viewport đầu, cart + nút TT luôn thấy.
3. Mobile 360px: filter không tràn 2 dòng, chữ tự thu không vỡ.
