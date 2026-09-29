/**
 * ẢNH XÁC NHẬN CHUYỂN KHOẢN — lần ghi kẹt không được đè ảnh mới.
 *
 * LỖI ĐÃ XẢY RA: modal lưu ảnh có watchdog 20s. Hết giờ thì mở khoá nút cho
 * cashier chụp lại, NHƯNG promise ghi ảnh cũ vẫn chạy nền. Hai lần ghi cùng đẩy
 * `paymentProof` vào state cha, không có thứ tự ⇒ lần xong sau thắng. Lần ghi
 * CŨ (đã báo lỗi cho cashier) xong sau lần MỚI sẽ đè ảnh mới, rồi cha gửi
 * `paymentProof.id` cũ lên server cho một đơn đã thu tiền.
 *
 * Test này khóa hành vi ở hàm thuần `createPhotoWriteGate` (src/lib): mỗi lần
 * ghi có "thế hệ", lần bị thay thế thì không ghi, và lần ghi mới phải xếp sau
 * lần đang chạy nên không bao giờ ghi vượt.
 *
 * Chạy: npx tsx scripts/test-photo-write-gate.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPhotoWriteGate } from '../src/lib/photo-write-gate';

let pass = 0;
let fail = 0;
const ok = (cond: unknown, msg: string, why = '') => {
  if (cond) {
    pass++;
    console.log(`  ok  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}${why ? ` — ${why}` : ''}`);
  }
};
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function run() {
  console.log('📸 KIỂM THỬ CỔNG GHI ẢNH XÁC NHẬN (không cần DB)');

  // 0. BẰNG CHỨNG kịch bản nguy hiểm — đúng logic CŨ: gọi thẳng cha, không
  //    hàng đợi, không thế hệ. Lần ghi kẹt xong sau sẽ đè ảnh mới.
  {
    let committed = '';
    const parent = async (id: string) => {
      committed = id;
    };
    const hung = delay(40).then(() => parent('ANH_CU'));
    await delay(10);
    await parent('ANH_MOI'); // cashier chụp lại, xong trước
    await hung; // lần cũ xong sau → đè
    ok(committed === 'ANH_CU', 'Kịch bản nguy hiểm: ghi cũ đè ghi mới (ANH_CU thắng)', `committed=${committed}`);
  }

  // 1. Lần ghi mới phải XẾP SAU lần đang kẹt, không ghi vượt.
  {
    const gate = createPhotoWriteGate();
    const started: string[] = [];
    const gen1 = gate.begin();
    const p1 = gate.run(gen1, async () => {
      started.push('cu');
      await delay(40);
    });
    await delay(10);
    const gen2 = gate.begin();
    const p2 = gate.run(gen2, async () => {
      started.push('moi');
    });
    await delay(15);
    ok(started.join(',') === 'cu', 'Lần ghi mới chưa ghi khi lần cũ còn kẹt', started.join(','));
    await Promise.all([p1, p2]);
    ok(started.join(',') === 'cu,moi', 'Thứ tự ghi: cũ xong trước, mới sau', started.join(','));
  }

  // 2. Lần ghi bị thay thế thì KHÔNG gọi cha (không ghi được gì để đè).
  {
    const gate = createPhotoWriteGate();
    const calls: string[] = [];
    const gen1 = gate.begin();
    const p1 = gate.run(gen1, async () => {
      calls.push('cu');
      return 'cu';
    });
    const gen2 = gate.begin();
    const p2 = gate.run(gen2, async () => {
      calls.push('moi');
      return 'moi';
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    ok(calls.length === 1 && calls[0] === 'moi', 'Lần ghi bị thay thế không hề ghi vào state', calls.join(','));
    ok(r1 === undefined && r2 === 'moi', 'Lần bị thay thế trả undefined, lần mới trả kết quả', `${String(r1)}/${String(r2)}`);
  }

  // 3. Lần ghi hỏng không làm kẹt hàng đợi cho lần sau.
  {
    const gate = createPhotoWriteGate();
    const gen1 = gate.begin();
    await assert.rejects(
      gate.run(gen1, async () => {
        throw new Error('Lưu ảnh thất bại');
      }),
      /Lưu ảnh thất bại/
    );
    const gen2 = gate.begin();
    ok((await gate.run(gen2, async () => 'xong')) === 'xong', 'Lần ghi hỏng không chặn lần ghi sau');
  }

  // 4. Nối dây: modal phải đưa MỌI lần ghi qua cổng, và chỉ tác động
  //    lần ghi còn hiện hành (watchdog/catch/finally của lần bị thay thế
  //    không được mở khoá UI của lần đang chạy).
  {
    const src = readFileSync(join(__dirname, '..', 'src', 'components', 'pos', 'TransferPaymentModal.tsx'), 'utf8');
    ok(/createPhotoWriteGate/.test(src), 'Modal dùng cổng ghi ảnh');
    ok(/writeGateRef\.current\.run\(/.test(src), 'Mọi lần ghi ảnh đi qua run()');
    ok(/writeGateRef\.current\.isCurrent\(/.test(src), 'Watchdog/catch/finally chỉ tác động lần ghi còn hiện hành');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass / ${fail} fail`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-photo-write-gate thất bại:', err);
  process.exit(1);
});
