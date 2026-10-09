# Spec: Vòng đời kho chiến dịch ngắn hạn (Campaign Lifecycle)

Ngày: 2026-10-09. Trạng thái: đã duyệt thiết kế, chờ review spec.
Quyết định đã chốt với chủ doanh nghiệp:
1. Hết chiến dịch: **ngưng + lưu trữ, KHÔNG xóa** (giữ báo cáo kỳ/doanh thu).
2. Kích hoạt bằng **nút bấm của quản lý** (Bắt đầu / Kết thúc), không scheduler.
3. Chuyển tồn thừa về: **xem trước rồi duyệt**, không tự động hết.

## 1. Bối cảnh

Kho hội chợ (VD: Hội chợ Hồ Gươm) chỉ sống vài ngày–1 tuần: mở kho → dồn hàng
từ kho chính → bán tại quầy → hết kỳ chuyển tồn thừa về → ngưng. Hiện tại mọi
bước làm tay, rời rạc, từng gây lỗi (vụ NV-01 10/2026: kho ngưng để lại id chết
trong `staff_accounts`, mọi lần gán kho sau đó 400 oan). Cần một luồng khép kín.

## 2. Mô hình dữ liệu: 1 bảng mới `campaigns`

```sql
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,      -- ISO YYYY-MM-DD
  end_date TEXT NOT NULL,        -- ISO YYYY-MM-DD, >= start_date
  status TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | ACTIVE | ENDED
  warehouse_id TEXT REFERENCES warehouses(id),   -- kho FAIR_EVENT của kỳ
  source_warehouse_id TEXT REFERENCES warehouses(id), -- kho chính lấy hàng
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT
);
```

Máy trạng thái ép ở server: DRAFT → ACTIVE (nút Bắt đầu) → ENDED (nút Kết thúc).
Không có đường tắt, không quay lại. `warehouse_id` set 1 lần lúc Bắt đầu.

## 3. Nút "Bắt đầu" (DRAFT → ACTIVE)

Thứ tự gọi, mỗi bước là API đã tồn tại, fail ở bước nào thì dừng và báo:

1. Validate: kho nguồn tồn tại + `isActive`, `end_date >= start_date`.
2. `WarehouseService.createWarehouse` type `FAIR_EVENT`, code
   `KHO_CD_<slug-tên>_<YYYYMMDD>`, link `campaigns.warehouse_id`.
3. Quản lý chọn sách chuyển đi bằng **BatchTransferModal có sẵn** (nguồn = kho
   chính, đích = kho chiến dịch). Không làm UI chọn sách mới.
4. Gán thu ngân bằng checkbox StaffManager có sẵn → POS tự scope (có sẵn).
5. `status = ACTIVE`.

## 4. Trong kỳ

- Ma trận tồn hiện kho chiến dịch như chip kho (luồng `FAIR_EVENT` có sẵn).
- Bán qua POS đúng kho (scoping có sẵn). Doanh thu ghi `warehouse_id` như mọi đơn.
- Báo cáo chốt ngày dùng API daily-settlement có sẵn, lọc theo kho chiến dịch.

## 5. Nút "Kết thúc" (ACTIVE → ENDED, 2 bước)

1. **Xem trước:** server trả danh sách tồn còn lại tại kho chiến dịch
   (sách nào, bao nhiêu) — quản lý sửa số/duyệt.
2. **Duyệt:** chuyển về kho nguồn qua transfer-batch validate có sẵn →
   ngưng kho (`PATCH /api/warehouses/[id] isActive=false`) → `detachStaffReferences`
   tự gỡ nhân sự (không lặp lại vụ NV-01) → `status = ENDED`, `ended_at` →
   báo cáo kỳ dùng luồng báo cáo có sẵn lọc theo `warehouse_id`.

## 6. Lưu trữ (không xóa)

Kho ngưng: ẩn khỏi mọi danh sách vận hành (filter có sẵn), giữ dòng + đơn + sổ
để báo cáo kỳ/doanh thu tra được. Luật cấm xóa kho có đơn/phiếu giữ nguyên —
không đụng `deleteWarehouse`.

## 7. Xử lý lỗi

- Fail ở bất kỳ bước Bắt đầu/Kết thúc nào: dừng, giữ nguyên trạng thái cũ,
  báo rõ bước nào (không 이용해 nửa vời: VD đã sinh kho nhưng chưa chuyển hàng
  thì campaign vẫn DRAFT, kho FAIR_EVENT tồn tại độc lập, dùng lại được).
- Chuyển tồn thừa validate tồn trước khi chuyển (luồng transfer-batch có sẵn).
- Hai quản lý bấm đồng thời: máy trạng thái server từ chối lần 2 (đã ACTIVE/ENDED).

## 8. Kiểm thử (mỗi luồng 1 check)

- Bắt đầu trên DB test: kho sinh đúng type/link, chuyển hàng đúng số.
- Kết thúc: tồn thừa về đủ, kho ngưng, staff gỡ gán, báo cáo kỳ đọc được.
- Cắt 1 mắt xích (VD bỏ detach) xem test có đỏ không (quy tắc test độc lập).

## 9. Không làm

Cron/scheduler, engine chuyển kho mới, UI chọn sách mới, đụng logic doanh thu,
đụng luật xóa kho, backfill chiến dịch cũ.
