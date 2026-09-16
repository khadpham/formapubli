/**
 * scripts/cp3-return-concurrency-worker.ts (Lane A CP3-R1, test-only)
 *
 * Worker tiến trình con độc lập cho CP3 return probes (R-QQ, R-AR, R-I1).
 * Chạy qua child_process.fork từ master runner.
 *
 * Giao thức: READY khi nạp xong → chờ START → thực thi 1 action →
 * RESULT { success, data?, error?, code? } rồi exit(0).
 *
 * Mọi action tự dựng actorContext CP3 chuẩn từ payload (harness tin cậy
 * hành xử như route sau auth). DATABASE_URL do master truyền (mỗi probe DB mới).
 */
import { assertIsolatedTestDb } from './test-guard';
import { ReturnService } from '../src/services/return.service';
import { OrderService } from '../src/services/order.service';
import { toActorContext } from '../src/services/actor-context';

assertIsolatedTestDb('cp3-return-concurrency-worker');

interface WorkerConfig {
  action: 'request' | 'approve' | 'reject' | 'createOrder';
  payload: any;
}

const configArg = process.env.WORKER_CONFIG;
if (!configArg) {
  console.error('WORKER_CONFIG env var is missing');
  process.exit(1);
}

const config: WorkerConfig = JSON.parse(configArg);

function actorOf(payload: any, fallbackRole: 'ROLE_OWNER' | 'ROLE_MANAGER' | 'ROLE_CASHIER' = 'ROLE_MANAGER') {
  const staffId = payload.actorStaffId || payload.cashierId || payload.createdBy || 'cp3-ret-worker';
  const role = payload.actorRole || fallbackRole;
  return toActorContext(staffId, role);
}

process.on('message', async (msg: any) => {
  if (msg?.type === 'START') {
    try {
      let result: any = null;
      if (config.action === 'request') {
        const p = config.payload;
        result = await ReturnService.createRequest({ ...p, actorContext: actorOf(p, 'ROLE_CASHIER') });
      } else if (config.action === 'approve') {
        const p = config.payload;
        const ctx = actorOf(p);
        result = await ReturnService.approve(p.returnId, ctx.role, ctx.staffId, ctx, p.idempotencyKey);
      } else if (config.action === 'reject') {
        const p = config.payload;
        const ctx = actorOf(p);
        result = await ReturnService.reject(p.returnId, ctx.role, p.rejectNote, ctx, p.idempotencyKey);
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
