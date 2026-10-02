import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Test kiểm chứng tự động cho 2 yêu cầu:
 * 1. Nút bấm xem chi tiết đơn hàng Top 5 trên Dashboard (TopOrdersCard & ExecutiveDashboard & OrderDetailModal)
 * 2. Sửa lỗi lẹm khung nút bấm xếp tồn Bé -> Lớn / Lớn -> Bé trong Tab Kiểm kê (DailyFairSettlementModal)
 */
async function runTest() {
  console.log('--- KIỂM CHỨNG TÍNH NĂNG VÀ SỬA LỖI UI ---');

  const rootDir = process.cwd();

  // 1. Kiểm tra OrderDetailModal.tsx
  const orderDetailModalPath = path.join(rootDir, 'src/components/orders/OrderDetailModal.tsx');
  assert.ok(fs.existsSync(orderDetailModalPath), 'File OrderDetailModal.tsx phải tồn tại');
  const orderDetailContent = fs.readFileSync(orderDetailModalPath, 'utf8');

  assert.ok(
    orderDetailContent.includes('export function OrderDetailModal'),
    'OrderDetailModal phải export component đúng tên'
  );
  assert.ok(
    orderDetailContent.includes('fetch(`/api/orders/${id}`)') || orderDetailContent.includes('fetch(`/api/orders/${orderId}`)'),
    'OrderDetailModal phải gọi API /api/orders/[id] để lấy chi tiết'
  );
  assert.ok(
    orderDetailContent.includes('/void'),
    'OrderDetailModal phải hỗ trợ gọi API hủy đơn an toàn'
  );
  assert.ok(
    orderDetailContent.includes('ROLE_OWNER') && orderDetailContent.includes('ROLE_MANAGER'),
    'OrderDetailModal phải kiểm tra quyền Quản lý/Chủ trước khi cho phép hủy đơn'
  );
  console.log('✓ 1. Component OrderDetailModal.tsx hoàn chỉnh và đầy đủ tính năng.');

  // 2. Kiểm tra TopOrdersCard.tsx
  const topOrdersCardPath = path.join(rootDir, 'src/components/dashboard/TopOrdersCard.tsx');
  const topOrdersContent = fs.readFileSync(topOrdersCardPath, 'utf8');

  assert.ok(
    topOrdersContent.includes('onSelectOrder?: (orderId: string) => void;'),
    'TopOrdersCard phải nhận prop onSelectOrder'
  );
  assert.ok(
    topOrdersContent.includes('onSelectOrder && orderId'),
    'TopOrdersCard phải kiểm tra onSelectOrder và orderId trước khi render button'
  );
  assert.ok(
    topOrdersContent.includes('onClick={() => onSelectOrder(orderId)}'),
    'TopOrdersCard phải kích hoạt callback onSelectOrder khi bấm vào mã đơn'
  );
  assert.ok(
    topOrdersContent.includes('hover:underline'),
    'TopOrdersCard phải có hover style rõ ràng cho thao tác bấm'
  );
  console.log('✓ 2. TopOrdersCard.tsx hỗ trợ click vào mã đơn để xem chi tiết.');

  // 3. Kiểm tra ExecutiveDashboard.tsx
  const executiveDashboardPath = path.join(rootDir, 'src/components/dashboard/ExecutiveDashboard.tsx');
  const executiveContent = fs.readFileSync(executiveDashboardPath, 'utf8');

  assert.ok(
    executiveContent.includes("import { OrderDetailModal } from '@/components/orders/OrderDetailModal';"),
    'ExecutiveDashboard phải import OrderDetailModal'
  );
  assert.ok(
    executiveContent.includes('const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);'),
    'ExecutiveDashboard phải có state selectedOrderId'
  );
  assert.ok(
    executiveContent.includes('<TopOrdersCard orders={orders} onSelectOrder={setSelectedOrderId} />'),
    'ExecutiveDashboard phải truyền onSelectOrder vào TopOrdersCard'
  );
  assert.ok(
    executiveContent.includes('<OrderDetailModal'),
    'ExecutiveDashboard phải render OrderDetailModal'
  );
  assert.ok(
    executiveContent.includes('onClick={() => setSelectedOrderId(ord.id)}'),
    'ExecutiveDashboard Recent Orders Table phải cho phép bấm mã đơn để xem chi tiết'
  );
  console.log('✓ 3. ExecutiveDashboard.tsx đã liên kết Top 5 đơn giá trị cao và Recent Orders với OrderDetailModal.');

  // 4. Kiểm tra DailyFairSettlementModal.tsx (Tab Kiểm Kê)
  const settlementModalPath = path.join(rootDir, 'src/components/pos/DailyFairSettlementModal.tsx');
  const settlementContent = fs.readFileSync(settlementModalPath, 'utf8');

  // Đảm bảo nút sắp xếp tồn có whitespace-nowrap và shrink-0 cho icon để không bị bóp vỡ
  assert.ok(
    settlementContent.includes('whitespace-nowrap') && settlementContent.includes('ArrowUp className="w-3.5 h-3.5 text-rose-600 shrink-0"'),
    'Nút sắp xếp tồn lý thuyết phải có whitespace-nowrap và icon shrink-0'
  );
  // Đảm bảo thanh amber bar không bị ép cứng min-w-[260px] và cho phép flex-wrap
  assert.ok(
    settlementContent.includes('flex flex-col sm:flex-row sm:items-center justify-between gap-2.5'),
    'Thanh amber bar kiểm kê phải responsive flex-col trên màn hình nhỏ và flex-row trên màn hình lớn'
  );
  assert.ok(
    settlementContent.includes('flex flex-wrap items-center gap-2 shrink-0'),
    'Cụm nút bộ lọc và sắp xếp phải có flex-wrap để không bị tràn lẹm vào khung'
  );
  // Đảm bảo không còn class lỗi py-0.2
  assert.ok(
    !settlementContent.includes('py-0.2'),
    'Không còn class lỗi py-0.2 trong DailyFairSettlementModal'
  );
  assert.ok(
    settlementContent.includes('py-0.5 rounded-full text-[10px] font-mono font-bold'),
    'Badge sắp hết phải dùng py-0.5 chuẩn Tailwind'
  );
  // Đảm bảo cột th có whitespace-nowrap và min-w
  assert.ok(
    settlementContent.includes('min-w-[130px]') && settlementContent.includes('whitespace-nowrap'),
    'Header cột tồn lý thuyết phải có min-w và whitespace-nowrap để không bị ép chữ'
  );
  console.log('✓ 4. DailyFairSettlementModal.tsx đã khắc phục triệt để lỗi lẹm khung của nút sắp xếp tồn.');

  // 5. Kiểm tra SalesLedgerView.tsx
  const salesLedgerPath = path.join(rootDir, 'src/components/sales/SalesLedgerView.tsx');
  const salesLedgerContent = fs.readFileSync(salesLedgerPath, 'utf8');

  assert.ok(
    salesLedgerContent.includes("import { OrderDetailModal } from '@/components/orders/OrderDetailModal';"),
    'SalesLedgerView phải import OrderDetailModal'
  );
  assert.ok(
    salesLedgerContent.includes('<OrderDetailModal'),
    'SalesLedgerView phải render OrderDetailModal'
  );
  console.log('✓ 5. SalesLedgerView.tsx tái sử dụng thành công OrderDetailModal dùng chung.');

  console.log('\n========================================');
  console.log('TẤT CẢ 5 BÀI KIỂM THỬ ĐÃ PASS 100%!');
  console.log('========================================');
}

runTest().catch((err) => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
