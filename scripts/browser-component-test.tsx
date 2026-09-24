import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BatchTransferModal } from '../src/components/inventory/BatchTransferModal';

const mockWarehouses = [
  { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ' },
  { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho Quỳnh Mai' },
  { id: 'wh-du-phong', code: 'KHO_DU_PHONG', name: 'Kho Dự Phòng' },
];

const mockBooks = [
  { id: 'b1', code: 'H01', title: 'Bệnh Tưởng', stockAuCo: 50, stockQuynhMai: 20, totalStock: 70 },
  { id: 'b2', code: 'H02', title: 'Trưởng Giả', stockAuCo: 30, stockQuynhMai: 10, totalStock: 40 },
];

// Global hooks for testing
let testHarnessSetOpen: (open: boolean) => void;

function TestApp() {
  const [isOpen, setIsOpen] = useState(true);
  testHarnessSetOpen = setIsOpen;

  return (
    <div id="test-app">
      <BatchTransferModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        books={mockBooks}
        warehouses={mockWarehouses}
        onSuccess={() => {}}
      />
    </div>
  );
}

// Custom deferred promise helper
function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runTestSuite() {
  const log = (msg: string) => {
    console.log(msg);
    const div = document.createElement('div');
    div.className = 'test-log';
    div.textContent = msg;
    document.getElementById('test-logs')?.appendChild(div);
  };

  log('Mounting TestApp with REAL BatchTransferModal...');
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  root.render(<TestApp />);

  // Wait for portal to mount into document.body
  await new Promise((r) => setTimeout(r, 200));

  // Helper to find button by text
  const findButton = (text: string): HTMLButtonElement | null => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find((b) => b.textContent?.includes(text)) || null;
  };

  // Helper to find select by label
  const findSelects = (): HTMLSelectElement[] => {
    return Array.from(document.querySelectorAll('select'));
  };

  // Step 1: Populate lines using real button "Thêm nhanh toàn bộ sách có tồn"
  const addBulkBtn = findButton('Thêm nhanh toàn bộ sách có tồn');
  if (!addBulkBtn) throw new Error('Cannot find "Thêm nhanh toàn bộ sách có tồn" button');
  addBulkBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  // Check lines rendered
  const numberInputs = Array.from(document.querySelectorAll('table input[type="number"]')) as HTMLInputElement[];
  if (numberInputs.length === 0) throw new Error('No lines added to transfer table');
  log(`✓ Populated ${numberInputs.length} lines into REAL component table`);

  // ==========================================
  // TEST P1: Mutating line quantity during validation aborts & unlocks isValidating
  // ==========================================
  log('\n--- Running Test P1: In-Flight Mutation during Validation ---');
  let pendingFetch1 = createDeferred<any>();
  let fetchCount = 0;
  let lastFetchSignal: AbortSignal | null = null;

  window.fetch = (async (url: string, init?: RequestInit) => {
    fetchCount++;
    lastFetchSignal = init?.signal || null;
    return pendingFetch1.promise;
  }) as any;

  const validateBtn = findButton('Kiểm tra tồn kho');
  if (!validateBtn) throw new Error('Cannot find "Kiểm tra tồn kho" button');
  const submitBtn = findButton('Xác nhận chuyển kho');
  if (!submitBtn) throw new Error('Cannot find "Xác nhận chuyển kho" button');

  // Trigger validate
  validateBtn.click();
  await new Promise((r) => setTimeout(r, 50));

  if (!validateBtn.disabled) throw new Error('P1 Failed: Validate button must be disabled during validation');
  log('✓ Validate request in-flight: validate button disabled (isValidating=true)');

  // User edits line quantity while fetch is in-flight
  const firstQtyInput = document.querySelector('table input[type="number"]') as HTMLInputElement;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  nativeInputValueSetter?.call(firstQtyInput, '15');
  firstQtyInput.dispatchEvent(new Event('input', { bubbles: true }));
  firstQtyInput.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  // Assert P1: isValidating MUST immediately become false (validateBtn unlocked!)
  if (validateBtn.disabled) {
    throw new Error('P1 FAILED: validateBtn is still disabled! Modal locked in validating state!');
  }
  log('✓ [P1] PASS: validateBtn immediately unlocked (isValidating=false) upon line mutation');

  // Assert signal was aborted
  if (!(lastFetchSignal as any)?.aborted) {
    throw new Error('P1 FAILED: AbortSignal was not aborted upon line mutation');
  }
  log('✓ [P1] PASS: In-flight AbortSignal was cleanly aborted');

  // Late response arrives
  pendingFetch1.resolve({
    ok: true,
    json: async () => ({ ok: true, data: {} }),
  });
  await new Promise((r) => setTimeout(r, 50));

  // Assert submit button is STILL disabled (late response did not set validationSuccess)
  if (!submitBtn.disabled) {
    throw new Error('P1 FAILED: Submit button became enabled on stale response!');
  }
  log('✓ [P1] PASS: Late response discarded, submit button remains disabled');

  // ==========================================
  // TEST P2: Changing warehouse during validation invalidates in-flight request
  // ==========================================
  log('\n--- Running Test P2: Warehouse Change during Validation ---');
  let pendingFetch2 = createDeferred<any>();

  window.fetch = (async (url: string, init?: RequestInit) => {
    lastFetchSignal = init?.signal || null;
    return pendingFetch2.promise;
  }) as any;

  // Trigger validate
  validateBtn.click();
  await new Promise((r) => setTimeout(r, 50));
  if (!validateBtn.disabled) throw new Error('P2 Failed: Validate button must be disabled during validation');

  // User changes destination warehouse to 'wh-du-phong'
  const selects = findSelects();
  const toSelect = selects[1];
  const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  nativeSelectValueSetter?.call(toSelect, 'wh-du-phong');
  toSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  // Assert P2: isValidating reset to false immediately
  if (validateBtn.disabled) {
    throw new Error('P2 FAILED: validateBtn is still disabled after warehouse change!');
  }
  log('✓ [P2] PASS: validateBtn immediately unlocked upon warehouse change');

  if (!(lastFetchSignal as any)?.aborted) {
    throw new Error('P2 FAILED: AbortSignal was not aborted upon warehouse change');
  }
  log('✓ [P2] PASS: In-flight AbortSignal was cleanly aborted upon warehouse change');

  // Resolve old warehouse fetch
  pendingFetch2.resolve({
    ok: true,
    json: async () => ({ ok: true, data: {} }),
  });
  await new Promise((r) => setTimeout(r, 50));

  if (!submitBtn.disabled) {
    throw new Error('P2 FAILED: Submit button became enabled from old warehouse response!');
  }
  log('✓ [P2] PASS: Old warehouse response rejected, submit button remains disabled');

  // ==========================================
  // TEST P3: Fresh validation on updated data succeeds completely
  // ==========================================
  log('\n--- Running Test P3: Fresh Validation Succeeds & Enables Submit ---');
  window.fetch = (async () => {
    return {
      ok: true,
      json: async () => ({ ok: true, data: {} }),
    };
  }) as any;

  validateBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  if (submitBtn.disabled) {
    throw new Error('P3 FAILED: Submit button should be enabled after successful fresh validation');
  }
  log('✓ [P3] PASS: Fresh validation succeeded, submit button is enabled');

  // Summary
  const summaryEl = document.createElement('div');
  summaryEl.id = 'test-summary';
  summaryEl.textContent = 'ALL REAL COMPONENT TESTS PASSED (3/3)';
  document.body.appendChild(summaryEl);
  log('\n>>> SUCCESS: ALL REAL COMPONENT TESTS PASSED (3/3) <<<');
}

window.addEventListener('DOMContentLoaded', () => {
  runTestSuite().catch((err) => {
    console.error('TEST ERROR:', err);
    const errEl = document.createElement('div');
    errEl.id = 'test-summary';
    errEl.textContent = 'FAILED: ' + err.message;
    document.body.appendChild(errEl);
  });
});
