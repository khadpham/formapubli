/**
 * A5.5 — nghịch thử với tiền thật, trên DEV.
 *
 * Spec A5.5: tạo 1 đơn chuyển khoản → mở modal → thấy đếm ngược → bấm "Huỷ"
 * → đơn biến mất, tồn kho (ATP) được giải phóng, báo cáo ngày KHÔNG đổi.
 * "Không đạt thì dừng, không deploy."
 *
 * Chạy 2 lần:
 *   npx tsx scripts/a55-money-probe.ts seed     dựng dữ liệu + in ATP/trước
 *   (bấm nút Huỷ trong modal bằng tay qua trình duyệt)
 *   npx tsx scripts/a55-money-probe.ts verify   in ATP/sau + so sánh
 *
 * Cố ý bỏ qua: tạo đơn qua POST /api/orders. Cần đủ cấu hình POS (lease phiên,
 * gán kho, mở ca) và sẽ chỉ chứng minh phần tạo, không chứng minh phần huỷ —
 * phần huỷ mới là thứ cần kiểm. Huỷ đi qua API THẬT.
 */
import path from 'node:path';
import { createClient } from '@libsql/client';
import { and, eq } from 'drizzle-orm';

const DB = 'file:' + path.resolve(process.cwd(), 'formapubli.db').split(path.sep).join('/');
const MODE = process.argv[2] || 'seed';

const WH = 'wh-a55-fair';
const CASHIER = 'CASH-A55';
const SESSION = 'sess-a55';
const EDITION = process.env.A55_EDITION || '';
const ORDER_CODE = 'ORD-A55-PROBE';
const QTY = 2;

// Ngày làm việc giờ VN, khớp vnToday() của monitor.
const vnDate = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const sqliteNow = new Date().toISOString().slice(0, 19).replace('T', ' ');

async function main() {
  const c = createClient({ url: DB });

  if (MODE === 'seed') {
    // 1 kho hội chợ + 1 thu ngân + 1 ca mở.
    await c.execute({
      sql: `INSERT OR IGNORE INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos)
            VALUES (?,?,?,?,1,1)`,
      args: [WH, 'KHO_A55', 'Kho A55 (hội chợ thử A5.5)', 'FAIR_EVENT'],
    });
    await c.execute({
      sql: `INSERT OR IGNORE INTO staff_accounts (staff_id,full_name,role,passcode_hash,salt,is_active,session_version)
            VALUES (?,?,?,?,?,1,1)`,
      args: [CASHIER, 'Thu ngân A5.5', 'ROLE_CASHIER', 'v2$100000$' + '0'.repeat(64), 'salt-a55'],
    });
    await c.execute({
      sql: `INSERT OR IGNORE INTO cashbox_sessions (id,warehouse_id,cashier_id,opening_cash,status,opened_at)
            VALUES (?,?,?,?, 'OPEN', ?)`,
      args: [SESSION, WH, CASHIER, 500000, sqliteNow],
    });

    // Chọn 1 ấn bản có sẵn rồi cho nó 5 cuốn ở kho hội chợ.
    if (!EDITION) {
      const e = await c.execute({ sql: `SELECT id FROM editions ORDER BY id LIMIT 1` });
      if (e.rows.length === 0) throw new Error('DB không có ấn bản nào');
      process.env.A55_EDITION = String(e.rows[0].id);
      (globalThis as any).__ED = String(e.rows[0].id);
    }
    const ed = EDITION || (globalThis as any).__ED;
    await c.execute({
      sql: `INSERT OR REPLACE INTO stock_balances (id,edition_id,warehouse_id,condition,physical_quantity)
            VALUES (?,?,?,'NEW',5)`,
      args: ['sb-a55-' + ed, ed, WH],
    });

    // 1 đơn chuyển khoản ĐANG CHỜ, còn hạn, giữ 2 cuốn.
    await c.execute({
      sql: `INSERT OR REPLACE INTO orders
            (id,order_code,idempotency_key,warehouse_id,cashier_id,cashbox_session_id,status,
             payment_method,subtotal,final_amount,discount_amount,discount_rate,
             created_at,payment_expires_at)
            VALUES (?,?,?,?,?,?, 'PENDING_CONFIRMATION','BANK_TRANSFER',150000,150000,0,0,?,?)`,
      args: ['o-a55', ORDER_CODE, 'k-a55', WH, CASHIER, SESSION, sqliteNow, new Date(Date.now() + 30 * 60_000).toISOString().slice(0, 19).replace('T', ' ')],
    });
    await c.execute({
      sql: `INSERT OR REPLACE INTO order_items (id,order_id,edition_id,quantity,unit_cover_price,unit_selling_price,total_amount)
            VALUES (?,?,?,?,50000,75000,150000)`,
      args: ['oi-a55', 'o-a55', ed, QTY],
    });
    console.log(`Đã dựng: kho=${WH} thu ngan=${CASHIER} ca=${SESSION} ấn bản=${ed}`);
    console.log(`Đơn chờ: ${ORDER_CODE} · ${QTY} cuốn · 150.000đ · hết hạn sau 30 phút`);
  }

  // --- Đo bằng ĐÚNG service thật, không tự cộng tay -----------------------------
  const { db } = await import('../src/db');
  const schema = await import('../src/db/schema');
  const { OrderService } = await import('../src/services/order.service');
  const { DailySettlementService } = await import('../src/services/daily-settlement.service');

  const ed = EDITION || (globalThis as any).__ED || String(
    (await c.execute({ sql: `SELECT edition_id FROM order_items WHERE order_id='o-a55' LIMIT 1` })).rows[0]?.edition_id || ''
  );
  const atp = await OrderService.getATP(ed, WH);
  const pendingOrders = await db
    .select({ id: schema.orders.id, orderCode: schema.orders.orderCode })
    .from(schema.orders)
    .where(and(eq(schema.orders.status, 'PENDING_CONFIRMATION'), eq(schema.orders.warehouseId, WH)));
  const report: any = await DailySettlementService.getDailyFairSettlement({ warehouseId: WH, date: vnDate }).catch((e: any) => ({ err: e.message }));
  const rev = report?.err ? `LOI: ${report.err}` : (report?.financials?.revenue ?? report?.totals?.revenue ?? null);

  console.log(`\n--- ${MODE.toUpperCase()} ---`);
  console.log(`ATP ấn bản ${ed} tại ${WH}: ${atp}  (5 - ${QTY} đang giữ chỗ = 3 nếu đúng)`);
  console.log(`Đơn PENDING_CONFIRMATION của kho: ${pendingOrders.length} ${pendingOrders.map((p: any) => p.orderCode).join(', ')}`);
  console.log(`Doanh thu báo cáo ngày ${vnDate}: ${rev}`);
  console.log(`Tồn kho vật lý trong sổ: ${JSON.stringify((await c.execute({ sql: `SELECT physical_quantity FROM stock_balances WHERE edition_id=? AND warehouse_id=? AND condition='NEW'`, args: [ed, WH] })).rows[0] ?? null)}`);
}

main().catch((e) => { console.error('LOI:', e.message); process.exit(1); });
