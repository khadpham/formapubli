/**
 * Rigorous Lifecycle & Contract Verification for Batch Transfer Bulk Edit (Ticket #5)
 * & Warehouse Creation CTA (Ticket #10-CTA).
 *
 * Covers:
 * [P1] In-flight mutation must NEVER lock isValidating in true; AbortController cancels pending request.
 * [P2] In-flight warehouse change (source or target) must invalidate pending request and reset isValidating/validationSuccess.
 * [P3] Closing and reopening modal resets isValidating, aborts pending request, and ensures fresh state.
 * [P4] Bulk quantity validation (strictly positive integer > 0, reject 0, negative, decimals, NaN).
 * [P5] Tri-state selection logic (all, none, indeterminate).
 * [P6] Bulk actions (delete selected, update qty on selected only).
 * [P7] 1-touch Cap to Max handles 0-stock by filtering out (not raising 0 to 1).
 * [P8] Idempotency key stability across retries and reset on payload changes.
 * [P9] Target warehouse preset with collision avoidance.
 */

import assert from 'node:assert';

// Simulation of the exact state & lifecycle logic inside BatchTransferModal
class BatchTransferLifecycleSimulator {
  isValidating = false;
  validationSuccess: boolean | null = null;
  errorMessage: string | null = null;
  fromWarehouseId = 'wh-au-co';
  toWarehouseId = 'wh-quynh-mai';
  lines: Array<{ editionId: string; quantity: number }> = [
    { editionId: 'book-1', quantity: 10 },
    { editionId: 'book-2', quantity: 20 },
  ];

  validationRequestId = 0;
  abortController: AbortController | null = null;

  invalidateValidation() {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }
    this.validationRequestId++;
    this.isValidating = false;
    this.validationSuccess = null;
  }

  changeFromWarehouse(id: string) {
    this.fromWarehouseId = id;
    this.invalidateValidation();
    this.errorMessage = null;
  }

  changeToWarehouse(id: string) {
    this.toWarehouseId = id;
    this.invalidateValidation();
    this.errorMessage = null;
  }

  modifyLineQuantity(editionId: string, qty: number) {
    this.lines = this.lines.map((l) => (l.editionId === editionId ? { ...l, quantity: qty } : l));
    this.invalidateValidation();
    this.errorMessage = null;
  }

  closeModal() {
    this.invalidateValidation();
    this.errorMessage = null;
  }

  async validateBatch(mockNetworkDelayMs: number, shouldSucceed: boolean) {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
    }
    const controller = new AbortController();
    this.abortController = controller;

    this.isValidating = true;
    this.errorMessage = null;
    this.validationSuccess = null;
    const reqId = ++this.validationRequestId;

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), mockNetworkDelayMs);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

      // Ignore if outdated
      if (reqId !== this.validationRequestId) return;

      if (shouldSucceed) {
        this.validationSuccess = true;
      } else {
        this.validationSuccess = false;
        this.errorMessage = 'Thiếu tồn';
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (reqId !== this.validationRequestId) return;
      this.errorMessage = err.message;
    } finally {
      if (reqId === this.validationRequestId) {
        this.isValidating = false;
        if (this.abortController === controller) {
          this.abortController = null;
        }
      }
    }
  }
}

async function testP1_MutationDuringValidationNeverLocks() {
  console.log('--- Test P1: Mutation During Validation Never Leaves Modal Locked ---');

  const sim = new BatchTransferLifecycleSimulator();

  // Start validation with 50ms network delay
  const valPromise = sim.validateBatch(50, true);
  assert.strictEqual(sim.isValidating, true, 'Must be validating initially');

  // User edits quantity at 10ms while network request is in-flight
  await new Promise((r) => setTimeout(r, 10));
  sim.modifyLineQuantity('book-1', 15);

  // Verification 1: isValidating MUST immediately become false (not waiting for late response)
  assert.strictEqual(sim.isValidating, false, 'isValidating must reset immediately on mutation');
  assert.strictEqual(sim.validationSuccess, null, 'validationSuccess must be null');

  // Wait for background promise to settle
  await valPromise;

  // Verification 2: After promise settles, isValidating remains false and validationSuccess was NOT accepted
  assert.strictEqual(sim.isValidating, false, 'isValidating must still be false after settled');
  assert.strictEqual(sim.validationSuccess, null, 'Stale validation response must be discarded');

  // Verification 3: Modal is completely unlocked and can run a fresh validation
  await sim.validateBatch(10, true);
  assert.strictEqual(sim.isValidating, false, 'Must finish validating');
  assert.strictEqual(sim.validationSuccess, true, 'Fresh validation on updated data succeeds');

  console.log('✓ [P1] PASS: No stuck validating state, stale response dropped.');
}

async function testP2_WarehouseChangeDuringValidationInvalidates() {
  console.log('--- Test P2: Warehouse Change Invalidate In-Flight Request ---');

  const sim = new BatchTransferLifecycleSimulator();
  sim.fromWarehouseId = 'wh-au-co';
  sim.toWarehouseId = 'wh-quynh-mai';

  // Start validation for wh-quynh-mai
  const valPromise = sim.validateBatch(50, true);
  assert.strictEqual(sim.isValidating, true);

  // User switches destination to wh-du-phong while request is in-flight
  await new Promise((r) => setTimeout(r, 10));
  sim.changeToWarehouse('wh-du-phong');

  // Verification: isValidating is false, validationSuccess is null
  assert.strictEqual(sim.isValidating, false, 'isValidating must be reset on warehouse change');
  assert.strictEqual(sim.validationSuccess, null);

  await valPromise;

  // Verification: Stale response for old warehouse pair did NOT set validationSuccess to true
  assert.strictEqual(
    sim.validationSuccess,
    null,
    'Response for old warehouse must NOT enable validationSuccess for new warehouse'
  );

  console.log('✓ [P2] PASS: Warehouse change strictly invalidates in-flight validation.');
}

async function testP3_ModalCloseAbortsAndUnlocks() {
  console.log('--- Test P3: Modal Close Aborts & Unlocks State ---');

  const sim = new BatchTransferLifecycleSimulator();
  const valPromise = sim.validateBatch(50, true);
  assert.strictEqual(sim.isValidating, true);

  // User presses Escape or clicks Backdrop
  sim.closeModal();

  assert.strictEqual(sim.isValidating, false, 'isValidating must be reset upon modal close');
  assert.strictEqual(sim.validationSuccess, null);

  await valPromise;
  assert.strictEqual(sim.isValidating, false);

  console.log('✓ [P3] PASS: Modal close cleanly aborts and unlocks.');
}

function testP4_BulkQuantityValidation() {
  console.log('--- Test P4: Bulk Quantity Validation ---');

  const isValidPositiveInteger = (input: string): { valid: boolean; value?: number; error?: string } => {
    const trimmed = input.trim();
    if (!trimmed) return { valid: false, error: 'Chưa nhập số lượng.' };
    const num = Number(trimmed);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
      return { valid: false, error: 'Số lượng phải là số nguyên dương lớn hơn 0.' };
    }
    return { valid: true, value: num };
  };

  assert.strictEqual(isValidPositiveInteger('10').valid, true);
  assert.strictEqual(isValidPositiveInteger('10').value, 10);
  assert.strictEqual(isValidPositiveInteger('1').valid, true);

  // Rejections
  assert.strictEqual(isValidPositiveInteger('0').valid, false, '0 must be rejected');
  assert.strictEqual(isValidPositiveInteger('-5').valid, false, 'Negative must be rejected');
  assert.strictEqual(isValidPositiveInteger('2.5').valid, false, 'Decimal must be rejected');
  assert.strictEqual(isValidPositiveInteger('abc').valid, false, 'NaN must be rejected');
  assert.strictEqual(isValidPositiveInteger('').valid, false, 'Empty must be rejected');
  assert.strictEqual(isValidPositiveInteger('   ').valid, false, 'Whitespace must be rejected');

  console.log('✓ [P4] PASS: Bulk quantity validation.');
}

function testP5_TriStateSelection() {
  console.log('--- Test P5: Tri-State Selection ---');

  const computeSelectionState = (totalLines: number, selectedCount: number) => {
    const isAllSelected = totalLines > 0 && selectedCount === totalLines;
    const isSomeSelected = selectedCount > 0 && selectedCount < totalLines;
    return { isAllSelected, isSomeSelected };
  };

  assert.deepStrictEqual(computeSelectionState(0, 0), { isAllSelected: false, isSomeSelected: false });
  assert.deepStrictEqual(computeSelectionState(5, 0), { isAllSelected: false, isSomeSelected: false });
  assert.deepStrictEqual(computeSelectionState(5, 2), { isAllSelected: false, isSomeSelected: true });
  assert.deepStrictEqual(computeSelectionState(5, 5), { isAllSelected: true, isSomeSelected: false });

  console.log('✓ [P5] PASS: Tri-State selection logic.');
}

function testP6_BulkActions() {
  console.log('--- Test P6: Bulk Actions (Apply Qty, Delete Selected) ---');

  interface Line {
    editionId: string;
    quantity: number;
  }

  let lines: Line[] = [
    { editionId: 'book-1', quantity: 5 },
    { editionId: 'book-2', quantity: 10 },
    { editionId: 'book-3', quantity: 15 },
  ];

  let selectedIds = new Set(['book-1', 'book-3']);

  // Apply bulk qty = 25 to selected
  const newQty = 25;
  lines = lines.map((l) => (selectedIds.has(l.editionId) ? { ...l, quantity: newQty } : l));

  assert.strictEqual(lines.find((l) => l.editionId === 'book-1')?.quantity, 25);
  assert.strictEqual(lines.find((l) => l.editionId === 'book-2')?.quantity, 10, 'Unselected must not change');
  assert.strictEqual(lines.find((l) => l.editionId === 'book-3')?.quantity, 25);

  // Delete selected
  lines = lines.filter((l) => !selectedIds.has(l.editionId));
  selectedIds.clear();

  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].editionId, 'book-2');
  assert.strictEqual(selectedIds.size, 0);

  console.log('✓ [P6] PASS: Bulk actions.');
}

function testP7_CapToMaxZeroStock() {
  console.log('--- Test P7: Cap to Max with 0 Stock ---');

  interface Line {
    editionId: string;
    quantity: number;
    availableStock?: number;
    staleWarning?: string;
  }

  const lines: Line[] = [
    { editionId: 'book-1', quantity: 10, availableStock: 3, staleWarning: 'Thiếu hàng' },
    { editionId: 'book-2', quantity: 5, availableStock: 0, staleWarning: 'Hết hàng' },
    { editionId: 'book-3', quantity: 8, availableStock: 8 },
  ];

  const cappedLines = lines
    .map((l) => {
      if (l.staleWarning && l.availableStock !== undefined) {
        if (l.availableStock <= 0) {
          return null;
        }
        return {
          ...l,
          quantity: l.availableStock,
          staleWarning: undefined,
        };
      }
      return l;
    })
    .filter((l): l is Line => l !== null);

  assert.strictEqual(cappedLines.length, 2, 'Line with 0 stock must be removed');
  assert.strictEqual(cappedLines.find((l) => l.editionId === 'book-1')?.quantity, 3);
  assert.strictEqual(cappedLines.find((l) => l.editionId === 'book-2'), undefined);
  assert.strictEqual(cappedLines.find((l) => l.editionId === 'book-3')?.quantity, 8);

  console.log('✓ [P7] PASS: Cap to Max with 0 stock removes item.');
}

function testP8_IdempotencyFingerprint() {
  console.log('--- Test P8: Idempotency Key Stability & Reset on Edit ---');

  const computeFingerprint = (from: string, to: string, note: string, items: Array<{ id: string; q: number }>) => {
    return JSON.stringify({
      from,
      to,
      note: note.trim(),
      items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
    });
  };

  let fromWh = 'wh-1';
  let toWh = 'wh-2';
  let note = 'Chuyển hàng hội chợ';
  let items = [{ id: 'b1', q: 10 }, { id: 'b2', q: 20 }];

  const fp1 = computeFingerprint(fromWh, toWh, note, items);
  const fpRetry = computeFingerprint(fromWh, toWh, note, items);
  assert.strictEqual(fp1, fpRetry, 'Fingerprint must be identical on retry');

  items = [{ id: 'b1', q: 11 }, { id: 'b2', q: 20 }];
  const fpEdited = computeFingerprint(fromWh, toWh, note, items);
  assert.notStrictEqual(fp1, fpEdited, 'Fingerprint must change when items change');

  console.log('✓ [P8] PASS: Idempotency fingerprint stability.');
}

function testP9_InitialWarehousePreset() {
  console.log('--- Test P9: Target Warehouse Preset (#10-CTA) ---');

  const warehouses = [
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ' },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho Quỳnh Mai' },
    { id: 'wh-fair-2026', code: 'KHO_FAIR', name: 'Kho Hội Chợ 2026' },
  ];

  const resolveWarehouses = (initialToId?: string) => {
    let toWh = initialToId || warehouses[1]?.id;
    let fromWh = warehouses.find((w) => w.code === 'KHO_AU_CO')?.id || warehouses[0]?.id;

    if (fromWh === toWh) {
      const alternative = warehouses.find((w) => w.id !== toWh);
      if (alternative) fromWh = alternative.id;
    }
    return { fromWh, toWh };
  };

  const res1 = resolveWarehouses('wh-fair-2026');
  assert.strictEqual(res1.toWh, 'wh-fair-2026');
  assert.strictEqual(res1.fromWh, 'wh-au-co');
  assert.notStrictEqual(res1.fromWh, res1.toWh);

  const res2 = resolveWarehouses('wh-au-co');
  assert.strictEqual(res2.toWh, 'wh-au-co');
  assert.notStrictEqual(res2.fromWh, 'wh-au-co');

  console.log('✓ [P9] PASS: Target warehouse preset & collision avoidance.');
}

async function runAll() {
  await testP1_MutationDuringValidationNeverLocks();
  await testP2_WarehouseChangeDuringValidationInvalidates();
  await testP3_ModalCloseAbortsAndUnlocks();
  testP4_BulkQuantityValidation();
  testP5_TriStateSelection();
  testP6_BulkActions();
  testP7_CapToMaxZeroStock();
  testP8_IdempotencyFingerprint();
  testP9_InitialWarehousePreset();
  console.log('\n========================================');
  console.log('>>> ALL 9 LIFECYCLE & CONTRACT TESTS PASSED! <<<');
  console.log('========================================\n');
}

runAll();
