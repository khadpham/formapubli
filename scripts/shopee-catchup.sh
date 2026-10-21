#!/usr/bin/env bash
#
# Bù tin push Shopee bị mất: gọi POST /api/shopee/catchup.
# Dùng chung handleShopeePush với webhook nên idempotent - chạy lại không
# trừ kho 2 lần, không tạo đơn trùng.
#
# Cài đặt cron trên VPS (mỗi 30 phút), ví dụ:
#   */30 * * * * /opt/formapubli/scripts/shopee-catchup.sh >> /var/log/shopee-catchup.log 2>&1
#
# Yêu cầu trước khi cài:
#   - CRON_SECRET trong môi trường phải trùng với CRON_SECRET trong
#     /opt/formapubli/.env (route từ chối 401 nếu sai/thiếu).
#   - APP_URL trỏ đúng domain public của ERP production.
#
set -euo pipefail

: "${CRON_SECRET:?Chua dat CRON_SECRET trong moi truong}"
APP_URL="${APP_URL:-https://app.formapubli.vn}"

curl -sS -m 180 -X POST "$APP_URL/api/shopee/catchup" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{}'
echo
