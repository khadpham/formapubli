import { assertIsolatedTestDb } from './test-guard';
import { db, activeSessions, staffAccounts } from '../src/db';
import { eq } from 'drizzle-orm';
import {
  claimCashierLease,
  checkCashierLease,
  renewCashierLease,
  CASHIER_LEASE_TTL_MS,
} from '../src/lib/auth-session';

assertIsolatedTestDb('test-cashier-session-recovery');

async function run() {
  console.log('=== BẮT ĐẦU TEST: Cashier Session Recovery on iOS ===');

  // Đảm bảo có tài khoản NV-01
  const staff = await db.select().from(staffAccounts).where(eq(staffAccounts.staffId, 'NV-01')).limit(1);
  if (!staff.length) {
    throw new Error('Tài khoản NV-01 không tồn tại trong DB test');
  }

  // Dọn sạch session cũ của NV-01
  await db.delete(activeSessions).where(eq(activeSessions.staffId, 'NV-01'));

  const sessionDeviceA = 'session-device-a-uuid-1234';
  const sessionDeviceB = 'session-device-b-uuid-5678';
  const now = Date.now();

  // 1. Thiết bị A (iPhone) đăng nhập và chiếm lease
  console.log('Case 1: Thiết bị A đăng nhập chiếm lease ban đầu...');
  await claimCashierLease({
    staffId: 'NV-01',
    sessionId: sessionDeviceA,
    deviceLabel: 'iPhone của Thu Ngân',
    nowMs: now,
  });

  let okA = await checkCashierLease('NV-01', sessionDeviceA);
  if (!okA) throw new Error('FAIL: Thiết bị A vừa chiếm lease nhưng checkCashierLease trả về false');
  console.log('  -> OK: Thiết bị A giữ lease hợp lệ.');

  // 2. Giả lập iPhone ngủ nền quá 15 phút (vượt quá TTL 10 phút)
  console.log('Case 2: Giả lập iPhone ngủ nền quá 15 phút (lease quá hạn trong DB)...');
  const pastIso = new Date(now - 5 * 60 * 1000).toISOString(); // Hết hạn từ 5 phút trước
  await db.update(activeSessions).set({ leaseExpiresAt: pastIso }).where(eq(activeSessions.staffId, 'NV-01'));

  // Kiểm tra trước khi hồi sinh: lease đang ở quá khứ
  const rowBefore = (await db.select().from(activeSessions).where(eq(activeSessions.staffId, 'NV-01')))[0];
  if (rowBefore.leaseExpiresAt > new Date().toISOString()) {
    throw new Error('FAIL: Không gán được lease quá hạn');
  }

  // 3. iPhone thức dậy: cùng sessionId gọi checkCashierLease
  console.log('Case 3: iPhone thức dậy, cùng sessionId gọi checkCashierLease (Same-Session Auto-Recovery)...');
  okA = await checkCashierLease('NV-01', sessionDeviceA);
  if (!okA) {
    throw new Error('FAIL: Thiết bị A thức dậy với cùng sessionId nhưng checkCashierLease từ chối!');
  }

  const rowAfter = (await db.select().from(activeSessions).where(eq(activeSessions.staffId, 'NV-01')))[0];
  if (rowAfter.leaseExpiresAt <= new Date().toISOString()) {
    throw new Error('FAIL: checkCashierLease không tự động gia hạn leaseExpiresAt vào tương lai!');
  }
  console.log('  -> OK: Thiết bị A tự động hồi sinh lease thành công (lease mới:', rowAfter.leaseExpiresAt, ')');

  // 4. Giả lập iPhone lại bị quá hạn, nhưng gửi heartbeat renewCashierLease
  console.log('Case 4: Heartbeat từ thiết bị A sau khi ngủ quá hạn...');
  await db.update(activeSessions).set({ leaseExpiresAt: pastIso }).where(eq(activeSessions.staffId, 'NV-01'));
  const renewOk = await renewCashierLease({
    staffId: 'NV-01',
    sessionId: sessionDeviceA,
    nowMs: Date.now(),
  });
  if (!renewOk) {
    throw new Error('FAIL: renewCashierLease từ chối gia hạn cho cùng sessionId khi lease hết hạn!');
  }
  console.log('  -> OK: renewCashierLease gia hạn thành công.');

  // 5. Kiểm tra tính năng S-01 bảo vệ: Thiết bị B đăng nhập sau khi A quá hạn
  console.log('Case 5: Thiết bị B chiếm quyền khi A đã quá hạn (đổi máy hợp lệ)...');
  await db.update(activeSessions).set({ leaseExpiresAt: pastIso }).where(eq(activeSessions.staffId, 'NV-01'));
  await claimCashierLease({
    staffId: 'NV-01',
    sessionId: sessionDeviceB,
    deviceLabel: 'Máy B backup',
    nowMs: Date.now(),
  });

  const rowB = (await db.select().from(activeSessions).where(eq(activeSessions.staffId, 'NV-01')))[0];
  if (rowB.sessionId !== sessionDeviceB) {
    throw new Error('FAIL: Thiết bị B không chiếm được lease khi A đã quá hạn!');
  }
  console.log('  -> OK: Thiết bị B đã chiếm lease thành công.');

  // 6. Thiết bị A cũ thức dậy SAU KHI B đã chiếm quyền: A phải bị chặn!
  console.log('Case 6: Thiết bị A thức dậy sau khi B đã chiếm quyền -> A phải bị từ chối...');
  const oldAOk = await checkCashierLease('NV-01', sessionDeviceA);
  if (oldAOk) {
    throw new Error('FAIL: Thiết bị A cũ vẫn được chấp nhận sau khi Thiết bị B đã chiếm quyền!');
  }
  const oldARenew = await renewCashierLease({
    staffId: 'NV-01',
    sessionId: sessionDeviceA,
    nowMs: Date.now(),
  });
  if (oldARenew) {
    throw new Error('FAIL: Thiết bị A cũ vẫn renew được sau khi Thiết bị B đã chiếm quyền!');
  }
  console.log('  -> OK: Thiết bị A cũ bị chặn hoàn toàn (Bảo vệ S-01 nguyên vẹn 100%).');

  console.log('=== TẤT CẢ CÁC CASE ĐỀU PASS! ===');
}

run().catch((err) => {
  console.error('LỖI TEST:', err);
  process.exit(1);
});
