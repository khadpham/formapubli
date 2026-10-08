/**
 * Test Contract AI GĐ1 — mock LLM, KHÔNG gọi API thật.
 * Chạy: npx tsx scripts/test-contract-ai-gd1.ts
 */
import { draftTemplateFromDescription, structureGdocTemplate, fetchGdocText, finalizeAiTemplate, ContractAIError } from '../src/services/ai/contract-ai.service';
import { assertIsolatedTestDb } from './test-guard';
import { db, contractTemplates } from '../src/db';
import { eq } from 'drizzle-orm';
import { ContractEngineService } from '../src/services/contract-engine.service';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

async function main() {
  console.log('=== Contract AI GĐ1: soạn nháp từ mô tả ===');
  const fakeLlm = async () => JSON.stringify({
    title: 'HỢP ĐỒNG THUÊ ĐỊA ĐIỂM SỰ KIỆN',
    bodyText: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\n\nBên A: {ten_ben_a}\nBên B: {ten_ben_b}\nGiá thuê: {gia_thue} đồng.',
    suggestedPlaceholders: ['ten_ben_a', 'ten_ben_b', 'gia_thue'],
  });
  const draft = await draftTemplateFromDescription(
    { category: 'THUE_DIA_DIEM_SK', description: 'thuê địa điểm hội chợ sách 3 ngày' },
    fakeLlm,
  );
  ok('1. parse đúng title', draft.title.includes('THUÊ ĐỊA ĐIỂM'));
  ok('2. bodyText chứa placeholder', draft.bodyText.includes('{ten_ben_a}'));
  ok('3. mọi placeholder đều xuất hiện trong bodyText',
    draft.suggestedPlaceholders.every(p => draft.bodyText.includes(`{${p}}`)));

  const badLlm = async () => 'không phải json {{{';
  let threw = false;
  try { await draftTemplateFromDescription({ category: 'TAC_QUYEN', description: 'x' }, badLlm); }
  catch (e) { threw = e instanceof ContractAIError; }
  ok('4. LLM trả JSON hỏng → throw ContractAIError', threw);

  console.log('=== Contract AI GĐ1: nhập từ Google Docs ===');
  const fakeStructure = async () => JSON.stringify({
    title: 'HỢP ĐỒNG ĐẶT HÀNG',
    bodyText: 'Bên bán: {ten_ben_ban} giao hàng trị giá {gia_tri} đồng.',
    suggestedPlaceholders: [
      { placeholder: 'ten_ben_ban', originalText: 'Công ty ABC' },
      { placeholder: 'gia_tri', originalText: '100.000.000 đồng' },
    ],
  });
  const raw = 'Bên bán: Công ty ABC giao hàng trị giá 100.000.000 đồng.';
  const structured = await structureGdocTemplate(raw, fakeStructure);
  ok('5. giữ nguyên cấu trúc văn bản', structured.bodyText.includes('{ten_ben_ban}'));
  ok('6. originalText khớp chuỗi thật trong văn bản gốc',
    structured.suggestedPlaceholders.every(p => raw.includes(p.originalText)));

  let gdocThrew = false;
  try { await fetchGdocText('https://example.com/khong-phai-gdoc'); } catch (e) { gdocThrew = e instanceof ContractAIError; }
  ok('7. URL không phải Google Docs → throw ContractAIError', gdocThrew);

  console.log('=== Contract AI GĐ1: chốt mẫu → .docx → lưu DB ===');
  assertIsolatedTestDb('test-contract-ai-gd1');
  const code = `AI-TEST-${Date.now()}`;
  const tplId = await finalizeAiTemplate({
    code, title: 'Mẫu test AI', category: 'THUE_DIA_DIEM_SK',
    bodyText: 'Bên A: {ten_ben_a}\nGiá thuê: {gia_thue} đồng.',
    placeholders: ['ten_ben_a', 'gia_thue'],
  });
  const [row] = await db.select().from(contractTemplates).where(eq(contractTemplates.id, tplId));
  ok('8. lưu DB thành công', !!row);
  ok('9. cờ ai_generated=1, legal_reviewed=0', row.aiGenerated === true && row.legalReviewed === false);
  // merge thử bằng engine hiện tại — chứng minh .docx sinh ra dùng được
  let mergedOk = false;
  try {
    const out = ContractEngineService.generateDocx(row.templateData, { ten_ben_a: 'CTY X', gia_thue: '50 triệu' });
    mergedOk = out.length > 1000;
  } catch { mergedOk = false; }
  ok('10. .docx merge được bằng engine hiện tại', mergedOk);

  let dupThrew = false;
  try {
    await finalizeAiTemplate({ code, title: 'trùng', category: 'TAC_QUYEN', bodyText: 'x', placeholders: [] });
  } catch (e) { dupThrew = e instanceof ContractAIError; }
  ok('11. trùng code → throw ContractAIError', dupThrew);
  await db.delete(contractTemplates).where(eq(contractTemplates.id, tplId));

  console.log(`\nTổng ${pass + fail} kiểm tra — đạt ${pass}, lỗi ${fail}.`);
  if (fail > 0) { console.log('❌ CÓ LỖI'); process.exit(1); }
  console.log('🎉 TẤT CẢ ĐẠT');
}

main().catch(e => { console.error('❌ CRASH:', e); process.exit(1); });
