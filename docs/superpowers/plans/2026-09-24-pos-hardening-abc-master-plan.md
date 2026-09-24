# Kế hoạch triển khai và điều phối A/B/C — POS, phân quyền, session và kho

> Khi triển khai: dùng `executing-plans` cho lane tự thực hiện; chỉ dùng `subagent-driven-development` khi đã giao việc cho subagents. Các checkbox trong tài liệu là công việc tương lai, không phải kết quả đã đạt.

**Goal:** Xử lý đủ 11 vấn đề đã báo cáo và bổ sung chính sách một phiên thu ngân; ưu tiên không sai tiền, không sai tồn, không vượt quyền, không mất đơn khi retry hoặc mất mạng.

**Architecture:** Giữ Next.js App Router, service hiện có và cơ chế transaction/idempotency. Agent A sở hữu ranh giới thanh toán, xác thực và tích hợp; B phụ trách báo cáo/kho; C phụ trách giao diện. Một file chỉ có một người sửa tại một thời điểm. Quyền, tính duy nhất của phiên và hiệu lực phê duyệt phải được kiểm tra ở server.

**Tech Stack:** Next.js 14, React 18, TypeScript, Drizzle ORM, libSQL, OpenNext/Cloudflare Workers; không thêm dependency mặc định.

**Spec:** Yêu cầu của người dùng ngày 24/09/2026 và đặc tả nghiệp vụ ở mục 3–6 của chính tài liệu này. Đây là bản kế hoạch hoàn chỉnh để review/giao việc, chưa phải xác nhận đã triển khai.

**Điều phối kiêm Agent A:** Codex trong cuộc hội thoại hiện tại. Agent B tự nhận là Muse Spark trong phản biện được người dùng chuyển; không giả định B/C chạy trong Codex hoặc dùng cùng tool. Hợp đồng giao việc độc lập harness: file, branch, bằng chứng, tests và kết quả. Việc tạo tài liệu không tự khởi chạy agents, migration hoặc deploy.

**Revision điều phối đã chốt với người dùng:** giữ nhãn source/live-reported; A1-H gồm stable orderCode; mặc định gọi trực tiếp suite tự có DB riêng, runner/fixture dùng chung phải nối tiếp; S-OFFLINE chặn chốt đơn offline mới khi không có lease hợp lệ và giữ giỏ/queue. A nhận toàn bộ logic POS tiền/phê duyệt/payment/session; C chỉ làm UI nhẹ. B được bắt đầu W0 chỉ đọc ngay. Người dùng đã yêu cầu push tài liệu và cấp nhánh; việc đó không bao gồm tự deploy hoặc bắt đầu sửa code sản phẩm.

## 1. Baseline, bằng chứng và trạng thái

- Mã nguồn đã đọc tại HEAD `4a50a2b`, workspace `D:\Data Project\formapubli`.
- Trước khi viết tài liệu có sẵn thay đổi chưa commit ở `src/db/index.ts` và file chưa tracked `scripts/deploy-cloudflare.ts`. Không nhận là thay đổi của kế hoạch này; không reset, stage, commit hoặc ghi đè chúng. A phải xác định baseline tích hợp trước khi mở nhánh triển khai.
- Đã đối chiếu source các luồng orders, discount approvals, auth, cashbox, daily settlement, batch transfer, login và mobile POS. Chưa chạy kiểm thử ứng dụng hoặc tái hiện production trong lượt lập kế hoạch này.
- Các câu “desktop 3/3 pass”, “logout 1 click chết session”, “S1 pass”, “manager API 200” trong kế hoạch đầu vào là **kết quả được báo lại, chưa kiểm chứng lại ở baseline này**. Đính kèm commit, lệnh, môi trường và output trước khi dùng làm gate đã qua.
- “Chậm do cold-start” là giả thuyết, chưa được coi là root cause.
- Đã thấy API orders gọi tạo đơn trước khi consume approval và bắt lỗi consume bằng cảnh báo. Đây là bằng chứng source đủ để ưu tiên viết ca tái hiện; chưa gọi là một cuộc kiểm thử gian lận production đã thực hiện.
- `active_sessions` là tính năng mới, không gắn nhãn một bug đã tái hiện.

### 1.0 Bổ sung baseline từ phản biện Agent B

Đối chiếu lại git: HEAD vẫn là `4a50a2b9034af395bb849e567759ec12cda94918`; việc B rút nhận định “baseline cũ” là đúng. Không dùng ngày viết tài liệu để suy ra branch đã đổi.

| Nội dung | A đã kiểm tra tại source | B báo cáo về triển khai | Quy tắc tránh làm lại |
|---|---|---|---|
| Catalog batch ATP | Có query theo lô trong pos-catalog.service.ts, không gọi getATP từng cuốn; đường danh mục có dữ liệu thường gồm 5 truy vấn kể cả getWarehouse | Live khoảng 60s → 1.5s; equivalence 162/162; S2 pass | Không tối ưu lại catalog trong đợt này; giữ logic ATP, chỉ mở lại nếu có regression đo được |
| Retry auth | validateSessionAccount đã retry tối đa 3 lần, backoff 300/800ms | Đã deploy; desktop login 3/3; logout một click | Giữ retry; #2 chuyển sang retest iPhone và kiểm chứng revoke token riêng, không viết lại theo phỏng đoán |
| Picker | LoginModal đã lọc ROLE_WAREHOUSE/ROLE_TAX ở client | Đã live | C giữ bộ lọc này khi đổi grid; ẩn picker không tương đương revoke quyền server |
| OpenNext/libSQL Windows | next.config.mjs có cặp package tên dùng slash/backslash cho client/core/hrana-client/isomorphic-ws/isomorphic-fetch | B xác định đây là fix copy workerd trên Windows | Không xóa như duplicate khi cleanup; chỉ thay nếu có bằng chứng build/runtime Windows tương đương |
| Dependencies | package.json hiện không khai báo next-on-pages/vercel | B báo đã gỡ, Pages auto-build đã tắt | Không tự phục hồi adapter cũ; trạng thái Pages là cấu hình remote, cần release record của B |
| DNS/Worker và dữ liệu mở đầu | Chưa kiểm tra hạ tầng hoặc DB live trong lượt review | B báo book.formaform.vn đã live/route+DNS xong; Turso “243+243 (81.000/kho)” | Ghi nguyên số liệu B cung cấp, không suy đoán đơn vị/số dòng; tuyệt đối không seed/import lại để “hoàn thiện baseline” |

Các số đo live, lượng tồn, Pages setting và kết quả test trong cột B là bằng chứng bàn giao do B báo cáo, không phải A tự đo. B bổ sung deployment ID/SHA/thời điểm/command/output và nghĩa của số liệu tồn vào báo cáo W0; A không chạy lại import hoặc sửa deployment để lấy bằng chứng. Được tiếp tục task độc lập; trước gắn gate PASS phải đối chiếu đúng build/fixture liên quan.

### 1.1 Trạng thái chuẩn cho mọi ticket

`REPORTED → REPRODUCED → READY → IMPLEMENTING → LOCAL_VERIFIED → INTEGRATED_VERIFIED → DEVICE_VERIFIED → ACCEPTED`.

- `SOURCE_CONFIRMED`: nhãn bổ sung cho đường đi lỗi thấy trong source; vẫn cần regression check trước sửa.
- `PARKED_EVIDENCE`: thiếu đầu vào để tái hiện; không sửa suy đoán. Được giao nhiệm vụ thu thập bằng chứng, không được giao task “fix” chưa xác định.
- `PENDING_DECISION`: thiếu quyết định nghiệp vụ có ảnh hưởng dữ liệu; chỉ chặn phần phụ thuộc quyết định đó.
- `NOT_REPRODUCED`: ghi môi trường và bước đã thử; không đồng nghĩa FIXED.
- Với tính năng mới: ghi `SPECIFIED → READY`, xác nhận hành vi mong muốn và kiểm tra thất bại trên baseline thay cho yêu cầu “tái hiện bug”.

## 2. Luật điều phối và phạm vi thay đổi

1. **Reproduce-first:** bug phải có thao tác tái hiện hoặc kiểm tra tự động thất bại đúng nguyên nhân trước sửa. Không dùng lỗi setup, thiếu bảng hoặc thiếu môi trường làm bằng chứng lỗi nghiệp vụ.
2. **Không commit main:** dùng nhánh `agent/a-<ticket>`, `agent/b-<ticket>`, `agent/c-<ticket>` theo quy ước người dùng. Mỗi agent dùng checkout/worktree riêng; không checkout đổi branch trong thư mục người khác đang làm.
3. **A quyết định tích hợp:** mỗi nhánh báo base SHA và head SHA. Không tự merge nhánh khác, không tự push/deploy production trong task con.
4. **Một chủ sở hữu mỗi file:** không chia theo “vùng code” để cho hai agent sửa cùng file. Thay chủ sở hữu phải ghi ticket bàn giao và SHA đã merge.
5. **Test theo tài nguyên thực:** mặc định gọi trực tiếp suite tự tạo DB riêng để chạy song song. Chỉ dùng runner khi cần fixture base chung; các lượt dùng chung DB phải báo nhau và chạy nối tiếp. Không có thủ tục xin slot cho DB riêng. Ghi đường dẫn DB tuyệt đối và checkout trước chạy; hai lượt cùng suite/cùng cwd không được chạy đồng thời vì vẫn dùng một filename. Kiểm cả import/setup/cleanup, không chỉ tên DB trong suite. Không cấp lại DB chung khi process cũ chưa thoát.
6. **Cách ly DB:** chỉ chạy DB test đã xác minh là file test; không seed/reset DB thật hoặc DB cloud. Dùng runner có sẵn, kiểm tra đường dẫn thực trước mọi cleanup.
7. **Migration:** chỉ task S-01 được sửa schema/migrations/journal. Nếu ticket khác thật sự cần migration, dừng riêng phần đó và báo A thay đổi thiết kế; không lén nhét vào migration session.
8. **Không hạ tiêu chuẩn để xanh test:** không bỏ guard, giảm quyền kiểm tra, tắt AUTH_STRICT hoặc đổi expected sang hành vi sai.
9. **Tiền và tồn:** mọi thất bại phải có kiểm tra không ghi một phần. Toast thành công không phải bằng chứng transaction đã đúng.
10. **Giữ danh tính thật:** actor lấy từ session đã xác thực, không tin staffId/role/giá/đã nhận tiền do client tự khai như bằng chứng quyền.
11. **Không log PIN, cookie, token, AUTH_SECRET:** log request/correlation ID, mã lỗi, actor nội bộ và số liệu kiểm thử đã khử nhạy cảm.
12. **Commit nhỏ:** bug dùng `fix(<scope>): <nội dung> (bug #N)`; session mới dùng `feat(auth): enforce cashier session lease (S-01)`. Không gộp formatting hàng loạt.
13. **Giữ dữ liệu cũ:** không đổi hàng loạt payment enum, order code, lịch sử kho hoặc xóa hàng đợi offline để làm sạch lỗi.
14. **Không tự mở rộng:** không xây hệ thống khóa sổ ngày mới, tái cấu trúc POS toàn bộ, thêm SSE, đổi DB adapter hoặc thay kiến trúc auth ngoài phạm vi cần thiết.
15. **Phân biệt kết quả:** test local, build Worker, smoke triển khai và kiểm tra iPhone là bốn loại bằng chứng khác nhau.

### Review Focus

- Retry sau khi server commit nhưng response bị mất: trả cùng đơn, không trừ kho/tiêu thụ duyệt lần hai — A/#1.
- Thu hồi/TTL hết hạn trong lúc request bán hàng đang chờ: phiên cũ không ghi đơn sau phiên thay thế — A/S-01.
- Tổng ngày bị lọt qua endpoint “báo cáo ca” hoặc sessionId của người khác — B/#3, A review.
- Bulk edit hoặc response validate cũ làm commit một giỏ chuyển kho khác với giỏ đang thấy — B/#5.
- iPhone ngủ nền/mất mạng, QR đổi số tiền, callback phê duyệt cũ: không xác nhận đơn sai hay xóa hàng đợi — C/#7/#8 và A/#1/S-01.

## 3. Danh mục đầy đủ các vấn đề

P0/P1 dưới đây là thứ tự xử lý đề xuất, không phải tuyên bố severity đã được tái hiện trên production.

| ID | Nội dung | Bằng chứng hiện tại | Ưu tiên | Chủ trì | Wave |
|---|---|---|---|---|---|
| #1 | Phê duyệt chiết khấu không ràng buộc an toàn với checkout; khóa giỏ và thiếu chi tiết duyệt | Source xác nhận thứ tự create/consume có vấn đề | P0 | A cả server và POS UI | 1 + 1B |
| #2 | Login/logout cần bấm hai lần | Retry 3 lần có trong source; B báo desktop 3/3 và logout một click; iPhone/token revoke chưa được A kiểm chứng | P1; nâng P0 nếu giữ quyền trái phép/chặn bán diện rộng | A | Retest iPhone; sửa khi tái hiện |
| #3 | Thu ngân xem/chạm báo cáo tổng ngày | Source API daily settlement cho phép cashier | P0 về quyền | B; A review bắt buộc | 1 |
| #4 | Chuyển kho hàng loạt không xác nhận được | Chưa có status/error/payload của lần lỗi | P1; nâng nếu chặn cấp hàng hội chợ | B điều tra, A xử lý nếu lỗi transaction | Parked |
| #5 | Thiếu chọn/xóa/số lượng hàng loạt | Có modal và thêm nhanh sách còn tồn; cần bổ sung phần thiếu | P1 | B | 2 |
| #6 | Quản lý kẹt CRUD ngân hàng/nhân viên/kho/gán kho | Nhiều API/UI đã có; chưa xác định thao tác kẹt | P1 | B điều tra; A duyệt quyền | Parked |
| #7 | Thanh toán nổi mobile chỉ scroll | Source có scrollIntoView | P2; nâng nếu cản bán trên máy thực | A; C kiểm giao diện chỉ đọc | 2 |
| #8 | Chuyển khoản/QR tách lựa chọn | Source có hai payment method | P2 | A; C kiểm giao diện chỉ đọc | 2 |
| #9 | Login thiếu hiện PIN, bố cục dài, tải danh sách chậm | UX cần cải thiện; nguyên nhân chậm chưa biết | P2 | C UI, A điều tra latency khi cần | 1 |
| #10 | Tạo kho thiếu phản hồi/CTA; quản lý khác không biết | Cần kiểm tra flow tạo kho; polling duyệt đã có | P2 | B phản hồi/CTA | 3; sync tách riêng |
| #11 | Danh mục nhanh mobile chiếm diện tích | Yêu cầu layout | P2 | C | 2 |
| S-01 | Chặn đăng nhập cashier thứ hai, TTL và force-release | Chính sách đã chốt, chưa triển khai | P1, rủi ro triển khai cao | A | 3 sau UI W2 |

### #1 — Phê duyệt chiết khấu và giỏ hàng

**Ở đâu:** POS, drawer/modal phê duyệt, API orders và service ghi đơn.

**Tái hiện:** cashier tạo giỏ X, xin giảm vượt ngưỡng, manager duyệt; thay số lượng/thêm sách rồi checkout, hoặc gửi trực tiếp request thay giỏ nhưng giữ approval ID. Thử thêm hai request đồng thời và retry response bị mất.

**Hiện trạng:** `src/app/api/orders/route.ts` kiểm tra status APPROVED trước createOrder; gọi consumeApproval sau createOrder và chỉ warn nếu lỗi. Service approval đã có cartHash; do đó cần sửa chỗ ghép transaction, không viết lại toàn bộ cơ chế duyệt.

**Mong đợi và phạm vi:**

- Server ràng buộc request duyệt với actor, kho, orderCode ổn định, giỏ đã chuẩn hóa, giá do server xác định và mức giảm thực tế từng dòng.
- Cùng transaction: kiểm tra replay, xác thực phê duyệt, tiêu thụ có điều kiện, ghi đơn/dòng đơn/tồn/két. Thất bại bất kỳ bước nào rollback toàn bộ.
- Một approval không dùng cho hai đơn khác nhau; cùng idempotency key và nội dung thì trả lại đơn đã có. Hai request cùng key có thể đều nhận 2xx replay, nhưng chỉ tạo một đơn. Hai key khác nhau dùng cùng approval thì chỉ một đơn được commit.
- Pending/approved khóa thêm/xóa/sửa hàng, số lượng, mức giảm, đổi kho, parser, scanner, shortcut và reset giỏ. Nút “Sửa giỏ và hủy phê duyệt” phải hủy ở server trước khi bỏ khóa; mất mạng khi hủy thì giữ trạng thái rõ ràng, không tự giả định hủy thành công.
- Reject/expired/superseded bỏ mức giảm được cấp; không để callback muộn khôi phục approval cũ.
- Manager thấy kho, cashier, từng dòng, số lượng, đơn giá, tổng trước giảm, mức/số tiền giảm và tổng sau giảm từ snapshot đáng tin cậy.
- Giữ luồng dưới ngưỡng; phân biệt rõ gift, bundle, PIN override và offline emergency. Không để một nhánh được miễn kiểm tra chỉ vì tên method.

**Không làm:** chỉ thêm isLocked; chỉ dời consume lên trước nhưng vẫn ngoài transaction; dùng pin do client gửi làm bằng chứng đã duyệt; tự thêm bảng approval mới.

**Ca nghiệm thu:** D01 giỏ đúng; D02 thêm/bớt/sửa quantity; D03 đổi kho/actor; D04 đổi giá/line discount; D05 expired/rejected/superseded; D06 hai key/một approval; D07 cùng key/cùng payload; D08 cùng key/khác payload; D09 lỗi sau consume rollback cả approval và order; D10 bundle/gift/override không tạo đường bỏ qua; D11 callback cũ; D12 reload và đổi kho khi đang xin duyệt.

### #2 — Login/logout cần thao tác hai lần

**Ở đâu:** `LoginModal.tsx`, `MasterAppShell.tsx`, auth login/logout/me và guard session.

**Cập nhật B:** desktop được báo PASS 3/3 sau deploy retry auth, logout một click. Giữ kết quả này với nguồn B, không tiếp tục giả định desktop đang lỗi; lấy deployment/log để đối chứng. Logout một click chưa chứng minh signed token bị thu hồi server-side: test token cũ là ca riêng. iPhone vẫn chưa nghiệm thu trong tài liệu này.

**Tái hiện:** mới mở app → chọn nhân viên → nhập đúng PIN → một lần submit; sau vào app → một lần logout → thử gọi lại endpoint bảo vệ bằng phiên cũ trong môi trường test. Lặp với reload, tab thứ hai, mạng chậm và iPhone ngủ nền.

**Ghi nhận lỗi:** lần bấm, thứ tự request login/me/logout, HTTP status/code, Set-Cookie có/không (không ghi giá trị), redirect/reload, request ID, timestamp và build SHA. Phân biệt mất cookie, DB unavailable, guard từ chối và UI stale.

**Mong đợi:** một submit hợp lệ vào app; một logout xóa cookie đúng thuộc tính và vô hiệu hóa quyền theo contract session. Không coi UI hiện màn hình login là chứng minh token cũ chết. Lỗi tạm thời của DB không được tự gắn nhãn “sai PIN”.

**Điều tra source:** logout client hiện không kiểm tra res.ok trước reload; /auth/me hiện xóa cookie khi validateSessionAccount ném lỗi. Đây là điểm kiểm tra, không phải root cause đã chốt.

**Mở parked:** có lần lỗi với bằng chứng trên hoặc regression check thất bại. Test iPhone ghi phiên bản nếu lấy được, nhưng không bắt người dùng đổi máy/browser hay cung cấp model mới được điều tra.

**Nghiệm thu:** login/logout mỗi thao tác một lần; reload vẫn đúng trạng thái; cookie cũ xử lý đúng contract; lỗi server hiện rõ, không vòng lặp vô hạn; giữ brute-force/rate limit. A quyết định sửa trước S-01 nếu lỗi auth đang chặn test session.

### #3 — Quyền báo cáo ca/ngày và đóng ca

**Ở đâu:** `/api/pos/daily-settlement`, `/api/cashbox`, `DailySettlementService`, nút Chốt Ngày.

**Tái hiện:** dùng cookie cashier gọi API tổng ngày trực tiếp; đổi warehouseId/sessionId sang kho/ca khác. Kiểm tra cả response JSON, không chỉ menu.

**Hiện trạng cần hiểu đúng:** nút “Chốt Ngày” mở báo cáo; API đã đọc là GET. Không tự biến ticket này thành tính năng khóa sổ ngày có mutation/migration mới.

| Thao tác | Cashier | Manager | Owner | Warehouse | Tax |
|---|---|---|---|---|---|
| Xem số liệu ca của mình | Cho phép, server ép actor/phạm vi | Cho phép trong phạm vi được cấp | Cho phép | 403 endpoint POS này | 403 endpoint POS này |
| Xem tổng ngày theo kho | 403 | Cho phép trong phạm vi được cấp | Cho phép | 403 | 403 |
| Đóng ca | Chỉ ca OPEN của chính mình | Cho phép trong phạm vi được cấp | Cho phép | 403 | 403 |
| Mở báo cáo Chốt Ngày | 403 | Cho phép | Cho phép | 403 | 403 |

- Quyền tax ở báo cáo thuế riêng không bị xóa bởi ma trận này.
- B giữ GET daily-settlement chỉ owner/manager. Cashier xem ca qua cashbox; nếu cần endpoint chi tiết ca, chỉ thêm projection tối thiểu, không trả toàn bộ daily payload rồi che ở UI.
- Không cho cashier bỏ sessionId để nhận tổng ngày hoặc chọn ca người khác. Ngày/kho/actor lấy theo ca thực, không chỉ tin query.
- Close ca dùng kiểm tra quyền và trạng thái trong đường ghi; hai lần close không tạo bút toán hai lần. B không sửa `order.service.ts` song song với A; phát hiện lỗ hổng ở CashboxService thì giao patch cho A.

**Nghiệm thu:** 5 role × 4 thao tác tự động bằng cookie thật trong fixture; thêm thiếu cookie 401, header tự xưng manager, đổi sessionId, đổi kho và ca đã đóng. Manual là bổ sung, không thay test API.

### #4 — Chuyển kho hàng loạt không xác nhận được

**Ở đâu:** `BatchTransferModal`, validate API, commit API và `InventoryService`.

**Tái hiện:** chọn nguồn/đích, 1 dòng trước rồi 60–80 dòng, kiểm tra tồn, xác nhận. Ghi role, cặp kho, loại kho, số dòng, quantity, status/code và request ID.

**Phân loại cần làm trước sửa:** 401 session; 403 quyền; 409 ATP stale/idempotency; 400 dữ liệu; timeout/5xx adapter hoặc transaction; validationSuccess bị UI giữ sai. Không gom tất cả thành “lỗi OpenNext”.

**Mong đợi:** chỉ kho/cặp kho hợp lệ mới được chuyển trực tiếp; đủ tồn và atomic trên mọi dòng. Hàng xuất–vận chuyển–nhận tiếp tục dùng luồng nhiều chặng, không cộng tồn đích sớm.

**Nghiệm thu:** commit một lần có phiếu; retry không tạo hai phiếu; một dòng thiếu thì toàn batch không ghi; tồn đổi giữa validate/submit trả 409 kèm staleItems; giữ form khi lỗi; UI không toast thành công trên response lỗi.

**Mở parked:** repro local/preview cùng payload hoặc bằng chứng prod đủ phân loại. B thu thập; A nhận nếu lỗi nằm ở transaction/adapter. Không sửa thay đổi đang có trong `src/db/index.ts` khi chưa xác định chủ sở hữu.

### #5 — Chọn/xóa/số lượng hàng loạt

**Ở đâu:** `src/components/inventory/BatchTransferModal.tsx`.

**Hiện trạng:** đã có thêm nhanh toàn bộ sách có tồn. Tái sử dụng; không tạo thêm luồng khác cùng tác dụng.

**Mong đợi cụ thể:**

- Checkbox mỗi dòng; “Chọn tất cả dòng đang hiển thị” có trạng thái chọn một phần; số dòng đã chọn luôn hiện rõ.
- “Xóa dòng đã chọn” không đụng dòng chưa chọn. “Xóa tất cả” yêu cầu xác nhận ngắn và chỉ xóa giỏ chuyển kho, không xóa sản phẩm.
- Ô số lượng áp dụng cho dòng đã chọn; nếu không chọn thì nút disabled, không âm thầm sửa tất cả. Muốn sửa tất cả dùng Chọn tất cả trước.
- Chỉ nhận số nguyên dương hữu hạn. Không âm, 0, NaN, thập phân; không tự cap tồn rồi báo đã áp dụng đúng số người dùng nhập.
- Mọi sửa dòng/kho làm kết quả validate cũ hết hiệu lực. Response validate về muộn cho phiên bản form cũ không được bật nút commit.
- Giữ giá trị và cảnh báo trên 409; “Hạ về tồn tối đa” xử lý tồn 0 bằng loại dòng có thông báo hoặc bắt bỏ dòng, không nâng 0 lên 1.
- Khi submit khóa các thao tác thay payload; retry cùng payload dùng cùng key, sửa payload sau kết quả xác định thì key mới. Không tự tạo key mới khi response timeout chưa biết server commit chưa.

**Nghiệm thu:** 80 dòng; lọc rồi chọn; xóa phần chọn; hủy xóa tất cả; nhập sai quantity; stale response; ATP 0; double click; mất mạng giữ form. Không đổi quyền server hoặc chính sách chuyển kho trong ticket UX này.

### #6 — Manager CRUD và gán kho/ngân hàng/nhân viên

**Ở đâu:** StaffManager, BankAccountsManager, WarehouseBankManager, API staff/bank-accounts/warehouses.

**Mong đợi nghiệp vụ:** manager tạo kho hoạt động, gán cashier đủ điều kiện, gán ngân hàng nhận tiền, cấu hình nội dung chuyển khoản nếu tính năng hiện có hỗ trợ. Không cho manager sửa/tạo owner hoặc tài khoản đặc quyền.

**Phải tách thành ca cụ thể:** tạo nhân viên cashier; sửa cashier; vô hiệu hóa; gán kho; tạo kho; tạo ngân hàng; gán ngân hàng mặc định; chỉnh mẫu nội dung. Mỗi ca ghi entry point UI, payload khử nhạy cảm, status và expected.

**Hiện trạng:** API/UI cho nhiều thao tác đã tồn tại. API 200 chỉ chứng minh route đó thành công với payload đó, chưa chứng minh UI gán kho hoặc quyền cấp thấp đã đúng.

**Mở parked:** một thao tác cụ thể thất bại hoặc thiếu giao diện có thể quan sát. Nếu mẫu nội dung chưa tồn tại và cần schema thì ghi feature riêng; không gọi đó là bug API, không vi phạm luật migration.

**Nghiệm thu:** sau lưu/reload vẫn đúng; cashier không sửa cấu hình; manager không vượt cấp; ngân hàng ngừng dùng không làm hỏng hóa đơn cũ; thay ngân hàng khi đang thanh toán không âm thầm đổi người nhận của giao dịch đang xác nhận.

### #7 — Nút thanh toán nổi trên mobile

**Ở đâu:** `PosCheckoutTerminal.tsx`; source hiện scroll tới vùng giỏ hàng.

**Mong đợi:** tap mở ngay vùng xác nhận thanh toán dạng sheet/modal dùng lại giỏ và tính tổng hiện có; không tự gọi chốt đơn chỉ vì tap nút nổi. Chỉ nút xác nhận cuối mới ghi đơn.

**Ràng buộc:** một nguồn dữ liệu giỏ; không render hai bộ handler thanh toán độc lập. Nút tĩnh và nút nổi mở cùng flow. Giữ kiểm tra ca, ATP, phê duyệt, busy và session. Bàn phím/QR/safe-area không che nút xác nhận; ngoài sheet có thể đóng khi không busy và không mất giỏ.

**Nghiệm thu:** tap một lần mở sheet; đóng/mở giữ giỏ; không có order trước xác nhận; double click chỉ một order; focus vào sheet và trở lại nút mở; iPhone thật kiểm tra safe-area và bàn phím.

### #8 — Gộp Chuyển khoản/QR

**Ở đâu:** POS payment UI, VietQR, snapshot hóa đơn, offline queue và báo cáo liên quan.

**Mong đợi:** một lựa chọn “Chuyển khoản / QR”, hiện số tài khoản/ngân hàng/chủ tài khoản/số tiền/nội dung và QR nếu tạo được. “Đã nhận tiền” là xác nhận thủ công của cashier, không phải webhook ngân hàng.

**Contract dữ liệu:** giữ server chấp nhận BANK_TRANSFER và QR_CODE cũ. Đơn mới từ lựa chọn hợp nhất lưu BANK_TRANSFER; điều kiện render QR/snapshot dựa vào lựa chọn chuyển khoản chứ không còn chỉ `=== QR_CODE`. Không migration dữ liệu lịch sử. Báo cáo cộng cả hai đúng một lần. Queue cũ giữ nguyên enum đã lưu.

**Ca cần giữ:** QR lỗi vẫn có thông tin chuyển khoản thủ công; chưa cấu hình tài khoản thì thông báo rõ và không ghi nhận đã chuyển khoản sang một tài khoản đoán; thay số tiền/giỏ làm QR và nội dung cập nhật cùng phiên bản; giữ orderCode thống nhất với approval và checkout.

**Nghiệm thu:** CASH không đổi; hai enum lịch sử đọc/in/báo cáo đúng; online mới và offline sync không trùng đơn; QR snapshot đúng số tiền; không có order chỉ vì QR hiện lên. Không thêm tích hợp ngân hàng tự động.

### #9 — Login UX và tốc độ tải

**Ở đâu:** chỉ `src/components/auth/LoginModal.tsx` cho C ở Wave 1.

**Mong đợi UI:** PIN mặc định ẩn; nút mắt type=button, aria-label/aria-pressed đúng, không submit form; giữ giá trị khi bật/tắt; reset về ẩn khi đóng/đổi người. Không phá loading/rate-limit/locked state.

**Lưới:** danh sách đang là tài khoản nhân viên, không mặc định gọi mọi ô là ca két. Hai cột ở viewport phù hợp; 4 ô đầu tạo khung 2×2, người thứ 5 trở đi vẫn truy cập được. Tên dài không che nút hoặc ép chữ quá nhỏ.

**Tải chậm:** C thêm trạng thái loading/error/retry dễ hiểu nếu thiếu, không cache danh sách staff trong đợt này. A đo riêng thời gian mạng, query và auth để xác định cold-start hay nguyên nhân khác. Không đóng bug latency chỉ vì layout gọn.

**Nghiệm thu:** PIN có số 0 đầu; Enter chỉ submit một lần; toggle không submit; >4 tài khoản; mạng lỗi có retry; bàn phím mobile; khóa brute-force vẫn giữ.

### #10 — Phản hồi sau tạo kho và đồng bộ quản lý

**Phần giao ngay Wave 3:** sau response tạo kho thành công, toast rõ tên kho, cập nhật danh sách local và CTA “Chuyển hàng vào kho này”. CTA truyền kho mới làm đích của BatchTransferModal, nguồn hợp lệ khác đích. Kho mới không đủ điều kiện nhận theo flow hiện hành thì giải thích rõ.

**Nghiệm thu:** reload còn kho; CTA mở đúng đích; tạo lỗi không hiện thành công; double click không tạo hai kho; đóng CTA không mất kết quả tạo.

**Phần tách riêng:** tự cập nhật ở máy manager B/C và thông báo ai tạo kho. Chưa triển khai trong scope core. Muốn mở phải ghi độ trễ chấp nhận, nguồn sự kiện có actor, chính sách tab nền và quota; ưu tiên refresh khi focus hoặc tái sử dụng cơ chế có sẵn. Polling approval hiện có không tự biến thành thông báo kho nếu API không trả sự kiện kho.

### #11 — Danh mục nhanh mobile 2×2

**Mong đợi:** 2 cột trên mobile đủ rộng, 4 danh mục đầu trong khung gọn; tất cả danh mục còn lại vẫn chọn được. Tên dài wrap/ellipsis có tên đầy đủ cho accessibility. Không hardcode chỉ còn 4 danh mục.

**Nghiệm thu:** 0/1/4/>4 danh mục; trạng thái đang chọn; xoay ngang; chữ lớn; touch target tối thiểu 44×44 CSS px theo tiêu chí dự án; desktop không hỏng. Không biến “2×2” thành ép mọi màn hình chỉ được một kích thước.

## 4. S-01 — Thiết kế chính sách một phiên cashier

### 4.1 Mục tiêu và giới hạn

- Áp dụng ROLE_CASHIER. Owner/manager vẫn có thể dùng nhiều thiết bị; không vô tình khóa họ khi thêm guard.
- Đơn vị khóa là một staff account; hai tab chung cookie là cùng một phiên, không phải hai cashier. Private window/thiết bị khác không có cookie phiên cũ là phiên khác.
- Một phiên auth không đồng nghĩa một ca két. Logout, TTL hết hoặc force-release không tự chốt ca, không sửa số tiền hoặc xóa giỏ/queue.
- Heartbeat mỗi 5 phút; lease TTL 10 phút tính từ server. Cookie có tuổi thọ riêng hiện là 12 giờ; lease không kéo dài vô hạn cookie đã hết hạn.
- Không bảo đảm tablet/iPhone chạy timer nền. Mở lại app phải revalidate trước thao tác ghi.
- “Kill app → nhả trong 10 phút” đo từ lần gia hạn thành công cuối cùng, không từ một sự kiện kill mà server không thể quan sát.

### 4.2 Quyết định nghiệp vụ đã chốt

**S-OFFLINE: chặn chốt đơn offline mới khi không có lease hợp lệ; giữ nguyên giỏ và queue.** Người dùng đã nhắc lại quyết định trong phán quyết sau review; bỏ trạng thái chờ xác nhận. **Concurrent-login:** cashier-only, giữ phiên cũ, chặn phiên mới; không kick-old. S-01 không còn blocked về quyết định nghiệp vụ, nhưng vẫn phải qua migration/test/release gates.

- Client chỉ cho chốt offline trong thời hạn lease đã được server xác nhận gần nhất; không tự kéo dài theo đồng hồ chỉnh tay, không có lease hoặc trạng thái lease không xác định thì chỉ giữ nháp.
- Khi hết hạn, app tiếp tục cho xem/giữ giỏ nhưng khóa chốt mới và yêu cầu kết nối/xác minh lại. Resume sau sleep phải revalidate trước thao tác ghi.
- Đơn đã lưu trước đó không bị xóa hoặc tự đổi cashier khi token hết hiệu lực. Chỉ sync sau xác thực đúng actor/quyền; xung đột cần giữ queue và hiển thị để đối soát.
- Server vẫn phải chặn session cũ sau force-release; UI offline không thể biết ngay một lần thu hồi từ xa khi chưa có mạng. Cam kết là bảo vệ ghi server và giới hạn chốt offline theo lease cuối đã xác minh, không khẳng định có thể thu hồi tức thì trên máy mất mạng.

### 4.3 Dữ liệu tối thiểu và phân vai sessionVersion

Bảng `active_sessions` mới, một row tối đa trên mỗi cashier:

| Trường | Ràng buộc / mục đích |
|---|---|
| staff_id | Primary key, tham chiếu staff account |
| session_id | Unique, random mạnh do server sinh, khớp signed cookie |
| started_at | Server timestamp UTC |
| last_seen_at | Server timestamp UTC |
| lease_expires_at | Server timestamp UTC, không nhận từ client |
| device_label | Chuỗi ngắn đã sanitize; chỉ để hiển thị, không dùng làm bằng chứng sở hữu |

- Tái sử dụng `SessionPayload.sessionId` đã có; sinh bằng Web Crypto thay vì dựa Math.random cho phiên mới.
- `active_sessions` giữ quyền chiếm phiên; `sessionVersion` tiếp tục là cơ chế thu hồi token. Không thêm revokeVersion thứ hai.
- Không coi device label là thiết bị đã xác minh. Message hiển thị “phiên bắt đầu lúc …, thiết bị tự khai …” hoặc label tổng quát. Không gọi started_at là giờ mở ca nếu chưa có ca.
- Không cần cron xóa TTL: login dùng điều kiện lease đã hết để thay row nguyên tử. Dữ liệu lịch sử quản trị dùng audit hiện có.

### 4.4 Luồng server và tính nguyên tử

1. **Login:** xác thực PIN/rate limit trước khi tiết lộ trạng thái phiên. Trong transaction, kiểm tra lại staff active/role/version; nếu có cookie hợp lệ khớp row đang sống thì tái sử dụng phiên, không tự khóa chính mình khi submit lặp.
2. **Login khác phiên:** row còn sống → 403 `SESSION_ACTIVE_ELSEWHERE`, thông tin hiển thị tối thiểu sau khi xác thực đúng. Phiên cũ không bị bump version/gia hạn/hủy bởi lần login bị chặn.
3. **Chiếm lease:** row chưa có hoặc đã hết → insert/update có điều kiện nguyên tử, kiểm tra số dòng thay đổi. Hai login đồng thời chỉ một session_id thắng; không SELECT ngoài transaction rồi insert không điều kiện.
4. **Cấp cookie:** chuẩn bị dữ liệu ký trước commit nếu có thể; commit rồi trả cookie. Lỗi trả response có thể để lease tồn tại chưa nhận cookie: ghi nhận khả năng hồi phục qua cùng cookie nếu đã nhận, force-release hoặc TTL; không tự xóa row của phiên mới khi retry cleanup.
5. **Guard:** mọi cashier request bảo vệ phải kiểm tra token, account/version và row session_id còn sống. Thiếu row/mismatch/hết TTL → 401 với code phân biệt. Không chỉ kiểm tra ở login/heartbeat.
6. **Gia hạn:** heartbeat chỉ UPDATE row còn sống khớp staff/session/version hiện hành; tuyệt đối không UPSERT để hồi sinh phiên hết hạn. Hoạt động API hợp lệ có thể gia hạn theo cùng helper; throttle ghi để không UPDATE mỗi polling request. Không dùng Map trong một Worker làm khóa toàn hệ thống.
7. **Ghi tiền/tồn:** request có thể qua guard rồi chờ trong khi force-release diễn ra. A kiểm tra lease/account lại trong transaction ghi đơn và các mutation cashier trọng yếu; share cùng thứ tự khóa/transaction với claim/release. Request bị thu hồi trước thời điểm commit hợp lệ không được ghi từ phiên cũ.
8. **Logout:** xóa có điều kiện `staff_id + session_id`; cookie cũ không xóa lease máy mới. Hủy token hiện hành theo contract version/lease, xóa cookie đúng path; audit lỗi không được làm UI báo logout thành công khi server còn session sống. Không tự close cashbox.
9. **Force-release:** chỉ manager/owner, target chỉ cashier trong scope quản lý. Transaction xóa row và tăng sessionVersion; không cập nhật version từ giá trị client. Hiển thị confirmation, lý do và cảnh báo đơn chưa sync không bị xóa. Audit actor/target/time/reason, không ghi token.
10. **DB unavailable:** fail closed với lỗi tạm thời rõ ràng, không giả là sai PIN và không tự xóa queue. Guard/me không nên xóa cookie chỉ vì sự cố DB có thể hồi phục.

### 4.5 Contract API dự kiến, A sở hữu

- `POST /api/auth/heartbeat`: cookie-only, không nhận actor/session_id do client làm nguồn quyền. Thành công `{success:true,data:{leaseExpiresAt,serverTime}}`; 401 phiên mất hiệu lực; 503 lỗi tạm thời. Giữ response envelope hiện có.
- `POST /api/staff/[staffId]/release-session`: body `{reason:string, expectedSessionId:string, expectedSessionVersion:number}`; manager/owner; target cashier. UI lấy expected fields từ response quản trị đã được phân quyền. Transaction chỉ release khi row và version khớp. Nếu không còn lease và version đã thay đổi thì trả 409 để refresh, không tăng version lần nữa; nếu đã có phiên mới cũng trả 409, không hủy phiên mới. Retry không được coi là quyền giải phóng bất kỳ phiên hiện hành nào.
- `GET /api/auth/me`: thêm leaseExpiresAt/serverTime cho cashier sau kiểm tra; không đưa PIN/token ra response. Role khác giữ contract cũ.
- Login giữ 403 `SESSION_ACTIVE_ELSEWHERE`; user không có PIN đúng không nhận thông tin thiết bị/phiên.
- A bổ sung lease summary gồm sessionId/sessionVersion/startedAt/leaseExpiresAt/deviceLabel vào response quản trị staff chỉ cho manager/owner đúng scope; không đưa vào danh sách tài khoản công khai ở màn hình login. A thực hiện cả route lẫn StaffManager nên không cần chia task qua agent khác.

### 4.6 Kiểm thử S-01

S01 A login, B bị 403; S02 A logout, B login; S03 hết TTL, B login; S04 hai login đồng thời; S05 heartbeat máy cũ sau máy mới → không hồi sinh; S06 logout cũ không xóa row mới; S07 force-release thu hồi cookie cũ; S08 retry force-release không hủy phiên mới; S09 manager/owner hai máy; S10 hai tab cùng cookie; S11 background iPhone >TTL rồi resume; S12 request đang chờ vs release; S13 DB down vs token invalid; S14 account đổi PIN/role/active; S15 token legacy thiếu sessionVersion/sessionId; S16 queue cũ còn nguyên sau logout/force-release; S17 sai PIN không lộ phiên; S18 heartbeat trễ ở mốc TTL; S19 close tab không bảo đảm logout; S20 retry login mất response.

Test TTL dùng thời gian cố định/điều chỉnh fixture DB, không sleep 10 phút trong suite. Kiểm thử iPhone thật vẫn cần để xác nhận behavior nền.

### 4.7 Migration, bật policy và phục hồi

- A chọn số migration kế tiếp sau rebase; không giả định 0022 còn trống khi bắt đầu. Sửa schema, migration và journal đồng bộ trong cùng task.
- Migration additive: không xóa/sửa hàng loạt orders/cashbox/payment. Test cả DB mới và nâng từ schema hiện tại có dữ liệu.
- Rollout hai bước: deploy schema + code tương thích khi policy chưa bật; sau kiểm chứng implementation đúng S-OFFLINE đã chốt mới bật enforcement.
- Phiên cashier legacy không có lease/version không được miễn guard vô thời hạn khi bật policy. Thông báo đăng nhập lại; giữ draft/queue, không tự gán lease cho mọi token cũ cạnh tranh.
- Rollback ưu tiên về bản đã có schema tương thích; giữ bảng additive, không DROP làm mất trạng thái. Tắt enforcement là nới chính sách, chỉ thực hiện theo quyết định vận hành có ghi nhận, không tự coi là rollback vô hại.
- Mọi migration remote/deploy cần release gate riêng; không chạy trong task lập kế hoạch.

## 5. Contract triển khai Agent A — phần khó và quan trọng nhất

### A1 — Transaction phê duyệt và tạo đơn (#1 server)

#### A1-H — Hotfix có ranh giới phát hành riêng

**Mục tiêu:** chặn dùng phê duyệt sai/đã dùng mà vẫn giữ checkout hợp lệ hoạt động. Branch dự kiến `agent/a-bug1-hotfix`; review B; code base W0 là `4a50a2b9034af395bb849e567759ec12cda94918` cho đến khi A phát hành base tích hợp mới.

**Bắt buộc trước ship:** phần A1.1–A1.5 liên quan đường checkout; actor/kho/giỏ/giá/mức giảm/expiry phải khớp; consume có điều kiện và order/items/ledger/cashbox cùng transaction; replay đúng nội dung trả đúng đơn; lỗi không bị nuốt. Kiểm tra alternate authorization đang hoạt động (PIN/OTP/emergency), không ship nếu chúng bỏ qua hotfix vừa thêm.

**Gates tối thiểu:** D01 giỏ hợp lệ; D02 sai giỏ; D03 sai actor/kho; D04 sai giá/mức giảm; D05 hết hạn/trạng thái sai; D06 hai key một approval; D07 cùng key replay; D08 key cũ payload mới; D09 rollback; D10 kiểm nhánh thay thế thực sự được phép trên đường production. D02/D06/D07/D09 là bốn ca trọng tâm, không đủ làm toàn bộ release gate vì không bắt false rejection hoặc bypass identity/price.

**Bridge UI bắt buộc, A tự làm:** source đang có activeOrderCode dùng xin duyệt/QR nhưng checkout sinh const orderCode khác. A sở hữu PosCheckoutTerminal.tsx và thống nhất mã đơn/mapping giá/payload ngay trong A1-H; không giao logic này cho C. Hotfix chưa đạt D01 qua UI nếu bridge chưa xong. C1 chỉ sửa LoginModal nên vẫn chạy song song không đụng file A.

**Được để A1-F:** drawer chi tiết, freeze UX toàn bộ, callback/reload matrix D11/D12, hủy/supersede phục vụ “Sửa giỏ” và review rộng các endpoint đọc ngoài checkout. Các lỗ hổng cấp quyền phát hiện trong đường checkout vẫn là blocker A1-H, không đẩy qua backlog để ship.

**Đầu ra:** commit hotfix, commit bridge nếu có, negative/positive/race/rollback evidence và release artifact SHA. Không migration, không catalog optimization, không session policy.

#### A1-F — Hoàn thiện sau hotfix

Tiếp tục A1.6–A1.8 và A4 phần UI phê duyệt, hoàn thành D01–D12 trên head tích hợp. Checklist dưới đây áp dụng toàn A1; tách hotfix không được đánh dấu cả A1 xong. A4 reuse stable orderCode đã merge, không làm lại.

**Files được sửa:** `src/app/api/orders/route.ts`, `src/services/order.service.ts`, `src/services/discount-approval.service.ts`, API dưới `src/app/api/pos/discount-approvals/`, `src/services/actor-context.ts` nếu cần thống nhất type, `src/components/pos/PosCheckoutTerminal.tsx` cho stable orderCode/payload. A độc quyền POS trong A1-H/A1-F; chỉ nhường cửa sổ sửa grid cho C2 sau gate W1B.

**Files test mới:** `scripts/test-discount-checkout-atomic.ts`. Mở rộng test service có sẵn nếu cần, không thay assertions cũ để che regression.

**Interfaces:** bổ sung `discountApprovalId?: string` vào CreateOrderParams, giữ actorContext là tham số nội bộ đã xác thực. Route không được coi APPROVED là đủ rồi bỏ qua kết quả consume. `consumeApproval` nhận actorContext và transaction bắt buộc cho đường checkout; không dùng default global DB ở đường này. Cart pricing và canonical hash phải cùng biểu diễn giữa create approval và checkout.

**Thứ tự trong transaction, mô tả chuẩn để implementation bám theo:**

```text
resolve actor từ cookie -> validate input/canonical pricing
begin transaction có retry hiện có
  kiểm tra idempotency key + actor + fingerprint
  nếu replay cùng nội dung: trả đơn cũ, không consume lại
  kiểm tra ca/kho và lease nếu S-01 đã bật
  đọc approval: owner, status, expiry, cart, rate, warehouse, orderCode
  update APPROVED -> CONSUMED có điều kiện; yêu cầu đúng 1 row
  kiểm tra ATP và ghi order/items/ledger/cashbox bằng cùng tx
commit -> trả kết quả
bất kỳ lỗi nào -> rollback, không warn rồi tiếp tục thành công
```

- [ ] A1.1 Truy mọi caller createOrder/consumeApproval; lập danh sách POS, online, bundle, gift, offline sync và test nội bộ. Ghi rõ nhánh nào cần approval; không vô tình bắt mọi đơn manager phải có approval.
- [ ] A1.2 Viết D02/D06/D07/D09 qua route trên DB test, capture số orders/items/ledger, stock và trạng thái approval trước/sau. Chạy baseline thấy sai invariant.
- [ ] A1.3 Chốt cách biểu diễn giá: OrderItemInput hiện có unitCoverPrice/unitDiscountRate, approval có unitPrice. Không map nhầm field thành 0; giá quyết định ở server. Ràng buộc mọi thành phần ảnh hưởng số tiền, gồm line discount/bundle. Nếu sửa hash, yêu cầu duyệt cũ không còn tương thích phải xin lại, không tự chấp nhận hash cũ thiếu dữ liệu.
- [ ] A1.4 Đưa consume vào transaction createOrder có sẵn; không mở outer transaction rồi gọi service tự mở transaction khác. Tận dụng txOrDb và withDbRetry, kiểm tra affected rows.
- [ ] A1.5 Rà replay trước các kiểm tra có thể đổi sau commit như approval đã CONSUMED hoặc tồn đã cạn, bao gồm bundle early replay. Không trả đơn người khác chỉ vì đoán key.
- [ ] A1.6 Bổ sung hủy/supersede có điều kiện cho UI. Chỉ chủ yêu cầu hoặc manager đúng quyền được hủy; race cancel/checkout chỉ một chuyển trạng thái thắng. Không cần enum mới nếu SUPERSEDED đã đủ biểu đạt.
- [ ] A1.7 Rà quyền GET/list/approve request; cashier chỉ xem request của mình. Mã định danh đơn/short code không tự trở thành bằng chứng quyền manager. Nhánh PIN/OTP/emergency phải có ca phủ riêng; phát hiện bypass thì ghi ticket con #1, không bật đường cấp quyền giả.
- [ ] A1.8 Chạy suite chỉ định, ghi contract API/error/stable orderCode để B review và A4 sử dụng. Review xong mới merge A1; C không phải tích hợp contract tiền.

**Assertions bắt buộc trong test mới (dùng snapshot truy vấn thực DB, không mock kết quả service):**

```ts
// rejectedBefore/rejectedAfter là snapshot counts và balances thực trước/sau request giỏ sai.
assert.deepEqual(rejectedAfter, rejectedBefore);
// Hai request khác key tranh cùng một approval.
assert.equal(committedOrderIds.size, 1);
assert.equal(approvalAfter.status, 'CONSUMED');
// Response mất rồi retry cùng key: order id trả lại phải giữ nguyên.
assert.equal(retryResult.orderId, firstResult.orderId);
assert.deepEqual(balancesAfterRetry, balancesAfterFirstCommit);
// Gây lỗi fixture trong transaction sau consume, tuyệt đối không hook qua HTTP prod.
assert.equal(approvalAfterRollback.status, 'APPROVED');
assert.deepEqual(businessRowsAfterRollback, businessRowsBefore);
```

Các biến snapshot trong ví dụ là biến local phải được test mới định nghĩa từ truy vấn; không phải helper đã tồn tại. Fault injection dùng fixture ràng buộc DB/transaction test, không thêm query/header điều khiển lỗi production.

### A2 — Session policy (S-01)

**Sở hữu:** `src/lib/auth-session.ts`, `src/services/actor-context.ts`, auth login/logout/me, route heartbeat mới, route release-session mới, `StaffManager.tsx`, `MasterAppShell.tsx`, schema/migrations/journal. `order.service.ts` để kiểm tra lease trong transaction. POS chỉ nhận lại từ C sau W2.

**Test mới:** `scripts/test-concurrent-session.ts`; thêm ca vào auth gateway/RBAC/actor-binding khi fixture cần lease thật.

- [ ] A2.1 Áp dụng S-OFFLINE đã chốt và inventorize mutation cashier qua guard chung; ghi endpoint không dùng helper chung để tránh lỗ hổng phiên cũ.
- [ ] A2.2 Viết migration additive + kiểm tra upgrade có dữ liệu; mọi timestamps do server.
- [ ] A2.3 Viết S01/S04/S05/S06/S07/S08 thất bại trước implementation bằng request/transaction thật, không chỉ gọi hai Promise rồi kiểm số response.
- [ ] A2.4 Cài claim/check/renew/release nguyên tử và kiểm tra lại trong đường ghi tiền; tái sử dụng sessionVersion cho revoke.
- [ ] A2.5 Cài heartbeat/focus/online refresh trong shell; cleanup timer; không tự xóa giỏ; không hồi sinh phiên hết hạn. Xử lý lỗi auth vs lỗi DB khác nhau.
- [ ] A2.6 Cài StaffManager force-release với expected session và reason; actor/target audit đúng.
- [ ] A2.7 Nâng fixture auth có token legacy để test chính sách rõ ràng, không whitelist test actors vào code sản phẩm.
- [ ] A2.8 Chạy S01–S20 + migration upgrade + suite auth/order/offline tích hợp. Viết runbook bật/tắt và recovery trước đưa vào release candidate.

### A3 — Điều phối, auth khó và release

- Sở hữu điều tra #2; B báo nếu #4 đi vào transaction/DB adapter thì A nhận phần root cause đó.
- Duyệt ma trận #3, dữ liệu #8, mọi thay đổi quyền #6, mọi migration.
- Theo dõi test có DB chung, cấp quyền sở hữu file, giải quyết xung đột theo hành vi nghiệp vụ; DB riêng đã kiểm chứng không cần xin slot.
- Không tự đánh dấu toàn bộ phần A an toàn chỉ bằng tự review: trước merge A1/A2, giao B đọc transaction/concurrency và C kiểm contract UI/fixture trong chế độ read-only. A chịu trách nhiệm giải quyết findings; không yêu cầu agent tự khẳng định thay điều phối.

### A4 — UI nghiệp vụ phê duyệt và thanh toán (#1 UI, #3 UI, #7, #8)

**Files:** PosCheckoutTerminal.tsx, DiscountApprovalModal.tsx, ManagerApprovalDrawer.tsx; VietQR/offline helper chỉ khi cần và có ca hồi quy. A giữ logic state/checkout; C chỉ hỗ trợ kiểm nhìn và checklist, không được giao race/idempotency/auth.

- [ ] A4.1 Sau A1-H, hoàn thiện freeze mọi đường đổi giỏ, cancel/supersede, chống callback muộn và snapshot manager như #1; kiểm D11/D12.
- [ ] A4.2 Sau B1, ẩn nút Chốt Ngày đúng role; xử lý 403 và giữ API là ranh giới quyền thật.
- [ ] A4.3 Kết thúc W1B, merge và giao SHA cùng quyền sửa grid cho C2. Trong cửa sổ C2, A không sửa POS trên bất kỳ branch nào; làm điều tra auth hoặc thiết kế migration thay thế.
- [ ] A4.4 Sau C2 merge và trả file, làm payment sheet #7 và gộp chuyển khoản/QR #8. Reuse handler; không tự chốt khi mở sheet; giữ enum lịch sử, queue và stable key.
- [ ] A4.5 Kiểm D01/D07, order-sales/offline-engine/s4-settlement/modal-dismiss và thanh toán hai lần liên tiếp. C báo lỗi nhìn thấy; A sửa mọi thay đổi handler/payment/guard.

## 6. Contract triển khai Agent B

### B1 — Báo cáo và quyền (#3)

**Files:** `src/app/api/pos/daily-settlement/route.ts`, `src/services/daily-settlement.service.ts`, `src/app/api/cashbox/route.ts`, `src/components/pos/DailyFairSettlementModal.tsx` nếu cần. **Không sửa PosCheckoutTerminal.tsx ở W1**; gửi yêu cầu ẩn nút cho C.

**Test mới:** `scripts/test-pos-report-permissions.ts`.

- [ ] B1.1 Tạo fixture đủ 5 role, hai cashier, hai ca và hai kho; chứng minh cashier hiện lấy tổng ngày qua API.
- [ ] B1.2 Chặn daily endpoint ở server; kiểm dữ liệu ca cashier trả về không lẫn tổng kho/ngày hoặc ca khác.
- [ ] B1.3 Test ma trận mục #3, actor spoofing, ca đã đóng và cross-session. Nếu sửa transaction CashboxService cần A thực hiện trong file A sở hữu.
- [ ] B1.4 Gửi C contract nút Chốt Ngày manager/owner only và cách UI nhận 403; không tự sửa file POS.
- [ ] B1.5 Chạy test-auth-rbac + test-s4-settlement + test mới, báo ảnh hưởng báo cáo thuế/ca. Merge sau A1.

### B2 — Bulk edit (#5)

**Files:** `src/components/inventory/BatchTransferModal.tsx`; helper local chỉ tách nếu logic cần test độc lập, không dựng state framework. Test mới `scripts/test-batch-transfer-selection.ts` nếu có logic chọn/quantity tách được để chạy bằng node:assert; kiểm tương tác thực vẫn bắt buộc.

- [ ] B2.1 Xác minh thêm nhanh hiện có và bổ sung đúng phần thiếu.
- [ ] B2.2 Làm checkbox/chọn theo phạm vi hiển thị/xóa phần chọn/xóa tất cả/áp quantity như #5; không duplicate edition IDs.
- [ ] B2.3 Vô hiệu validate khi form đổi; bỏ response cũ; giữ stable key cho retry cùng payload.
- [ ] B2.4 Test selected/unselected, số không hợp lệ, ATP 0 và stale response; smoke 80 dòng trên desktop/mobile.
- [ ] B2.5 Chạy test-s1-batch-transfer và test-cp3-transfer-concurrency để chắc chắn UX không đổi contract ghi kho.

### B3 — #4/#6 evidence và #10 CTA

- #4/#6 chỉ thu bằng chứng khi còn parked; không đoán nguyên nhân rồi sửa.
- Đã trace entry point: `CreateWarehouseModal.tsx` gọi POST warehouses và `onCreated(json.data)`; `StockOverviewMatrix.tsx` hiện nối `onCreated={handleRefresh}`. B3 sở hữu hai file đó cùng BatchTransferModal. WarehouseBankManager chỉ sửa nếu ca được tái hiện cần nó. **CTA không cần sửa StaffManager, không phụ thuộc A2.**
- Phân biệt hiện trạng/thiết kế: `onCreated(warehouse)` và callback refresh đã có; **prop initialToWarehouseId cùng wiring CTA chưa có, là phần B3 sẽ xây**. B recon lại chain trên đúng base B3 trước code, không báo reuse một prop chưa tồn tại.
- Branch dự kiến `agent/b-bug10-cta` bắt đầu từ SHA B2 đã merge do A cung cấp. B lưu warehouse.id từ onCreated, refresh danh sách, hiện toast/CTA và truyền `initialToWarehouseId?: string` cho BatchTransferModal. Đích mới chưa vào props sau refresh thì chờ danh sách xác nhận hoặc báo lỗi, không tự chọn kho khác. Validate nguồn khác đích và loại kho hợp lệ mỗi lần mở.
- Điểm dừng rõ: B giao commit CTA hoạt động ở StockOverviewMatrix và prop contract trên. Không nối CTA vào StaffManager. Nếu sau này cần entry point ở StaffManager, A làm wiring trong nhánh A từ SHA B3 đã tích hợp; B không sửa file đó. Force-release ở StaffManager hoàn toàn thuộc A2.
- Test tạo thành công/thất bại, CTA đúng đích, reopen reset hợp lý và không tạo hai kho khi double click.

## 7. Contract triển khai Agent C

**Nguyên tắc phân công mới:** C làm ít file, ít logic và dễ kiểm chứng. Không giao C khóa giỏ, state machine phê duyệt, auth/session, mã đơn, transaction, payment enum, offline sync hay migration. Nếu một sửa UI chạm các phần này, C dừng phần đó và báo A; vẫn hoàn thiện phần bố cục độc lập.

### C1 — Login UX (#9)

**File duy nhất W1:** `src/components/auth/LoginModal.tsx`.

- [ ] C1.1 Ghi trạng thái trước sửa ở viewport mobile/desktop, danh sách >4 tài khoản.
- [ ] C1.2 Thêm eye toggle có accessibility và reset; lưới responsive; trạng thái loading/error/retry nếu thiếu.
- [ ] C1.3 Kiểm tra Enter, busy, sai PIN/rate limit, leading zero và keyboard focus. Không sửa auth route, caching hay nguyên nhân latency.
- [ ] C1.4 Chạy test-login-accounts + tsc; manual login/logout không được ghi là đã fix #2.

### C2 — Lưới danh mục mobile (#11), một cửa sổ sửa ngắn

**Bắt đầu sau W1B**, chỉ khi A đã merge phần POS tiền/quyền, cung cấp SHA mới và bàn giao độc quyền file. Branch `agent/c-bug11-grid` tạo từ SHA đó, không tạo trước từ base cũ. File duy nhất `src/components/pos/PosCheckoutTerminal.tsx`; chỉ markup/className vùng danh mục. A tạm ngừng mọi sửa file POS tới khi C2 merge.

- [ ] C2.1 Giữ dữ liệu và onClick hiện có; đổi layout thành 2 cột responsive, không hardcode chỉ còn 4 danh mục.
- [ ] C2.2 Kiểm 0/1/4/>4 danh mục, tên dài, trạng thái chọn, touch target và desktop; không thay fetch/filter/cart/checkout.
- [ ] C2.3 tsc, kiểm diff chỉ vùng danh mục, ảnh/chú thích viewport 320/375/390 CSS px. Không viết test framework cho CSS.
- [ ] C2.4 Bàn giao commit và ảnh, A merge rồi nhận lại file. C không sửa POS tiếp sau bàn giao.

### C3 — Kiểm giao diện và ghi chép, không sửa logic

- [ ] C3.1 Trong lúc A/B làm nghiệp vụ, rà checklist giao diện login/grid/toast/CTA/payment sheet trên build do A cấp. Ghi bước, expected/actual, viewport, build SHA; không chạm DB live.
- [ ] C3.2 Kiểm chữ bị cắt, focus, bàn phím, safe-area, trạng thái busy/error và tương phản; gửi findings cho đúng owner. Không tự sửa cùng file owner đang làm.
- [ ] C3.3 Soạn hướng dẫn ngắn thao tác login/grid mới trong báo cáo C; A đưa vào manual khi tích hợp để tránh cùng sửa file tài liệu chung.
- [ ] C3.4 Phân biệt viewport mô phỏng và iPhone thật; nếu không có thiết bị thì ghi DEVICE_PENDING. C không tự xác nhận transaction hoặc thu hồi token.

## 8. Wave và thứ tự tích hợp

| Wave | A | B | C | Gate ra |
|---|---|---|---|---|
| 0 — baseline | Chốt base/dirty files và contract | Recon reuse, #4/#6, logout revocation | Recon LoginModal/grid chỉ đọc | Báo cáo riêng, không code/mutation production |
| 1 — hotfix/quyền/login | A1-H server + stable orderCode POS | B1 #3 backend | C1 #9 LoginModal | Merge A1-H → B1 → C1, mỗi nhánh test theo tài nguyên |
| 1B — hoàn thiện tiền/quyền | A1-F + A4.1/A4.2 | Read-only review A1 | C3 checklist nhìn/ghi chép | Hotfix/UI đúng, gate bàn giao POS cho C |
| 2A — cửa sổ grid | Điều tra #2/thiết kế S-01, không sửa POS | B2 #5 | C2 #11 chỉ grid | C2 merge và trả file cho A |
| 2B — payment | A4.4/A4.5 #7/#8 | Hoàn thiện B2, chuẩn bị B3 | C3 kiểm UI chỉ đọc | Payment/queue/historical enum verified |
| 3 — phiên và CTA | A2 S-01 theo quyết định đã chốt | B3 #10 phần local/CTA | C3 hỗ trợ manual/mobile | Migration/lease/rollback verified, không tranh POS |
| 4 — release | A tổng hợp và build/deploy gate | B kiểm tồn/báo cáo | C kiểm UI/iPhone cùng người dùng | Smoke + nghiệm thu thiết bị, đóng từng ticket |

- Không gộp chờ toàn bộ feature mới mới sửa P0: A1-H/B1 có thể phát hành hotfix riêng sau đủ gate; session chưa triển khai không chặn hotfix tiền/quyền.
- Phần parked được mở bằng ticket điều tra có output cụ thể. Khi có repro, A xếp vào wave gần nhất theo mức độ và file đang rảnh, không tự chen sửa cùng file.
- Khác branch không bảo đảm khác file; merge thứ tự không thay thế ownership.
- Suite gọi trực tiếp với DB riêng đã kiểm tra được chạy song song. Chỉ những invocation cùng DB/fixture phải báo nhau và nối tiếp; không để runner setup/cleanup phá fixture người khác.

### 8.1 Wave 0 của B — bắt đầu ngay, output báo cáo

1. Vẽ chain thật WarehouseBankManager/CreateWarehouseModal/StockOverviewMatrix/BatchTransferModal: cái đã có, cái sẽ thêm. Liệt kê polling hiện có và khả năng reuse, chưa thêm interval.
2. #4/#6: thu role, thao tác, endpoint, status/code, request ID và phiên bản triển khai đã có; nếu không tái hiện ghi NOT_REPRODUCED, không code fix.
3. **W0-LR — logout revocation:** đọc login/logout/verifySession/guard; phân biệt cookie bị xóa, chữ ký token còn hợp lệ và endpoint bảo vệ còn chấp nhận token. Review source ngay; repro chỉ trong fixture auth/DB local cô lập khi môi trường sẵn sàng, không lấy/replay token thật của người dùng hoặc probe production.
4. Báo W0-LR thành finding độc lập nếu token cũ vẫn được endpoint chấp nhận: precondition, lifetime, role, tác động, evidence/source-only hay reproduced và hướng xử lý. Không tự gắn P0. A sở hữu mọi fix auth/session; B không sửa auth-session hoặc WIP db/index.ts.
5. Output: một báo cáo W0 gồm đường dẫn source/line, nguồn evidence live, build/deployment SHA khi có, kết luận từng ca và câu hỏi còn thiếu. Chưa sửa code sản phẩm, chưa seed/import/deploy; metadata test cục bộ không commit vào repo.

### 8.2 Base và nhánh giao việc

- Code baseline được xác nhận lại: `4a50a2b9034af395bb849e567759ec12cda94918`. Commit tài liệu được tạo từ đúng code base này; không gồm hai file WIP.
- Nhánh phát hành tài liệu: `codex/abc-coordination-plan`. A cung cấp SHA commit tài liệu sau push; B/C lấy commit đó làm base ban đầu để có cả source baseline và kế hoạch mới.
- Nhánh khởi động: `agent/a-bug1-hotfix`, `agent/b-wave0-recon`, `agent/b-bug3`, `agent/c-bug9`. Việc có branch không chứng minh agent đã chạy.
- Các nhánh kế tiếp `agent/b-bug5`, `agent/b-bug10-cta`, `agent/c-bug11-grid`, `agent/a-session-policy` chỉ tạo sau checkpoint trước, từ SHA tích hợp A cung cấp; không tạo hàng loạt từ base cũ rồi phải giải xung đột.
- Mỗi agent dùng checkout/worktree riêng. Không switch branch trong workspace main đang có WIP. Branch/review chỉ chứa file thuộc task; không dùng git add .

## 9. Gói giao việc có thể sao chép

### Giao Agent A / điều phối

Bạn là Agent A kiêm điều phối kỹ thuật. Đọc toàn bộ kế hoạch này, nhận A1/A2/A3/A4; ưu tiên A1-H trước. Sở hữu transaction tạo đơn/phê duyệt, stable orderCode và UI nghiệp vụ POS, payment, auth/session/migration, test lease và release gate. Xác nhận baseline trước sửa; không nhận hai thay đổi dirty hiện tại thành code của mình. Chỉ nhường POS cho C2 trong cửa sổ grid sau W1B; không sửa cùng file ở branch khác trong thời gian đó. S-OFFLINE đã chốt chặn offline mới khi không lease, giữ giỏ/queue. Theo dõi invocation DB chung; DB riêng được chạy trực tiếp song song. Mỗi ticket báo repro/diff/tests/commit/giới hạn; không coi local tests là nghiệm thu iPhone.

### Giao Agent B

Bạn là Agent B. Đọc mục 1–3, 6, 8, 10–12. Bắt đầu W0 ngay trên agent/b-wave0-recon: recon bank/warehouse/polling reuse, evidence #4/#6 và finding logout revocation W0-LR; output báo cáo, không code sản phẩm hoặc mutation live. Sau W0 được A review, làm B1 trên agent/b-bug3 từ base tài liệu A cấp. Không sửa PosCheckoutTerminal.tsx, order.service.ts, auth-session.ts hay WIP db/index.ts. Tạo matrix API 5×4 + spoofing/cross-session/cross-warehouse, gửi contract ẩn nút cho A. Suite trực tiếp DB riêng có thể chạy song song; runner/DB chung phải báo nhau. Sau W1 làm B2, sau B2 làm B3; initialToWarehouseId là prop B3 sẽ thêm, không phải hiện trạng. Không migration/deploy.

### Giao Agent C

Bạn là Agent C, nhận việc UI nhẹ. Đọc mục 1–3, 7, 8, 10–12. C1 trên agent/c-bug9 chỉ sửa LoginModal.tsx: mắt PIN accessible, grid tài khoản responsive, giữ bộ lọc warehouse/tax và guards hiện có; không cache hoặc sửa auth. Không sửa POS lúc A làm hotfix. C2 chỉ sau A bàn giao SHA/file ở W2A: grid danh mục #11, markup/className, không đổi handler/state nghiệp vụ; merge xong trả file ngay. Trong thời gian chờ, C3 kiểm nhìn/checklist/ghi chép chỉ đọc. Không nhận stable orderCode, phê duyệt, payment, offline, transaction, session hay migration. Không tự thêm dependency. Báo ảnh/steps/build SHA và tsc; không coi viewport mô phỏng là iPhone thật.

## 10. Kế hoạch kiểm thử và bằng chứng

### 10.1 Cách chạy

Chạy từ checkout được A cấp; không tải thêm framework test. Đọc guard/setup của suite trước chạy vì một số suite tự tạo DB riêng.

**Setup checkout mới:** kiểm tra Node/npm theo môi trường dự án, package-lock.json và node_modules/.bin/tsx, tsc. Nếu checkout chưa có dependency hoặc không khớp lockfile, chạy `npm ci` trong chính checkout đó với quyền network phù hợp, không sửa lockfile hoặc chạy npm install để nâng version. Chỉ chạy một lần khi cần; không npm ci vào thư mục agent khác đang dùng. `npx --no-install` bên dưới chủ ý không tự tải tool; không có dependency thì hoàn thành setup trước, không kết luận suite fail do bug ứng dụng. Chưa chạy npm ci trong lượt review tài liệu này.

**R4 đã chốt — mặc định gọi trực tiếp + DB riêng; runner/fixture chung thì báo nhau và nối tiếp.**

- Đã đối chiếu S1/S2/S3 approval/S4/warehouse-creation: tự migrate và seed fixture riêng theo cwd. Đặt DATABASE_URL đúng fixture **trước khi khởi chạy** để import ứng dụng không mở nhầm DB; suite vẫn có thể tự ghi đè env nên phải xác minh path cuối.
- Không chạy hai instance cùng suite trong cùng cwd. Worktree khác nhau phải dùng path thực khác nhau, không symlink DB hoặc trỏ chung tuyệt đối. Database URL chứa tên test không đủ; phải là file local xác định, không remote.
- `run-isolated.ts` mặc định setup DB base và clear-login-buckets, kể cả --only; --no-setup không bỏ bước clear. Chỉ dùng runner cho suite cần fixture chung; báo tên fixture và thời gian bắt đầu/kết thúc cho các agent dùng cùng DB, không xin slot cho suite riêng.
- Suite mới ưu tiên self-contained DB riêng, guard trước import và cleanup trước migrate. Nếu chưa chứng minh được cách ly thì dùng chế độ nối tiếp, không đoán.

Ví dụ gọi **trực tiếp** trong các shell/checkout khác nhau với fixture không giao nhau; đây là lệnh dự kiến, chưa chạy trong lượt cập nhật tài liệu:

```powershell
# B: S1 batch (tự seed)
$env:DATABASE_URL='file:formapubli_test_s1_batch.db'
npx --no-install tsx scripts/test-s1-batch-transfer.ts

# A: S3 approval (tự seed)
$env:DATABASE_URL='file:formapubli_test_s3_approval.db'
npx --no-install tsx scripts/test-s3-discount-approval.ts

# B: S4 báo cáo (tự seed)
$env:DATABASE_URL='file:formapubli_test_s4_settlement.db'
npx --no-install tsx scripts/test-s4-settlement.ts

# B: warehouse creation (tự seed)
$env:DATABASE_URL='file:formapubli_test_warehouse_creation.db'
npx --no-install tsx scripts/test-warehouse-creation.ts
```

Những mapping runner bên dưới là phương án chạy tuần tự khi tích hợp hoặc khi suite cần base chung; không phải bắt mọi agent dùng runner cho các suite tự seed. Trước mỗi runner phải đặt lại DATABASE_URL/TEST_DATABASE_FILE về cùng DB base local và báo các lượt dùng chung:

```powershell
# Liệt kê suite: read-only đối với DB theo runner hiện tại.
npx --no-install tsx scripts/run-isolated.ts --list

# A1 integration: runner thực hiện setup test DB; nối tiếp với lượt dùng chung DB base.
npx --no-install tsx scripts/run-isolated.ts --only=test-discount-guard,test-s3-discount-approval,test-order-sales,test-order-guards,test-bundle-engine,test-offline-engine

# B1
npx --no-install tsx scripts/run-isolated.ts --only=test-auth-rbac,test-s4-settlement,test-actor-binding

# B2
npx --no-install tsx scripts/run-isolated.ts --only=test-s1-batch-transfer,test-cp3-transfer-concurrency

# C1
npx --no-install tsx scripts/run-isolated.ts --only=test-login-accounts

# A4 payment/UI integration; C3 chỉ đọc kết quả/kiểm giao diện
npx --no-install tsx scripts/run-isolated.ts --only=test-order-sales,test-offline-engine,test-s4-settlement,test-modal-dismiss

# A2, ngoài suite session mới
npx --no-install tsx scripts/run-isolated.ts --only=test-auth-gateway,test-auth-rbac,test-login-accounts,test-actor-binding,test-discount-guard,test-offline-engine

# Sau tích hợp mỗi wave
npx --no-install tsc --noEmit
npm run build
```

- Những lệnh trên là lệnh dự kiến, chưa được chạy trong lượt viết tài liệu.
- Test mới phải đăng ký trong `ALL_SUITES` của `scripts/run-isolated.ts` trước dùng `--only`. File runner do A tích hợp registrations, B/C gửi tên suite; không cùng sửa runner.
- Runner hiện có thể bỏ qua tên suite không tồn tại nếu danh sách còn tên hợp lệ. A so output suite thực chạy với danh sách yêu cầu; không dùng exit 0 làm bằng chứng suite mới đã chạy.
- `setup-test-db.ts` có import code ứng dụng: luôn đặt DATABASE_URL về DB test ngay từ process chạy setup/runner, không đợi suite con set biến sau import. Xác minh TEST_DATABASE_FILE và DATABASE_URL trỏ cùng fixture base; suite tự dùng DB riêng phải có guard tương ứng.
- Ví dụ môi trường test được đặt trước các lệnh runner: `$env:DATABASE_URL='file:formapubli_test.db'`; `$env:TEST_DATABASE_FILE='formapubli_test.db'`. Chỉ trong shell test, không thay env sản xuất; không in auth token/secret môi trường.
- Không chạy suite dùng provider/API bên ngoài trong đợt này. Không dùng `test:isolated` không filter nếu chưa kiểm toàn bộ danh sách.
- Runner đối chiếu mtime/size DB thật; đó không phải chứng minh bất biến từng byte. Báo cáo đúng mức kiểm đã làm; ưu tiên không cho process test có đường kết nối DB thật.
- Kiểm tra transaction/concurrency phải chạy trên fixture adapter tương ứng runtime mục tiêu trước release. Source `src/db/index.ts` đang dùng libSQL; Worker không đồng nghĩa tự dùng D1. A xác minh cấu hình thực, không sửa theo giả định tên nền tảng.

### 10.2 Suite mới và người sở hữu

| Suite mới | Chủ | Bắt buộc phủ |
|---|---|---|
| test-discount-checkout-atomic | A | D01–D10, route→service→DB; rollback và replay |
| test-pos-report-permissions | B | 5×4 matrix, actor/ca/kho giả mạo |
| test-batch-transfer-selection | B | Chọn/xóa/quantity, invalidation; chỉ tách helper thật cần kiểm |
| test-concurrent-session | A | S01–S20, race claim/release/write, migration compatibility |

Không tạo test chỉ tìm chuỗi source rồi gọi là chứng minh đúng hành vi. UI nhỏ có thể dùng checklist tương tác; logic tiền/quyền phải có assertion API/DB.

### 10.3 Mẫu báo cáo bàn giao bắt buộc

```text
Ticket / Agent / trạng thái:
Base SHA / Head SHA / checkout:
Files thay đổi:
Repro baseline: bước hoặc lệnh, kết quả sai, invariant bị vi phạm:
Root cause và sửa ở shared function nào:
Invocation trực tiếp/runner, fixture path tuyệt đối; nếu dùng chung đã phối hợp với ai:
Lệnh thực chạy / exit code / số case pass-fail / output path:
Ca negative, race, replay và rollback đã kiểm:
Build local / Worker / smoke / iPhone: ghi riêng PASS, FAIL hoặc NOT RUN:
API/props/ownership bàn giao:
Rủi ro còn lại và điều kiện mở ticket parked:
```

Agent báo BLOCKED phải nêu thiếu dữ liệu nào, đã thử gì và task khác còn làm được. Không ghi “done” khi mới tsc xanh.

## 11. Merge, deploy và nghiệm thu

### 11.1 Merge gate của coordinator

- [ ] Kiểm base/head và scope; không lẫn dirty code của người khác hoặc migration ngoài S-01.
- [ ] Xem diff + caller bị ảnh hưởng; đọc regression check có thực sự thất bại trên baseline.
- [ ] Review transaction, quyền, replay và offline; A1/A2 có B/C đọc độc lập.
- [ ] Merge theo wave vào nhánh tích hợp; chạy suite mapping ở **head đã ghép**, không chỉ tin branch riêng.
- [ ] tsc + next build; API/UI payload smoke, đặc biệt orderCode, unitPrice/unitCoverPrice và error code.
- [ ] Cập nhật `docs/TEAM_TEST_MANUAL.md`, README hướng dẫn session/payment và tracker; không ghi tính năng chưa phát hành là đang có trên prod.
- [ ] Ghi release SHA, migration có/không, danh sách known issues và rollback.

### 11.2 Gate triển khai Worker

- `next build` không chứng minh OpenNext Worker chạy. Build artifact Worker bằng script hiện có trong môi trường test/preview; xác minh DB adapter, secrets được cấu hình mà không in giá trị.
- `npm run deploy` hiện gồm build và deploy; không dùng như một lệnh “chỉ kiểm build”. File deploy-cloudflare chưa tracked phải được chủ sở hữu xác nhận trước đưa vào release pipeline.
- Migration session phải có bản sao lưu/phương án restore đã xác minh theo backend thực; chạy additive trước bật enforcement. Không seed lại DB khi upgrade.
- Smoke ghi dữ liệu dùng preview/DB cô lập. Không thử gian lận hoặc tạo đơn giả trực tiếp vào production để chứng minh fix. Production chỉ quan sát hoặc dùng kịch bản vận hành đã được cho phép, có kế hoạch đối soát.
- Không coi câu “5 gates cũ” là checklist đầy đủ nếu không có định nghĩa. Dùng danh sách cụ thể dưới đây, và nhập thêm gate cũ có bằng chứng nếu tìm được.

### 11.3 Smoke gates cụ thể

| Gate | Thao tác | Điều kiện đạt |
|---|---|---|
| G1 Auth | Login, reload, logout | Một lần thao tác, phiên/quyền đúng, không mất queue |
| G2 Ca + bán thường | Mở ca, bán CASH, đóng ca | Một order, đúng tồn/két, chốt đúng người |
| G3 Kho | Chuyển batch hợp lệ, rồi stale batch | Hợp lệ một phiếu; stale không ghi một phần |
| G4 Payment | CASH + chuyển khoản/QR + đọc đơn QR_CODE cũ | Tổng/QR/biên lai/báo cáo đúng, không double count |
| G5 Mobile | Scanner, giỏ, nút nổi, modal, login | Không che nút, không mất giỏ, guards giữ nguyên |
| G6 Discount | Giỏ đúng/sai, retry, race | Sai không ghi; replay một đơn; approval một lần |
| G7 RBAC | Cashier gọi tổng ngày, đổi ca/kho | 403; báo cáo ca hợp lệ vẫn dùng được |
| G8 Session | Hai thiết bị, logout, TTL, force-release | Đúng S-01, máy cũ không hồi sinh |
| G9 Offline | Queue cũ, reconnect, token hết hiệu lực | Không xóa/nhân đôi/gán lại actor; theo S-OFFLINE đã chốt |
| G10 Recovery | Lỗi DB/response timeout/rollback release | Không báo thành công giả, dữ liệu còn đối soát được |

### 11.4 Nghiệm thu iPhone và hoàn thành

- Ghi build SHA/URL, browser, thời gian và thông tin thiết bị nếu lấy được. Không dùng “iOS nào?” làm điều kiện mới được hỗ trợ.
- Kịch bản người dùng: login một lần; chọn 4+ danh mục; scan/thêm giỏ; xin giảm; mở sheet; QR; chốt một đơn; đổi app rồi quay lại; logout/login lại; mất mạng/khôi phục; session bị manager release.
- Automated PASS nhưng chưa có máy thật → `INTEGRATED_VERIFIED, DEVICE_PENDING`, không `ACCEPTED` cho mobile.
- Người dùng nghiệm thu từng nhóm, không cần chờ #4/#6 không tái hiện được mới nhận hotfix #1/#3. Parked vẫn ghi rõ chưa đóng.
- Toàn đợt chỉ báo hoàn thành khi ticket trong phạm vi release đạt gate; mục deferred/parked phải có chủ trì và điều kiện mở, không biến mất khỏi báo cáo.

## 12. Quyết định, rủi ro và tiêu chí dừng

### Đã xác định trong kế hoạch

- A là đầu mối kỹ thuật và implementer phần tiền/session khó nhất; B/C không tự mở rộng schema/quyền.
- Giữ toàn bộ 11 vấn đề trong sổ theo dõi; S-01 là feature riêng.
- POS do A sở hữu; chỉ nhường C2 một cửa sổ grid sau W1B, merge xong nhận lại trước payment/session. C1 LoginModal độc lập; C3 chỉ đọc.
- Không xóa nút Xuất bán/Quà tặng hoặc Soạn Kệ theo phỏng đoán. Soạn Kệ là pick list theo vị trí, không phải chuyển nội bộ.
- “Chốt Ngày” trong scope là quyền báo cáo hiện có; khóa sổ ngày thật cần đặc tả khác.
- Payment hợp nhất ở UI, dữ liệu cũ tương thích; không xác nhận ngân hàng tự động.

### Cần chốt trước phần phụ thuộc

- S-OFFLINE và concurrent-login đã chốt trong phán quyết người dùng: không chờ hỏi lại. Gate còn lại là implementation đúng policy, bằng chứng kiểm thử, migration và release.
- Baseline của hai file dirty hiện tại: A xác định chủ sở hữu/nội dung trước tích hợp, không đảo thay đổi.
- #4/#6: cần repro thao tác cụ thể; thiếu bằng chứng không chặn A1/B1/C1.
- #10 sync giữa managers: chưa đưa vào core release; phải có yêu cầu độ trễ và nguồn sự kiện trước mở.

### Dừng riêng ticket và báo A khi

- Cần migration ngoài S-01, cần sửa file agent khác đang giữ, hoặc phải bỏ guard để tiếp tục.
- Test chạm DB không được xác minh là test; runner thực chạy sai suite; fixture có network provider ngoài phạm vi.
- Giải pháp sửa một đường nhưng để sibling caller bypass tiền/quyền.
- Hành vi offline/session có thể mất đơn, đổi người chịu trách nhiệm hoặc cho hai phiên ghi mà chưa có quyết định.
- Deploy artifact không khớp source SHA/tested head hoặc không có đường rollback đã kiểm.

**Kết quả của tài liệu:** B bắt đầu W0 báo cáo ngay; A1-H/B1/C1 triển khai trên baseline được giao theo ownership; C chỉ nhận UI nhẹ. S-01 hết blocked về quyết định, chưa có nghĩa đã đạt release gate. Việc push tài liệu/cấp nhánh không đồng nghĩa agent đã chạy, bug đã sửa hoặc production đã triển khai.
