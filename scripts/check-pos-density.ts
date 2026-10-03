import { readFileSync } from 'node:fs';
const css = readFileSync('src/app/globals.css', 'utf8');
// fit-bar phải có + phải có lối thoát màn rất hẹp (giấu icon <=300px).
const mustHave = ['.fit-bar', 'max-width: 300px'];
// density-compact không ai dùng (grep 0 hit) — cấm tồn tại (YAGNI).
const mustNotHave = ['.density-compact'];
let fail = 0;
for (const c of mustHave) {
  const ok = css.includes(c);
  console.log(`${ok ? 'PASS' : 'FAIL'} has ${c}`);
  if (!ok) fail++;
}
for (const c of mustNotHave) {
  const ok = !css.includes(c);
  console.log(`${ok ? 'PASS' : 'FAIL'} no ${c}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
