/**
 * scripts/cp3-concurrency-worker.ts (Lane B, test-only)
 *
 * Worker tiến trình con độc lập cho CP3 transfer probes (T-DS, T-RR, T-RC,
 * T-DP, T-IK và replay/conflict). Chạy qua child_process.fork từ master runner.
 *
 * Giao thức (giữ nguyên như CP2 để không phát sinh harness mới):
 * - Khởi động + nạp xong service: process.send({ type: 'READY' })
 * - Nhận { type: 'START' }: thực thi 1 action duy nhất
 * - Báo cáo: process.send({ type: 'RESULT', success, data?, error?, code? }) rồi exit(0)
 *
 * DATABASE_URL do master truyền (mỗi probe một file DB mới). Guard chặn prod.
 */
import { assertIsolatedTestDb } from './test-guard';
import { TransferService } from '../src/services/transfer.service';
import { OrderService } from '../src/services/order.service';

assertIsolatedTestDb('cp3-concurrency-worker');

interface WorkerConfig {
  action: 'dispatch' | 'receive' | 'cancel' | 'directTransfer' | 'createOrder';
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
      if (config.action === 'dispatch') {
        result = await TransferService.dispatch(config.payload);
      } else if (config.action === 'receive') {
        result = await TransferService.receive(config.payload);
      } else if (config.action === 'cancel') {
        result = await TransferService.cancel(
          config.payload.shipmentId,
          config.payload.actorId || 'cp3-probe'
        );
      } else if (config.action === 'directTransfer') {
        // CP3-A chưa có service direct-transfer riêng: chuyển tiếp sang dispatch
        // kèm meta actorRole/pair để probe fail-closed ghi nhận expected-red.
        result = await TransferService.dispatch(config.payload as any);
      } else if (config.action === 'createOrder') {
        result = await OrderService.createOrder(config.payload);
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

if (process.send) {
  process.send({ type: 'READY' });
}
