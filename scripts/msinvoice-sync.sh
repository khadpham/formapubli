#!/usr/bin/env bash
#
# Đồng bộ trạng thái ký MS-Invoice về ERP: gọi POST /api/cron/msinvoice-sync.
# Kế toán ký/hủy hóa đơn trên MS-Invoice xong, script này kéo trạng thái về
# bảng einvoices (SIGNED / CANCELLED) - thay việc bấm tay "Tải từ MS-Invoice".
# Idempotent: chạy lại không đổi gì thêm.
#
# Cài đặt cron trên VPS (mỗi 30 phút), ví dụ:
#   */30 * * * * /opt/formapubli/scripts/msinvoice-sync.sh >> /var/log/msinvoice-sync.log 2>&1
#
# Yêu cầu trước khi cài:
#   - CRON_SECRET trong môi trường phải trùng với CRON_SECRET trong
#     /opt/formapubli/.env (route từ chối 401 nếu sai/thiếu).
#   - APP_URL trỏ đúng domain public của ERP production.
#
set -euo pipefail

: "${CRON_SECRET:?Chua dat CRON_SECRET trong moi truong}"
APP_URL="${APP_URL:-https://app.formapubli.vn}"

curl -sS -m 180 -X POST "$APP_URL/api/cron/msinvoice-sync" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{}'
echo
