/**
 * 5.1 — ĐO WER STT THẬT (Groq Whisper v3 vs turbo).
 *
 * - Không tham số: chỉ chạy unit test hàm tính WER (offline, không tốn quota).
 * - Đo thật: GROQ_API_KEY=... npx tsx scripts/measure-stt-wer.ts --audio <file> --ref <txt>
 *   So sánh 2 model: GROQ_STRICT... chạy 2 lần với GROQ_STT_MODEL=whisper-large-v3
 *   rồi whisper-large-v3-turbo, đối chiếu WER + thời gian.
 *
 * WER = (S + D + I) / N trên chuỗi từ đã chuẩn hóa (thường, không dấu? GIỮ dấu
 * vì tiếng Việt sai dấu là sai nghĩa — chỉ thường hóa + bỏ chấm câu).
 */
import fs from 'node:fs';
import { transcribeAudio } from '../src/services/ai/voice-order.service';

export function normalizeWords(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[.,!?;:()"“”‘’—–\-/\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function wer(reference: string, hypothesis: string): { wer: number; s: number; d: number; i: number; n: number } {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  const n = ref.length;
  const m = hyp.length;
  if (n === 0) return { wer: m === 0 ? 0 : 1, s: 0, d: 0, i: m, n: 0 };
  const dp: number[][] = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
  for (let j = 1; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
      );
    }
  }
  // Truy vết S/D/I.
  let i = n;
  let j = m;
  let s = 0;
  let d = 0;
  let ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      s++;
      i--;
      j--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      ins++;
      j--;
    } else {
      d++;
      i--;
    }
  }
  return { wer: Math.round(((s + d + ins) / n) * 1000) / 1000, s, d, i: ins, n };
}

async function run() {
  const args = process.argv.slice(2);
  const audioIdx = args.indexOf('--audio');
  const refIdx = args.indexOf('--ref');

  // Unit test offline — luôn chạy, không tốn quota.
  const cases: Array<[string, string, number]> = [
    ['lấy hai cuốn sách', 'lấy hai cuốn sách', 0],
    ['lấy hai cuốn sách', 'lấy hai cuốn vở', 0.25],
    ['a b c', '', 1],
    ['', '', 0],
  ];
  let passed = 0;
  for (const [ref, hyp, expected] of cases) {
    const r = wer(ref, hyp);
    const okPass = r.wer === expected;
    if (okPass) passed++;
    console.log(`${okPass ? '✅' : '❌'} WER("${ref}" vs "${hyp}") = ${r.wer} (kỳ vọng ${expected})`);
  }
  console.log(`WER unit: ${passed}/${cases.length}`);
  if (passed !== cases.length) process.exit(1);

  if (audioIdx < 0 || refIdx < 0) {
    console.log('\nMuốn đo thật: GROQ_API_KEY=... npx tsx scripts/measure-stt-wer.ts --audio <file> --ref <txt>');
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    console.error('❌ Thiếu GROQ_API_KEY — không đo thật được.');
    process.exit(1);
  }
  const audioPath = args[audioIdx + 1];
  const refPath = args[refIdx + 1];
  const buf = fs.readFileSync(audioPath);
  const ref = fs.readFileSync(refPath, 'utf8').trim();
  const model = process.env.GROQ_STT_MODEL || 'whisper-large-v3';
  const blob = new Blob([new Uint8Array(buf)], { type: 'audio/webm' });
  const t0 = Date.now();
  const stt = await transcribeAudio({ audio: blob, filename: audioPath.split(/[\\/]/).pop() });
  const ms = Date.now() - t0;
  const r = wer(ref, stt.text);
  console.log(`\nModel: ${stt.model} (env yêu cầu: ${model})`);
  console.log(`STT: "${stt.text}"`);
  console.log(`WER=${r.wer} (S=${r.s} D=${r.d} I=${r.i} N=${r.n}), thời gian=${ms}ms`);
}

run().catch((err) => {
  console.error('❌ measure-stt-wer thất bại:', err);
  process.exit(1);
});
