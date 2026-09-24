import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const tempDir = process.env.TEMP || 'C:\\Users\\PC\\AppData\\Local\\Temp';
const bundlePath = path.join(tempDir, 'component-test-bundle.js');
const htmlPath = path.join(tempDir, 'component-test.html');

console.log('1. Bundling REAL BatchTransferModal component test with esbuild...');
const esbuildCmd = `npx esbuild scripts/browser-component-test.tsx --bundle --platform=browser --outfile="${bundlePath}" --define:process.env.NODE_ENV='"test"'`;
execSync(esbuildCmd, { stdio: 'inherit' });
console.log('✓ Bundle generated:', bundlePath);

console.log('2. Preparing HTML test harness...');
const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BatchTransferModal Component Test</title>
</head>
<body>
  <div id="root"></div>
  <div id="test-logs" style="font-family: monospace; white-space: pre-wrap;"></div>
  <script src="file:///${bundlePath.replace(/\\/g, '/')}"></script>
</body>
</html>`;
fs.writeFileSync(htmlPath, htmlContent, 'utf8');

console.log('3. Running tests inside REAL Google Chrome Headless browser...');
// Allow Chrome up to 5 seconds to run the async test suite
const runChrome = () => {
  const chromeCmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --virtual-time-budget=5000 --dump-dom "file:///${htmlPath.replace(/\\/g, '/')}"`;
  const output = execSync(chromeCmd, { encoding: 'utf8' });
  return output;
};

const domOutput = runChrome();

console.log('\n--- Chrome Headless Test Execution Logs ---');
const logMatches = domOutput.match(/<div class="test-log">([^<]+)<\/div>/g);
if (logMatches) {
  for (const m of logMatches) {
    const text = m.replace(/<div class="test-log">/, '').replace(/<\/div>/, '');
    console.log(text);
  }
}

fs.writeFileSync(path.join(tempDir, 'test-output-debug.html'), domOutput, 'utf8');

if (domOutput.includes('ALL REAL COMPONENT TESTS PASSED (3/3)')) {
  console.log('\n======================================================');
  console.log('>>> VERIFICATION PASSED: REAL COMPONENT TESTS 3/3 PASS! <<<');
  console.log('======================================================\n');
  process.exit(0);
} else {
  console.error('\n❌ TEST SUITE FAILED OR TIMED OUT');
  console.log('See: ' + path.join(tempDir, 'test-output-debug.html'));
  process.exit(1);
}
