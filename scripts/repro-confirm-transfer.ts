/**
 * TÁI HIỆN lỗi xác nhận đơn chuyển khoản trên DB THẬT để lấy đúng stack lỗi.
 *
 * CHẠY: npx tsx scripts/repro-confirm-transfer.ts
 *
 * Tạo MỘT đơn PENDING nhỏ (1 dòng) bằng chính `OrderService.createOrder`, gọi
 * đúng `OrderService.confirmOrder` như server làm, in stack lỗi thật, rồi huỷ
 * đơn đó. Mục đích: hai lần giả thuyết trước (vượt 50 subrequest, rowsAffected
 * bigint) đều bị bác bởi dữ liệu thật — cần lỗi gốc chứ không đoán tiếp.
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
process.env.DATABASE_URL = process.env.TURSO_DATABASE_URL as string;
process.env.DATABASE_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN as string;

async function main() {
  const { createClient } = await import('@libsql/client');
  const raw = createClient({
    url: process.env.DATABASE_URL as string,
    authToken: process.env.DATABASE_AUTH_TOKEN as string,
  });
  const { OrderService } = await import('../src/services/order.service');

  // Kho đang có hàng + phiên két đang mở để đi qua hết điều kiện thật.
  const wh = await raw.execute({
    sql: `SELECT id FROM warehouses WHERE is_sellable_on_pos = 1 AND is_active = 1 LIMIT 1`,
    args: [],
  });
  const warehouseId = String(wh.rows[0].id);
  // Thử lần lượt các ca đang mở: ca nào bị chặn bởi "quá giờ chốt ngày" thì bỏ qua.
  const sessions = await raw.execute({
    sql: `SELECT s.id, s.warehouse_id, s.cashier_id FROM cashbox_sessions s
          WHERE s.status = 'OPEN' ORDER BY s.opened_at DESC LIMIT 10`,
    args: [],
  });

  const stock = await raw.execute({
    sql: `SELECT sb.edition_id FROM stock_balances sb
          WHERE sb.warehouse_id = ? AND sb.condition = 'NEW' AND sb.physical_quantity > 5
          LIMIT 1`,
    args: [warehouseId],
  });
  const editionId = String(stock.rows[0].edition_id);

  console.log(`\n=== TÁI HIỆN XÁC NHẬN (${sessions.rows.length} ca đang mở) ===`);

  const actorContext = { staffId: 'x', role: 'ROLE_CASHIER' as const, fullName: 'Chẩn đoán' };
  let orderId = '';
  let orderCode = '';
  let lastCreateErr = '';

  for (const s of sessions.rows) {
    const wid = String(s.warehouse_id);
    const st = await raw.execute({
      sql: `SELECT sb.edition_id FROM stock_balances sb
            WHERE sb.warehouse_id = ? AND sb.condition = 'NEW' AND sb.physical_quantity > 5 LIMIT 1`,
      args: [wid],
    });
    if (st.rows.length === 0) continue;
    const edId = String(st.rows[0].edition_id);
    const ac = { staffId: String(s.cashier_id), role: 'ROLE_CASHIER' as const, fullName: 'Chẩn đoán' };
    try {
      const created = await OrderService.createOrder({
        warehouseId: wid,
        channel: 'FAIR_EVENT',
        paymentMethod: 'BANK_TRANSFER',
        cashierId: String(s.cashier_id),
        note: 'CHAN DOAN - se huy ngay',
        confirmImmediately: false,
        actorContext: ac,
        items: [{ editionId: edId, quantity: 1 }],
      } as any);
      orderId = (created as any).orderId;
      orderCode = (created as any).orderCode;
      console.log(`  Đã tạo đơn PENDING: ${orderCode} (kho ${wid}, ca ${s.id}, sách ${edId})`);
      break;
    } catch (e: any) {
      lastCreateErr = e?.message || String(e);
      console.log(`  bỏ qua ca ${s.id} (${wid}): ${String(lastCreateErr).slice(0, 90)}`);
    }
  }

  if (!orderId) {
    console.log(`\n  KHÔNG tạo được đơn PENDING để thử. Lý do cuối: ${lastCreateErr}`);
    raw.close();
    return;
  }

  try {
    const done = await OrderService.confirmOrder(
      orderId,
      'ROLE_CASHIER',
      String((sessions.rows[0] as any)?.cashier_id ?? ''),
      actorContext as any,
      { id: `proof-diag-${Date.now()}`, capturedAt: new Date().toISOString() }
    );
    console.log(`  ✅ XÁC NHẬN THÀNH CÔNG: ${JSON.stringify(done)}`);
    console.log('  ⇒ KHÔNG tái hiện được bằng 1 dòng. Vấn đề chỉ xảy ra với đơn NHIỀU dòng.');
  } catch (e: any) {
    console.log('\n  ❌ LỖI THẬT (đây là thứ server đang che thành "Lỗi hệ thống"):');
    console.log(`     ten     : ${e?.constructor?.name}`);
    console.log(`     code    : ${e?.code ?? '(khong co)'}`);
    console.log(`     message : ${e?.message}`);
    console.log('     stack   :');
    for (const line of String(e?.stack || '').split('\n').slice(0, 14)) {
      console.log(`       ${line.trim().slice(0, 130)}`);
    }
  }

  // Dọn dẹp: huỷ đơn chẩn đoán.
  try {
    await OrderService.cancelOrder(orderId, 'ROLE_OWNER', 'Don chan doan - huy ngay', undefined, 'ADMIN-01');
    console.log('\n  Đã huỷ đơn chẩn đoán.');
  } catch (e: any) {
    console.log(`\n  ⚠ Không huỷ được đơn chẩn đoán: ${e?.message}`);
  }
  raw.close();
}

main().catch((e) => { console.error('  LOI:', e?.message || e); process.exit(1); });
