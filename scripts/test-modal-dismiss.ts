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
  ['src/components/pos/ReturnsModal.tsx', [['onClose']]],
  ['src/components/auth/LoginModal.tsx', [['onCancel']]],
  ['src/components/pos/DiscountApprovalModal.tsx', [['onClose']]],
  ['src/components/pos/PosCheckoutTerminal.tsx', [
    ['setCompletedOrder'], ['setAmbiguousMatches'], ['setIsParserOpen'],
    ['setIsOpenShiftModalOpen'], ['setIsCloseShiftModalOpen'],
  ]],
] as const;
let tested = 0;
for (const [file, expected] of cases) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const className = attributes.find(attribute => attribute.name.getText(source) === 'className')?.initializer;
      if (className && ts.isStringLiteral(className) && className.text.includes('fixed inset-0')) {
        const click = attributes.find(attribute => attribute.name.getText(source) === 'onClick')?.initializer;
        handlers.push(click && ts.isJsxExpression(click) ? click.expression?.getText(source) || 'undefined' : 'undefined');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(handlers.length, expected.length, `${file}: cover each modal backdrop`);
  handlers.forEach((handler, index) => {
    const calls: Array<{ name: string; value: unknown }> = [];
    const scope: Record<string, unknown> = { loading: false, submitting: false, busy: false, isSubmittingSession: false, isClosable: true, status: 'PENDING' };
    for (const name of expected[index]) scope[name] = (value: unknown) => calls.push({ name, value });
    vm.createContext(scope);
    const js = ts.transpileModule(`const handle = ${handler}; handle;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const click = vm.runInContext(js, scope) as ((event: { target: object; currentTarget: object }) => void) | undefined;
    const backdrop = {};
    click?.({ target: {}, currentTarget: backdrop });
    assert.equal(calls.length, 0, `${file} #${index + 1}: tapping content must not close the modal`);
    click?.({ target: backdrop, currentTarget: backdrop });
    assert.deepEqual(calls.map(call => call.name), expected[index], `${file} #${index + 1}: tapping outside must run the existing close action`);
    for (const call of calls) {
      if (['setCompletedOrder', 'setAmbiguousMatches', 'setPendingDiscountRate'].includes(call.name)) assert.equal(call.value, null);
      if (call.name.startsWith('setIs')) assert.equal(call.value, false);
    }
    const pending = file.includes('StockMovement') ? 'loading' : file.includes('RmaTicket') ? 'submitting' : file.includes('ReturnsModal') ? 'busy' : file.includes('PosCheckout') && (index === 3 || index === 4) ? 'isSubmittingSession' : file.includes('DiscountApprovalModal') ? 'status' : null;
    if (pending) {
      calls.length = 0;
      scope[pending] = pending === 'status' ? 'LOADING' : true;
      click?.({ target: backdrop, currentTarget: backdrop });
      assert.equal(calls.length, 0, 'Do not dismiss an in-flight transaction by accidental backdrop tap');
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
