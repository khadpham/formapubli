# Runbook: Chuyen doi Shopee LIVE + dua D1 len production

Trang thai: SAN SANG CHO - kich hoat ngay khi Shopee duyet Go-Live
(app 246728 "Vita Nova shopee", ho so da nop 2026-10-20, ket qua qua email
trong 24h). Quyet dinh anh Kha 2026-10-20: D1 (hoa don cho xac nhan nhan
hang) KHONG di rieng - gop cung dot nay.

## Dieu kien tien quyet
- Email duyet Go-Live da ve (hop thu Formapubli.vitanova@gmail.com).
- Trang app tren console chuyen trang thai khoi "Developing"/"under review".
- Console cap Live Partner ID + Live Partner Key (muc thong tin ung dung).
  KHONG ghi 2 gia tri nay vao tai lieu nay hay bat ky file nao trong repo.

## Buoc 1 - Cau hinh khoa live len production (chi tren may chu)
Sua /opt/formapubli/.env (backup truoc vao /root nhu cac dot truoc):
- SHOPEE_PARTNER_ID = Live Partner ID
- SHOPEE_PARTNER_KEY = Live Partner Key
- SHOPEE_BASE_URL = https://partner.shopeemobile.com
- SHOPEE_UI_ENABLED = 1 (giu nguyen)
- SHOPEE_SHOP_ID: de trong, se dien sau khi uy quyen shop that.
pm2 reload formapubli (chi reload, khong start lai bang ecosystem cua repo -
xem AGENTS.md muc deploy production).

Danh sach trang IP: 160.187.228.139 da khai bao tren console tu luc nop ho
so - API goi tu VPS khong bi chan. DOI IP MAY CHU = cap nhat whitelist truoc.

## Buoc 2 - Uy quyen shop that formapubli (Shopee Mall)
1. Dang nhap production bang ADMIN-01 (Owner).
2. Lay URL uy quyen: GET /api/shopee/auth-url (hoac nut ket noi trong tab
   Shopee neu co) - URL tro ve https://app.formapubli.vn/api/shopee/callback.
3. Mo URL, dang nhap tai khoan seller cua shop formapubli Mall, xac nhan uy
   quyen. Ma uy quyen song 10 phut - lam lien mot mach.
4. Kiem tra: GET /api/shopee/status -> connected = true; bang
   shopee_shop_tokens tren Turso co dong token cua shop.
5. Dien SHOPEE_SHOP_ID (lay tu status/shop info) vao .env neu he thong can.

## Buoc 3 - Gan kho xuat cho shop
PUT /api/shopee/config { warehouse_id: <kho xuat that> } (Owner).
Mac dinh theo ke hoach: kho Au Co. Xac nhan lai id kho tren production
truc tiep truoc khi gan (bang warehouses).

## Buoc 4 - Cau hinh Push tren console
1. Muc Push Mechanism cua app: callback URL =
   https://app.formapubli.vn/api/shopee/push
2. Bat cac nhom su kien: trang thai don, van chuyen, hoan tra (nhung gi
   webhook cua ERP xu ly). Goi y: endpoint push tra 200 ngay cho goi kiem
   tra code 0, cac su kien khac bat buoc chu ky hop le.
3. Kiem tra bang cach phat sinh 1 don that nho va xem webhook ghi nhan.
4. Cai cron bu tin push mat (scripts/shopee-catchup.sh) tren VPS, moi 30 phut:
   */30 * * * * /opt/formapubli/scripts/shopee-catchup.sh >> /var/log/shopee-catchup.log 2>&1
   - CRON_SECRET trong moi truong cron phai trung voi CRON_SECRET trong .env.
   - Route POST /api/shopee/catchup goi get_lost_push_message va chay tung tin
     qua dung handleShopeePush cua webhook (idempotent) roi confirm da nhan.
   - Neu chua muon cai cron ngay: bu tay bang cach goi POST /api/shopee/catchup
     tu trinh duyet (dang nhap vai tro Quan ly tro len).

## Buoc 5 - Dua D1 len production (gop cung dot)
1. Mo PR dev -> main (chi chua cac commit D1 + tai lieu ke tu dot go-live
   giai doan 1), merge.
2. Backup Turso logic nhu dot truoc (/opt/backups/).
3. Ap migration 0074_delivery_confirmation.sql len Turso production
   (2 cot nullable tren orders - an toan, khong khoa bang lau).
4. Deploy theo dung quy trinh AGENTS.md: bao toan ecosystem.config.js
   production, git pull, npm install neu package.json doi, tsc + build kiem
   exit code truc tiep, chi reload PM2 khi build sach va co BUILD_ID.
5. Kiem chung tren production: tab Hoa don co khoi "Hoa don don online";
   tab Shopee co muc "Cho xac nhan khach nhan hang".

## Buoc 6 - Kiem chung van hanh that (khong bo qua)
- Dong bo don: POST /api/shopee/sync keo duoc don that cua shop Mall.
- Mot don that tu dau den cuoi: dong goi, gui SPX, in van don (PDF qua
  /api/shopee/awb), ma van don ve dung.
- D1 tren don that: truoc xac nhan -> day hoa don bi chan; xac nhan xong ->
  phat hanh duoc; don chua xac nhan khong bi gom vao hoa don tong hop.
- Escrow doc duoc so lieu don da giao (get_escrow_detail).

## Buoc 7 - Dong vong bao mat
- Vo hieu hoa tai khoan REVIEW-01 tren production (PATCH staff isActive=false)
  ngay khi doi duyet Shopee khong con can.
- Xac nhan lai: khong con credential sandbox/test nao tren production env.

## Rollback
- Tat UI Shopee: SHOPEE_UI_ENABLED=0 + reload.
- Ngan ket noi: xoa dong token trong shopee_shop_tokens (don van giu nguyen
  trong ERP, chi ngung dong bo).
- D1 rollback: code revert qua PR; 2 cot 0074 de nguyen khong hai (nullable,
  khong doi hanh vi khi code cu).
