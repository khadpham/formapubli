import fs from 'node:fs';
import { createClient } from '@libsql/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

/** CHỈ ĐỌC. Royalty thật sự có dùng không. */
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (s: string) => (await db.execute(s)).rows as any[];

  for (const t of ['rights_contracts', 'consignments', 'partners']) {
    try {
      const r = await q(`SELECT COUNT(*) n FROM \`${t}\``);
      console.log(`  ${t} = ${r[0].n}`);
    } catch {
      console.log(`  ${t} = KHÔNG TỒN TẠI`);
    }
  }

  const au = await q(
    `SELECT action, COUNT(*) n FROM audit_logs
     WHERE action LIKE '%ROYAL%' OR action LIKE '%CONSIGN%' GROUP BY action`
  );
  console.log(`\n  audit log royalty/consignment: ${au.length ? JSON.stringify(au) : '(KHÔNG có hoạt động nào)'}`);

  const allAu = await q(
    `SELECT action, COUNT(*) n FROM audit_logs GROUP BY action ORDER BY n DESC LIMIT 8`
  );
  console.log('\n  8 hoạt động audit phổ biến nhất:');
  for (const a of allAu) console.log(`    ${a.action}: ${a.n}`);

  process.exit(0);
}
main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });