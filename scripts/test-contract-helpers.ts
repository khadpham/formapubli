import assert from 'node:assert/strict';
import { readVietnameseNumber } from '../src/lib/vietnamese-number-reader';
import { formatVietnameseDate } from '../src/lib/vietnamese-date-formatter';

async function run() {
  console.log('--- TEST CONTRACT HELPERS ---');

  // Đọc số thành chữ
  assert.equal(readVietnameseNumber(0), 'Không đồng chẵn');
  assert.equal(readVietnameseNumber(11), 'Mười một đồng chẵn');
  assert.equal(readVietnameseNumber(15000000), 'Mười lăm triệu đồng chẵn');
  assert.equal(readVietnameseNumber(50000000), 'Năm mươi triệu đồng chẵn');
  assert.equal(readVietnameseNumber(1000000000), 'Một tỷ đồng chẵn');
  assert.equal(readVietnameseNumber(1000005), 'Một triệu không trăm linh năm đồng chẵn');
  assert.equal(readVietnameseNumber(1000001), 'Một triệu không trăm linh một đồng chẵn');
  assert.equal(readVietnameseNumber(1010000), 'Một triệu không trăm mười nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(21000), 'Hai mươi mốt nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(125000), 'Một trăm hai mươi lăm nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(115000), 'Một trăm mười lăm nghìn đồng chẵn');
  assert.equal(readVietnameseNumber(105), 'Một trăm linh năm đồng chẵn');

  // Ngày tháng ND30: ngày VÀ tháng pad 2 chữ số khi < 10 (bẫy v1: tháng 09)
  assert.equal(
    formatVietnameseDate('2026-02-05', 'Hà Nội'),
    'Hà Nội, ngày 05 tháng 02 năm 2026'
  );
  assert.equal(
    formatVietnameseDate('2026-09-09'),
    'ngày 09 tháng 09 năm 2026'
  );
  assert.equal(
    formatVietnameseDate('2026-12-25', 'TP. Hồ Chí Minh'),
    'TP. Hồ Chí Minh, ngày 25 tháng 12 năm 2026'
  );
  assert.equal(formatVietnameseDate('không phải ngày', 'Hà Nội'), '');

  console.log('Test Contract Helpers: PASS');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
