/**
 * Test Contract AI GĐ3 — mock LLM, KHÔNG gọi API thật.
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-contract-ai-gd3
 */
import { smartDraft, ContractAIError } from '../src/services/ai/contract-ai.service';
import { assertIsolatedTestDb } from './test-guard';
import { db, contractTemplates } from '../src/db';
import { eq } from 'drizzle-orm';
import { finalizeAiTemplate } from '../src/services/ai/contract-ai.service';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

async function main() {
  assertIsolatedTestDb('test-contract-ai-gd3');
  console.log('=== Contract AI GĐ3: smartDraft ===');

  // Tạo mẫu thật trong DB test để smartDraft load
  const tplId = await finalizeAiTemplate({
    code: `GD3-TEST-${Date.now()}`,
    title: 'Mẫu test GĐ3',
    category: 'THUE_DIA_DIEM_SK',
    bodyText: 'Bên thuê: {ten_ben_thue}\nGiá thuê: {gia_thue} đồng.\nĐiều 3: Bên cho thuê bàn giao mặt bằng trước 7 ngày.',
    placeholders: ['ten_ben_thue', 'gia_thue'],
  });

  const fakeLlm = async () => JSON.stringify({
    filledText: 'Bên thuê: Công ty ABC\nGiá thuê: 100 triệu đồng.\nĐiều 3: Bên cho thuê bàn giao mặt bằng trước 7 ngày.',
    adjustments: [
      {
        id: 'adj-1',
        clauseRef: 'Điều 3',
        original: 'Bên cho thuê bàn giao mặt bằng trước 7 ngày.',
        proposed: 'Bên cho thuê bàn giao mặt bằng trước 10 ngày.',
        reason: 'Theo ghi chú: cần thêm thời gian setup gian hàng.',
      },
    ],
  });

  const result = await smartDraft(
    { templateId: tplId, fieldValues: { ten_ben_thue: 'Công ty ABC', gia_thue: '100 triệu' }, notes: 'cần thêm thời gian setup' },
    fakeLlm,
  );
  ok('1. filledText đã điền giá trị', result.filledText.includes('Công ty ABC') && !result.filledText.includes('{ten_ben_thue}'));
  ok('2. filledText giữ nguyên điều khoản gốc', result.filledText.includes('bàn giao mặt bằng trước 7 ngày'));
  ok('3. adjustments đủ 5 trường',
    result.adjustments.length === 1 &&
    result.adjustments.every((a) => a.id && a.clauseRef && a.original && a.proposed && a.reason));
  ok('4. điều chỉnh nằm riêng, không lẫn vào filledText', !result.filledText.includes('10 ngày'));

  let notFound = false;
  try { await smartDraft({ templateId: 'khong-ton-tai', fieldValues: {}, notes: '' }, fakeLlm); }
  catch (e) { notFound = e instanceof ContractAIError; }
  ok('5. templateId không tồn tại → throw ContractAIError', notFound);

  await db.delete(contractTemplates).where(eq(contractTemplates.id, tplId));

  console.log(`\nTổng ${pass + fail} kiểm tra — đạt ${pass}, lỗi ${fail}.`);
  if (fail > 0) { console.log('❌ CÓ LỖI'); process.exit(1); }
  console.log('🎉 TẤT CẢ ĐẠT');
}

main().catch((e) => { console.error('❌ CRASH:', e); process.exit(1); });
