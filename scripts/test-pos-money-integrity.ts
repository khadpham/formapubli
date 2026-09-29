/**
 * Hai lỗi POS mất tiền đã được xác minh tay trước khi sửa:
 *
 * 1. Chốt ca THẤT BẠI thì POS xoá `activeSession` ở client mà không hỏi lại
 *    server. Ca vẫn OPEN trên server, nhưng POS hiện "két chưa mở". Từ đó đơn
 *    tiền mặt gửi đi mang `cashboxSessionId: activeSession?.id` = undefined ⇒
 *    server ghi `cashboxSessionId = null` ⇒ `calculateSessionStats` lọc theo
 *    sessionId nên BỎ SÓT chính các đơn đó ⇒ `expectedCash` thấp hơn thực tế ⇒
 *    chốt ca ghi sai số chênh lệch.
 *
 * 2. `resetPostCheckoutState` nằm bên trong `handleCheckout` và ref chỉ được
 *    gán tại đó. Sau khi F5, phiên chuyển khoản được khôi phục từ cache mà
 *    `handleCheckout` chưa từng chạy ⇒ `postCheckoutResetRef.current === null`
 *    ⇒ bấm Xác nhận/Huỷ gọi `?.()` vào null, `activeOrderCode` không đổi ⇒ đơn
 *    kế gửi trùng `idempotencyKey` của đơn cũ ⇒ server trả lại ĐƠN CŨ. Bán lại
 *    đúng giỏ cũ chỉ có 1 dòng đơn và trừ kho 1 lần, còn khách nhận sách 2 lần.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/pos/PosCheckoutTerminal.tsx'),
  'utf8'
);
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  .join('\n');

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

// --- Lỗi 1: catch của chốt ca phải hỏi lại server, không tự dọn state két ---
const closeShift = code.match(/const handleCloseShift[\s\S]{0,4000}?finally \{/);
ok(!!closeShift, 'phải tìm thấy handler chốt ca');
if (closeShift) {
  const block = closeShift[0];
  const catchBlock = block.slice(block.indexOf('catch'));
  ok(
    /fetchActiveCashboxSession\(\)/.test(catchBlock),
    'chốt ca lỗi phải gọi lại fetchActiveCashboxSession() — server mới là nguồn sự thật'
  );
  ok(
    !/setActiveSession\(null\)/.test(catchBlock),
    'chốt ca lỗi KHÔNG được tự setActiveSession(null) — sẽ bỏ sót đơn tiền mặt khỏi két'
  );
}

// --- Lỗi 2: ref phải luôn có sẵn, không phụ thuộc handleCheckout đã chạy ---
const refDecl = code.match(/const postCheckoutResetRef[\s\S]{0,3000}?postCheckoutResetRef\.current = resetPostCheckoutState/);
ok(!!refDecl, 'phải gán postCheckoutResetRef.current ở phạm vi component');
if (refDecl) {
  ok(
    !/const handleCheckout/.test(refDecl[0]),
    'việc gán ref KHÔNG được nằm trong handleCheckout — sau F5 handleCheckout chưa chạy'
  );
}

// Hàm reset phải ở phạm vi component, không định nghĩa lần thứ hai bên trong
// handleCheckout (định nghĩa trùng là dấu hiệu chưa dọn sạch).
ok(
  (code.match(/const resetPostCheckoutState = /g) || []).length === 1,
  'resetPostCheckoutState phải được định nghĩa đúng một lần'
);
ok(
  !/const resetPostCheckoutState = /.test(
    (code.match(/const handleCheckout[\s\S]{0,4000}/) || [''])[0]
  ),
  'resetPostCheckoutState không được nằm trong handleCheckout'
);

console.log(`\n=== HAI LỖI POS MẤT TIỀN: ${checks} assertions PASS ===`);
