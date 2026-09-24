import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PosCheckoutTerminal } from '../src/components/pos/PosCheckoutTerminal';
import { UserRole } from '../src/lib/roles';

// Mock fetch
window.fetch = (async (url: string) => {
  if (url.includes('/api/warehouses')) {
    return {
      ok: true,
      json: async () => ({
        ok: true,
        data: [
          { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho Âu Cơ', warehouseType: 'RETAIL_OFFICE' }
        ]
      })
    };
  }
  if (url.includes('/api/atp')) {
    return {
      ok: true,
      json: async () => ({ ok: true, atp: {} })
    };
  }
  if (url.includes('/api/pos/discount-approvals')) {
    return {
      ok: true,
      json: async () => ({ ok: true, data: [] })
    };
  }
  return {
    ok: true,
    json: async () => ({ ok: true, data: {} })
  };
}) as any;

const sampleBooks = [
  { id: '1', code: 'BOOK-01', title: 'Muôn Kiếp Nhân Sinh - Tập 1 (Tái Bản Đặc Biệt)', isbn: '9781111', isbnLast4: '1111', author: 'Nguyên Phong', coverPrice: 168000, stockAvailable: 12, stockAuCo: 12, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 27 },
  { id: '2', code: 'BOOK-02', title: 'Cây Cam Ngọt Của Tôi', isbn: '9782222', isbnLast4: '2222', author: 'José Mauro de Vasconcelos', coverPrice: 108000, stockAvailable: 5, stockAuCo: 5, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 20 },
  { id: '3', code: 'BOOK-03', title: 'Hiểu Về Trái Tim', isbn: '9783333', isbnLast4: '3333', author: 'Thích Minh Niệm', coverPrice: 145000, stockAvailable: 8, stockAuCo: 8, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 23 },
  { id: '4', code: 'BOOK-04', title: 'Đắc Nhân Tâm (Khổ Lớn)', isbn: '9784444', isbnLast4: '4444', author: 'Dale Carnegie', coverPrice: 98000, stockAvailable: 20, stockAuCo: 20, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 35 },
  { id: '5', code: 'BOOK-05', title: 'Nhà Giả Kim', isbn: '9785555', isbnLast4: '5555', author: 'Paulo Coelho', coverPrice: 79000, stockAvailable: 15, stockAuCo: 15, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 30 },
  { id: '6', code: 'BOOK-06', title: 'Hành Trình Về Phương Đông', isbn: '9786666', isbnLast4: '6666', author: 'Baird T. Spalding', coverPrice: 120000, stockAvailable: 10, stockAuCo: 10, stockDuPhong: 10, stockQuynhMai: 5, totalStock: 25 }
];

function log(msg: string) {
  console.log(msg);
  const logDiv = document.getElementById('test-logs');
  if (logDiv) {
    const el = document.createElement('div');
    el.className = 'test-log';
    el.textContent = msg;
    logDiv.appendChild(el);
  }
}

function findButton(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.find((b) => b.textContent?.includes(text)) || null;
}

function TestContainer() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialRole = (urlParams.get('role') || 'ROLE_CASHIER') as UserRole;
  const [role, setRole] = useState<UserRole>(initialRole);

  useEffect(() => {
    (window as any).__setRole = setRole;
  }, []);

  return <PosCheckoutTerminal books={sampleBooks} currentRole={role} />;
}

async function runTestSuite() {
  log('Starting Automated Real Component Tests for PosCheckoutTerminal...');
  await new Promise((r) => setTimeout(r, 200));

  // 1. Check catalog grid structure (grid-cols-2)
  const gridEl = document.querySelector('.grid.grid-cols-2');
  if (!gridEl) {
    throw new Error('Test 1 Failed: Catalog grid container does not have grid-cols-2 class!');
  }
  log('✓ [Test 1] PASS: Catalog grid uses responsive 2 columns (grid-cols-2)');

  // 2. Check initial collapsed card count on mobile (should be 4 cards)
  const bookCards = gridEl.querySelectorAll('div[title]');
  if (bookCards.length !== 4) {
    throw new Error(`Test 2 Failed: Expected 4 book cards in 2x2 collapsed view, got ${bookCards.length}`);
  }
  log('✓ [Test 2] PASS: Mobile view renders exactly 4 books in compact 2x2 grid');

  // 3. Test expand toggle: Click "Xem tất cả"
  const expandBtn = findButton('Xem tất cả');
  if (!expandBtn) {
    throw new Error('Test 3 Failed: Cannot find "Xem tất cả" button');
  }
  expandBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  const expandedCards = gridEl.querySelectorAll('div[title]');
  if (expandedCards.length !== 6) {
    throw new Error(`Test 3 Failed: Expected 6 book cards after expanding, got ${expandedCards.length}`);
  }
  log('✓ [Test 3] PASS: Clicking "Xem tất cả" expands catalog grid to all 6 books');

  // 4. Test collapse toggle: Click "Thu gọn"
  const collapseBtn = findButton('Thu gọn');
  if (!collapseBtn) {
    throw new Error('Test 4 Failed: Cannot find "Thu gọn" button');
  }
  collapseBtn.click();
  await new Promise((r) => setTimeout(r, 100));

  const collapsedAgain = gridEl.querySelectorAll('div[title]');
  if (collapsedAgain.length !== 4) {
    throw new Error(`Test 4 Failed: Expected 4 book cards after collapsing back, got ${collapsedAgain.length}`);
  }
  log('✓ [Test 4] PASS: Clicking "Thu gọn" restores compact 2x2 grid (4 books)');

  // 5. Test Settlement button role check for Cashier
  const cashierSettlementBtn = findButton('Chốt Ngày');
  if (cashierSettlementBtn) {
    throw new Error('Test 5 Failed: "Chốt Ngày" button must NOT be rendered for ROLE_CASHIER');
  }
  log('✓ [Test 5] PASS: "Chốt Ngày" button is strictly hidden for ROLE_CASHIER');

  // 6. Switch role to ROLE_MANAGER and verify Settlement button renders
  (window as any).__setRole('ROLE_MANAGER');
  await new Promise((r) => setTimeout(r, 150));

  const managerSettlementBtn = findButton('Chốt Ngày');
  if (!managerSettlementBtn) {
    throw new Error('Test 6 Failed: "Chốt Ngày" button MUST be rendered for ROLE_MANAGER');
  }
  log('✓ [Test 6] PASS: "Chốt Ngày" button correctly renders for ROLE_MANAGER');

  // Summary
  const summaryEl = document.createElement('div');
  summaryEl.id = 'test-summary';
  summaryEl.textContent = 'ALL REAL POS COMPONENT TESTS PASSED (6/6)';
  document.body.appendChild(summaryEl);
  log('\n>>> SUCCESS: ALL REAL POS COMPONENT TESTS PASSED (6/6) <<<');
}

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  root.render(<TestContainer />);

  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode') || 'test';

  if (mode === 'test') {
    runTestSuite().catch((err) => {
      console.error('TEST ERROR:', err);
      const errEl = document.createElement('div');
      errEl.id = 'test-summary';
      errEl.textContent = 'FAILED: ' + err.message;
      document.body.appendChild(errEl);
    });
  }
});
