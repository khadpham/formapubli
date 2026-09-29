/**
 * HỢP ĐỒNG POS (3 lỗi đã kiểm chứng trên mã nguồn):
 *
 *  1. Nguồn tài khoản ngân hàng: chỉ fallback sang cache 24h khi THẬT SỰ không
 *     tải được. Server trả lời "không còn tài khoản nào dùng được" là quyết định
 *     thật (mọi TK đã bị ngưng) — dùng cache lúc đó là mã hoá tài khoản chết
 *     vào mã QR.
 *  2. Nội dung chuyển khoản đóng băng vào đơn phải là CHÍNH chuỗi đã mã hoá
 *     vào QR (đã bỏ dấu, đã cắt còn 23 ký tự), không phải bản gõ tay thô.
 *  3. Nút "Tải ảnh xuống" phải tải file thật, không mở share sheet.
 *
 * Cách kiểm: phần [1] và [2] chạy HÀM THẬT (hàm quyết định thuần + giải mã TLV
 * ngay từ chuỗi payload), phần [3] rút handler thật ra khỏi .tsx bằng compiler
 * API rồi CHẠY THẬT trong `vm` với navigator/URL/document giả — không assert
 * trên chuỗi nguồn. Chỉ vài assertion cấu trúc mới đọc AST, và luôn kiểm cả
 * mã thực thi lẫn tên hàm, không để regex tự khớp vào comment.
 *
 * Chạy: npx tsx scripts/test-pos-bank-qr-gallery.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { decideBankAccounts } from '../src/components/pos/VietQrPay';
import { generateVietQRPayload, normalizeVietqrContent, VIETQR_CONTENT_MAX } from '../src/lib/vietqr';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (cond: unknown, msg: string, why = '') => {
  if (cond) {
    pass++;
    console.log(`  ok  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}${why ? ` — ${why}` : ''}`);
  }
};

const readSource = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
const parse = (relative: string) =>
  ts.createSourceFile(relative, readSource(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Đi hết các nút của cây, gọi `visit` cho từng nút. */
function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

// ===========================================================================
// [1] NGUỒN TÀI KHOẢN — fetch hỏng KHÁC fetch thành công và rỗng
// ===========================================================================
console.log('\n[#1] Chỉ fallback cache khi thật sự hỏng; danh sách rỗng thì chặn QR');

const account = (id: string) => ({
  id,
  label: `VietinBank — ${id}`,
  bankBin: '970436',
  accountNo: `10${id}`,
  accountName: 'Công ty TNHH Sách Tri Thức',
});
const dead = account('ba-cu');
const live = [account('ba-1'), account('ba-2')];

// --- 1.1. Mất mạng / HTTP lỗi ⇒ ĐƯỢC dùng cache (đúng hợp đồng cũ) ---------
const offline = decideBankAccounts({
  fetchOk: false,
  networkAccounts: null,
  cachedAccounts: [dead],
  cachedDefaultId: dead.id,
  cachedAt: 1_700_000_000_000,
});
ok(offline.source === 'CACHE', 'fetch hỏng + cache còn hạn ⇒ dùng CACHE', offline.source);
ok(offline.accounts[0]?.id === dead.id, 'CACHE phải lấy đúng tài khoản trong cache');
ok(offline.cachedAt === 1_700_000_000_000, 'CACHE phải mang theo mốc thời gian để hiện nhãn');
ok(offline.serverSaysEmpty === false, 'CACHE không phải trường hợp "server bảo không có TK"');

const offlineNoCache = decideBankAccounts({
  fetchOk: false,
  networkAccounts: null,
  cachedAccounts: null,
  cachedDefaultId: null,
  cachedAt: null,
});
ok(offlineNoCache.source === 'NONE', 'fetch hỏng + không cache ⇒ NONE (chặn QR)');
ok(offlineNoCache.accounts.length === 0, 'NONE không mang tài khoản nào để mã hoá');
ok(offlineNoCache.serverSaysEmpty === false, 'Mất mạng KHÔNG phải "server nói không có tài khoản"');

const offlineCacheNoDefault = decideBankAccounts({
  fetchOk: false,
  networkAccounts: null,
  cachedAccounts: [dead, live[1]],
  cachedDefaultId: null,
  cachedAt: 42,
});
ok(
  offlineCacheNoDefault.defaultId === dead.id,
  'fetch hỏng + cache không có mặc định ⇒ chọn tài khoản đầu, không để trống',
  offlineCacheNoDefault.defaultId
);

// --- 1.2. LỖI CỐT LÕI: server trả lời RỖNG thì KHÔNG được rơi về cache ------
const emptyFromServer = decideBankAccounts({
  fetchOk: true,
  networkAccounts: [],
  networkDefaultId: null,
  cachedAccounts: [dead],
  cachedDefaultId: dead.id,
  cachedAt: 1_700_000_000_000,
});
ok(
  emptyFromServer.source === 'NONE',
  'fetch THÀNH CÔNG + danh sách rỗng ⇒ KHÔNG fallback cache (phải chặn QR)',
  `nguồn thực tế: ${emptyFromServer.source}`
);
ok(
  emptyFromServer.accounts.length === 0,
  'danh sách rỗng không được lấy tài khoản từ cache — tài khoản đã bị ngưng',
  `mang đi: ${JSON.stringify(emptyFromServer.accounts.map((a) => a.id))}`
);
ok(
  emptyFromServer.defaultId === '',
  'danh sách rỗng không được chọn sẵn tài khoản nào',
  emptyFromServer.defaultId
);
ok(emptyFromServer.serverSaysEmpty === true, 'phải phát tín hiệu "server nói không còn tài khoản"');
ok(
  emptyFromServer.cachedAt === null,
  'danh sách rỗng không được gắn nhãn "dữ liệu cache" (đang nói dối nguồn dữ liệu)'
);

const emptyNoCache = decideBankAccounts({
  fetchOk: true,
  networkAccounts: [],
  networkDefaultId: null,
  cachedAccounts: null,
  cachedDefaultId: null,
  cachedAt: null,
});
ok(emptyNoCache.source === 'NONE' && emptyNoCache.serverSaysEmpty === true,
  'fetch thành công + rỗng + không cache ⇒ vẫn NONE, vẫn báo "không còn tài khoản"');

// --- 1.3. Có dữ liệu thật ⇒ NETWORK, cache được làm mới ---------------------
const network = decideBankAccounts({
  fetchOk: true,
  networkAccounts: live,
  networkDefaultId: live[1].id,
  cachedAccounts: [dead],
  cachedDefaultId: dead.id,
  cachedAt: 1_700_000_000_000,
});
ok(network.source === 'NETWORK', 'fetch thành công + có tài khoản ⇒ NETWORK');
ok(network.defaultId === live[1].id, 'NETWORK chọn tài khoản mặc định do server chỉ định');
ok(network.accounts.length === 2, 'NETWORK mang đủ danh sách');
ok(network.cachedAt === null, 'NETWORK không gắn nhãn cache');
ok(network.serverSaysEmpty === false, 'NETWORK không phải trường hợp rỗng');

const networkNoDefault = decideBankAccounts({
  fetchOk: true,
  networkAccounts: live,
  networkDefaultId: null,
  cachedAccounts: null,
  cachedDefaultId: null,
  cachedAt: null,
});
ok(
  networkNoDefault.defaultId === live[0].id,
  'server không chỉ định mặc định ⇒ lấy tài khoản đầu, không để trống',
  networkNoDefault.defaultId
);

// Bất biến nền: cache CHỈ được ghi ở nhánh có dữ liệu. Nếu vô tình ghi cache
// rỗng thì "cache rỗng" và "chưa từng có tài khoản" thành một — hợp đồng ở trên
// mất hết ý nghĩa. Chốt bằng AST trên chính file component.
const vietAst = parse('src/components/pos/VietQrPay.tsx');
let writeCacheGuard = '';
walk(vietAst, (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(vietAst) === 'writeBankAccountsCache') {
    // Leo qua mọi khối lồng nhau để tới ĐIỀU KIỆN bao quanh, không dừng ở block.
    let p: ts.Node | undefined = node;
    while (p && !ts.isIfStatement(p) && !ts.isConditionalExpression(p)) p = p.parent;
    writeCacheGuard = p && ts.isIfStatement(p) ? p.expression.getText(vietAst) : '';
  }
});
ok(writeCacheGuard !== '', 'writeBankAccountsCache phải nằm trong một nhánh có điều kiện');
ok(
  /length\s*>\s*0/.test(writeCacheGuard),
  'chỉ ghi cache khi danh sách KHÔNG rỗng — cache luôn là tài khoản từng hoạt động',
  writeCacheGuard || '(không tìm thấy điều kiện bao quanh)'
);

// onSource vẫn phải là 3 giá trị cũ: POS khai báo đúng 3 giá trị đó, đổi union
// ở đây sẽ làm hỏng kiểu của cha.
ok(
  /export type BankAccountSource = 'NETWORK' \| 'CACHE' \| 'NONE';/.test(readSource('src/components/pos/VietQrPay.tsx')),
  'union BankAccountSource phải giữ nguyên 3 giá trị (POS khai báo cứng)'
);

// fetch phải kiểm tra r.ok: nếu không, HTTP 500 trả body JSON lỗi sẽ bị đọc
// thành "danh sách rỗng" và ta chặn QR cả khi chỉ là sự cố tạm thời.
let checksResponseStatus = false;
walk(vietAst, (node) => {
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'ok' &&
    node.parent &&
    ts.isConditionalExpression(node.parent)
  ) {
    checksResponseStatus = true;
  }
});
ok(checksResponseStatus, 'phải kiểm tra res.ok — HTTP lỗi là "tải hỏng", không phải "danh sách rỗng"');

// Nhãn cho thu ngân: hai trường hợp NONE phải nói khác nhau, có dấu, ngắn.
const vietSource = readSource('src/components/pos/VietQrPay.tsx');
ok(
  /serverSaysEmpty/.test(vietSource) && /Quản Lý Kho/.test(vietSource),
  'trường hợp server báo rỗng phải có lời nhắc riêng cho thu ngân'
);

// ===========================================================================
// [2] NỘI DUNG ĐÓNG BĂNG = ĐÚNG CHUỖI ĐÃ MÃ HOÁ
// ===========================================================================
console.log('\n[#2] Đơn phải đóng băng đúng chuỗi ngân hàng ghi nhận');

// Đọc ngược TLV thật trong payload để lấy đúng add_info (tag 62.08) mà ngân
// hàng sẽ ghi vào sao kê — không tin lời mô tả trong comment.
function tlvAt(s: string, pos: number) {
  const id = s.slice(pos, pos + 2);
  const len = Number(s.slice(pos + 2, pos + 4));
  return { id, value: s.slice(pos + 4, pos + 4 + len), next: pos + 4 + len };
}
function addInfoOf(payload: string): string {
  let p = tlvAt(payload, 0).next; // 00
  p = tlvAt(payload, p).next; // 01
  p = tlvAt(payload, p).next; // 38
  // 53 (currency) và 54 (amount) là tuỳ chọn — đi tới hết tầng ngoài cho tới 62.
  for (let guard = 0; guard < 8; guard++) {
    const field = tlvAt(payload, p);
    // 62 chứa TLV lồng bên trong: add_info nằm ở offset 0 của CHÍNH value 62.
    if (field.id === '62') return tlvAt(field.value, 0).value;
    p = field.next;
  }
  throw new Error('không tìm thấy tag 62 trong payload');
}

const RAW = 'Chuyển khoản đơn hàng của khách lẻ 0912345678'; // 41 ký tự, có dấu
const encoded = addInfoOf(
  generateVietQRPayload({ bankBin: '970436', accountNo: '3180281056609', amount: 150000, content: RAW })
);
ok(encoded === normalizeVietqrContent(RAW), 'tag 62.08 trong payload CHÍNH LÀ chuỗi đã chuẩn hoá', encoded);
ok(encoded.length === VIETQR_CONTENT_MAX, `sao kê chỉ ghi ${VIETQR_CONTENT_MAX} ký tự`, String(encoded.length));
ok(
  RAW !== encoded && RAW.length > VIETQR_CONTENT_MAX,
  'bản thô DÀI HƠN chuỗi ngân hàng ghi ⇒ đóng băng `content` thô là đóng băng sai chuỗi',
  `thô ${RAW.length} ký tự / ngân hàng ${encoded.length}`
);
// Chuẩn hoá là idempotent: đưa chuỗi đã chuẩn hoá vào payload không đổi byte,
// nên đóng băng chuỗi đã chuẩn hoá không phá mã QR cũ.
ok(
  generateVietQRPayload({ bankBin: '970436', accountNo: '3180281056609', amount: 150000, content: RAW }) ===
    generateVietQRPayload({ bankBin: '970436', accountNo: '3180281056609', amount: 150000, content: encoded }),
  'payload không đổi khi dùng chuỗi đã chuẩn hoá (chuẩn hoá idempotent)'
);

// Ràng buộc tới đúng dòng đóng băng trong component.
let qrContentInit = '';
let payloadContent = '';
let snapshotContent = '';
walk(vietAst, (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(vietAst) === 'qrContent') {
    qrContentInit = node.initializer?.getText(vietAst) ?? '';
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(vietAst) === 'generateVietQRPayload' &&
    ts.isObjectLiteralExpression(node.arguments[0])
  ) {
    for (const prop of node.arguments[0].properties) {
      if (ts.isPropertyAssignment(prop) && prop.name.getText(vietAst) === 'content') {
        payloadContent = prop.initializer.getText(vietAst);
      }
    }
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(vietAst) === 'onQrRef.current' &&
    node.arguments[0] &&
    ts.isObjectLiteralExpression(node.arguments[0])
  ) {
    for (const prop of node.arguments[0].properties) {
      if (ts.isPropertyAssignment(prop) && prop.name.getText(vietAst) === 'content') {
        snapshotContent = prop.initializer.getText(vietAst);
      }
    }
  }
});
ok(qrContentInit === `normalizeVietqrContent(content)`, 'phải có biến qrContent = normalizeVietqrContent(content)', qrContentInit);
ok(payloadContent === 'qrContent', 'payload phải mã hoá đúng biến qrContent', payloadContent);
ok(
  snapshotContent === 'qrContent',
  'onQr phải đóng băng qrContent — đóng băng `content` thô là lệch với sao kê ngân hàng',
  snapshotContent
);

// ===========================================================================
// [3] NÚT "TẢI ẢNH XUỐNG" PHẢI TẢI THẬT
// ===========================================================================
console.log('\n[#3] Nút tải ảnh phải tải file, không mở share sheet');

const galleryAst = parse('src/components/pos/PaymentPhotoGallery.tsx');

/** Rút biểu thức hàm được gán cho một `const` trong component. */
function fnTextOf(name: string): string {
  let text = '';
  walk(galleryAst, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(galleryAst) === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      text = node.initializer.getText(galleryAst);
    }
  });
  return text;
}

/** Rút `onClick` của nút theo aria-label. */
function onClickOf(ariaLabel: string): string {
  let text = '';
  walk(galleryAst, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const aria = node.attributes.properties.find(
      (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(galleryAst) === 'aria-label'
    );
    // Gán vào biến cục bộ: thu hẹp kiểu trên `aria.initializer` không giữ được
    // sau `||` (TS đọc lại property mỗi lần).
    const ariaValue = aria?.initializer;
    if (!ariaValue || !ts.isStringLiteral(ariaValue) || ariaValue.text !== ariaLabel) return;
    const click = node.attributes.properties.find(
      (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(galleryAst) === 'onClick'
    );
    // onClick là JSX expression container — lấy biểu thức bên trong, không lấy
    // cả `{ ... }` (nếu không `const handler = (() => {})` sẽ không gọi được).
    if (click?.initializer && ts.isJsxExpression(click.initializer) && click.initializer.expression) {
      text = click.initializer.expression.getText(galleryAst);
    }
  });
  return text;
}

const downloadPhotoText = fnTextOf('downloadPhoto');
const sharePhotoText = fnTextOf('sharePhoto');
const fileNameText = fnTextOf('fileNameOf');
ok(downloadPhotoText !== '', 'Gallery phải có hàm tải ảnh RIÊNG (downloadPhoto)');
ok(sharePhotoText !== '', 'Gallery phải còn hàm sharePhoto');
ok(fileNameText !== '', 'Gallery phải có hàm đặt tên file dùng chung (fileNameOf)');
ok(
  !/navigator\s*\.\s*share/.test(downloadPhotoText),
  'downloadPhoto KHÔNG được chạm navigator.share — nếu không thì lại mở share sheet'
);
ok(/anchor\.download\s*=/.test(downloadPhotoText), 'downloadPhoto phải tải file bằng thuộc tính download');
ok(
  /setTimeout\([\s\S]*revokeObjectURL/.test(downloadPhotoText),
  'phải trì hoãn thu hồi object URL — thu hồi ngay sau click() sẽ huỷ download'
);
ok(
  /canShare/.test(sharePhotoText) && /navigator\s*\.\s*share/.test(sharePhotoText),
  'sharePhoto mới được rẽ vào Web Share'
);
ok(
  /downloadPhoto\(photo\)/.test(sharePhotoText),
  'sharePhoto phải gọi downloadPhoto làm nhánh dự phòng khi không có Web Share'
);

const downloadOnClick = onClickOf('Tải ảnh xuống');
const shareOnClick = onClickOf('Chia sẻ ảnh');
ok(downloadOnClick !== '' && shareOnClick !== '', 'phải tìm thấy cả hai nút (theo aria-label)');
ok(/downloadPhoto\(photo\)/.test(downloadOnClick), 'nút "Tải ảnh xuống" phải gọi downloadPhoto', downloadOnClick);
ok(
  !/sharePhoto\(photo\)/.test(downloadOnClick),
  'nút "Tải ảnh xuống" KHÔNG được nối vào sharePhoto (đó là lỗi gốc)',
  downloadOnClick
);
ok(/sharePhoto\(photo\)/.test(shareOnClick), 'nút "Chia sẻ ảnh" phải gọi sharePhoto', shareOnClick);
ok(
  !/downloadPhoto\(photo\)/.test(shareOnClick),
  'nút "Chia sẻ ảnh" không được tải file thay vì chia sẻ',
  shareOnClick
);

// --- CHẠY THẬT các handler trên trong vm, không chỉ đọc mã nguồn -----------
const PHOTO = {
  id: 'photo-1',
  orderCode: 'ORD-20260929-AB12CD34',
  warehouseId: 'wh-au-co',
  cashierId: 'cashier-1',
  capturedAt: '2026-09-29T09:00:00.000Z',
  blob: { size: 3 },
} as any;

interface GalleryProbe {
  share: number;
  downloads: string[];
  revoked: string[];
  timers: number;
}

/**
 * Bấm một nút thật của component trong `vm`: nối vào chính hàm `onClick` mà
 * .tsx đang khai báo, với navigator/URL/document giả để đếm được lần gọi
 * `navigator.share` và lần tải file.
 */
function runHandler(ariaLabel: string, options: { canShare: boolean; photo?: any }): GalleryProbe {
  const probe: GalleryProbe = { share: 0, downloads: [], revoked: [], timers: 0 };
  const anchor: Record<string, any> = {
    click() {
      probe.downloads.push(anchor.download);
    },
  };
  const sandbox: Record<string, any> = {
    isPhotoInScope: (photo: any, s: any) => photo.warehouseId === s.warehouseId,
    scope: { warehouseId: 'wh-au-co', cashierId: 'cashier-1', includeAllCashiers: false },
    URL: {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: (u: string) => probe.revoked.push(u),
    },
    document: { createElement: () => anchor },
    // setTimeout giả: không hẹn lịch 60 giây thật, chỉ đếm lời hẹn thu hồi.
    setTimeout: () => {
      probe.timers++;
      return 0;
    },
    File,
    Blob,
    navigator: {
      canShare: () => options.canShare,
      share: () => {
        probe.share++;
        return Promise.resolve();
      },
    },
    photo: options.photo ?? PHOTO,
  };
  const script = [
    `const fileNameOf = ${fileNameText};`,
    `const downloadPhoto = ${downloadPhotoText};`,
    `const sharePhoto = ${sharePhotoText};`,
    `const handler = (${onClickOf(ariaLabel)});`,
    'handler(photo);',
  ].join('\n');
  const js = ts.transpileModule(script, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  return probe;
}

const DOWNLOAD = 'Tải ảnh xuống';
const SHARE = 'Chia sẻ ảnh';

console.log('\n[#3.1] Bấm nút TẢI trên máy CÓ Web Share (đúng mọi iPhone)');
const probe = runHandler(DOWNLOAD, { canShare: true });
ok(
  probe.downloads.length === 1 && probe.downloads[0] === `payment-${PHOTO.orderCode}-${PHOTO.capturedAt}.jpg`,
  'nút tải phải tải file, KHÔNG mở share sheet',
  `tải ${probe.downloads.length} lần, share ${probe.share} lần`
);
ok(probe.share === 0, 'nút tải KHÔNG được gọi navigator.share');
ok(probe.revoked.length === 0, 'URL tải phải còn nguyên tới khi trình duyệt đọc xong');
ok(probe.timers === 1, 'phải hẹn thu hồi object URL (không rò RAM), và chỉ hẹn một lần');
ok(
  Boolean(probe.downloads[0]?.includes(PHOTO.orderCode)),
  'tên file tải xuống phải mang mã đơn để thu ngân tìm được ảnh',
  probe.downloads[0]
);

console.log('\n[#3.2] Bấm nút CHIA SẺ — đường riêng, không dính nút tải');
const withShare = runHandler(SHARE, { canShare: true });
ok(withShare.share === 1, 'nút chia sẻ + canShare đúng ⇒ gọi navigator.share', String(withShare.share));
ok(withShare.downloads.length === 0, 'nút chia sẻ + canShare đúng ⇒ KHÔNG tải file');
const withoutShare = runHandler(SHARE, { canShare: false });
ok(withoutShare.downloads.length === 1, 'nút chia sẻ + không có Web Share ⇒ tải file (dự phòng)');
ok(withoutShare.share === 0, 'không có Web Share thì không được gọi navigator.share');

console.log('\n[#3.3] Ảnh ngoài phạm vi: cả hai nút đều bị chặn');
const foreign = { ...PHOTO, warehouseId: 'wh-kho-khac' };
const outOfScopeDownload = runHandler(DOWNLOAD, { canShare: true, photo: foreign });
ok(outOfScopeDownload.downloads.length === 0, 'ảnh ngoài phạm vi: nút tải không được tải file');
const outOfScopeShare = runHandler(SHARE, { canShare: true, photo: foreign });
ok(
  outOfScopeShare.share === 0 && outOfScopeShare.downloads.length === 0,
  'ảnh ngoài phạm vi: nút chia sẻ không được chia sẻ lẫn tải file'
);

console.log(`\n${fail === 0 ? '🎉' : '💥'} Hợp đồng POS (TK ngân hàng / QR / tải ảnh): ${pass}/${pass + fail} PASS`);
assert.equal(fail, 0, `${fail} case FAIL`);
