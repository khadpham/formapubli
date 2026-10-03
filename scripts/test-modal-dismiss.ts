/** Run the real backdrop handlers; no browser or database needed. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const cases = [
  ['src/components/scanner/InAppBarcodeScanner.tsx', [['stopCamera', 'onClose']]],
  ['src/components/StockMovementModal.tsx', [['onClose']]],
  ['src/components/inventory/PickListModal.tsx', [['onClose']]],
  ['src/components/inventory/RmaTicketModal.tsx', [['onClose']]],
  ['src/components/auth/LoginModal.tsx', [['onCancel']]],
  ['src/components/pos/DiscountApprovalModal.tsx', [['onCancel']]],
  ['src/components/pos/PosCheckoutTerminal.tsx', [
    ['setCompletedOrder'],
    // Modal trùng mã vạch: đóng phải xoá cả danh sách ứng viên LẪN khoá mã đã
    // quét, nếu không khoá sót lại sẽ ghi nhớ nhầm ở lần quét sau.
    ['setAmbiguousMatches', 'setAmbiguousPickKey'],
    ['setIsParserOpen'],
    ['setIsOpenShiftModalOpen'], ['setIsCloseShiftModalOpen'],
    // 30/09: màn hình Đơn Chờ — lối ra khi chốt ca bị chặn. Thứ tự PHẢI khớp
    // thứ tự backdrop trong file (modal này nằm TRƯỚC bottom sheet).
    ['setIsPendingOrdersOpen'],
    ['setIsMobileCheckoutSheetOpen'], // #7: overlay Bottom Sheet thanh toán mobile
  ]],
] as const;
let tested = 0;
for (const [file, expected] of cases) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const className = attributes.find((attribute) => attribute.name.getText(source) === 'className')?.initializer;
      if (className && ts.isStringLiteral(className) && className.text.includes('fixed inset-0')) {
        const click = attributes.find((attribute) => attribute.name.getText(source) === 'onClick')?.initializer;
        // Chỉ element CÓ handler mới là backdrop thật: vỏ wrapper (không onClick) bị bỏ qua,
        // và overlay self-closing (vd. #7 mobile sheet) được tính vào ma trận.
        if (click && ts.isJsxExpression(click) && click.expression) {
          handlers.push(click.expression.getText(source));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(handlers.length, expected.length, `${file}: cover each modal backdrop`);
  handlers.forEach((handler, index) => {
    const calls: Array<{ name: string; value: unknown }> = [];
    const scope: Record<string, unknown> = { loading: false, submitting: false, busy: false, isSubmitting: false, isSubmittingSession: false, isClosable: true, status: 'PENDING', setShowPasscode: () => {} };
    for (const name of expected[index]) scope[name] = (value: unknown) => calls.push({ name, value });
    if (file.includes('PosCheckoutTerminal') && index === 2) {
      scope.handleCloseParser = () => (scope.setIsParserOpen as ((value: boolean) => void))(false);
    }
    vm.createContext(scope);
    const js = ts.transpileModule(`const handle = ${handler}; handle;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const click = vm.runInContext(js, scope) as ((event: { target: object; currentTarget: object }) => void) | undefined;
    const backdrop = {};
    click?.({ target: {}, currentTarget: backdrop });
    assert.equal(calls.length, 0, `${file} #${index + 1}: tapping content must not close the modal`);
    click?.({ target: backdrop, currentTarget: backdrop });
    assert.deepEqual(calls.map(call => call.name), expected[index], `${file} #${index + 1}: tapping outside must run the existing close action`);
    for (const call of calls) {
      if (['setCompletedOrder', 'setAmbiguousMatches', 'setAmbiguousPickKey', 'setPendingDiscountRate'].includes(call.name)) assert.equal(call.value, null);
      if (call.name.startsWith('setIs')) assert.equal(call.value, false);
    }
    const pending = file.includes('StockMovement') ? 'loading' : file.includes('RmaTicket') ? 'submitting' : file.includes('PosCheckout') && (index === 3 || index === 4) ? 'isSubmittingSession' : file.includes('DiscountApprovalModal') ? 'status' : null;
    if (pending) {
      const guardedValues = pending === 'status' ? ['LOADING', 'APPROVED'] : [true];
      for (const guardedValue of guardedValues) {
        calls.length = 0;
        scope[pending] = guardedValue;
        click?.({ target: backdrop, currentTarget: backdrop });
        assert.equal(calls.length, 0, 'Do not dismiss an in-flight or approved transaction by accidental backdrop tap');
      }
    }
    if (file.includes('LoginModal')) {
      calls.length = 0;
      scope.isClosable = false;
      click?.({ target: backdrop, currentTarget: backdrop });
      assert.equal(calls.length, 0, 'Required authentication cannot be dismissed');
    }
    tested++;
  });
}
console.log(`PASS: ${tested} modal backdrops close on outside taps, preserve inside taps, busy guards and login gating.`);
