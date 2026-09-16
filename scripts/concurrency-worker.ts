/**
 * scripts/concurrency-worker.ts
 *
 * Worker tiến trình con độc lập phục vụ kiểm thử tranh chấp đồng thời (Concurrency Probes A - E).
 * Được gọi qua child_process.fork / spawn từ master runner.
 *
 * Giao thức giao tiếp:
 * - Khi khởi động và nạp xong: process.send({ type: 'READY' })
 * - Nhận lệnh bắt đầu: process.on('message', { type: 'START' })
 * - Thực thi tác vụ (createOrder, confirmOrder, cancelOrder)
 * - Báo cáo kết quả: process.send({ type: 'RESULT', success: boolean, data?: any, error?: string, code?: string })
 */
import { assertIsolatedTestDb } from './test-guard';
import { OrderService } from '../src/services/order.service';
import { toActorContext } from '../src/services/actor-context';

assertIsolatedTestDb('concurrency-worker');

interface WorkerConfig {
  action: 'createOrder' | 'confirmOrder' | 'cancelOrder';
  payload: any;
}

const configArg = process.env.WORKER_CONFIG;
if (!configArg) {
  console.error('WORKER_CONFIG env var is missing');
  process.exit(1);
}

const config: WorkerConfig = JSON.parse(configArg);

process.on('message', async (msg: any) => {
  if (msg?.type === 'START') {
    try {
      let result: any = null;
      if (config.action === 'createOrder') {
        result = await OrderService.createOrder(config.payload);
      } else if (config.action === 'confirmOrder') {
        const actor = toActorContext(config.payload.staffId || 'mgr-1', config.payload.role || 'ROLE_MANAGER');
        result = await OrderService.confirmOrder(
          config.payload.orderId,
          config.payload.role || 'ROLE_MANAGER',
          config.payload.staffId || 'mgr-1',
          actor
        );
      } else if (config.action === 'cancelOrder') {
        const actor = toActorContext(config.payload.staffId || 'mgr-1', config.payload.role || 'ROLE_MANAGER');
        result = await OrderService.cancelOrder(
          config.payload.orderId,
          config.payload.role || 'ROLE_MANAGER',
          config.payload.reason || 'Concurrently cancelled',
          actor
        );
      } else {
        throw new Error(`Unknown action: ${config.action}`);
      }

      if (process.send) {
        process.send({ type: 'RESULT', success: true, data: result });
      }
      process.exit(0);
    } catch (err: any) {
      if (process.send) {
        process.send({
          type: 'RESULT',
          success: false,
          error: err?.message || String(err),
          code: err?.code || err?.name,
        });
      }
      process.exit(0);
    }
  }
});

// Báo hiệu đã nạp xong và sẵn sàng chờ còi lệnh
if (process.send) {
  process.send({ type: 'READY' });
}
