/**
 * Test Contract AI GĐ2 — mock LLM, KHÔNG gọi API thật.
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-contract-ai-gd2
 */
import { DEFAULT_CHECKLISTS, getChecklist } from '../src/services/ai/contract-checklists';
import { extractDocxText, analyzeContract, reviewContract, ContractAIError } from '../src/services/ai/contract-ai.service';
import { Document, Packer, Paragraph, TextRun } from 'docx';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

async function main() {
  console.log('=== Contract AI GĐ2: checklist mặc định ===');
  for (const cat of ['THUE_DIA_DIEM_SK', 'DAT_HANG_HOA_SK', 'TAC_QUYEN']) {
    const cl = DEFAULT_CHECKLISTS[cat];
    ok(`${cat} có ≥5 items`, cl && cl.items.length >= 5);
    ok(`${cat} items đủ trường`, cl.items.every((i) => i.id && i.label && i.hint && ['THIEU', 'MO_HO', 'RUI_RO'].includes(i.severity)));
  }
  const fallback = getChecklist('KHAC');
  ok('category lạ → fallback không rỗng', fallback.length > 0);

  console.log('=== Contract AI GĐ2: trích text .docx ===');
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Bên A: Công ty X')] })] }] });
  const b64 = (await Packer.toBuffer(doc)).toString('base64');
  ok('trích được text từ docx', extractDocxText(b64).includes('Công ty X'));
  let docxThrew = false;
  try { extractDocxText('khong-phai-base64!!!'); } catch (e) { docxThrew = e instanceof ContractAIError; }
  ok('base64 rác → throw ContractAIError', docxThrew);

  console.log('=== Contract AI GĐ2: AI tóm tắt ===');
  const fakeAnalyze = async () => JSON.stringify({
    contractType: 'Hợp đồng thuê địa điểm',
    parties: ['Công ty X', 'Công ty Y'],
    valueText: '150.000.000 đồng',
    keyDates: ['01/12/2026'],
    obligations: ['Bên A bàn giao mặt bằng đúng hạn'],
    summary: 'Hợp đồng thuê địa điểm tổ chức sự kiện.',
  });
  const analysis = await analyzeContract('Bên A: Công ty X...', fakeAnalyze);
  ok('parse đúng parties', analysis.parties.includes('Công ty X'));
  ok('parse đúng valueText', analysis.valueText === '150.000.000 đồng');

  console.log('=== Contract AI GĐ2: AI phản biện ===');
  const fakeReview = async () => JSON.stringify({
    issues: [
      { checklistId: 'dat-coc', level: 'THIEU', finding: 'Không thấy điều khoản đặt cọc', suggestion: 'Bổ sung: Bên B đặt cọc 30% khi ký.' },
      { checklistId: 'phat-huy', level: 'DAT', finding: 'Đã có điều khoản phạt hủy rõ ràng', suggestion: '' },
    ],
  });
  const review = await reviewContract('nội dung...', 'THUE_DIA_DIEM_SK', fakeReview);
  ok('parse đủ issues', review.issues.length === 2);
  ok('issue đủ 4 trường, level hợp lệ',
    review.issues.every((i) => i.checklistId && ['THIEU', 'MO_HO', 'RUI_RO', 'DAT'].includes(i.level) && i.finding !== undefined && i.suggestion !== undefined));
  let emptyThrew = false;
  try { await reviewContract('   ', 'TAC_QUYEN', fakeReview); } catch (e) { emptyThrew = e instanceof ContractAIError; }
  ok('text rỗng → throw ContractAIError', emptyThrew);

  console.log(`\nTổng ${pass + fail} kiểm tra — đạt ${pass}, lỗi ${fail}.`);
  if (fail > 0) { console.log('❌ CÓ LỖI'); process.exit(1); }
  console.log('🎉 TẤT CẢ ĐẠT');
}

main().catch((e) => { console.error('❌ CRASH:', e); process.exit(1); });
