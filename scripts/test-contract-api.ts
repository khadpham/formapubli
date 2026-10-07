import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import PizZip from 'pizzip';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_contract_api.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

function buildTemplate(paragraphsXml: string): string {
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

function unzipTextFromResponseBytes(buf: ArrayBuffer): string {
  const zip = new PizZip(Buffer.from(buf).toString('binary'));
  return zip.file('word/document.xml')!.asText();
}

async function run() {
  console.log('--- TEST CONTRACT API: handler thật + session ký thật ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-contract-api');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { signSession, SESSION_COOKIE_NAME } = await import('../src/lib/auth-session');
  const { GET: tplList, POST: tplCreate } = await import('../src/app/api/contracts/templates/route');
  const { POST: preview } = await import('../src/app/api/contracts/preview/route');
  const { POST: docCreate } = await import('../src/app/api/contracts/documents/route');
  const { GET: exportDocx } = await import('../src/app/api/contracts/documents/[id]/export-docx/route');
  const { PUT: finalDocx } = await import('../src/app/api/contracts/documents/[id]/final-docx/route');
  const { GET: autofill } = await import('../src/app/api/contracts/autofill/route');
  const { GET: presetsGet, POST: presetsPost, PUT: presetsPut, DELETE: presetsDel } = await import('../src/app/api/contracts/presets/route');
  const { GET: profileGet, PUT: profilePut } = await import('../src/app/api/contracts/company-profile/route');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);
  await db.insert(schema.staffAccounts).values([{
    staffId: 'staff-api-owner', fullName: 'Chủ Test', role: 'ROLE_OWNER',
    passcodeHash: 'v2$test', salt: 'salt-test', sessionVersion: 1, isActive: true,
  }]);
  await db.insert(schema.partners).values([
    { id: 'part-api', code: 'DL_API', name: 'Đại lý API', type: 'WHOLESALE', discountRate: 0.3 },
  ]);
  const now = Date.now();
  const ownerToken = await signSession({
    role: 'ROLE_OWNER', actorId: 'staff-api-owner', issuedAt: now, expiresAt: now + 3600000,
  });
  const cookie = `${SESSION_COOKIE_NAME}=${ownerToken}`;
  const req = (url: string, init?: any) =>
    new Request(url, { ...(init || {}), headers: { ...(init?.headers || {}), Cookie: cookie } }) as any;

  // 1. Không cookie → 401/403 (D5: auth trên mọi route).
  const noAuth = await tplList(new Request('http://localhost/api/contracts/templates') as any);
  assert.ok([401, 403].includes(noAuth.status), `thiếu auth phải 401/403, thực ${noAuth.status}`);
  console.log('✓ Không session bị chặn 401/403');

  // 2. Tạo mẫu (validate + sinh schema_fields) + preview merge.
  const tplB64 = buildTemplate('<w:p><w:r><w:t>Bên B: {ben_b_ten}</w:t></w:r></w:p>');
  const tplRes: any = await tplCreate(req('http://localhost/api/contracts/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'HD_API', title: 'Mẫu API', templateFilename: 'mau.docx', templateData: tplB64 }),
  }));
  assert.equal(tplRes.status, 201);
  const tplJson = await tplRes.json();
  assert.ok(tplJson.success && tplJson.data.id, 'tạo mẫu phải trả id');
  const fields = JSON.parse(tplJson.data.schemaFields);
  assert.ok(fields.some((f: any) => f.key === 'ben_b_ten'), 'schema_fields phải sinh từ placeholder');
  // Template ngoặc lởm bị từ chối.
  const badTpl = buildTemplate('<w:p><w:r><w:t>{ben_b_ten chưa đóng</w:t></w:r></w:p>');
  const badRes: any = await tplCreate(req('http://localhost/api/contracts/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'HD_BAD', title: 'Mẫu lởm', templateFilename: 'x.docx', templateData: badTpl }),
  }));
  assert.equal(badRes.status, 400);
  console.log('✓ Tạo mẫu validate + sinh schema_fields; mẫu lởm 400');

  const pvRes: any = await preview(req('http://localhost/api/contracts/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: tplJson.data.id, data: { ben_b_ten: 'Đại lý API' } }),
  }));
  assert.equal(pvRes.status, 200);
  const pvBuf = await pvRes.arrayBuffer();
  assert.ok(unzipTextFromResponseBytes(pvBuf).includes('Đại lý API'), 'preview phải merge text');
  console.log('✓ Preview merge trả bytes docx đúng');

  // 3. Soạn HĐ → số đúng format → export → tải được.
  const docRes: any = await docCreate(req('http://localhost/api/contracts/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: tplJson.data.id, title: 'HĐ API 1', category: 'TAC_QUYEN',
      payloadData: { ben_b_ten: 'Đại lý API' }, partnerId: 'part-api',
      signedDate: '2026-10-08', totalAmount: 5000000,
    }),
  }));
  assert.equal(docRes.status, 201);
  const docJson = await docRes.json();
  assert.match(docJson.data.contractNumber, /^\d{2}\/2026\/HĐXB-FORMA$/, 'số HĐ sai format');
  const expRes: any = await exportDocx(
    req(`http://localhost/api/contracts/documents/${docJson.data.id}/export-docx`) as any,
    { params: Promise.resolve({ id: docJson.data.id }) } as any
  );
  assert.equal(expRes.status, 200);
  assert.ok(unzipTextFromResponseBytes(await expRes.arrayBuffer()).includes('Đại lý API'));
  console.log('✓ Soạn HĐ cấp số đúng format, export tải được file merge');

  // 4. Upload bản cuối → export sau đó trả BẢN CUỐI.
  const finalB64 = buildTemplate('<w:p><w:r><w:t>NỘI DUNG CUỐI ĐÃ SỬA NGOÀI WORD</w:t></w:r></w:p>');
  const finRes: any = await finalDocx(
    req(`http://localhost/api/contracts/documents/${docJson.data.id}/final-docx`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: finalB64, filename: 'cuoi.docx' }),
    }) as any,
    { params: Promise.resolve({ id: docJson.data.id }) } as any
  );
  assert.equal(finRes.status, 200);
  const expRes2: any = await exportDocx(
    req(`http://localhost/api/contracts/documents/${docJson.data.id}/export-docx`) as any,
    { params: Promise.resolve({ id: docJson.data.id }) } as any
  );
  assert.ok(unzipTextFromResponseBytes(await expRes2.arrayBuffer()).includes('NỘI DUNG CUỐI ĐÃ SỬA NGOÀI WORD'));
  console.log('✓ Upload bản cuối thắng khi export (D9)');

  // 5. Company profile đổi tên → autofill trả tên mới.
  const profPut: any = await profilePut(req('http://localhost/api/contracts/company-profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenCongTy: 'Công ty API Mới' }),
  }));
  assert.equal(profPut.status, 200);
  const afRes: any = await autofill(req('http://localhost/api/contracts/autofill?partnerId=part-api') as any);
  const afJson = await afRes.json();
  assert.equal(afJson.data.ben_a_ten, 'Công ty API Mới');
  assert.equal(afJson.data.ben_b_ten, 'Đại lý API');
  console.log('✓ Company profile sửa được, autofill theo tên mới');

  // 6. Preset CRUD.
  const pList0: any = await presetsGet(req('http://localhost/api/contracts/presets') as any);
  const p0 = await pList0.json();
  const n0 = p0.data.all.length;
  assert.ok(p0.data.all.some((p: any) => p.label === 'Giám đốc — Phạm Đam Ca'), 'thiếu preset seed');
  const pCreate: any = await presetsPost(req('http://localhost/api/contracts/presets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Preset API Test', valuesJson: JSON.stringify({ ben_a_dai_dien: 'X' }), sortOrder: 9 }),
  }));
  assert.equal(pCreate.status, 201);
  const created = await pCreate.json();
  const pPut: any = await presetsPut(req('http://localhost/api/contracts/presets', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: created.data.id, label: 'Preset API Đổi Tên' }),
  }));
  assert.equal((await pPut.json()).data.label, 'Preset API Đổi Tên');
  const pDel: any = await presetsDel(req(`http://localhost/api/contracts/presets?id=${created.data.id}`, { method: 'DELETE' }) as any);
  assert.equal(pDel.status, 200);
  const pList1: any = await presetsGet(req('http://localhost/api/contracts/presets') as any);
  assert.equal((await pList1.json()).data.all.length, n0);
  console.log('✓ Preset CRUD đủ vòng (D11)');

  console.log('Test Contract API: PASS');
}

run().catch((e) => { console.error('❌ FAIL:', e.message); process.exit(1); });
