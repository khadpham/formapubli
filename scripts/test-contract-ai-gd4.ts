/**
 * Test Contract AI GĐ4 — dự án + cột mốc + gợi ý.
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-contract-ai-gd4
 * (Test trực tiếp service/DB vì routes cần session.)
 */
import { assertIsolatedTestDb } from './test-guard';
import { db, contractProjects, contractMilestones, contractDocuments } from '../src/db';
import { eq } from 'drizzle-orm';
import { generateUUIDv7 } from '../src/lib/uuidv7';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

function vnDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function main() {
  assertIsolatedTestDb('test-contract-ai-gd4');
  console.log('=== Contract AI GĐ4: dự án + cột mốc ===');

  const pid = `cprj-${generateUUIDv7()}`;
  await db.insert(contractProjects).values({ id: pid, name: 'Hội chợ sách 2026', status: 'ACTIVE' });

  const m1 = `cms-${generateUUIDv7()}`;
  const m2 = `cms-${generateUUIDv7()}`;
  await db.insert(contractMilestones).values([
    { id: m1, projectId: pid, title: 'Ký HĐ thuê địa điểm', dueDate: vnDate(5), neededCategory: 'THUE_DIA_DIEM_SK', status: 'PENDING' },
    { id: m2, projectId: pid, title: 'Ký HĐ đặt hàng', dueDate: vnDate(-3), neededCategory: 'DAT_HANG_HOA_SK', status: 'PENDING' },
  ]);

  const milestones = await db.select().from(contractMilestones).where(eq(contractMilestones.projectId, pid));
  ok('1. tạo 2 milestones', milestones.length === 2);

  // Giả lập suggest: quá hạn + sắp tới hạn (chưa có contract)
  const today = vnDate(0);
  const overdue = milestones.filter((m) => m.dueDate < today && !m.contractId && m.status === 'PENDING');
  const upcoming = milestones.filter((m) => m.dueDate >= today && !m.contractId && m.status === 'PENDING');
  ok('2. phát hiện 1 quá hạn', overdue.length === 1 && overdue[0].id === m2);
  ok('3. phát hiện 1 sắp tới hạn', upcoming.length === 1 && upcoming[0].id === m1);

  // Link hợp đồng → DONE
  await db.update(contractMilestones).set({ status: 'DONE' }).where(eq(contractMilestones.id, m1));
  const [updated] = await db.select().from(contractMilestones).where(eq(contractMilestones.id, m1));
  ok('4. link xong → DONE', updated.status === 'DONE');

  // Xóa dự án → milestones theo, hợp đồng giữ nguyên (không có contract nào ở đây, chỉ kiểm cascade)
  await db.delete(contractProjects).where(eq(contractProjects.id, pid));
  const remaining = await db.select().from(contractMilestones).where(eq(contractMilestones.projectId, pid));
  ok('5. xóa dự án → milestones theo', remaining.length === 0);

  console.log(`\nTổng ${pass + fail} kiểm tra — đạt ${pass}, lỗi ${fail}.`);
  if (fail > 0) { console.log('❌ CÓ LỖI'); process.exit(1); }
  console.log('🎉 TẤT CẢ ĐẠT');
}

main().catch((e) => { console.error('❌ CRASH:', e); process.exit(1); });
