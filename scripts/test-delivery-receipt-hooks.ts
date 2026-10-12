import assert from 'assert';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { DeliveryReceiptPrint } from '../src/components/inventory/DeliveryReceiptPrint';

console.log('=== KIỂM THỬ: ĐẢM BẢO TUÂN THỦ REACT RULES OF HOOKS TRONG DELIVERY RECEIPT PRINT ===');

// 1. Static AST/Content Check: Không có hook nào được gọi sau câu lệnh return
const componentPath = path.join(__dirname, '../src/components/inventory/DeliveryReceiptPrint.tsx');
const content = fs.readFileSync(componentPath, 'utf-8');

// Tìm function DeliveryReceiptPrint
const functionStart = content.indexOf('export function DeliveryReceiptPrint(');
assert(functionStart !== -1, 'Không tìm thấy hàm DeliveryReceiptPrint');
const functionBody = content.slice(functionStart);

// Tìm early return: if (!isOpen || !mounted) return null;
const earlyReturnRegex = /if\s*\([^)]*mounted[^)]*\)\s*return\s*null;/;
const earlyReturnMatch = functionBody.match(earlyReturnRegex);
assert(earlyReturnMatch && earlyReturnMatch.index !== undefined, 'Không tìm thấy early return của mounted trong hàm');

const codeBeforeEarlyReturn = functionBody.slice(0, earlyReturnMatch.index);

// Kiểm tra isDeletingDraft phải nằm TRƯỚC early return
assert(
  codeBeforeEarlyReturn.includes('isDeletingDraft'),
  'LỖI: isDeletingDraft phải được khai báo TRƯỚC early return để không vi phạm React Rules of Hooks'
);

// Kiểm tra không có hook (use[A-Z]\w+) nào xuất hiện giữa early return và return JSX cuối cùng
const returnJsxIndex = functionBody.indexOf('return (');
const codeBetweenReturns = functionBody.slice(earlyReturnMatch.index + earlyReturnMatch[0].length, returnJsxIndex);

const strayHookMatches = codeBetweenReturns.match(/\buse[A-Z]\w+\s*\(/g);
assert(
  !strayHookMatches || strayHookMatches.length === 0,
  `LỖI: Tìm thấy hook sau early return: ${strayHookMatches?.join(', ')}`
);
console.log('✔ Static Check: Toàn bộ hooks đều nằm ở đầu component trước early return.');

// 2. Dynamic Hook Sequence Check
const mockOrder: any = {
  id: 'preview-id',
  code: 'DRAFT-B944A316',
  partnerId: 'DL-BINH-BAN-BOOK',
  partnerName: 'Bình bán Book',
  partnerCode: 'DL-BINH-BAN-BOOK',
  fromWarehouseId: 'WH-1',
  warehouseName: 'Kho 1',
  subtotal: 100000,
  discountRate: 0.3,
  finalAmount: 70000,
  fiscalScope: 'COMMERCIAL_WHOLESALE',
  status: 'DRAFT',
  items: []
};

// Polyfill window, document & fetch cho môi trường Node
(global as any).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  print: () => {},
  confirm: () => true
};
import ReactDOM from 'react-dom';
(ReactDOM as any).createPortal = (children: any) => children;

(global as any).document = {
  body: { nodeType: 1 }
};
(global as any).fetch = () => Promise.resolve({ json: () => Promise.resolve({ success: false }) });

const origUseState = React.useState;
const origUseEffect = React.useEffect;

// Đo lượt gọi khi mounted = false
let hooksPass1: string[] = [];
(React as any).useState = (init: any) => {
  hooksPass1.push('useState');
  return [init, () => {}];
};
(React as any).useEffect = () => {
  hooksPass1.push('useEffect');
};

DeliveryReceiptPrint({ order: mockOrder, isOpen: true, onClose: () => {} });

// Đo lượt gọi khi mounted = true
let hooksPass2: string[] = [];
let stateCall = 0;
(React as any).useState = (init: any) => {
  hooksPass2.push('useState');
  stateCall++;
  // State đầu tiên là mounted -> trả về true
  if (stateCall === 1) return [true, () => {}];
  return [init, () => {}];
};
(React as any).useEffect = () => {
  hooksPass2.push('useEffect');
};

DeliveryReceiptPrint({ order: mockOrder, isOpen: true, onClose: () => {} });

console.log(`Lượt 1 (mounted=false): ${hooksPass1.length} hooks [${hooksPass1.join(', ')}]`);
console.log(`Lượt 2 (mounted=true):  ${hooksPass2.length} hooks [${hooksPass2.join(', ')}]`);

assert.strictEqual(
  hooksPass1.length,
  hooksPass2.length,
  `LỖI: Số lượng hook khác nhau giữa các lần render (${hooksPass1.length} vs ${hooksPass2.length}) gây React error #310!`
);

assert.deepStrictEqual(
  hooksPass1,
  hooksPass2,
  'LỖI: Trật tự gọi hooks bị thay đổi giữa các lần render!'
);

// Khôi phục
(React as any).useState = origUseState;
(React as any).useEffect = origUseEffect;

console.log('✔ Dynamic Check: Thứ tự và số lượng hooks hoàn toàn khớp giữa mọi trạng thái render.');
console.log('TAT CA DAT');
