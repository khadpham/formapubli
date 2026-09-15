# PHASE 0 — Ma trận điều hành và nghiệm thu

Tài liệu này là bảng kiểm soát độc lập cho bản tích hợp cuối của Lane A và Lane B.
Một hạng mục chỉ được đánh dấu `PASS` khi có bằng chứng trên commit tích hợp, qua HTTP hoặc UI phù hợp, và database kiểm thử riêng.

## Trạng thái hiện tại

- **Chưa nghiệm thu:** working tree đang có thay đổi chưa commit từ hai lane.
- **Blocker đã phát hiện:** `docs/PHASE0_CONTRACT.md` yêu cầu loại bỏ hoàn toàn `allowOverdraft`, nhưng `src/services/order.service.ts` và `src/app/api/orders/route.ts` vẫn còn trường và nhánh xử lý này.
- **Không được kết luận ATP kín** cho tới khi blocker trên được giải quyết hoặc contract được sửa công khai và có phê duyệt nghiệp vụ mới.
- `src/services/actor-context.ts` và `src/services/app-error.ts` đang nằm trong `src/services/**` nhưng được Lane A sử dụng. Cần xác nhận chủ sở hữu cuối cùng hoặc chuyển chúng thành module dùng chung trước khi merge.

## Gate trước khi tích hợp

| Gate | Chủ trì | Bằng chứng bắt buộc | Trạng thái |
|---|---|---|---|
| Contract danh tính, mã lỗi, ATP | A + B | Contract được chốt, shared modules xác lập | ĐÃ CHỐT |
| Schema và migration | A | Fresh DB + nâng cấp DB bản sao, journal khớp (0015_staff_accounts) | PASS |
| ATP nguyên tử | B | Hai kết nối tranh cuốn cuối; chỉ một thành công | CHỜ B PROBE |
| Auth strict & 23 API Routes | A | Toàn bộ 23 route phủ session policy, fail-closed (`test-phase0-laneA`) | PASS (25/25) |
| Danh tính không giả mạo | A + B | Client gửi `actorId/cashierId` khác vẫn ghi actor từ session (`test-phase0-laneA`) | PASS |
| Rate limit & IP Trust Boundary | A | Khóa 5 lần -> 429 ngay; khóa IP tin cậy (cf-connecting-ip); chặn spoof | PASS |
| Bán–trả–két–báo cáo | B | Bộ số liệu mẫu trong contract khớp từng bước (`test-order-sales`, `test-returns`) | CHỜ B RE-VERIFY |
| UI gatekeeper & SSR Zero Leakage | A | Server không trả dữ liệu bảo vệ trước session; role scope tại SSR query | PASS |
| Tích hợp cuối | A | 30/30 suites cách ly 100% xanh; formapubli.db production nguyên vẹn 100% | PASS |


## Ma trận ca độc lập

### Auth và identity

1. Không cookie → `401`, không có dữ liệu nghiệp vụ trong response.
2. Cookie sai chữ ký/hết hạn → `401`.
3. Cookie Cashier + header Owner → vẫn là Cashier.
4. Cookie hợp lệ nhưng sai action → `403`.
5. Client gửi `actorId`, `cashierId`, `approvedBy` giả → bị bỏ qua hoặc từ chối; audit ghi staffId từ session.
6. Tài khoản inactive/đổi quyền → session cũ xử lý theo chính sách thu hồi đã công bố.
7. Đăng xuất, hết phiên, reload PWA → không còn dữ liệu phiên được dùng lại.

### Rate limit

8. Sai 5 lần cùng staffId → khóa staffId 15 phút.
9. Sai 10 lần trên cùng IP tin cậy với nhiều staffId → khóa IP 15 phút.
10. Đổi `x-forwarded-for` tùy ý → không né được giới hạn.
11. Khởi động lại hoặc chạy instance thứ hai → hành vi đúng với phạm vi triển khai đã cam kết.

### ATP và cạnh tranh

12. Có 1 NEW, tạo pending giữ 1, bán ngay 1 → bị từ chối, ATP không âm.
13. Hai request bán đồng thời tranh cuốn cuối → đúng 1 thành công.
14. Hai request pending đồng thời tranh cuốn cuối → đúng 1 thành công.
15. Pending duyệt → không trừ/đếm giữ chỗ hai lần.
16. Pending hết hạn/hủy → nhả đúng lượng, không nhả hai lần.
17. Transfer out, exchange, consignment dispatch tranh cùng hàng giữ → không xâm phạm ATP.
18. Cùng idempotency key/cùng payload → một hiệu ứng; cùng key/khác payload → `409`.
19. Rollback giữa chừng → không có ticket/đơn/bút toán mồ côi.

### Tiền, trả hàng và báo cáo

20. Bán 2 × 100.000, giảm 10% → thu 180.000.
21. Trả 1 cuốn, hoàn 90.000 → két còn 90.000, tồn tăng 1.
22. Gross 180.000, refund 90.000, net 90.000; báo cáo và két cùng định nghĩa.
23. Refund ở kỳ sau → báo cáo ghi đúng kỳ hoàn trả.
24. Đơn gift, sponsorship, COD → không bị tính sai vào doanh thu/tiền mặt/forecast.

## Quy tắc bàn giao

- Không merge nếu test chỉ chạy trên branch riêng.
- Không dùng `git checkout ours/theirs` để giải quyết auth, schema hoặc transaction.
- Mỗi lane gửi: commit, file đã sửa, contract/schema thay đổi, lệnh test, log, known limitations.
- Bản nghiệm thu cuối chạy trên commit tích hợp, database test mới và một bản sao database nâng cấp.
- Không ghi “100% an toàn”. Ghi rõ phạm vi runtime, số instance, driver và giới hạn còn lại.

## Blocker đang mở

1. Quyết định cuối về `allowOverdraft`: phải xóa khỏi đường bán thông thường hoặc sửa contract và đặc tả ngoại lệ thành nghiệp vụ điều chỉnh riêng có chứng từ.
2. Chủ sở hữu `actor-context.ts` và `app-error.ts` phải được chốt để tránh hai lane cùng sửa.
3. Xác nhận cơ chế khóa transaction thực tế của libSQL/SQLite bằng hai kết nối hoặc hai process; không chấp nhận chỉ kiểm thử hai lời gọi tuần tự.

