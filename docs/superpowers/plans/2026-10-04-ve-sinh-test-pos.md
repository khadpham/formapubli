# Vệ sinh test POS — 04/10/2026

Bổ sung cho mục 12 và 13 của `2026-10-02-trang-thai-toan-bo.md`.
**Không sửa `src/` ⇒ không deploy.** Chỉ `scripts/` + `docs/` + ảnh chụp trong
`reports/wave3-pos-ui/` (sinh lại từ lần chạy xanh).

## Vấn đề

Hai suite kiểm thử POS trên trình duyệt thật tồn tại nhưng **không ai gọi**:

| Suite | Lệnh | Trạng trước |
|---|---|---|
| Quà tay qua duyệt | `npm run test:pos-gift` | mới tạo, chỉ chạy tay |
| POS component (14 test) | `npx tsx scripts/run-real-pos-terminal-test.ts` | **đỏ ở Test 2 ⇒ 12 test phía sau chưa từng chạy tới** |

Không ai thấy vì `scripts/run-isolated.ts` không gọi chúng. Đó là rot: test chết
âm thầm, không ai sửa, và mọi test mới đặt vào đó cũng sẽ chết theo.

## Đã làm

### 1. Nối cả hai vào `run-isolated.ts`

- `BROWSER_SUITES = [run-real-manual-gift-test, run-real-pos-terminal-test]`,
  chạy **sau** danh sách suite DB, dùng đúng vòng lặp retry-crash sẵn có.
- `--list` in ra hai nhóm. `--only=` lọc được cả hai nhóm.
- Thiếu Google Chrome ⇒ in `⏩ BỎ QUA` và **không tính là đỏ** (phụ thuộc môi
  trường, không phải lỗi code). Muốn bắt buộc thì `POS_REQUIRE_CHROME=1`.
- Bỏ qua bước `clear-login-buckets` cho suite browser (không đụng DB).

### 2. Sửa suite POS cũ — 5 nguyên nhân thật

| # | Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|---|
| 1 | Test 2 đòi danh mục thu gọn 2×2 | App đã bỏ chế độ đó (mobile nay ẩn danh mục, scan-first) | Chỉ kiểm khi danh mục **thực sự** ở chế độ thu gọn, ngược lại báo `SKIP` kèm lý do |
| 2 | Test 6 đỏ, Test 5 xanh **giả** | Nút đã đổi tên "Chốt Ngày" → "Báo Cáo Ngày". Test tìm tên cũ nên `null` mọi vai ⇒ cashier "xanh" vì tìm nhầm | Sửa cả 2 theo tên mới |
| 3 | Test 7 đỏ "tràn ngang 12px" ở **mọi** khung | Harness mount POS vào `<div>` trần, thiếu `p-3` của `<main>` thật; trong POS có khối `-mx-3 px-3` cân bằng đúng lớp padding đó | Thêm `p-3` vào harness, **không sửa component** |
| 4 | Test 9 không tìm thấy nút "Thêm" | Selector `.grid.grid-cols-2 button[…]` bám **thứ tự DOM**; sau Test 6 (đổi vai) có lưới khác đứng trước | Đổi sang `button[aria-label*="vào giỏ"]` — không phụ thuộc thứ tự |
| 5 | Test 11, 13, 14 đỏ | Bám câu chữ cũ: "tải lại", "Đã nhận tiền", `title^="Mở bảng duyệt…"` | Bám **bản chất** hiện hành: có thông báo lỗi khi hủy duyệt hỏng; nút chuyển khoản phải ghi "Chụp ảnh" và **không tạo đơn khi chưa có ảnh**; nút duyệt theo `title` mới |

Kết quả: **14/14 xanh**, kèm 8 ảnh chụp trong `reports/wave3-pos-ui/`.

### 3. Nguyên nhân gốc khiến suite chết âm thầm

`--window-size=375,640`: Chrome headless `--dump-dom` **ép cửa sổ về 500px** rồi
**đổi kích thước thêm một lần nữa sau khi trang đã mount** (Tailwind CDN + font tải
xong mới layout). `PosCheckoutTerminal` nghe `matchMedia('(max-width: 767px)')` để
quyết định `isMobileView`:

- lúc mount: cửa sổ còn rộng ⇒ `isMobileView = false` ⇒ danh mục hiện;
- sau đó: cửa sổ về 500px ⇒ `isMobileView = true` ⇒ **danh mục biến mất giữa chừng
  suite**, mọi test phía sau chết.

Dấu hiệu nhận ra nằm ngay trong log: `matchMedia mobile=true` trong khi component
vẫn đang ở chế độ desktop. Đã đổi sang cửa sổ cố định `--window-size=1280,900`.

### 4. Bài học đã áp dụng luôn

- **Thông báo lỗi phải chỉ ra thủ phạm.** Test 7 trước đây chỉ nói
  `scrollWidth (332) > clientWidth (320)` ⇒ người sửa phải tự mò trong DOM rồi đoán.
  Nay nó in ra 5 phần tử tràn nhiều nhất kèm class và lề tràn. Chính vì log không
  đủ thông tin mà suite này chết suốt thời gian qua.
- **Harness phải mô phỏng đủ điều kiện thật**: `p-3` của `<main>`, ca két đang mở
  (`/api/cashbox`), và prop `actorId`. Thiếu `actorId` thì `handleCheckout` chặn
  ngay ⇒ mọi khẳng định "chốt đơn bị chặn" **xanh vì lý do khác**.

## Kiểm chứng

```
npx tsx scripts/run-isolated.ts --only=run-real-manual-gift-test,run-real-pos-terminal-test
  → ALL MANUAL GIFT TESTS PASSED (6/6)
  → ALL REAL POS COMPONENT TESTS PASSED (14/14)
  → formapubli.db production nguyên vẹn 100%
npx tsx scripts/run-isolated.ts --only=test-manual-gift-approval,test-gift-forgery
  → 15/15 và 12/12 (xác nhận không làm hỏng đường chạy suite DB)
npx tsc --noEmit → sạch
```
