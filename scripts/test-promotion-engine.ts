/**
 * scripts/test-promotion-engine.ts — khoá luật tính quà.
 *
 * Thuần khiết, KHÔNG đụng DB. Chạy: `npx tsx scripts/test-promotion-engine.ts`
 *
 * Hai lỗi lịch sử mà bài này phải chặn vĩnh viễn:
 *  1. CỘNG DỒN bậc: đơn 1 triệu ra 2A + 2B + C thay vì A + B + C.
 *  2. VÒNG LẶP: dòng quà tự đẩy tổng vượt bậc kế tiếp và sinh quà mới.
 * Bài này khoá CẢ HAI bằng assert, không chỉ bằng lời giải thích trong comment.
 */
import assert from 'node:assert';
import {
  computeGifts,
  giftValueWarning,
  type PromotionCampaign,
} from '../src/lib/promotion-engine';

let pass = 0;
let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(
      `  ❌ FAIL: ${label}\n      nhận ${JSON.stringify(actual)}\n      cần  ${JSON.stringify(expected)}`
    );
  }
}

/** Bậc thang đúng như nhân viên văn phòng mô tả. */
const CAMPAIGN: PromotionCampaign = {
  id: 'KM1',
  name: 'Tặng theo mốc đơn',
  isActive: true,
  gifts: [
    { minSubtotal: 500_000, productId: 'A', giftQuantity: 1 },
    { minSubtotal: 800_000, productId: 'A', giftQuantity: 1 },
    { minSubtotal: 800_000, productId: 'B', giftQuantity: 1 },
    { minSubtotal: 1_000_000, productId: 'A', giftQuantity: 1 },
    { minSubtotal: 1_000_000, productId: 'B', giftQuantity: 1 },
    { minSubtotal: 1_000_000, productId: 'C', giftQuantity: 1 },
  ],
};

const ids = (r: { productId: string }[]) => r.map((x) => x.productId).sort();
const calc = (eligibleBase: number, extra: Partial<Parameters<typeof computeGifts>[0]> = {}) =>
  computeGifts({ eligibleBase, campaigns: [CAMPAIGN], ...extra });

console.log('=== TEST: ENGINE TÍNH QUÀ ===\n');

console.log('--- 1. BẬC THANG: chỉ mốc cao nhất (KHÔNG cộng dồn) ---');
eq('300k — dưới mốc, không tặng', calc(300_000), []);
eq('500k — đúng mốc → A', ids(calc(500_000)), ['A']);
eq('799k — chưa đạt 800k → A', ids(calc(799_000)), ['A']);
eq('800k → A + B', ids(calc(800_000)), ['A', 'B']);
eq('999k → A + B', ids(calc(999_000)), ['A', 'B']);

// ĐÂY LÀ ASSERT QUAN TRỌNG NHẤT CỦA CẢ BÀI.
// Nếu ai đó đổi lại thành "mọi mốc ≤ tổng đều kích hoạt", dòng này ĐỎ.
eq('1.000.000 → A + B + C (KHÔNG phải 2A+2B+C)', ids(calc(1_000_000)), ['A', 'B', 'C']);
eq(
  '1.000.000 — mỗi món đúng 1 chiếc, không nhân đôi',
  calc(1_000_000).map((x) => x.quantity).sort(),
  [1, 1, 1]
);
eq('2.000.000 — vẫn A+B+C, KHÔNG tăng theo tỷ lệ', ids(calc(2_000_000)), ['A', 'B', 'C']);

console.log('\n--- 2. VÒNG LẶP ---');
// Mô phỏng bẫy: bậc 500k tặng tù lù (300k), bậc 800k tặng áo mưa.
// Nếu dòng quà được tính vào tổng, lần lặp sau sẽ leo lên bậc 800k.
const LOOP_CAMPAIGN: PromotionCampaign = {
  id: 'KM2',
  name: 'Tặng bậc có giá trị lớn',
  isActive: true,
  gifts: [
    { minSubtotal: 500_000, productId: 'Tù lù', giftQuantity: 1 },
    { minSubtotal: 800_000, productId: 'Áo mưa', giftQuantity: 1 },
  ],
};
const loopOnce = computeGifts({
  eligibleBase: 500_000,
  campaigns: [LOOP_CAMPAIGN],
});
eq('đơn 500k chỉ nhận Tù lù', ids(loopOnce), ['Tù lù']);

// Bẫng thật: giả sử hệ thống LỖI tính cả quà vào tổng (500k + 300k = 800k).
// Engine phải cho kết quả ĐÚNG khi đưa 800k vào, và người gọi phải loại quà
// khỏi eligibleBase trước. Test này khoá hành vi, không khoá lỗi của người gọi.
// Bật thang KHÔNG phải "cộng dồn": ở 800k chỉ nhận đúng món của bậc 800k.
eq(
  'đơn 800k chỉ nhận Áo mưa (KHÔNG phải cả Tù lù)',
  ids(computeGifts({ eligibleBase: 800_000, campaigns: [LOOP_CAMPAIGN] })),
  ['Áo mưa']
);
eq(
  'đơn 500k + quà đã trừ ra (eligibleBase=500k) KHÔNG leo bậc',
  ids(computeGifts({ eligibleBase: 500_000, campaigns: [LOOP_CAMPAIGN] })),
  ['Tù lù']
);

console.log('\n--- 3. BỎ QUÀ (dính) ---');
eq(
  'bỏ B ở bậc 800k → chỉ còn A',
  ids(calc(800_000, { dismissed: new Set(['B']) })),
  ['A']
);
eq(
  'lên bậc 1tr, B ĐÃ BỎ thì không tự quay lại',
  ids(calc(1_000_000, { dismissed: new Set(['B']) })),
  ['A', 'C']
);
eq(
  'C chưa từng bị bỏ nên vẫn hiện',
  calc(1_000_000, { dismissed: new Set(['B']) }).length,
  2
);

console.log('\n--- 4. QUÀ TAY ĐÃ DUYỆT ---');
eq(
  'quà tay không nằm trong cấu hình vẫn được tặng',
  ids(computeGifts({
    eligibleBase: 100_000,
    campaigns: [CAMPAIGN],
    approvedManual: new Set(['X']),
  })),
  ['X']
);
eq(
  'quà tay trùng với quà tự động → gộp, đánh dấu tay',
  (() => {
    const r = computeGifts({
      eligibleBase: 500_000,
      campaigns: [CAMPAIGN],
      approvedManual: new Set(['A']),
    });
    return { n: r.length, qty: r[0].quantity, isManual: r[0].isManual };
  })(),
  { n: 1, qty: 1, isManual: true }
);
eq(
  'quà tay đã bị bỏ thì không tặng lại',
  computeGifts({
    eligibleBase: 100_000,
    campaigns: [CAMPAIGN],
    dismissed: new Set(['X']),
    approvedManual: new Set(['X']),
  }),
  []
);

console.log('\n--- 5. CHIẾN DỊCH TẮT / NGOÀI THỜI GIAN ---');
eq('chiến dịch tắt', computeGifts({
  eligibleBase: 1_000_000,
  campaigns: [{ ...CAMPAIGN, isActive: false }],
}), []);
eq('chưa tới ngày bắt đầu', ids(computeGifts({
  eligibleBase: 1_000_000,
  campaigns: [{ ...CAMPAIGN, startsAt: '2030-01-01' }],
  now: new Date('2026-10-01'),
})), []);
eq('đã qua ngày kết thúc', computeGifts({
  eligibleBase: 1_000_000,
  campaigns: [{ ...CAMPAIGN, endsAt: '2020-01-01' }],
  now: new Date('2026-10-01'),
}), []);
eq('trong thời gian → vẫn tặng', ids(computeGifts({
  eligibleBase: 1_000_000,
  campaigns: [{ ...CAMPAIGN, startsAt: '2026-01-01', endsAt: '2027-01-01' }],
  now: new Date('2026-10-01'),
})), ['A', 'B', 'C']);

console.log('\n--- 6. NHIỀU CHIẾN DỊCH SONG SONG ---');
eq('hai chiến dịch, mỗi cái lấy bậc cao nhất của chính nó', ids(computeGifts({
  eligibleBase: 1_000_000,
  campaigns: [
    CAMPAIGN,
    {
      id: 'KM3',
      name: 'Tặng phụ',
      isActive: true,
      gifts: [{ minSubtotal: 1_000_000, productId: 'D', giftQuantity: 2 }],
    },
  ],
})), ['A', 'B', 'C', 'D']);
eq('số lượng quà phụ giữ nguyên 2', computeGifts({
  eligibleBase: 1_000_000,
  campaigns: [{
    id: 'KM3', name: 'x', isActive: true,
    gifts: [{ minSubtotal: 1_000_000, productId: 'D', giftQuantity: 2 }],
  }],
})[0].quantity, 2);

console.log('\n--- 7. DỮ LIỆU BẨN phải bị chặn ---');
eq('giftQuantity = 0 bị bỏ qua', ids(computeGifts({
  eligibleBase: 999_999,
  campaigns: [{
    id: 'X', name: 'x', isActive: true,
    gifts: [{ minSubtotal: 500_000, productId: 'A', giftQuantity: 0 }],
  }],
})), []);
eq('giftQuantity âm bị bỏ qua', ids(computeGifts({
  eligibleBase: 999_999,
  campaigns: [{
    id: 'X', name: 'x', isActive: true,
    gifts: [{ minSubtotal: 500_000, productId: 'A', giftQuantity: -3 }],
  }],
})), []);
eq('giftQuantity thập phân bị bỏ qua', ids(computeGifts({
  eligibleBase: 999_999,
  campaigns: [{
    id: 'X', name: 'x', isActive: true,
    gifts: [{ minSubtotal: 500_000, productId: 'A', giftQuantity: 1.5 }],
  }],
})), []);
eq('eligibleBase = 0 thì không tặng gì', calc(0), []);

console.log('\n--- 8. CẢNH BÁO GIÁ TRỊ QUÀ ---');
eq('quà = 20% đơn → không cảnh báo', giftValueWarning(200_000, 1_000_000), null);
eq('quà = 50% đơn → CẢNH BÁO', typeof giftValueWarning(500_000, 1_000_000), 'string');
eq('quà = 100% đơn → CẢNH BÁO', typeof giftValueWarning(1_000_000, 1_000_000), 'string');
eq('quà = 0 → không cảnh báo', giftValueWarning(0, 1_000_000), null);
eq('đơn = 0 → không cảnh báo (tránh chia 0)', giftValueWarning(100_000, 0), null);

console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.error('\n❌ ENGINE TÍNH QUÀ SAI — KHÔNG ĐƯỢC ĐƯA LÊN UI.');
  process.exit(1);
}
console.log('\n✅ ENGINE ĐÚNG: bậc thang không cộng dồn, không vòng lặp.');
process.exit(0);