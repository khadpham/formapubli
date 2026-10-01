/**
 * Tra tồn cẢ GIỎ trong 1 vòng — POS chốt đơn chậm vì gọi từng cuốn một.
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-checkout-stock-batch
 *
 * BỐI CẢNH (người dùng hỏi 30/09): sau khi chụp ảnh xác nhận chuyển khoản phải
 * chờ khá lâu mới có đơn. Nguyên nhân gốc: POS gọi `/api/atp` MỘT LẦN CHO TỪNG
 * CUỐN, nối tiếp — mỗi lần gọi là một chuyến qua Cloudflare Worker + vài câu DB
 * xa. Giỏ 20 cuốn = 20 chuyến.
 *
 * HỢP ĐỒNG ĐƯỢC CHỐT:
 *  1. `getBatchBalance` phải cho ĐÚNG số như `getBalance` gọi từng cuốn.
 *  2. Ấn bản chưa có dòng tồn = 0 (không phải "thiếu").
 *  3. Route `/api/atp` nhận `editionIds` (danh sách) và trả `items[]`, giữ nguyên
 *     hình dạng cũ khi gọi 1 ấn bản để không phá 3 nơi đang gọi cũ.
 *  4. POS chốt đơn gọi `/api/atp` ĐÚNG MỘT LẦN — không còn vòng lặp theo giỏ.
 *  5. Nhãn tiến trình phải được XOÁ ở mọi đường thoát, nếu không nút kẹt
 *     "Đang kiểm tra tồn kho…" mãi.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_stock_batch.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const WH = 'wh-batch';
let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

async function run() {
  console.log('\n=== TRA TỒN CẢ GIỎ: GỘP 1 VÒNG THAY VÌ N VÒNG ===');
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-checkout-stock-batch');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const { InventoryService } = await import('../src/services/inventory.service');
  const { OrderService } = await import('../src/services/order.service');

  await raw.execute({
    sql: `INSERT INTO warehouses (id,code,name,warehouse_type,is_active,is_sellable_on_pos)
          VALUES ('${WH}','KHO_B','Kho đo','FAIR_EVENT',1,1)`,
    args: [],
  });
  // DDL lấy nguyên văn từ src/db/migrations/0000_late_nitro.sql — không tự đoán cột.
  const stock: Array<[string, number]> = [['ed-a', 50], ['ed-b', 0], ['ed-c', 7], ['ed-d', 0]];
  for (const [id, qty] of stock) {
    await raw.execute({
      sql: `INSERT INTO works (id,code,title,author) VALUES (?,?,?,?)`,
      args: [`w-${id}`, `W-${id.toUpperCase()}`, `Tác phẩm ${id}`, 'Tác giả'],
    });
    await raw.execute({
      sql: `INSERT INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`,
      args: [id, `w-${id}`, id.toUpperCase(), `978000000${id.slice(-1)}0`, id.slice(-1), 50000],
    });
    await raw.execute({
      sql: `INSERT INTO stock_balances (id,edition_id,product_id,warehouse_id,condition,physical_quantity)
            VALUES (?,?,?,?, 'NEW', ?)`,
      args: [`sb-${id}`, id, id, WH, qty],
    });
  }
  await raw.execute({
    sql: `INSERT INTO works (id,code,title,author) VALUES (?,?,?,?)`,
    args: ['w-ed-miss', 'W-MISS', 'Tác phẩm không tồn', 'Tác giả'],
  });
  await raw.execute({
    sql: `INSERT INTO editions (id,work_id,code,isbn,isbn_last4,cover_price) VALUES (?,?,?,?,?,?)`,
    args: ['ed-miss', 'w-ed-miss', 'ED-MISS', '97800000099', '9', 50000],
  });

  const ids = ['ed-a', 'ed-b', 'ed-c', 'ed-d', 'ed-miss'];

  // --- 1. Gộp phải khớp từng cuốn ---
  const batchBal = await InventoryService.getBatchBalance(ids, WH, 'NEW');
  let allMatch = true;
  const detail: string[] = [];
  for (const id of ids) {
    const single = await InventoryService.getBalance(id, WH, 'NEW');
    const got = batchBal.get(id);
    detail.push(`${id}: gộp=${got} lẻ=${single}`);
    if (got !== single) allMatch = false;
  }
  ok(allMatch, '1. getBatchBalance khớp ĐÚNG getBalance gọi từng cuốn', detail.join(' · '));

  // --- 2. Ấn bản chưa có dòng tồn = 0, và phải CÓ mặt trong kết quả ---
  ok(batchBal.has('ed-miss') && batchBal.get('ed-miss') === 0,
     '2. Ấn bản chưa có dòng tồn trả 0 và CÓ trong kết quả (không thiếu mục)',
     `ed-miss = ${batchBal.get('ed-miss')}`);

  // --- 3. Trùng id không nhân bản, rỗng thì trả map rỗng ---
  const dup = await InventoryService.getBatchBalance(['ed-a', 'ed-a', ''], WH, 'NEW');
  ok(dup.size === 1, '3. Id trùng/lẻ rác được gộp, không nhân bản kết quả', `size=${dup.size}`);
  const empty = await InventoryService.getBatchBalance([], WH, 'NEW');
  ok(empty.size === 0, '4. Danh sách rỗng trả kết quả rỗng, không ném lỗi');

  // --- 5. getBatchATP vẫn khớp getATP (không đổi hành vi giữ chỗ) ---
  const batchAtp = await OrderService.getBatchATP(ids, WH);
  let atpMatch = true;
  for (const id of ids) {
    const singleAtp = await OrderService.getATP(id, WH);
    if ((batchAtp.get(id) ?? 0) !== singleAtp) atpMatch = false;
  }
  ok(atpMatch, '5. getBatchATP khớp getATP từng cuốn (giữ chỗ không đổi)');

  // --- 6. Route nhận danh sách, giữ hình dạng cũ cho 1 ấn bản ---
  const routeSrc = fs.readFileSync('src/app/api/atp/route.ts', 'utf8');
  ok(/searchParams\.get\('editionIds'\)/.test(routeSrc)
     && /many\.split\(','\)/.test(routeSrc),
     '6. Route nhận `editionIds` dạng danh sách phân tách bởi dấu phẩy');
  ok(/if \(!many\)/.test(routeSrc),
     '7. Gọi 1 ấn bản (không có editionIds) vẫn trả hình dạng CŨ → không phá 3 nơi gọi cũ');
  ok(/held: physical - atp/.test(routeSrc),
     '8. Mỗi mục có đủ physical / atp / held để báo lỗi "còn N cuốn giữ chỗ"');
  ok(/editionIds\.length > 200/.test(routeSrc),
     '9. Có trần số ấn bản để câu SQL không thành rác');

  // --- 10. POS KHÔNG còn vòng lặp gọi từng cuốn ---
  const posSrc = fs.readFileSync('src/components/pos/PosCheckoutTerminal.tsx', 'utf8');
  const handle = posSrc.slice(posSrc.indexOf('const handleCheckout = async'));
  const beforeOrders = handle.slice(0, handle.indexOf("fetch('/api/orders'"));
  const atpCalls = (beforeOrders.match(/fetch\(\s*`?\/api\/atp/g) || []).length;
  ok(atpCalls === 1, '10. POS gọi /api/atp ĐÚNG MỘT LẦN trước khi tạo đơn', `số lần gọi = ${atpCalls}`);
  ok(!/for \(const item of cart\)[\s\S]{0,200}\/api\/atp/.test(posSrc),
     '11. Không còn vòng lặp gọi /api/atp theo từng cuốn trong giỏ');
  ok(/editionIds=\$\{encodeURIComponent\(ids\.join\(','\)\)\}/.test(posSrc),
     '12. POS gửi cả giỏ trong 1 tham số editionIds');

  // --- 13. Nhãn tiến trình có và luôn được xoá ---
  ok(/setCheckoutStep\('Đang kiểm tra tồn kho…'\)/.test(posSrc)
     && /setCheckoutStep\('Đang tạo đơn…'\)/.test(posSrc),
     '13. Có bước "Đang kiểm tra tồn kho…" và "Đang tạo đơn…" để thu ngân thấy hệ thống còn chạy');
  // Chỉ kiểm "có ít nhất một chỗ xoá" là YẾU: xoá đúng một chỗ vẫn xanh. Phải
  // kiểm TỪNG chỗ tắt nút. Hai chỗ nằm TRƯỚC khi bước bắt đầu (giỏ rỗng, thiếu
  // lý do tặng) thì tiến trình còn null nên không cần xoá — phải tính ngoại lệ.
  const hcStart = posSrc.indexOf('const handleCheckout = async');
  const hcEnd = posSrc.indexOf('const handleConfirmTransfer');
  const hc = posSrc.slice(hcStart, hcEnd > 0 ? hcEnd : posSrc.length);
  // Chỉ số phải cùng hệ với `hc` (m.index là tương đối trong hc), nếu không phép
  // so sánh dưới đây vô nghĩa và mọi lần xoá đều bị coi là "sót".
  const stepStart = hc.indexOf("setCheckoutStep('Đang kiểm tra tồn kho…')");
  ok(stepStart > 0, '13b. Tìm thấy điểm bắt đầu bước "kiểm tra tồn kho" trong handleCheckout');
  const badExits: number[] = [];
  // Dùng exec + for thay vì matchAll: tsconfig của repo target thấp hơn, không
  // duyệt được iterator của matchAll.
  const scan = /setIsSubmitting\(false\);/g;
  for (let m = scan.exec(hc); m; m = scan.exec(hc)) {
    const after = hc.slice(m.index, m.index + 140);
    if (after.includes('setCheckoutStep(null)')) continue;
    if (m.index < stepStart) continue; // chốt chặn trước khi bật tiến trình
    badExits.push(m.index);
  }
  ok(badExits.length === 0,
     '14. Mọi đường thoát SAU khi bắt đầu chốt đơn đều xoá tiến trình (nếu sót, nút kẹt "Đang kiểm tra tồn kho…" mãi)',
     badExits.length === 0 ? 'không có chỗ nào sót' : `${badExits.length} chỗ sót`);
  ok(/checkoutSubmittingLabel = checkoutStep/.test(posSrc),
     '15. Nút bấm hiện bước đang làm thay vì một dòng chữ bất biến');

  raw.close();
  console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
  if (failures > 0) throw new Error('có kiểm tra đỏ');
  console.log('\n✅ Tra tồn cả giỏ: 1 vòng mạng, số liệu khớp hệt cách cũ, không kẹt nhãn.');
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('  ❌', e?.message || e);
    process.exit(1);
  });
