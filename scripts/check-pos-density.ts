import { readFileSync } from 'node:fs';
const css = readFileSync('src/app/globals.css', 'utf8');
const checks = ['.density-compact', '.fit-bar'];
let fail = 0;
for (const c of checks) {
  const ok = css.includes(c);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
