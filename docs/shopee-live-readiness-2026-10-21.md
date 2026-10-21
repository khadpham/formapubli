# Kiểm toán sẵn sàng Go-Live Shopee - 2026-10-21

Phương pháp: đọc code thật trên nhánh dev (không đoán), đối chiếu với
docs/runbook-shopee-live-cutover.md và tài liệu nghiên cứu Shopee API v2.
Phạm vi chỉ đọc - không sửa code, không deploy, không chạm production.

Mức độ: **CHẶN** (không live được) / **NÊN SỬA** (live được nhưng rủi ro hoặc
một phần chức năng không chạy) / **NHỎ** (cải thiện nhỏ).

Tổng kết: **CHẶN: 0 · NÊN SỬA: 7 · NHỎ: 2**

---

## 1. UI/UX - tab Shopee và vai trò vận hành

### ĐẠT

1.1. **Thẻ kết nối shop** (src/components/shopee/ShopeeTab.tsx:148-175):
hiển thị "Đã kết nối shop Shopee #..." / "Chưa kết nối shop Shopee", kho
xuất, cờ COD; nút "Đồng bộ ngay" có trạng thái đang chạy (spinner), disabled
khi đang đồng bộ. Nhãn tiếng Việt có dấu, icon + aria-label rõ.

1.2. **Hàng đợi "Đơn Shopee cần gói"**: từng đơn có nút "Giao Hàng"
(POST /api/shopee/ship) với trạng thái "Đang giao…" và link "In vận đơn"
(GET /api/shopee/awb, mở tab mới) - đủ luồng đóng gói → giao → in của thủ kho.

1.3. **D1 - mục "Chờ xác nhận khách nhận hàng"**: nút "Đã nhận hàng" gọi
/api/orders/[id]/confirm-delivery, kèm dòng giải thích "Hóa đơn của các đơn
này chỉ phát hành sau khi xác nhận khách đã nhận hàng". Đúng quyết định D1.

1.4. **Quarantine**: mục "Đơn Lỗi Cần Xử Lý" hiện lý do + SKU từng đơn
(SKU lạ, COD tắt, thiếu dòng hàng) - thủ kho biết phải xử lý gì.

1.5. **Hub đơn online**: PortalOrdersPanel nằm ngay đầu tab Shopee - đúng
quyết định dồn đơn online về một hub.

1.6. **Doanh thu**: placeholder "Số đối soát phí sàn xem ở tab Chủ sau
(đơn chỉ tính khi đã giao)" - đúng phạm vi P1/P3.

1.7. **ROLE_SHOPEE_OPS** (src/lib/roles.ts:67-74): allowedNavItems chỉ
['shopee', 'settings'], nhãn "Nhân viên Shopee" có dấu, hidden khỏi UI đăng
nhập chạm-chọn. Đủ cho người vận hành live: gói, giao, in vận đơn, xác nhận
nhận hàng, xem đơn lỗi - và không thấy gì khác (đã kiểm chứng 403 trên
production ngày 2026-10-20).

1.8. **Cài đặt (ShopeePanel.tsx)**: nút "Kết nối gian hàng" qua
/api/shopee/auth-url (Owner only), cấu hình kho xuất, cờ COD, cấp kho cho
nhân viên Shopee (ops_warehouse_ids).

### NÊN SỬA

1.9. **Không có thông báo sau khi ủy quyền xong.**
src/app/api/shopee/callback/route.ts đổi token xong redirect về /?shopee=ok,
nhưng không component nào trong src/components đọc cờ này để báo "Đã kết
nối thành công" (grep toàn thư mục không thấy). Người bấm ủy quyền về trang
chính mà không biết đã xong chưa - dễ bấm lại hoặc tưởng hỏng.

### NHỎ

1.10. Khi chưa kết nối, tab Shopee chỉ hiện chữ "Chưa kết nối shop Shopee"
mà không có nút hành động - nút kết nối nằm ở Cài đặt → Shopee. Người mới
khó tìm.

---

## 2. ENGINE - src/services/shopee/

### ĐẠT

2.1. **sign.ts**: HMAC-SHA256, chuỗi ký = partner_id + path + timestamp +
access_token + shop_id; API công khai bỏ 2 phần cuối. Đúng chuẩn tài liệu
Shopee v2.

2.2. **token-store.ts + auth.ts**: token lưu Turso (không giữ RAM/file),
refresh XOAY VÒNG được lưu cặp mới NGAY (onConflictDoUpdate cả access và
refresh); refresh đệm 5 phút trước hết hạn; endpoint token trả ở gốc JSON
được xử lý đúng (bài học sandbox b0061e4).

2.3. **order-sync.ts**:
- response_optional_fields đầy đủ cả 2 tầng: list xin order_status; detail
  xin item_list, payment_method, recipient_address, shipping_carrier,
  total_amount, actual_shipping_fee (bài học 8c91339).
- COD chuẩn hoá đúng nhãn Shopee: 'COD' hoặc chứa 'CASH ON DELIVERY'.
- Idempotent tuyệt đối theo shopee-<order_sn> (đơn) và
  idem-shopee-<orderId> (bút toán kho).
- SKU lạ → cách ly CẢ đơn, không trừ nửa vời; COD tắt → cách ly có lý do.

2.4. **shipment.ts**: gate role (WAREHOUSE/MANAGER/OWNER/SHOPEE_OPS) và trạng
thái CREATED; lỗi "already shipped" được giữ lại để đi lấy mã vận đơn; mã
vận đơn sinh trễ được retry 3 nhịp và gắn cờ trackingPending; AWB bắt buộc
kèm tracking_number trong order_list và bóc fail_error từng đơn trong
result_list (bài học 80bf1fb). Carrier lấy từ đơn đã kéo về, không đoán.

2.5. **webhook.ts + route push**: HMAC(url_đầy_đủ + '|' + rawBody),
so sánh timing-safe; code 0 trả 200 ngay không kiểm chữ ký; sự kiện khác
bắt buộc chữ ký hợp lệ. code 1 READY_TO_SHIP → ingest idempotent; CANCELLED
→ hủy + hoàn kho nếu chưa giao; code 2 → cập nhật tracking. Route luôn trả
200 sau xử lý để Shopee không retry bão. Webhook URL dựng từ
x-forwarded-host/proto nên đúng trên mọi domain (dev/prod).

2.6. **revenue-guard.ts**: shopeeDeliveredOnly được dùng trong
analytics.service.ts (3 điểm), daily-settlement.service.ts,
executive-query.service.ts; isCountedRevenue dùng trong
OrderService.getSalesSummary. Đơn Shopee chưa giao không phồng doanh thu.

2.7. **stock-push.ts**: chỉ được gọi từ scripts/test-*, không có hook tự
động nào từ luồng kho gọi. Cam kết P1 "chưa đẩy tồn tự động" được code đảm
bảo; buffer an toàn 2 có mặt.

2.8. **shop-config.ts**: cấu hình runtime DB thắng env thắng mặc định;
setShopeeConfig chỉ Owner; phạm vi kho của nhân viên Shopee
(ops_warehouse_ids, mặc định = kho xuất); isShopeeOrderInScope được ship và
awb gọi (403 "Đơn ngoài kho được cấp").

### NÊN SỬA

2.9. **Không có đường code nào đưa đơn Shopee về DELIVERED.**
Webhook chỉ xử lý code 1 (READY_TO_SHIP, CANCELLED) và code 2 (tracking);
pull chỉ ingest READY_TO_SHIP. Hệ quả kép:
- syncEscrow (src/services/shopee/escrow-sync.ts:40) yêu cầu
  shippingStatus = DELIVERED → với đơn Shopee hiện tại KHÔNG BAO GIỜ chạy
  được, bước "đối soát escrow đơn đã giao" trong runbook (bước 6) không thực
  hiện được.
- revenue-guard loại đơn chưa DELIVERED → doanh thu Shopee trong mọi báo
  cáo luôn = 0.
Đề xuất: route POST /api/orders/[id]/confirm-delivery khi xác nhận đơn
SHOPEE thì đồng thời chuyển shippingStatus sang DELIVERED - vì theo thiết kế
D1, xác nhận thủ công của nhân viên CHÍNH là tín hiệu giao hàng cho đến khi
có API vận chuyển. (Không đụng luồng ONLINE portal.)

2.10. **Không có get_lost_push_message và không có job đồng bộ định kỳ.**
Push mất (restart đúng lúc webhook đến, cấu hình push sai) chỉ được bù bằng
nút "Đồng bộ ngay" bấm tay. Chú thích route sync ghi "UI nút bấm tay và job
định kỳ dùng chung" nhưng job định kỳ không tồn tại ở đâu (grep toàn repo
và script cron trên VPS). Cần ít nhất một lần quét bù tự động (mỗi 30-60
phút, trong giới hạn rate của Shopee) hoặc bổ sung get_lost_push_message.

2.11. **Sau ủy quyền lần đầu không biết shop_id để điền env.**
status và sync lấy shopId TỪ ENV SHOPEE_SHOP_ID. Token đã nằm trong DB nhưng
env còn trống → status vẫn "Chưa kết nối", sync trả 400 "Chưa cấu hình".
Không có chỗ nào trong UI/API cho người vận hành biết shop_id vừa ủy quyền
(callback chỉ redirect /?shopee=ok, không trả shop_id). Đề xuất: status khi
env trống thì đọc shop_id mới nhất từ shopee_shop_tokens và hiển thị luôn để
copy điền env.

2.12. **confirm-delivery thiếu kiểm tra phạm vi kho cho ROLE_SHOPEE_OPS.**
ship và awb đều gọi isShopeeOrderInScope, riêng route này không - nhân viên
Shopee có thể xác nhận nhận hàng cho đơn online bất kỳ (kể cả đơn portal,
đơn kho khác) chỉ bằng order id. Không nhất quán với nguyên tắc đặc quyền
tối thiểu.

2.13. **escrow-sync chưa bóc thuế VN và COGS có nguy cơ luôn null.**
Chưa tách withholding_vat_tax/pit_tax/cit_tax cho kế toán (thiết kế P3 yêu
cầu). COGS lấy từ products.cost_price nhưng ingest ghi
orderItems.productId = editionId - nếu ID hai tầng (edition/product) không
khớp thì COGS luôn null ("trung thực" nhưng thành ra không bao giờ tính
được lãi thật). Cần đối chiếu ID hai tầng trước P3.

2.14. **status báo "đã kết nối" cả khi token đã hết hạn.**
connected = !!access_token, không kiểm tra expired_at. Lần gọi API đầu tiên
sẽ tự refresh nên tự lành, nhưng UI nói dối trong lúc chờ.

### NHỎ

2.15. **auth-url sinh redirect_uri từ origin của request.**
Sau proxy Caddy, req.url mang host nội bộ nếu Caddy không forward Host gốc
(callback và push đã dùng x-forwarded-host, riêng auth-url dùng
new URL(req.url).origin). Runbook bước 2 đã có bước nhìn URL bằng mắt -
lần đầu trên production phải kiểm tra URL sinh ra có phải
https://app.formapubli.vn/api/shopee/callback không.

---

## 3. FUNCTION - routes src/app/api/shopee/

| Route | Vai trò được phép | Đánh giá |
|---|---|---|
| auth-url (GET) | ROLE_OWNER | ĐẠT - 400 rõ khi thiếu key; không lộ secret |
| callback (GET) | công khai (Shopee gọi) | ĐẠT - không hardcode domain, dựng lại từ forwarded headers nên chạy đúng dev/prod; đổi code lấy token 1 lần rồi lưu DB |
| push (POST) | công khai + chữ ký | ĐẠT - code 0 → 200 ngay; còn lại bắt buộc HMAC; idempotent qua ingest |
| status (GET) | OWNER/MANAGER/WAREHOUSE/SHOPEE_OPS | ĐẠT (xem 2.11, 2.14) |
| config (GET/PUT) | GET: +SHOPEE_OPS; PUT đổi kho/COD: Owner (ops_warehouse_ids: Owner/Manager) | ĐẠT |
| queue (GET) | 4 vai trò, phân phạm vi kho cho SHOPEE_OPS | ĐẠT - gồm toPack, toConfirm (D1), quarantine |
| ship (POST) | 4 vai trò + scope kho | ĐẠT |
| awb (GET) | 4 vai trò + scope kho | ĐẠT |
| sync (POST) | 4 vai trò | ĐẠT - hours 1..360, kho từ config runtime (xem 2.11) |

Điểm chỉ test được trên sandbox: ủy quyền test shop 227989704 (token đã có
trên dev). Điểm chỉ kiểm chứng được thật sau đơn live đầu tiên: tracking trễ
trên SPX thật, escrow guarantee 15 ngày của shop Mall, push thật từ Shopee,
phí Mall thật trên hóa đơn.

---

## 4. VẬN HÀNH - đối chiếu runbook

### ĐẠT

4.1. **Bước 1 (env production)**: đủ biến chuẩn
SHOPEE_PARTNER_ID/KEY/BASE_URL/SHOP_ID/UI_ENABLED/WAREHOUSE_ID; code mặc
định BASE_URL = live host khi thiếu env; IP whitelist 160.187.228.139 đã
khai trên console.

4.2. **Bước 2 (ủy quyền shop Mall)**: auth-url + callback + token store
keyed theo shop_id - shop live và shop sandbox không lẫn nhau.

4.3. **Bước 3 (gắn kho xuất)**: PUT /api/shopee/config - Owner only, đã có.

4.4. **Bước 4 (push console)**: endpoint xử lý đúng trên domain production
nhờ forwarded headers; bật nhóm sự kiện làm trên console (không qua API
được) - runbook đã ghi đúng.

4.5. **Bước 5 (D1 gộp cùng đợt)**: code D1 có mặt trên dev, CHƯA có trên
main (commit 3dd8834, migration 0074) - đúng nội dung PR đợt này. Chốt chặn
trong MSInvoiceService.pushInvoice (msinvoice.service.ts:210); consolidateDay
gom theo ngày xác nhận (invoice.service.ts:130); route confirm-delivery +
queue toConfirm + UI cả 2 tab đều có.

4.6. **Bước 6 (kiểm chứng)**: sync/ship/awb/escrow-sync sẵn; bộ kiểm tra
khói scripts/smoke-check.ts có thể chạy lên production ở chế độ chỉ đọc sau
deploy (10 điểm kiểm tra, đã xanh trên dev).

4.7. **Bước 7 (bảo mật)**: REVIEW-01 vô hiệu hoá bằng PATCH staff; code
không hardcode bất kỳ credential sandbox/test nào; token chỉ nằm trong DB
và .env trên máy chủ.

### NÊN SỬA (đã liệt kê ở mục 2, nhắc lại dưới góc vận hành)

4.8. Không có đường lên DELIVERED → bước "đối soát escrow đơn đã giao"
trong runbook hiện không thực hiện được; doanh thu Shopee trong báo cáo =
0. Sửa ở confirm-delivery (mục 2.9).

4.9. Không có quét bù định kỳ → đơn về chậm nếu push mất; vận hành phải nhớ
bấm "Đồng bộ ngay" (mục 2.10).

4.10. Sau ủy quyền phải điền SHOPEE_SHOP_ID vào env nhưng không có chỗ nào
cho biết shop_id (mục 2.11) - dễ kẹt 10 phút quý giá của mã ủy quyền ở lần
làm đầu.

### Ghi chú rollback

Runbook đã có: tắt UI (SHOPEE_UI_ENABLED=0), ngắt kết nối (xoá token),
D1 revert qua PR. Code hỗ trợ đủ.

---

## Phụ lục: danh sách việc theo mức độ (để lập task)

**NÊN SỬA (7):**
1. confirm-delivery: đơn SHOPEE xác nhận xong thì chuyển shippingStatus sang
   DELIVERED (mục 2.9).
2. Quét bù đơn định kỳ hoặc get_lost_push_message (mục 2.10).
3. status/sync: hiển thị shop_id từ DB khi env trống để điền env (mục 2.11).
4. confirm-delivery: thêm isShopeeOrderInScope cho ROLE_SHOPEE_OPS (mục 2.12).
5. escrow: bóc thuế VN + đối chiếu ID hai tầng cho COGS (mục 2.13).
6. status: kiểm tra expired_at trước khi báo connected (mục 2.14).
7. UI: toast "Đã kết nối thành công" sau callback (mục 1.9).

**NHỎ (2):**
1. Tab Shopee khi chưa kết nối: thêm nút "Kết nối gian hàng" cho Owner
   (mục 1.10).
2. Kiểm tra bằng mắt redirect_uri của auth-url lần đầu trên production
   (mục 2.15).
