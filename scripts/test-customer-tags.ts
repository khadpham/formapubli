/**
 * Bước 3 — Kiểm thử Customer Tags CRM (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-customer-tags
 * 8 cases: assign / idempotent / tag lạ / unassign / lọc 1 tag /
 * multi any / multi all / cascade khi xóa khách.
 */
import { db, customers } from '../src/db';
import { eq } from 'drizzle-orm';
import { CustomerTagService } from '../src/services/customer-tag.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-customer-tags');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function makeCustomer(name: string) {
  const id = uniq('cust-tag');
  await db.insert(customers).values({ id, code: `CT-${id}`, fullName: name });
  return id;
}

async function run() {
  console.log('🏷️ KIỂM THỬ CUSTOMER TAGS CRM (DB cách ly)');
  let passed = 0;
  const total = 8;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  const cA = await makeCustomer('Khách Sub Test');
  const cB = await makeCustomer('Khách News Test');

  // 1. Assign tag chuẩn
  const a1 = await CustomerTagService.assign(cA, 'TAG_SUBSCRIPTION', 'ROLE_MANAGER');
  ok('1. Gắn TAG_SUBSCRIPTION', a1.already === false && (await CustomerTagService.listTags(cA)).includes('TAG_SUBSCRIPTION'));

  // 2. Gắn trùng idempotent
  const a2 = await CustomerTagService.assign(cA, 'TAG_SUBSCRIPTION', 'ROLE_MANAGER');
  const tagsA = await CustomerTagService.listTags(cA);
  ok('2. Gắn trùng không sinh dòng mới', a2.already === true && tagsA.filter((t) => t === 'TAG_SUBSCRIPTION').length === 1);

  // 3. Tag lạ bị từ chối
  let badTag = false;
  try {
    await CustomerTagService.assign(cA, 'TAG_VIP_TU_DO', 'ROLE_MANAGER');
  } catch (e: any) {
    badTag = /không hợp lệ/.test(e.message);
  }
  ok('3. Chặn tag ngoài allowlist', badTag);

  // 4. Unassign
  await CustomerTagService.assign(cA, 'TAG_NEWSLETTER', 'ROLE_MANAGER');
  await CustomerTagService.unassign(cA, 'TAG_NEWSLETTER', 'ROLE_MANAGER');
  ok('4. Gỡ tag', !(await CustomerTagService.listTags(cA)).includes('TAG_NEWSLETTER'));

  // 5. Lọc 1 tag (phát hành hàng loạt)
  await CustomerTagService.assign(cB, 'TAG_SUBSCRIPTION', 'ROLE_MANAGER');
  const sub = await CustomerTagService.filterByTags(['TAG_SUBSCRIPTION']);
  ok('5. Lọc 1 tag ra đủ khách', sub.some((c) => c.id === cA) && sub.some((c) => c.id === cB), `n=${sub.length}`);

  // 6. Multi any: có ≥1 tag
  await CustomerTagService.assign(cB, 'SOURCE_EVENT', 'ROLE_MANAGER');
  const anyRes = await CustomerTagService.filterByTags(['TAG_SUBSCRIPTION', 'SOURCE_CAMPAIGN'], 'any');
  ok('6. Multi any', anyRes.some((c) => c.id === cA) && anyRes.some((c) => c.id === cB));

  // 7. Multi all: phải đủ mọi tag
  const allRes = await CustomerTagService.filterByTags(['TAG_SUBSCRIPTION', 'SOURCE_EVENT'], 'all');
  ok('7. Multi all chỉ ra khách đủ tag', allRes.some((c) => c.id === cB) && !allRes.some((c) => c.id === cA));

  // 8. Xóa khách cascade tag
  const cC = await makeCustomer('Khách Xóa Test');
  await CustomerTagService.assign(cC, 'TAG_NEWSLETTER', 'ROLE_MANAGER');
  await db.delete(customers).where(eq(customers.id, cC));
  ok('8. Xóa khách cascade tag', (await CustomerTagService.listTags(cC)).length === 0);

  console.log(`\n${passed === total ? '🎉' : '⚠️'} CUSTOMER TAGS: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-customer-tags thất bại:', err);
  process.exit(1);
});
