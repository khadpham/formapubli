import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { ContractEngineService } from '../src/services/contract-engine.service';

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

function buildDocx(paragraphsXml: string): string {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paragraphsXml
    + '</w:body></w:document>'
  );
  return zip.generate({ type: 'base64', compression: 'DEFLATE' });
}

function docText(base64: string): string {
  const zip = new PizZip(Buffer.from(base64, 'base64').toString('binary'));
  return zip.file('word/document.xml')!.asText();
}

function bytesToBase64(u8: Uint8Array): string {
  return Buffer.from(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer).toString('base64');
}

async function run() {
  console.log('--- TEST CONTRACT ENGINE: merge + validate (inspect-module) ---');

  // 1. Split-run: placeholder bị Word bẻ thành 2 run vẫn extract được.
  const split = buildDocx(
    '<w:p><w:r><w:t>{ten_</w:t></w:r><w:r><w:t>doi_tac}</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Số tiền: {so_tien}</w:t></w:r></w:p>'
  );
  const tags = ContractEngineService.extractPlaceholders(split);
  assert.ok(tags.includes('ten_doi_tac'), `split-run mất tag, thực: ${tags.join(',')}`);
  assert.ok(tags.includes('so_tien'), `thiếu tag so_tien, thực: ${tags.join(',')}`);
  console.log('✓ Split-run extract đủ placeholder');

  // 2. Ngoặc lởm: {so_tien chưa đóng → validate báo lỗi.
  const broken = buildDocx('<w:p><w:r><w:t>{so_tien chưa đóng ngoặc</w:t></w:r></w:p>');
  const bad = ContractEngineService.validateTemplate(broken);
  assert.equal(bad.isValid, false);
  assert.ok((bad.errors || []).length > 0, 'phải có chi tiết lỗi');
  console.log('✓ Ngoặc lởm bị validate bắt');

  // 3. Template đủ placeholder → hợp lệ, đếm đúng.
  const good = ContractEngineService.validateTemplate(split);
  assert.equal(good.isValid, true);
  assert.equal(good.placeholders.length, 2);
  console.log('✓ Validate khớp: isValid + đủ 2 placeholder');

  // 4. Merge: text thay thế, hết placeholder, zip không corrupt.
  const merged = ContractEngineService.generateDocx(split, { ten_doi_tac: 'Nguyễn Văn A', so_tien: '100000' });
  const xml = docText(bytesToBase64(merged));
  assert.ok(xml.includes('Nguyễn Văn A'), 'text thay thế không có trong document.xml');
  assert.ok(!xml.includes('{ten_doi_tac}'), 'placeholder chưa thay hết');
  assert.ok(!xml.includes('{so_tien}'), 'placeholder chưa thay hết');
  console.log('✓ Merge thay text, hết placeholder, zip nguyên vẹn');

  console.log('Test Contract Engine: PASS');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
