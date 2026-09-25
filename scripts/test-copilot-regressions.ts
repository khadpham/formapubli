import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import { db, editions, stockBalances } from '../src/db';
import { POST as postCopilot } from '../src/app/api/ai/copilot/route';
import { SESSION_COOKIE_NAME, signSession } from '../src/lib/auth-session';
import { ExecutiveQueryService } from '../src/services/executive-query.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-copilot-regressions');

async function run() {
  const [edition] = await db
    .select({ id: editions.id, title: editions.title })
    .from(editions)
    .limit(1);
  assert.ok(edition?.title, 'DB test phải có ít nhất một ấn bản có tiêu đề');

  await db.update(editions).set({ status: 'OUT_OF_STOCK' }).where(eq(editions.id, edition.id));
  await db
    .update(stockBalances)
    .set({ physicalQuantity: 0 })
    .where(
      and(
        eq(stockBalances.editionId, edition.id),
        eq(stockBalances.condition, 'NEW'),
        ne(stockBalances.warehouseId, 'wh-in-transit')
      )
    );
  await db
    .update(stockBalances)
    .set({ physicalQuantity: 37 })
    .where(
      and(
        eq(stockBalances.editionId, edition.id),
        eq(stockBalances.warehouseId, 'wh-au-co'),
        eq(stockBalances.condition, 'NEW')
      )
    );
  await db.delete(stockBalances).where(
    and(
      eq(stockBalances.editionId, edition.id),
      eq(stockBalances.warehouseId, 'wh-in-transit'),
      eq(stockBalances.condition, 'NEW')
    )
  );
  await db.delete(stockBalances).where(
    and(
      eq(stockBalances.editionId, edition.id),
      eq(stockBalances.warehouseId, 'wh-quynh-mai'),
      eq(stockBalances.condition, 'DEFECTIVE')
    )
  );
  await db.insert(stockBalances).values([
    {
      id: `sb-${edition.id}-wh-in-transit-NEW`,
      editionId: edition.id,
      warehouseId: 'wh-in-transit',
      condition: 'NEW',
      physicalQuantity: 900,
    },
    {
      id: `sb-${edition.id}-wh-quynh-mai-DEFECTIVE`,
      editionId: edition.id,
      warehouseId: 'wh-quynh-mai',
      condition: 'DEFECTIVE',
      physicalQuantity: 400,
    },
  ]);
  const catalog = await ExecutiveQueryService.queryCatalog({ titleContains: edition.title, limit: 1 });
  const item = catalog.items[0];

  assert.ok(item, 'Tra cứu đề mục phải trả đúng ấn bản');
  assert.equal(item.availableStock, 37, 'Tồn danh mục chỉ lấy NEW bán được và loại In-Transit');
  assert.equal(item.status, 'IN_STOCK', 'Tình trạng danh mục phải phản ánh tồn thực tế, không dùng trạng thái tĩnh');

  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  const token = await signSession({
    role: 'ROLE_OWNER',
    actorId: 'ADMIN-01',
    fullName: 'Copilot Regression',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  const req = new Request('http://localhost/api/ai/copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    body: JSON.stringify({ question: 'Liệt kê danh mục sách và tình trạng hiện tại' }),
  });
  const response = await postCopilot(req as any);
  const payload = await response.json();
  assert.equal(response.status, 200, 'Copilot fallback phải trả lời thành công');
  assert.match(payload.data.answer, /Còn hàng.*37 cuốn/, 'Fallback danh mục phải nêu tình trạng và tồn thực tế');

  const drawerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/copilot/CopilotDrawer.tsx'),
    'utf8'
  );

  assert.match(drawerSource, /<textarea/, 'Ô chat phải là textarea để hiển thị câu hỏi nhiều dòng');
  assert.doesNotMatch(drawerSource, /title="Mở rộng"/, 'Drawer không được có nút phóng to lần hai');
  assert.match(drawerSource, /title="Mở rộng toàn màn hình phải"/, 'Cửa sổ mini vẫn giữ một nút mở drawer');

  console.log('✅ Copilot catalog stock + chat UI regressions passed');
}

run().catch((err) => {
  console.error('❌ Copilot regression test failed:', err);
  process.exit(1);
});
