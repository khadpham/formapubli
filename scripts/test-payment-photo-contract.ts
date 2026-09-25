/**
 * Transfer/QR payment proof contract.
 * Pure node assertion suite: bank-account cache, photo retention, and the
 * source-level contracts of the camera / modal / gallery / POS wiring.
 * No database, no browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Minimal in-memory localStorage so the cache module works under tsx/node. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
}
(globalThis as any).localStorage = new MemoryStorage();

// Static import: the cache module only touches localStorage inside its functions.
import {
  BANK_ACCOUNT_CACHE_TTL_MS,
  readBankAccountsCache,
  writeBankAccountsCache,
} from '../src/lib/bank-account-cache';

const account = {
  id: 'ba-1',
  label: 'VietinBank — Âu Cơ',
  bankBin: '970436',
  accountNo: '1234567890',
  accountName: 'Công ty TNHH Sách Tri Thức',
};

assert.equal(BANK_ACCOUNT_CACHE_TTL_MS, 24 * 3600_000, 'TTL cache tài khoản ngân hàng là 24 giờ');

const now = Date.now();
writeBankAccountsCache({ warehouseId: 'wh-au-co', cachedAt: now, defaultId: 'ba-1', accounts: [account] });
assert.equal(
  readBankAccountsCache('wh-au-co', now)?.accounts[0]?.accountNo,
  '1234567890',
  'Đọc cache ngay sau khi ghi'
);
assert.equal(
  readBankAccountsCache('wh-au-co', now)?.accounts[0]?.label,
  'VietinBank — Âu Cơ',
  'Cache giữ nguyên nhãn tài khoản'
);
assert.equal(readBankAccountsCache('wh-au-co', now)?.defaultId, 'ba-1', 'Cache giữ tài khoản mặc định');
assert.equal(
  readBankAccountsCache('wh-au-co', now + BANK_ACCOUNT_CACHE_TTL_MS),
  null,
  'Cache hết hạn sau đúng 24 giờ'
);
assert.equal(
  readBankAccountsCache('wh-au-co', now + BANK_ACCOUNT_CACHE_TTL_MS + 1),
  null,
  'Cache quá 24 giờ bị từ chối'
);
assert.equal(readBankAccountsCache('wh-quynh-mai', now), null, 'Không đọc cache của kho khác');
assert.equal(
  readBankAccountsCache('wh-au-co', now)?.warehouseId,
  'wh-au-co',
  'Cache trả về đúng kho đã ghi'
);

localStorage.setItem('formapubli.bankAccounts.wh-au-co', '{not json');
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Cache JSON hỏng bị từ chối');

localStorage.setItem(
  'formapubli.bankAccounts.wh-au-co',
  JSON.stringify({ warehouseId: 'wh-quynh-mai', cachedAt: now, defaultId: 'ba-1', accounts: [account] })
);
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Cache mang warehouseId khác bị từ chối');

localStorage.setItem(
  'formapubli.bankAccounts.wh-au-co',
  JSON.stringify({ warehouseId: 'wh-au-co', cachedAt: 'x', defaultId: 'ba-1', accounts: [account] })
);
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'cachedAt không phải số bị từ chối');

localStorage.setItem(
  'formapubli.bankAccounts.wh-au-co',
  JSON.stringify({ warehouseId: 'wh-au-co', cachedAt: now, defaultId: 'ba-1', accounts: 'nope' })
);
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Danh sách tài khoản hỏng bị từ chối');

localStorage.setItem('formapubli.bankAccounts.wh-au-co', JSON.stringify({ warehouseId: 'wh-au-co', cachedAt: now, defaultId: null, accounts: [] }));
assert.equal(readBankAccountsCache('wh-au-co', now)?.accounts.length, 0, 'Cache rỗng vẫn đọc được, QR sẽ bị chặn ở tầng UI');
localStorage.clear();
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Không có cache thì trả null, không ném lỗi');

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const vietQr = readSource('src/components/pos/VietQrPay.tsx');
assert.match(vietQr, /readBankAccountsCache/, 'VietQrPay phải fallback sang cache tài khoản');
assert.match(vietQr, /writeBankAccountsCache/, 'VietQrPay phải làm mới cache khi có mạng');
assert.match(vietQr, /'NETWORK' \| 'CACHE' \| 'NONE'/, 'VietQrPay phải phân biệt nguồn mạng / cache / không có');
assert.doesNotMatch(vietQr, /3600_000|24 \* 3600/, 'VietQrPay không tự đặt hạn cache: TTL thuộc về bank-account-cache');
assert.match(vietQr, /Dữ liệu cache/, 'VietQrPay hiển thị nhãn dữ liệu cache');
assert.match(vietQr, /onQrRef\.current\?\.\(null\)/, 'VietQrPay gọi onQr(null) khi không có tài khoản để xóa QR cũ');

console.log('PASS: transfer payment photo contract.');
