import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\ceb23bea-db7c-4257-801e-e11bfb62fe7e';
const reportDir = path.join(process.cwd(), 'reports', 'wave3-pos-ui');
const tempDir = process.env.TEMP || 'C:\\Users\\PC\\AppData\\Local\\Temp';
const bundlePath = path.join(tempDir, 'pos-terminal-test-bundle.js');
const htmlPath = path.join(tempDir, 'pos-terminal-test.html');

if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

console.log('1. Bundling REAL PosCheckoutTerminal component test with esbuild...');
const esbuildCmd = `npx esbuild scripts/browser-pos-terminal-test.tsx --bundle --platform=browser --outfile="${bundlePath}" --define:process.env.NODE_ENV='"test"'`;
execSync(esbuildCmd, { stdio: 'inherit' });
console.log('✓ Bundle generated:', bundlePath);

console.log('2. Preparing HTML test harness with Tailwind CSS...');
const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Real PosCheckoutTerminal Component Test</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-slate-100 p-2 sm:p-4 text-slate-800 antialiased min-h-screen">
  <div id="root"></div>
  <div id="test-logs" style="font-family: monospace; white-space: pre-wrap; display: none;"></div>
  <script src="file:///${bundlePath.replace(/\\/g, '/')}"></script>
</body>
</html>`;
fs.writeFileSync(htmlPath, htmlContent, 'utf8');

console.log('3. Running automated tests on REAL PosCheckoutTerminal inside Chrome Headless...');
const testCmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --window-size=375,640 --virtual-time-budget=6000 --dump-dom "file:///${htmlPath.replace(/\\/g, '/')}?mode=test"`;
const domOutput = execSync(testCmd, { encoding: 'utf8' });

console.log('\n--- Chrome Headless Test Execution Logs ---');
const logMatches = domOutput.match(/<div class="test-log">([^<]+)<\/div>/g);
if (logMatches) {
  for (const m of logMatches) {
    const text = m.replace(/<div class="test-log">/, '').replace(/<\/div>/, '');
    console.log(text);
  }
}

if (!domOutput.includes('ALL REAL POS COMPONENT TESTS PASSED (6/6)')) {
  console.error('\n❌ REAL COMPONENT TEST SUITE FAILED OR TIMED OUT');
  fs.writeFileSync(path.join(tempDir, 'pos-test-output-debug.html'), domOutput, 'utf8');
  console.log('Debug output saved to:', path.join(tempDir, 'pos-test-output-debug.html'));
  process.exit(1);
}

console.log('\n======================================================');
console.log('>>> VERIFICATION PASSED: REAL COMPONENT TESTS 6/6 PASS! <<<');
console.log('======================================================\n');

console.log('4. Capturing REAL component screenshots from Google Chrome Headless...');
const viewports = [
  { name: 'pos-mobile-320px', width: 320, height: 600, role: 'ROLE_CASHIER' },
  { name: 'pos-mobile-375px', width: 375, height: 640, role: 'ROLE_CASHIER' },
  { name: 'pos-mobile-390px', width: 390, height: 660, role: 'ROLE_CASHIER' },
  { name: 'pos-manager-topbar', width: 1024, height: 500, role: 'ROLE_MANAGER' },
  { name: 'pos-cashier-topbar', width: 1024, height: 500, role: 'ROLE_CASHIER' }
];

for (const vp of viewports) {
  const artifactOutput = path.join(artifactDir, `${vp.name}.png`);
  const reportOutput = path.join(reportDir, `${vp.name}.png`);
  const shotCmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --window-size=${vp.width},${vp.height} --virtual-time-budget=2000 --screenshot="${artifactOutput}" "file:///${htmlPath.replace(/\\/g, '/')}?mode=view&role=${vp.role}"`;
  execSync(shotCmd, { stdio: 'pipe' });

  fs.copyFileSync(artifactOutput, reportOutput);
  console.log(`✓ Real Component Screenshot: ${vp.name}.png (${vp.width}x${vp.height}) [${vp.role}]`);
}

console.log('\nAll REAL component screenshots and tests successfully verified!');
