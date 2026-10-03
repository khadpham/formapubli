# POS Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dọn không gian POS: lưới dày hơn, cart sticky, filter 1 dòng, không còn `...` trên nhãn đã biết.

**Architecture:** Mở rộng utility `fit-bar` đã có trong `globals.css` bằng token `.density-compact`; sửa 4 điểm trong `PosCheckoutTerminal.tsx` (grid chính, lưới sản phẩm, cart, header filter). Không đổi logic, chỉ class.

**Tech Stack:** Next.js + Tailwind (raw CSS cho container query), TypeScript, `npx tsc --noEmit`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-10-03-pos-density-design.md`

## Global Constraints

- `main` là nguồn sự thật, làm một mình thì commit thẳng `main`.
- Sửa file `.css` thì phải chạy `npm run build` (`tsc` không validate CSS).
- Giá trị hằng tra nguồn thật (`src/db/schema.ts`, migration); test không dùng chung hằng với code.
- Nhãn UI tiếng Việt có dấu, ngắn; nút là động từ ngắn.
- Không commit secret/token; `certificates/` gitignore.
- `git add` ghi rõ từng file, không `-A` / `commit -a`; deploy chỉ khi cây sạch + tsc + build + test xanh.

## Review Focus

- Tab `Tiền & Két / Kiểm Kê / Chiết Khấu` ở 320px phải đủ chữ, không `...`.
- Desktop 1366px: viewport đầu thấy ≥24 sản phẩm, cart + nút thanh toán luôn thấy.
- Mobile 360px: filter không tràn 2 dòng, chữ tự thu không vỡ layout.
- Cart sticky không che nội dung khi cuộn dài.
- Mọi nút giữ `aria-label`/`title` đầy đủ sau khi gọn.

---

### Task 1: Token `.density-compact` dùng chung

**Files:**
- Modify: `src/app/globals.css:181-182` (chèn sau khối `@container (max-width: 340px)`)
- Test: `scripts/check-pos-density.ts` (tạo mới, assert grep)

**Interfaces:**
- Consumes: `.fit-bar` hiện có (container-type inline-size).
- Produces: `.density-compact` mà Task 2-4 dùng cho `gap`/`padding`.

- [ ] **Step 1: Viết script kiểm tra thất bại**

```ts
// scripts/check-pos-density.ts
import { readFileSync } from 'node:fs';
const css = readFileSync('src/app/globals.css', 'utf8');
const checks = ['.density-compact', '.fit-bar'];
let fail = 0;
for (const c of checks) {
  const ok = css.includes(c);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Chạy để xác nhận FAIL (thiếu `.density-compact`)**

Run: `npx tsx scripts/check-pos-density.ts`
Expected: `FAIL .density-compact`, exit 1.

- [ ] **Step 3: Thêm token tối thiểu**

```css
.density-compact {
  gap: 8px;
}
.density-compact > * {
  min-width: 0;
}
```

Chèn vào cuối `src/app/globals.css`, sau khối fit-bar.

- [ ] **Step 4: Chạy lại để PASS + tsc sạch**

Run: `npx tsx scripts/check-pos-density.ts`
Expected: PASS cả 2, exit 0.

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css scripts/check-pos-density.ts
git commit -m "feat(pos): token density-compact dung chung"
```

### Task 2: Lưới chính + cart sticky

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx:3067` (grid chính)
- Modify: `src/components/pos/PosCheckoutTerminal.tsx:3414` (cart panel)

**Interfaces:**
- Consumes: `.density-compact` từ Task 1.
- Produces: layout 2-pane cart sticky cho Task 5 verify.

- [ ] **Step 1: Đổi `gap-6` thành `gap-4`**

```tsx
// cũ (dòng 3067)
<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
// mới
<div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
```

- [ ] **Step 2: Cart sticky + gọn padding**

```tsx
// cũ (dòng 3414)
<div id="cart-checkout-panel" className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between scroll-mt-20">
// mới
<div id="cart-checkout-panel" className="lg:col-span-5 bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex flex-col justify-between scroll-mt-20 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
```

- [ ] **Step 3: tsc sạch**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
git add src/components/pos/PosCheckoutTerminal.tsx
git commit -m "feat(pos): grid gap-4 + cart sticky desktop"
```

### Task 3: Lưới sản phẩm dày hơn

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx:3344` (lưới)
- Modify: `src/components/pos/PosCheckoutTerminal.tsx:3355` (card)

**Interfaces:**
- Consumes: grid chính từ Task 2.
- Produces: mật độ card cho Task 5 đếm ≥24 sản phẩm.

- [ ] **Step 1: Lưới 2→3→4 cột**

```tsx
// cũ (dòng 3344)
<div className="grid grid-cols-2 gap-2 sm:gap-3 max-h-[560px] overflow-y-auto pr-1">
// mới
<div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 max-h-[560px] overflow-y-auto pr-1">
```

- [ ] **Step 2: Card gọn**

```tsx
// cũ (dòng 3355)
className={`p-2.5 sm:p-3.5 bg-white rounded-2xl border transition-all cursor-pointer flex flex-col justify-between select-none min-h-[110px] ${ ... }`}
// mới
className={`p-2.5 bg-white rounded-2xl border transition-all cursor-pointer flex flex-col justify-between select-none min-h-[96px] ${ ... }`}
```

Chỉ đổi `sm:p-3.5` → bỏ, `min-h-[110px]` → `min-h-[96px]`; giữ nguyên phần `${ ... }`.

- [ ] **Step 3: tsc sạch**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
git add src/components/pos/PosCheckoutTerminal.tsx
git commit -m "feat(pos): luoi san pham 4 cot, card 96px"
```

### Task 4: Header filter 1 dòng desktop

**Files:**
- Modify: `src/components/pos/PosCheckoutTerminal.tsx:2917` (thanh filter)

**Interfaces:**
- Consumes: không phụ thuộc Task 2-3.
- Produces: filter gọn cho Task 5 screenshot.

- [ ] **Step 1: Gọn padding/gap**

```tsx
// cũ (dòng 2917)
<div className="hidden md:flex bg-white rounded-2xl p-3 md:p-5 border border-slate-200/80 shadow-sm flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
// mới
<div className="hidden md:flex bg-white rounded-2xl p-3 border border-slate-200/80 shadow-sm flex-row items-center justify-between gap-2">
```

- [ ] **Step 2: tsc sạch**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add src/components/pos/PosCheckoutTerminal.tsx
git commit -m "feat(pos): header filter 1 dong desktop"
```

### Task 5: Verify tầng 1-3

**Files:**
- Test: `scripts/check-pos-density.ts` (Task 1)
- Test: `npx tsx scripts/verify-pos-live.ts` (có sẵn)

**Interfaces:**
- Consumes: Task 1-4.
- Produces: bằng chứng xanh để đóng việc.

- [ ] **Step 1: tsc + check density**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

Run: `npx tsx scripts/check-pos-density.ts`
Expected: PASS, exit 0.

- [ ] **Step 2: build (bắt buộc vì sửa CSS/class)**

Run: `npm run build`
Expected: build xong không lỗi CSS.

- [ ] **Step 3: verify POS live**

Run: `npx tsx scripts/verify-pos-live.ts`
Expected: đăng nhập thật, tạo đơn thật, mã 13 ký tự, tồn + báo cáo đúng.

- [ ] **Step 4: Chụp màn hình thật 1366px + 360px, đếm sản phẩm viewport đầu**

Run: dev `npm run dev:lan`, mở `http://192.168.1.8:3000`, screenshot POS.
Expected: desktop ≥24 sản phẩm, cart + nút TT thấy; mobile filter 1-2 dòng gọn, tab đủ chữ.
