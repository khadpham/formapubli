/**
 * Biên bản chốt ngày: bấm "In Báo Cáo" ra TRANG TRẮNG HOÀN TOÀN.
 *
 * 1. CẤU TRÚC. Khối in `#printable-settlement-report` nằm BÊN TRONG khung modal
 *    `overflow-hidden max-h-[92vh]`. Khi in, khung cha đó vẫn cắt nội dung, và
 *    trang in ra không có gì để in ⇒ trang trắng. Sửa: khối in phải là CON TRỰC
 *    TIẾP của gốc portal (`document.body`), anh em với backdrop, không nằm trong
 *    khung modal nào. Test đo bằng AST chứ không đo bằng `indexOf` — đo chuỗi
 *    thì không phân biệt được "con của backdrop" với "con của khung modal".
 * 2. CSS. `hidden` của Tailwind đè lên `print:block` tùy thứ tự CSS, và khung
 *    cha vẫn giữ `overflow`/`max-height`. Phải có `display: block !important`
 *    cho khối in và quy tắc nới mọi khung cha trong `@media print`.
 * 3. `handlePrint` gọi `window.print()` vô điều kiện. Chưa tải xong / tải lỗi thì
 *    bấm In ra đúng MỘT TRANG TRẮNG — khớp triệu chứng. Phải chặn và nói rõ.
 *
 * `handlePrint` được bóc qua AST + `vm` và chạy thật với `window.print` giả
 * (không cần trình duyệt, không cần DB) — giống test-settlement-date-integrity.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const MODAL = 'src/components/pos/DailyFairSettlementModal.tsx';
const src = readFileSync(MODAL, 'utf8');

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};

const sourceFile = ts.createSourceFile(MODAL, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// `ts.createSourceFile` là error-tolerant: file JSX hỏng cú pháp vẫn "parse" xong
// và mọi assertion dưới đây vẫn PASS. Đã dính đúng lần: dấu ` trong CSS nằm
// trong template literal của <style jsx global> làm đứt chuỗi, test xanh, chỉ
// tsc mới bắt được. Tự soi lỗi cú pháp để test không bao giờ báo xanh giả.
const syntaxErrors: any[] = (sourceFile as any).parseDiagnostics ?? [];
ok(
  syntaxErrors.length === 0,
  `${MODAL} phải parse sạch — ${syntaxErrors.length} lỗi cú pháp, test sẽ báo PASS giả`
);

// --- Tiện ích AST ------------------------------------------------------------
// Thuộc tính JSX nằm trên `openingElement`, KHÔNG nằm trực tiếp trên JsxElement.
const attrsOf = (el: ts.JsxElement) => el.openingElement.attributes.properties;

const classNameOf = (el: ts.JsxElement): string => {
  const attr = attrsOf(el).find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sourceFile) === 'className'
  );
  if (!attr || !attr.initializer || !ts.isStringLiteral(attr.initializer)) return '';
  return attr.initializer.text;
};

const findById = (id: string): ts.JsxElement | undefined => {
  let found: ts.JsxElement | undefined;
  const walk = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(node)) {
      for (const p of attrsOf(node)) {
        if (ts.isJsxAttribute(p) && p.initializer && ts.isStringLiteral(p.initializer) && p.initializer.text === id) {
          found = node;
          return;
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return found;
};

const findStyleTag = (): ts.JsxElement | undefined => {
  let found: ts.JsxElement | undefined;
  const walk = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'style') {
      found = node;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return found;
};

const findPortalCall = (): ts.CallExpression | undefined => {
  let found: ts.CallExpression | undefined;
  const walk = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createPortal' &&
      node.arguments.length >= 2
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return found;
};

// =============================================================================
async function main() {
  // --- 1. CẤU TRÚC: khối in KHÔNG được nằm trong khung modal bị cắt ----------
  const printEl = findById('printable-settlement-report');
  ok(!!printEl, `phải còn khối biên bản in #printable-settlement-report trong ${MODAL}`);

  const portalCall = findPortalCall();
  ok(!!portalCall, 'modal vẫn phải render qua createPortal');
  ok(
    /document\s*\.\s*body/.test(portalCall!.arguments[1].getText(sourceFile)),
    'portal ngoài phải render vào document.body'
  );
  const portalRoot = portalCall!.arguments[0];
  ok(
    /fixed\s+inset-0/.test(portalRoot.getText(sourceFile)),
    'gốc portal ngoài phải là backdrop `fixed inset-0`'
  );
  // Khung modal trắng vẫn phải còn (không được xoá modal cho khỏi in trắng).
  ok(
    /max-w-4xl/.test(portalRoot.getText(sourceFile)),
    'khung modal trắng max-w-4xl phải còn nguyên trong portal'
  );

  // Khối in phải có portal RIÊNG trỏ thẳng về document.body. Gốc của portal đó
  // phải CHÍNH là khối in — không có phần tử JSX nào chen giữa, nên trong DOM nó
  // là con trực tiếp của <body>, không nằm dưới khung `overflow-hidden max-h`.
  let innerPortal: ts.CallExpression | undefined;
  let p: ts.Node | undefined = printEl!.parent;
  while (p) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'createPortal') {
      innerPortal = p;
      break;
    }
    p = p.parent;
  }
  ok(
    !!innerPortal,
    'khối in phải được render qua createPortal riêng để thoát khỏi khung modal bị cắt'
  );
  ok(
    /document\s*\.\s*body/.test(innerPortal!.arguments[1].getText(sourceFile)),
    'khối in phải render thẳng vào document.body — cạnh backdrop, không nằm trong khung modal'
  );

  // Bất kỳ phần tử JSX nào nằm giữa khối in và portal của nó đều là khung cha
  // trong DOM ⇒ chính là thứ cắt mất biên bản khi in.
  const between: ts.JsxElement[] = [];
  p = printEl!.parent;
  while (p && p !== innerPortal) {
    if (ts.isJsxElement(p)) between.push(p);
    p = p.parent;
  }
  ok(
    between.length === 0,
    `khối in không được bọc trong khung modal nào (tìm thấy: ${between.map(classNameOf).join(' | ')})`
  );

  // --- 2. CSS IN --------------------------------------------------------------
  const styleTag = findStyleTag();
  ok(!!styleTag, 'phải còn khối <style jsx global> chứa CSS in');
  const printCss = styleTag!.getText(sourceFile);
  ok(/@media\s+print/.test(printCss), 'CSS in phải nằm trong @media print');
  ok(
    /#printable-settlement-report\s*\{[^}]*display:\s*block\s*!important/.test(printCss),
    'khối in phải có `display: block !important` để đè thắng class `hidden` của Tailwind'
  );
  ok(
    /#printable-settlement-report[^}]*\{[^}]*visibility:\s*visible\s*!important/.test(printCss),
    'biên bản phải được ép `visibility: visible` để không bị ẩn với phần còn lại'
  );
  // Phần ẩn nội dung KHÁC phải GỠ KHỎI LUỒNG, không chỉ ẩn bằng `visibility`.
  // Nếu chỉ `visibility: hidden` thì nội dung ẩn VẪN CHIẾM CHỖ trong luồng in
  // ⇒ trình duyệt in ra hàng chục trang TRẮNG nối sau biên bản. Review độc lập đã
  // chỉ ra đúng điểm này khi quy tắc `body > * { overflow/max-height/height }`
  // ép lên mọi con của body mà không loại chúng khỏi luồng.
  //
  // Cập nhật 2026-10-01 (sau Task 1): selector thật là
  // `body > *:not(:has(#printable-settlement-report)):not(#printable-settlement-report)`.
  // Regex CŨ bắt buộc `)` ngay trước `{` nên không khớp ⇒ suite đỏ từ khi Task 1
  // thêm mệnh đề loại trừ thứ hai. Ở đây BÓC nguyên selector + thân rule ra rồi
  // kiểm từng mệnh đề: khớp selector mới mà KHÔNG nới lỏng — mất mệnh đề
  // `:not(#printable-settlement-report)` thì vẫn đỏ (đó chính là lỗi in trắng).
  const hideRule = printCss.match(
    /body\s*>\s*\*:not\(:has\(#printable-settlement-report\)\)([^{]*)\{([^}]*)\}/
  );
  ok(
    !!hideRule,
    'phải có selector `body > *:not(:has(#printable-settlement-report))…` gỡ mọi nhánh khác khỏi luồng in'
  );
  ok(
    !!hideRule && /:not\(#printable-settlement-report\)/.test(hideRule[1]),
    'selector ẩn khi in phải loại trừ #printable-settlement-report — thiếu nó thì :has() thắng `display: block` và in ra trang TRẮNG'
  );
  ok(
    !!hideRule && /display:\s*none\s*!important/.test(hideRule[2]),
    'phải `display: none` mọi nhánh của body KHÔNG chứa biên bản, để không sinh trang trắng'
  );
  ok(
    /#printable-settlement-report\s*\{[^}]*overflow:\s*visible\s*!important/.test(printCss),
    'bản thân biên bản phải `overflow: visible` khi in'
  );
  ok(
    /#printable-settlement-report\s*\{[^}]*max-height:\s*none\s*!important/.test(printCss),
    'bản thân biên bản phải `max-height: none` khi in'
  );
  ok(
    /\.no-print\s*\{\s*display:\s*none\s*!important/.test(printCss),
    'phải giữ `.no-print { display: none !important }` để không in giao diện màn hình'
  );
  ok(/@page\s*\{/.test(printCss), 'phải giữ khổ giấy @page A4');

  // --- 3. handlePrint PHẢI CHẶN, KHÔNG IN TRANG TRẮNG -------------------------
  let handlePrintExpr: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'handlePrint' && node.initializer) {
      handlePrintExpr = node.initializer.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  ok(!!handlePrintExpr, 'phải tìm thấy hàm handlePrint trong modal');

  const SAMPLE = { reportDate: '2026-09-29', financials: { netSales: 1 } };
  function harness() {
    const calls: { name: string; value: unknown }[] = [];
    let printed = 0;
    const scope: any = {
      data: null as any,
      isLoading: false,
      loadError: null as string | null,
      setPrintNotice: (value: unknown) => calls.push({ name: 'setPrintNotice', value }),
      window: { print: () => printed++ },
    };
    vm.createContext(scope);
    const js = ts.transpileModule(`const handlePrint = ${handlePrintExpr}; handlePrint;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const handlePrint = vm.runInContext(js, scope) as () => void;
    const notices = () =>
      calls.filter((c) => c.name === 'setPrintNotice' && typeof c.value === 'string').map((c) => String(c.value));
    return {
      handlePrint,
      scope,
      notices,
      printedCount: () => printed,
    };
  }

  // 3a. Chưa có dữ liệu ⇒ KHÔNG in, phải nói ra.
  {
    const h = harness();
    h.handlePrint();
    ok(h.printedCount() === 0, 'data chưa có thì KHÔNG được gọi window.print (đó là trang trắng)');
    ok(h.notices().length === 1, 'phải báo lý do không in được');
    ok(
      /[^\x00-\x7F]/.test(h.notices()[0] || ''),
      'thông báo phải là tiếng Việt CÓ DẤU'
    );
  }

  // 3b. Đang tải ⇒ KHÔNG in.
  {
    const h = harness();
    h.scope.data = SAMPLE;
    h.scope.isLoading = true;
    h.handlePrint();
    ok(h.printedCount() === 0, 'đang tải thì KHÔNG được gọi window.print');
    ok(h.notices().length === 1, 'đang tải thì phải báo "chờ tải xong"');
  }

  // 3c. Tải lỗi ⇒ KHÔNG in, phải kèm lý do lỗi.
  {
    const h = harness();
    h.scope.loadError = 'Báo cáo không tải được (mã lỗi 500).';
    h.handlePrint();
    ok(h.printedCount() === 0, 'tải lỗi thì KHÔNG được gọi window.print');
    ok(
      (h.notices()[0] || '').includes('500'),
      'thông báo phải kèm lý do lỗi đang có, không báo chung chung'
    );
  }

  // 3d. Sẵn sàng ⇒ CÓ in, đúng 1 lần, và xoá thông báo cũ.
  {
    const h = harness();
    h.scope.data = SAMPLE;
    h.handlePrint();
    ok(h.printedCount() === 1, 'khi có dữ liệu thì phải in đúng 1 lần');
    ok(
      h.notices().length === 0,
      'không có lý do gì để chặn thì không được để lại thông báo lỗi cũ trên màn hình'
    );
  }

  // 3e. Sau khi chặn rồi tải lại được ⇒ lần sau in phải sạch.
  {
    const h = harness();
    h.handlePrint(); // chặn
    h.scope.data = SAMPLE;
    h.handlePrint(); // in
    ok(h.printedCount() === 1, 'bấm lần hai khi đã có dữ liệu thì phải in');
    ok(
      h.notices().length === 1,
      'chỉ được giữ đúng MỘT thông báo (của lần bị chặn), thông báo cũ phải được xoá khi in'
    );
  }

  // --- 4. Thông báo phải LỘ RA cho người dùng, và không lọt vào bản in ---------
  ok(/printNotice/.test(src), 'phải lưu thông báo chặn in vào state');
  ok(
    /role="alert"/.test(src),
    'thông báo chặn in phải được render với role="alert" để người dùng thấy ngay'
  );
  ok(
    /no-print[^"]*"[\s\S]{0,400}printNotice/.test(src) || /printNotice[\s\S]{0,400}no-print/.test(src),
    'khối cảnh báo phải mang class `no-print` — nếu không nó sẽ bị in ra trong biên bản'
  );
  ok(
    /onClick=\{handlePrint\}[\s\S]{0,200}disabled=\{isLoading \|\| !data\}/.test(src),
    'nút In phải giữ trạng thái disabled khi chưa có dữ liệu / đang tải'
  );

  console.log(`\n=== BIÊN BẢN CHỐT NGÀY — IN KHÔNG RA TRANG TRẮNG: ${checks} assertions PASS ===`);
}

main().catch((err) => {
  console.error('❌ test-settlement-print:', err);
  process.exit(1);
});
