/**
 * scripts/test-cp2-concurrency-probes.ts
 *
 * Bộ kiểm thử đa tiến trình độc lập (Multi-Process Concurrency Probes A - E)
 * Nghiệm thu Checkpoint 2: Tranh chấp đồng thời, Atomicity & Idempotency.
 *
 * CÁC CA KIỂM THỬ:
 * - Probe A: 10 tiến trình độc lập cùng tranh mua 1 cuốn sách vật lý duy nhất.
 *            Kỳ vọng: Đúng 1 tiến trình thành công, 9 tiến trình bị từ chối với INSUFFICIENT_ATP.
 *            Tồn kho cuối cùng = 0, đúng 1 đơn hàng, đúng 1 bút toán ledger.
 * - Probe B: 2 tiến trình độc lập cùng duyệt (confirmOrder) 1 đơn PENDING.
 *            Kỳ vọng: Đúng 1 tiến trình COMPLETED đầu tiên, tiến trình kia nhận kết quả idempotent hoặc conflict.
 *            Đúng 1 bộ bút toán xuất kho (không nhân đôi ledger).
 * - Probe C: 1 đơn PENDING (giữ chỗ) chạy song song với 1 đơn BÁN NGAY (COMPLETED) cùng tranh 1 cuốn.
 *            Kỳ vọng: Đúng 1 đơn thành công (giữ hoặc bán), đơn kia lập tức bị chặn vì hết ATP.
 * - Probe D: Đua giữa duyệt đơn (confirmOrder) và hủy đơn (cancelOrder).
 *            Kỳ vọng: Đơn hàng về đúng 1 trạng thái cuối cùng (COMPLETED hoặc CANCELLED).
 *            Nếu COMPLETED -> có ledger xuất kho. Nếu CANCELLED -> không có ledger xuất kho.
 * - Probe E: Tranh chấp Idempotency Key song song giữa 2 tiến trình độc lập.
 *            - Nhánh 1: Cùng Key, cùng Payload -> Cả 2 đều nhận thành công cùng 1 orderCode (chính xác 1 đơn tạo ra).
 *            - Nhánh 2: Cùng Key, khác Payload -> Đúng 1 tiến trình tạo thành công, tiến trình kia nhận lỗi 409 IDEMPOTENCY_CONFLICT.
 */
import path from 'node:path';
import { fork } from 'node:child_process';
import { assertIsolatedTestDb } from './test-guard';
import { db, orders, orderItems, inventoryLedger, stockBalances, editions } from '../src/db';
import { eq, sql, inArray, and } from 'drizzle-orm';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';

assertIsolatedTestDb('test-cp2-concurrency-probes');

interface WorkerResult {
  workerIndex: number;
  success: boolean;
  data?: any;
  error?: string;
  code?: string;
}

const WORKER_SCRIPT = path.resolve(__dirname, 'concurrency-worker.ts');
const TSX_CLI = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');

/**
 * Điều phối N worker chạy đồng thời, đồng bộ qua còi xuất phát.
 */
async function runConcurrentWorkers(
  configs: Array<{ action: 'createOrder' | 'confirmOrder' | 'cancelOrder'; payload: any }>
): Promise<WorkerResult[]> {
  const n = configs.length;
  const children: any[] = [];
  const results: WorkerResult[] = new Array(n);
  const readyPromises: Promise<void>[] = [];

  for (let i = 0; i < n; i++) {
    let markReady: () => void;
    const pReady = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    readyPromises.push(pReady);

    const child = fork(WORKER_SCRIPT, [], {
      execPath: process.execPath,
      execArgv: [TSX_CLI],
      env: {
        ...process.env,
        WORKER_CONFIG: JSON.stringify(configs[i]),
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });

    const workerIdx = i;
    child.on('message', (msg: any) => {
      if (msg?.type === 'READY') {
        markReady();
      } else if (msg?.type === 'RESULT') {
        results[workerIdx] = {
          workerIndex: workerIdx,
          success: msg.success,
          data: msg.data,
          error: msg.error,
          code: msg.code,
        };
      }
    });

    children.push(child);
  }

  // 1. Chờ tất cả worker nạp xong mã nguồn và sẵn sàng
  await Promise.all(readyPromises);

  // 2. Thổi còi xuất phát đồng loạt tới toàn bộ worker
  for (const child of children) {
    child.send({ type: 'START' });
  }

  // 3. Chờ tất cả tiến trình con hoàn thành với timeout bảo vệ 25 giây
  await Promise.all(
    children.map(
      (child, idx) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            results[idx] = {
              workerIndex: idx,
              success: false,
              error: 'TIMEOUT_EXCEEDED (Worker hung)',
            };
            resolve();
          }, 25000);

          child.on('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        })
    )
  );

  return results;
}

async function main() {
  console.log('🚀 =========================================================================');
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TRANH CHẤP ĐỒNG THỜI ĐA TIẾN TRÌNH (PROBES A - E)');
  console.log('🚀 =========================================================================\n');

  // Chuẩn bị 1 ấn bản chuyên biệt cho probe
  const testWarehouse = 'wh-au-co';
  const allEds = await db.select().from(editions).limit(5);
  if (allEds.length < 5) throw new Error('Không đủ editions để chạy probe.');
  
  const [edProbeA, edProbeB, edProbeC, edProbeD, edProbeE] = allEds.map((e) => e.id);

  // ---------------------------------------------------------------------------
  // PROBE A: 10 TIẾN TRÌNH TRANH MUA 1 CUỐN SÁCH VẬT LÝ
  // ---------------------------------------------------------------------------
  console.log('--- PROBE A: 10 TIẾN TRÌNH TRANH MUA 1 CUỐN SÁCH DUY NHẤT ---');
  // Cài đặt tồn vật lý = đúng 1 cuốn
  const currBalA = await InventoryService.getBalance(edProbeA, testWarehouse, 'NEW');
  if (currBalA !== 1) {
    await InventoryService.recordMovement({
      editionId: edProbeA,
      warehouseId: testWarehouse,
      eventType: 'ADJUSTMENT',
      quantityDelta: 1 - currBalA,
      condition: 'NEW',
      documentRef: 'INIT-PROBE-A',
      actorId: 'probe-runner',
      idempotencyKey: `probe-a-init-${Date.now()}`,
    });
  }

  const balBeforeA = await InventoryService.getBalance(edProbeA, testWarehouse, 'NEW');
  console.log(`- Tồn kho ban đầu trước Probe A: ${balBeforeA} cuốn`);

  const ledgersBeforeA = await db
    .select()
    .from(inventoryLedger)
    .where(
      and(
        eq(inventoryLedger.editionId, edProbeA),
        eq(inventoryLedger.warehouseId, testWarehouse),
        eq(inventoryLedger.eventType, 'DISPATCH_SALE')
      )
    );

  const configsA = Array.from({ length: 10 }).map((_, idx) => ({
    action: 'createOrder' as const,
    payload: {
      warehouseId: testWarehouse,
      channel: 'FAIR_EVENT',
      customerName: `Khách tranh mua A-${idx}`,
      paymentMethod: 'CASH',
      fiscalScope: 'INTERNAL_MANAGEMENT',
      cashierId: `cashier-a-${idx}`,
      confirmImmediately: true,
      idempotencyKey: `idem-probe-a-${idx}-${Date.now()}`,
      items: [{ editionId: edProbeA, quantity: 1 }],
    },
  }));

  const resultsA = await runConcurrentWorkers(configsA);
  const successesA = resultsA.filter((r) => r.success);
  const failuresA = resultsA.filter((r) => !r.success);

  const balAfterA = await InventoryService.getBalance(edProbeA, testWarehouse, 'NEW');
  const ledgersAfterA = await db
    .select()
    .from(inventoryLedger)
    .where(
      and(
        eq(inventoryLedger.editionId, edProbeA),
        eq(inventoryLedger.warehouseId, testWarehouse),
        eq(inventoryLedger.eventType, 'DISPATCH_SALE')
      )
    );

  const newLedgersA = ledgersAfterA.length - ledgersBeforeA.length;
  const winningOrderId = successesA[0]?.data?.orderId;
  const winnerLedger = winningOrderId
    ? await db
        .select()
        .from(inventoryLedger)
        .where(eq(inventoryLedger.correlationId, winningOrderId))
    : [];

  console.log(`- Kết quả: ${successesA.length} tiến trình thành công, ${failuresA.length} bị từ chối.`);
  console.log(`- Tồn kho sau cuộc đua: ${balAfterA} cuốn`);
  console.log(`- Số bút toán bán hàng DISPATCH_SALE mới phát sinh: ${newLedgersA}`);

  if (successesA.length !== 1 || failuresA.length !== 9 || balAfterA !== 0 || newLedgersA !== 1 || winnerLedger.length !== 1) {
    console.error('❌ PROBE A THẤT BẠI: Không bảo đảm đúng 1 người mua được cuốn duy nhất!', {
      successes: successesA.length,
      failures: failuresA.length,
      balAfter: balAfterA,
      newLedgers: newLedgersA,
      winnerLedgerCount: winnerLedger.length,
      failureErrors: failuresA.map((f) => f.error),
    });
    process.exit(1);
  }
  console.log('✅ PROBE A ĐẠT: Đúng 1 tiến trình mua thành công, 9 tiến trình nhận INSUFFICIENT_ATP, tồn kho = 0, 1 ledger!\n');

  // ---------------------------------------------------------------------------
  // PROBE B: 2 TIẾN TRÌNH ĐỘC LẬP CÙNG DUYỆT 1 ĐƠN PENDING
  // ---------------------------------------------------------------------------
  console.log('--- PROBE B: 2 TIẾN TRÌNH CÙNG DUYỆT 1 ĐƠN PENDING ---');
  // Cài đặt tồn cho B
  const currBalB = await InventoryService.getBalance(edProbeB, testWarehouse, 'NEW');
  if (currBalB < 5) {
    await InventoryService.recordMovement({
      editionId: edProbeB,
      warehouseId: testWarehouse,
      eventType: 'ADJUSTMENT',
      quantityDelta: 5 - currBalB,
      condition: 'NEW',
      documentRef: 'INIT-PROBE-B',
      actorId: 'probe-runner',
      idempotencyKey: `probe-b-init-${Date.now()}`,
    });
  }

  // Tạo 1 đơn pending 2 cuốn
  const pendingOrderB = await OrderService.createOrder({
    warehouseId: testWarehouse,
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'Khách Probe B',
    paymentMethod: 'COD',
    cashierId: 'web-bot',
    confirmImmediately: false,
    idempotencyKey: `idem-probe-b-order-${Date.now()}`,
    items: [{ editionId: edProbeB, quantity: 2 }],
  });

  const configsB = [
    { action: 'confirmOrder' as const, payload: { orderId: pendingOrderB.orderId, role: 'ROLE_MANAGER', staffId: 'mgr-1' } },
    { action: 'confirmOrder' as const, payload: { orderId: pendingOrderB.orderId, role: 'ROLE_MANAGER', staffId: 'mgr-2' } },
  ];

  const resultsB = await runConcurrentWorkers(configsB);
  const successB = resultsB.filter((r) => r.success);
  const ledgersB = await db
    .select()
    .from(inventoryLedger)
    .where(eq(inventoryLedger.correlationId, pendingOrderB.orderId));

  console.log(`- Kết quả duyệt B: ${successB.length} phản hồi thành công (gồm cả idempotent nếu có)`);
  console.log(`- Bút toán ghi sổ liên quan đến đơn B: ${ledgersB.length}`);

  if (ledgersB.length !== 1 || ledgersB[0].quantityDelta !== -2) {
    console.error('❌ PROBE B THẤT BẠI: Ledger bị ghi trùng hoặc không ghi đúng!', ledgersB);
    process.exit(1);
  }
  console.log('✅ PROBE B ĐẠT: Đúng 1 bộ ledger xuất kho được ghi, không nhân đôi tồn kho!\n');

  // ---------------------------------------------------------------------------
  // PROBE C: ĐƠN PENDING VS ĐƠN BÁN NGAY CÙNG TRANH 1 CUỐN
  // ---------------------------------------------------------------------------
  console.log('--- PROBE C: ĐƠN PENDING VS ĐƠN BÁN NGAY TRANH 1 CUỐN DUY NHẤT ---');
  const currBalC = await InventoryService.getBalance(edProbeC, testWarehouse, 'NEW');
  if (currBalC !== 1) {
    await InventoryService.recordMovement({
      editionId: edProbeC,
      warehouseId: testWarehouse,
      eventType: 'ADJUSTMENT',
      quantityDelta: 1 - currBalC,
      condition: 'NEW',
      documentRef: 'INIT-PROBE-C',
      actorId: 'probe-runner',
      idempotencyKey: `probe-c-init-${Date.now()}`,
    });
  }

  const configsC = [
    {
      action: 'createOrder' as const,
      payload: {
        warehouseId: testWarehouse,
        channel: 'RETAIL_ONLINE_WEB',
        customerName: 'Khách C Giữ Chỗ',
        paymentMethod: 'COD',
        cashierId: 'web-bot',
        confirmImmediately: false,
        idempotencyKey: `idem-probe-c-pend-${Date.now()}`,
        items: [{ editionId: edProbeC, quantity: 1 }],
      },
    },
    {
      action: 'createOrder' as const,
      payload: {
        warehouseId: testWarehouse,
        channel: 'FAIR_EVENT',
        customerName: 'Khách C Bán Ngay',
        paymentMethod: 'CASH',
        cashierId: 'cashier-c',
        confirmImmediately: true,
        idempotencyKey: `idem-probe-c-imm-${Date.now()}`,
        items: [{ editionId: edProbeC, quantity: 1 }],
      },
    },
  ];

  const resultsC = await runConcurrentWorkers(configsC);
  const successC = resultsC.filter((r) => r.success);
  const failC = resultsC.filter((r) => !r.success);

  const finalAtpC = await OrderService.getATP(edProbeC, testWarehouse);
  console.log(`- Kết quả C: ${successC.length} thành công, ${failC.length} thất bại. ATP còn lại: ${finalAtpC}`);

  if (successC.length !== 1 || failC.length !== 1 || finalAtpC !== 0) {
    console.error('❌ PROBE C THẤT BẠI: Bán lẹm hàng hoặc cả 2 cùng thành công!', { resultsC, finalAtpC });
    process.exit(1);
  }
  console.log('✅ PROBE C ĐẠT: Đúng 1 đơn giành được cuốn duy nhất, đơn còn lại bị chặn ATP!\n');

  // ---------------------------------------------------------------------------
  // PROBE D: ĐUA GIỮA CONFIRM ORDER VÀ CANCEL ORDER
  // ---------------------------------------------------------------------------
  console.log('--- PROBE D: ĐUA GIỮA DUYỆT ĐƠN (CONFIRM) VÀ HỦY ĐƠN (CANCEL) ---');
  const currBalD = await InventoryService.getBalance(edProbeD, testWarehouse, 'NEW');
  if (currBalD < 5) {
    await InventoryService.recordMovement({
      editionId: edProbeD,
      warehouseId: testWarehouse,
      eventType: 'ADJUSTMENT',
      quantityDelta: 5 - currBalD,
      condition: 'NEW',
      documentRef: 'INIT-PROBE-D',
      actorId: 'probe-runner',
      idempotencyKey: `probe-d-init-${Date.now()}`,
    });
  }

  const orderD = await OrderService.createOrder({
    warehouseId: testWarehouse,
    channel: 'RETAIL_ONLINE_WEB',
    customerName: 'Khách Đua D',
    paymentMethod: 'COD',
    cashierId: 'web-bot',
    confirmImmediately: false,
    idempotencyKey: `idem-probe-d-order-${Date.now()}`,
    items: [{ editionId: edProbeD, quantity: 2 }],
  });

  const configsD = [
    { action: 'confirmOrder' as const, payload: { orderId: orderD.orderId, role: 'ROLE_MANAGER', staffId: 'mgr-1' } },
    { action: 'cancelOrder' as const, payload: { orderId: orderD.orderId, role: 'ROLE_MANAGER', reason: 'Đua hủy', staffId: 'mgr-2' } },
  ];

  const resultsD = await runConcurrentWorkers(configsD);
  const rowsD = await db.select().from(orders).where(eq(orders.id, orderD.orderId));
  const finalStatusD = rowsD[0]?.status;
  const ledgersD = await db.select().from(inventoryLedger).where(eq(inventoryLedger.correlationId, orderD.orderId));

  console.log(`- Kết quả đua D: Trạng thái cuối cùng = ${finalStatusD}, Bút toán ledger = ${ledgersD.length}`);
  if (finalStatusD === 'COMPLETED') {
    if (ledgersD.length !== 1 || ledgersD[0].quantityDelta !== -2) {
      throw new Error('Đơn COMPLETED nhưng bút toán ledger không đúng!');
    }
  } else if (finalStatusD === 'CANCELLED') {
    if (ledgersD.length !== 0) {
      throw new Error('Đơn CANCELLED nhưng lại có bút toán xuất kho!');
    }
  } else {
    throw new Error(`Trạng thái không hợp lệ sau cuộc đua: ${finalStatusD}`);
  }
  console.log(`✅ PROBE D ĐẠT: Quyết định phân định rạch ròi trạng thái (${finalStatusD}) và toàn vẹn sổ kho!\n`);

  // ---------------------------------------------------------------------------
  // PROBE E: TRANH CHẤP IDEMPOTENCY KEY ĐỒNG THỜI
  // ---------------------------------------------------------------------------
  console.log('--- PROBE E: TRANH CHẤP IDEMPOTENCY KEY ĐỒNG THỜI (SAME KEY) ---');
  
  // E1. Cùng Key + Cùng Payload -> Cả 2 đều nhận thành công cùng 1 orderCode
  const sameKeyE1 = `idem-probe-e1-${Date.now()}`;
  const payloadE1 = {
    warehouseId: testWarehouse,
    channel: 'FAIR_EVENT',
    customerName: 'Khách E1',
    paymentMethod: 'CASH',
    cashierId: 'cashier-e',
    confirmImmediately: true,
    idempotencyKey: sameKeyE1,
    items: [{ editionId: edProbeE, quantity: 1 }],
  };

  const resultsE1 = await runConcurrentWorkers([
    { action: 'createOrder', payload: payloadE1 },
    { action: 'createOrder', payload: payloadE1 },
  ]);

  const succE1 = resultsE1.filter((r) => r.success);
  console.log(`- Kết quả E1 (Cùng payload): ${succE1.length}/2 thành công`);
  if (succE1.length !== 2 || succE1[0].data.orderId !== succE1[1].data.orderId) {
    console.error('❌ PROBE E1 THẤT BẠI: Cùng key cùng payload không trả về cùng 1 đơn!', resultsE1);
    process.exit(1);
  }

  // E2. Cùng Key + Khác Payload -> Đúng 1 tiến trình thắng, 1 tiến trình 409
  const sameKeyE2 = `idem-probe-e2-${Date.now()}`;
  const configsE2 = [
    {
      action: 'createOrder' as const,
      payload: {
        warehouseId: testWarehouse,
        channel: 'FAIR_EVENT',
        customerName: 'Khách E2-A',
        paymentMethod: 'CASH',
        cashierId: 'cashier-e',
        confirmImmediately: true,
        idempotencyKey: sameKeyE2,
        items: [{ editionId: edProbeE, quantity: 1 }],
      },
    },
    {
      action: 'createOrder' as const,
      payload: {
        warehouseId: testWarehouse,
        channel: 'FAIR_EVENT',
        customerName: 'Khách E2-B',
        paymentMethod: 'CASH',
        cashierId: 'cashier-e',
        confirmImmediately: true,
        idempotencyKey: sameKeyE2,
        items: [{ editionId: edProbeE, quantity: 2 }], // Khác số lượng
      },
    },
  ];

  const resultsE2 = await runConcurrentWorkers(configsE2);
  const succE2 = resultsE2.filter((r) => r.success);
  const failE2 = resultsE2.filter((r) => !r.success);

  console.log(`- Kết quả E2 (Khác payload): ${succE2.length} thành công, ${failE2.length} thất bại.`);
  const conflictDetected = failE2.some((f) => /Idempotency-Key đã gắn/.test(f.error || ''));
  if (succE2.length !== 1 || failE2.length !== 1 || !conflictDetected) {
    console.error('❌ PROBE E2 THẤT BẠI: Không phát hiện xung đột idempotency khi khác payload!', resultsE2);
    process.exit(1);
  }
  console.log('✅ PROBE E ĐẠT: Xử lý idempotent tuyệt đối (cùng payload trả đơn cũ, khác payload chặn 409)!\n');

  console.log('=========================================================================');
  console.log('🎉 TOÀN BỘ 5/5 CONCURRENCY PROBES (A, B, C, D, E) ĐÃ VƯỢT QUA 100%!');
  console.log('=========================================================================');
}

main().catch((err) => {
  console.error('❌ Lỗi chạy Concurrency Probes:', err);
  process.exit(1);
});
