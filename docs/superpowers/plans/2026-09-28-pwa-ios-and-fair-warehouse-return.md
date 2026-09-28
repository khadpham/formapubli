# Plan — PWA iOS + Chuyển ngược kho hội chợ (28/09/2026)

Bối cảnh: main `ab99d53`, prod đang chạy `ea44433f`. Phân loại: **bounded** (2 việc
độc lập, sửa flow đã tồn tại). Đã được user duyệt 28/09: làm PWA trước, rồi
chuyển ngược.

---

## Phần A — PWA trên iOS (không có nút cài đặt)

### Vì sao iOS không hiện nút (KHÔNG phải bug)

`beforeinstallprompt` không bao giờ fire trên iOS/iPadOS. WebKit cố tình không
implement (bugs.webkit.org/show_bug.cgi?id=255716): mọi thao tác "thêm vào màn
hình chính" trên iOS phải do người dùng tự bấm qua Share sheet. Vì vậy băng cài
đặt gated bởi `installPrompt` (`PwaRegister.tsx:70`) là **vô điều kiện** trên
iPhone — không sửa code nào làm nó hiện được.

Đường cài duy nhất trên iOS: **nút Chia sẻ → "Thêm vào Màn hình chính"**.
Không có JS API nào mở được Share sheet.

### 3 lỗi thật khiến bản cài ra xấu (phải sửa)

| # | Lỗi | Vị trí | Hậu quả |
|---|---|---|---|
| A1 | `apple-touch-icon` trỏ `.svg` | `src/app/layout.tsx:21` | iOS **không nhận SVG** cho apple-touch-icon → sau khi A2HS, icon là ảnh chụp màn hình hoặc trống |
| A2 | Thiếu `viewport-fit=cover` | `src/app/layout.tsx` viewport export | 7 call site `env(safe-area-inset-*)` đều ra `0px` (`MasterAppShell.tsx:78,79,82,234`, `AppSidebar.tsx:206,358`, `PosCheckoutTerminal.tsx:2163,3619,3782`) → app standalone bị Dynamic Island / thanh home đè |
| A3 | `public/` chỉ có icon SVG, `purpose: "any maskable"` | `public/manifest.json:26-28` | Logo chiếm ~50% giữa canvas, maskable sẽ bị cắt mép; iOS/Windows không có PNG để dùng |

### Thay đổi

1. **`scripts/gen-pwa-icons.ts`** (mới, chạy 1 lần rồi commit PNG).
   Dùng `sharp` — đã nằm sẵn trong `node_modules` (optional dep của `next`),
   **không thêm dependency**. Đọc `public/icons/icon-192.svg`, xuất:
   - `public/icons/apple-touch-icon.png` 180×180
   - `public/icons/icon-192.png` 192×192
   - `public/icons/icon-512.png` 512×512
   Script tự assert kích thước đầu ra (chống hỏng âm thầm — đây là rủi ro
   lớn nhất vì iOS **im lặng bỏ qua** apple-touch-icon sai).
2. **`public/manifest.json`** — `icons[]` trỏ PNG, `purpose: "any"`, **bỏ
   `maskable`**. Thêm `id: "/"` để Chrome ổn định (hiện id ngầm = `start_url`).
   `shortcuts[].icons` cũng trỏ PNG.
3. **`src/app/layout.tsx`** — `icons.apple` → `/icons/apple-touch-icon.png`;
   thêm `viewportFit: "cover"`.
4. **`src/components/pwa/PwaRegister.tsx`** — thêm nhánh iOS:
   - điều kiện: **không** có `installPrompt` **và** là iOS/iPadOS **và** chưa
     chạy standalone (`window.matchMedia('(display-mode: standalone)')` hoặc
     `navigator.standalone`).
   - hiện băng "Thêm vào màn hình chính" + hướng dẫn Chia sẻ (2 dòng, có icon
     `Share2` từ lucide để không ai phải đoán nút nào).
   - `localStorage['pwa_ios_hint_dismissed']` — đóng 1 lần là không hiện lại.
   - băng tự nhích lên trên `env(safe-area-inset-bottom)` để không bị thanh
     home đè.
   - dọn 2 biến chết đang có: `isInstalled` (set mà không đọc), import
     `CheckCircle` không dùng.
   - **Không** bắt người dùng phải chuyển sang Safari: iOS 16.4+ Chrome/Firefox
     cũng A2HS được qua Share sheet. Chỉ nhắc Safari trong hướng dẫn dạng dài
     (nếu sau này thêm mục trong Cài đặt).

### Verify

- `node --experimental-strip-types scripts/gen-pwa-icons.ts` hoặc `npx tsx` →
  assert 3 PNG đúng kích thước.
- `npx tsc --noEmit` xanh.
- **Bắt buộc**: `npm run dev:lan` → bạn mở `http://192.168.1.246:3000` trên
  iPhone bằng Chrome → phải thấy băng hướng dẫn. Sau đó tự A2HS và kiểm tra
  icon có đẹp không (tôi không đoán được, chỉ bạn mới thấy).

---

## Phần B — Chuyển ngược hàng loạt từ kho hội chợ về kho gốc

### Vì sao chưa làm được (nguyên nhân gốc, không phải thiếu nút)

`BatchTransferModal.tsx:199-206`:

```ts
const getFromStock = (bookId: string): number => {
  const book = books.find((b) => b.id === bookId);
  if (!book) return 0;
  if (fromWarehouseId === 'wh-au-co') return book.stockAuCo ?? 0;
  if (fromWarehouseId === 'wh-quynh-mai') return book.stockQuynhMai ?? 0;
  if (fromWarehouseId === 'wh-du-phong') return book.stockDuPhong ?? 0;
  return book.totalStock ?? 0;   // ← TỔNG MỌI KHO
};
```

Chỉ biết 3 mã kho cứng. Mọi kho khác (tức **mọi kho hội chợ**) rơi về
`totalStock` = tổng tồn **cả hệ thống**. Hậu quả ở 4 call site:

- `:202-205` cột "Tồn Nguồn" hiển thị sai (tổng mọi kho).
- `:281` SL mặc định `min(20, stock)` → có thể vượt tồn thật của kho hội chợ.
- `:427-446` "Thêm nhanh toàn bộ sách có tồn" thêm cả sách **không có** trong
  kho hội chợ, và cap cứng `quantity: Math.min(stock, 30)` — không bao giờ lấy
  đủ tồn thật.

Nghĩa là chiều **tới** kho hội chợ cũng đang hiển thị sai số liệu, không riêng
chiều ngược. Sửa ở hàm dùng chung để một diff chữa hết 4 call site.

Dữ liệu đã sẵn có: `InventoryService.getStockMatrix` trả `stockByWarehouse`
(map theo `warehouseId`, động, gồm mọi kho) — `inventory.service.ts:731`; kiểu
đã khai ở `StockOverviewMatrix.tsx:62`. Chỉ là modal chưa dùng.

### Bẫy thứ 2: "xoá kho hội chợ" sẽ LUÔN 409

`WarehouseService.deleteWarehouse` chặn xoá nếu kho đó có bất kỳ
`inventory_ledger` hoặc `orders` nào. Phiếu chuyển hàng loạt đã ghi ledger 2N
dòng ⇒ kho hội chợ **luôn** có ledger ⇒ `DELETE` luôn 409, kể cả khi tồn đã về 0.
Đây là chủ ý (giữ vết sổ kho). Hành động đúng sau khi lấy hết là
**Ngưng hoạt động** (`PATCH isActive=false`) — đã có sẵn UI + audit log.

### Thay đổi (KHÔNG đụng server, KHÔNG đụng API)

1. **`src/lib/warehouse-stock.ts`** (mới) — hàm thuần, 1 nguồn sự thật:

   ```ts
   export function stockOfWarehouse(
     book: { stockByWarehouse?: Record<string, number> },
     warehouseId: string
   ): number
   ```

   Đọc `stockByWarehouse[warehouseId]`, fallback 3 mã kho cũ, cuối cùng `0`
   (không fallback `totalStock` — đó chính là bug).

2. **`scripts/test-warehouse-stock.ts`** (mới) — 3 assert, viết **trước** khi
   sửa (TDD): kho hội chợ trả số riêng của nó, kho cố định trả đúng, kho lạ → 0.
   Chạy: `npx tsx scripts/test-warehouse-stock.ts`

3. **`src/components/inventory/BatchTransferModal.tsx`**
   - `BookItem` interface += `stockByWarehouse?: Record<string, number>`.
   - Xoá `getFromStock` cũ, dùng `stockOfWarehouse(book, fromWarehouseId)`.
   - Nút mới **"Lấy tồn thật kho nguồn"**: mọi ấn bản có `stock > 0` ở kho
     nguồn, `quantity = stock` (bỏ cap 30). Chỉ **bổ sung** dòng còn thiếu,
     không đụng dòng người dùng tự nhập/sửa.
   - Giữ nguyên nút cũ (cap 30) cho ca chuẩn bị hội chợ; chỉ đổi nhãn cho rõ
     ("Thêm nhanh — mặc định 30 cuốn/đầu").
   - Sau khi bấm: báo rõ `Đã thêm: N đầu sách, M cuốn`.
   - Panel thành công (`:699-723`): thêm dòng *"Kho nguồn đã về 0 → Quản Lý
     Kho → **Ngưng hoạt động** (không dùng Xoá: kho đã có sổ kho)."*

4. **Cơ chế "cho phép lựa chọn"** — không cần code thêm: cột "Số Lượng Chuyển"
   sửa tay được (`:1044-1058`) và xoá dòng được. Sách bán hết sẽ không vào danh
   sách (chỉ lấy `stock > 0`); sách bán một phần thì sửa SL còn lại.

### Cố ý giữ nguyên

- Trần 100 dòng/phiếu (`inventory.service.ts:661-664`) — chưa cần nâng; giao
  diện chỉ cảnh báo nếu vượt. Nếu kho hội chợ thực tế > 100 ấn bản thì nâng hằng
  số này (vẫn an toàn: đường ghi gom lô là **4 query cố định** bất kể N).
- Transaction, chặn âm, idempotency, rollback, ledger 2N dòng — không đụng.
- Không thêm endpoint mới.

### Verify

- `npx tsx scripts/test-warehouse-stock.ts` xanh.
- `npx tsx scripts/run-isolated.ts --only=test-s1-batch-transfer` xanh (hồi quy).
- `npx tsc --noEmit` + `npm run build` xanh.
- **Bắt buộc**: `npm run dev:lan` → mở Ma trận → Chuyển kho → Hàng loạt, chọn
  kho hội chợ làm nguồn → cột "Tồn Nguồn" phải bằng tồn riêng của kho hội chợ.

---

## Thứ tự thực hiện

A1 → A2 → A3 → A4 → verify A → **dừng, chờ user test iPhone** → B(test đỏ) →
B1 → B2 → B3 → verify B.
