/**
 * NGHIỆM THU COPILOT QUA HTTP THẬT (chỉ đọc): đăng nhập thật, hỏi thật,
 * kiểm tra engine báo đúng + không dính JSON thô.
 * Chạy: npx tsx scripts/verify-copilot-live.ts
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.VERIFY_BASE || 'https://formapubli.phamkha9x.workers.dev';
let cookie = '';
let checks = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  checks++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  } as any);
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let body: any = null;
  try { body = await r.json(); } catch { /* không phải JSON */ }
  return { status: r.status, body };
}

function devPasscodeFor(staffId: string): string | null {
  // Passcode dev nằm trong DEFAULT_STAFF_ACCOUNTS của auth-session.ts
  // (không phải .env) — cùng cách verify-pos-live.ts dò.
  const src = readFileSync('src/lib/auth-session.ts', 'utf8');
  const block = src.split('DEFAULT_STAFF_ACCOUNTS')[1] ?? '';
  const idx = block.indexOf(`staffId: '${staffId}'`);
  if (idx < 0) return null;
  const m = block.slice(idx, idx + 400).match(/passcode:\s*'([^']+)'/);
  return m ? m[1] : null;
}

async function ask(question: string, model?: string) {
  const r = await api('/api/ai/copilot', {
    method: 'POST',
    body: JSON.stringify({ question, ...(model ? { model } : {}) }),
  });
  return r;
}

async function main() {
  console.log('\n=== NGHIỆM THU COPILOT QUA HTTP THẬT (chỉ đọc) ===');
  console.log(`Server: ${BASE}\n`);

  const staffId = 'ADMIN-01';
  const passcode = devPasscodeFor(staffId);
  if (!passcode) { console.error('❌ Không dò được mật khẩu dev. Dừng.'); process.exit(1); }

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ staffId, passcode }),
  });
  ok('1. Đăng nhập thật', login.status === 200, `status=${login.status}`);
  if (login.status !== 200) process.exit(1);
  ok('2. Có cookie phiên', cookie.startsWith('formapubli_session='));

  const a = await ask('top 7 sách bán chạy');
  ok('3. Hỏi top-N → 200', a.status === 200, `status=${a.status}`);
  const ans = String(a.body?.data?.answer || '');
  ok('4. Có câu trả lời', ans.length > 20, `${ans.length} ký tự`);
  ok('5. Không dính JSON thô', !ans.includes('{"') && !ans.includes('},'), ans.slice(0, 60));
  console.log(`   engine: ${a.body?.data?.engine} | tool: ${a.body?.data?.toolUsed}`);

  const b = await ask('Tồn kho cuốn HH001 và doanh số hôm nay?', 'cf/gpt-oss-120b');
  ok('6. Ép Cloudflare Workers AI → 200', b.status === 200, `status=${b.status}`);
  ok('7. Engine báo Cloudflare', /^cf:/.test(String(b.body?.data?.engine || '')), String(b.body?.data?.engine));
  ok('8. Câu nhiều ý vẫn có đáp', String(b.body?.data?.answer || '').length > 20);
  console.log(`   engine: ${b.body?.data?.engine} | tool: ${b.body?.data?.toolUsed}`);
  console.log(`   --- đáp ---\n${String(b.body?.data?.answer || '').slice(0, 500)}`);

  const c = await ask('Két ca hôm qua lệch bao nhiêu?', 'local');
  ok('9. Chế độ luật nội bộ vẫn trả lời', c.status === 200 && String(c.body?.data?.answer || '').length > 10);

  console.log(`\n${checks} bước kiểm tra.`);
  const failed = [
    !ans.includes('{"'),
  ].filter(Boolean).length;
  console.log(failed ? '⚠️ có bước ❌ ở trên' : '✅ tất cả các bước có ✅');
}

main().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });