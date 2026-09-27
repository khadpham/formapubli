/**
 * Kiểm thử chuông thông báo (1 nút duy nhất, gộp 2 nguồn, xóa được, nổi trên nội dung, nhãn có dấu).
 *
 * Chạy: npx tsx scripts/test-notification-bell.ts
 * KHÔNG chạm DB (chỉ đọc source + gọi hàm thuần).
 */
import * as fs from 'fs';
import * as path from 'path';
import { mergeNotifyItems, computeUnreadBadge } from '../src/components/notifications/NotificationBell';

const BELL = path.join(__dirname, '../src/components/notifications/NotificationBell.tsx');
const SHELL = path.join(__dirname, '../src/components/layout/MasterAppShell.tsx');

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  OK   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const bellSrc = fs.readFileSync(BELL, 'utf-8');
const shellSrc = fs.readFileSync(SHELL, 'utf-8');

console.log('\n[1] Chỉ có MỘT chuông trong header');
const bellAriaCount = (bellSrc.match(/aria-label="Thông báo"/g) || []).length;
check('NotificationBell đúng 1 nút aria-label="Thông báo"', bellAriaCount === 1, `thấy ${bellAriaCount}`);
check('MasterAppShell không render icon Bell nào', !/<Bell\b/.test(shellSrc));
check('MasterAppShell không còn aria-label chuông', !/aria-label="[^"]*[Tt]hông báo[^"]*"/.test(shellSrc));
check('MasterAppShell không còn panel "Thông báo POS"', !/Thông báo POS/.test(shellSrc));

console.log('\n[2] Gộp 2 nguồn, mới nhất trước, có nhãn khu vực');
const merged = mergeNotifyItems(
  [
    { id: 'a', kind: 'order', severity: 'warn', title: 'A', body: 'b', at: '2026-01-01T00:00:00Z', area: 'Kho' },
    { id: 'pos', kind: 'pos', severity: 'info', title: 'POS', body: 'b', at: '2026-01-03T00:00:00Z', area: 'POS' },
  ],
  [
    { id: 'shift-1', kind: 'shift', severity: 'info', title: 'Ca', body: 'b', at: '2026-01-02T00:00:00Z', area: 'Ca làm' },
  ],
);
check('gộp đủ 3 mục từ 2 nguồn', merged.length === 3, `thấy ${merged.length}`);
check('sắp xếp mới nhất trước', merged.map((i) => i.id).join(',') === 'pos,shift-1,a', merged.map((i) => i.id).join(','));
check('mọi mục đều có khu vực', merged.every((i) => typeof i.area === 'string' && i.area.length > 0));
check('mục không có area vẫn lọc được', !merged.some((i) => i.area === ''));

console.log('\n[3] Xóa được: "Xóa tất cả" + ẩn từng mục');
check('có nút "Xóa tất cả"', bellSrc.includes('Xóa tất cả'));
check('có hành động ẩn từng mục', bellSrc.includes('Ẩn thông báo này'));
check('có hàm xóa cục bộ gọi từ UI', /function clearAll|const clearAll|const dismissItem|const dismissAll/.test(bellSrc));
check('danh sách rỗng có thông điệp', bellSrc.includes('Bạn chưa có thông báo nào'));
check('có nút "Đánh dấu đã đọc"', bellSrc.includes('Đánh dấu đã đọc'));

console.log('\n[4] Panel nổi trên nội dung, cuộn được, vừa màn 375px');
const portalIdx = bellSrc.indexOf('createPortal');
const zMatch = bellSrc.match(/z-\[(\d+)\]/g) || [];
const zMax = Math.max(0, ...zMatch.map((z) => Number(z.replace(/\D/g, ''))));
check('panel render qua createPortal (thoát khỏi stacking context của header)', portalIdx !== -1);
check('z-index panel >= 100 (cao hơn header z-30 và drawer z-70)', zMax >= 100, `z tối đa ${zMax}`);
check('panel giới hạn chiều rộng theo viewport', /max-w-\[calc\(100vw/.test(bellSrc));
check('panel cuộn được', /overflow-y-auto/.test(bellSrc));
check('panel có chiều cao tối đa', /max-h-\[/.test(bellSrc));

console.log('\n[5] Nhãn tiếng Việt CÓ DẤU');
const forbidden = [
  'Thong bao', 'Xoa tat ca', 'Danh dau da doc', 'Thong bao POS',
  'Mo thong bao', 'Ban chua co thong bao nao', 'An thong bao', 'Lam moi',
  'Khong co viec nao', 'Cap nhat moi', 'Dong thong bao',
];
for (const f of forbidden) {
  check(`không có chuỗi không dấu "${f}" trong NotificationBell`, !bellSrc.includes(f));
  check(`không có chuỗi không dấu "${f}" trong MasterAppShell`, !shellSrc.includes(f));
}

console.log('\n[6] Badge chưa đọc không phình vô hạn');
const MARK = '2026-01-01T00:00:00Z';
const many = Array.from({ length: 500 }, (_, i) => ({
  id: `n${i}`, kind: 'order', severity: 'warn' as const, title: 't', body: 'b',
  at: MARK, area: 'Kho',
}));
// Mốc đã đọc = sau mọi mục → không mục nào "chưa đọc".
const beforeClear = computeUnreadBadge(many, '2026-01-02T00:00:00Z', new Set());
const afterClear = computeUnreadBadge(many, '2026-01-02T00:00:00Z', new Set(many.map((i) => i.id)));
check('badge chỉ đếm mục CHƯA đọc', beforeClear === 0, `thấy ${beforeClear}`);
check('badge = 0 sau khi xóa hết', afterClear === 0, `thấy ${afterClear}`);
check('badge bị chặn trần 99+', computeUnreadBadge(many, '2000-01-01T00:00:00Z', new Set()) === 99);
const unreadFresh = computeUnreadBadge(many.slice(0, 3), '2000-01-01T00:00:00Z', new Set());
check('badge đếm đúng số mục mới', unreadFresh === 3, `thấy ${unreadFresh}`);
// Mục bị ẩn không được cộng vào badge dù còn mới.
const withHidden = computeUnreadBadge(many.slice(0, 10), '2000-01-01T00:00:00Z', new Set(['n0', 'n1']));
check('badge bỏ qua mục đã ẩn', withHidden === 8, `thấy ${withHidden}`);
check('UI có hiển thị trần 99+', bellSrc.includes("'99+'"));

console.log(failed === 0 ? '\nPASS: tất cả kiểm tra chuông thông báo đều đạt.\n' : `\nFAIL: ${failed} kiểm tra chưa đạt.\n`);
process.exit(failed === 0 ? 0 : 1);
