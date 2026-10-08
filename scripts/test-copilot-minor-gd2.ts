/**
 * Test cho 7 minor GĐ2 (fix/copilot-gd2-minor).
 * Chạy DB cách ly: DATABASE_URL=file:/tmp/formapubli_test_minor.db
 */
import assert from 'node:assert/strict';
import { assertIsolatedTestDb } from './test-guard';

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  assertIsolatedTestDb('test-copilot-minor-gd2');
  const { ExecutiveQueryService } = await import('../src/services/executive-query.service');
  const { db } = await import('../src/db');
  const { warehouses, editions, works, stockBalances } = await import('../src/db/schema');
  const { eq, and } = await import('drizzle-orm');

  // Seed tối thiểu cho prepareTransferDraft (theo mẫu test-copilot-gd2).
  const { randomUUID } = await import('node:crypto');
  const suffix = randomUUID().slice(0, 6);
  const whId = 'wh-minor-' + suffix;
  const workId = 'work-minor-' + suffix;
  const prodId = 'prod-minor-' + suffix;
  const edId = 'ed-minor-' + suffix;
  const { products } = await import('../src/db/schema');
  await db.insert(warehouses).values({ id: whId, code: 'KMN' + suffix, name: 'Kho Minor Test' });
  await db.insert(works).values({ id: workId, code: 'W-MN' + suffix, title: 'Sách Minor', author: 'Tác giả Minor' });
  await db.insert(products).values({ id: prodId, name: 'Sách Minor' });
  await db.insert(editions).values({
    id: edId, code: 'MN001', workId,
    isbn: '9780000000099', isbnLast4: '0099', coverPrice: 100000,
  });
  await db.insert(stockBalances).values({ id: 'sb-minor-' + suffix, editionId: edId, productId: prodId, warehouseId: whId, physicalQuantity: 50 } as any);

  // Minor 2: số lượng > 999 → cảnh báo + giới hạn 999 (không lặng lẽ thành 1).
  const big = await ExecutiveQueryService.prepareTransferDraft({
    q: `chuyển 5000 cuốn MN001 từ Kho Minor Test sang Kho Khác`,
  });
  const bigLine = big.items.find((it: any) => it.code === 'MN001');
  ok(bigLine?.quantity === 999, `số lượng vượt cap → 999 (thấy ${bigLine?.quantity})`);
  ok(big.warnings.some((w: string) => w.includes('5000') && w.includes('999')), 'có warning vượt cap');

  // Minor 1: chưa rõ kho gửi → formatter không in "tồn kho gửi: 0".
  const noWh = await ExecutiveQueryService.prepareTransferDraft({ q: 'chuyển 5 cuốn MN001 sang kho B' });
  ok(!noWh.fromWarehouseId, 'không xác định kho gửi');
  ok(noWh.warnings.some((w: string) => w.includes('kho gửi')), 'có warning thiếu kho gửi');
  // Formatter: kiểm tra logic hiển thị qua route formatter (import trực tiếp).
  const { formatFallbackAnswer } = await import('../src/app/api/ai/copilot/route').catch(() => ({} as any));
  if (typeof formatFallbackAnswer === 'function') {
    const text = formatFallbackAnswer('prepare_transfer_draft', noWh as any);
    ok(!text.includes('tồn kho gửi: 0'), 'formatter không in "tồn kho gửi: 0" khi chưa rõ kho');
    ok(text.includes('chưa rõ'), 'formatter in "chưa rõ"');
  }

  // Minor 6: planNextStep nhận tracker (không throw khi truyền tracker).
  const { CopilotGuardrails } = await import('../src/services/ai/copilot-guardrails');
  const tracker: { planner?: string } = {};
  const step = await CopilotGuardrails.planNextStep('tồn kho?', [], [], undefined, tracker);
  ok(step.action === 'FINISH', 'không LLM key → FINISH (fail-closed)');

  // Minor 7: prompt ghi đúng 16 tool.
  const src = (await import('node:fs')).readFileSync('src/services/ai/copilot-guardrails.ts', 'utf-8');
  ok(src.includes('16 tool hệ thống'), 'prompt ghi 16 tool');
  ok(!/(^|[^0-9])6 tool hệ thống/.test(src), 'không còn "6 tool" đứng riêng');

  // Dọn seed.
  await db.delete(stockBalances).where(and(eq(stockBalances.editionId, edId), eq(stockBalances.warehouseId, whId)));
  await db.delete(editions).where(eq(editions.id, edId));
  await db.delete(products).where(eq(products.id, prodId));
  await db.delete(works).where(eq(works.id, workId));
  await db.delete(warehouses).where(eq(warehouses.id, whId));

  console.log(`✅ test-copilot-minor-gd2: ${checks} checks passed`);
}

run().catch((err) => {
  console.error(`❌ test-copilot-minor-gd2 FAILED sau ${checks} checks:`, err);
  process.exit(1);
});
