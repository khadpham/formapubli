/**
 * scripts/cp3-concurrency-worker.ts (Lane B, test-only — CP3-B1.1)
 *
 * Worker tiến trình con độc lập cho CP3 transfer probes. Chạy qua
 * child_process.fork từ master runner.
 *
 * Giao thức: READY khi nạp xong → chờ START → thực thi 1 action →
 * RESULT { success, data?, error?, code? } rồi exit(0).
 *
 * CP3-B1.1: mọi action tự dựng actorContext từ payload (vai trò Lane B:
 * harness tin cậy hành xử như route sau auth) và gọi đúng service CP3 chuẩn:
 * - dispatch/receive/cancel -> TransferService (actorContext + key bắt buộc)
 * - directTransfer -> InventoryService.transfer (actorContext OWNER/MANAGER +
 *   key + allowlist tại service)
 *
 * DATABASE_URL + ALLOWLIST_EXTRA_ENV do master truyền (mỗi probe DB mới).
 */
import { assertIsolatedTestDb } from './test-guard';
import { TransferService } from '../src/services/transfer.service';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { toActorContext } from '../src/services/actor-context';

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

/** Dựng actorContext CP3 chuẩn từ payload (staffId + role tường minh). */
function actorOf(payload: any, fallbackRole: 'ROLE_OWNER' | 'ROLE_MANAGER' | 'ROLE_WAREHOUSE' = 'ROLE_MANAGER') {
  const staffId =
    payload.actorStaffId || payload.dispatcherId || payload.receiverId || payload.actorId || payload.cashierId || 'cp3-worker';
  const role = payload.actorRole || fallbackRole;
  return toActorContext(staffId, role);
}

process.on('message', async (msg: any) => {
  if (msg?.type === 'START') {
    try {
      let result: any = null;
      if (config.action === 'dispatch') {
        const { dispatcherId, actorRole, ...rest } = config.payload;
        void dispatcherId;
        void actorRole;
        result = await TransferService.dispatch({ ...rest, actorContext: actorOf(config.payload) });
      } else if (config.action === 'receive') {
        const { receiverId, ...rest } = config.payload;
        void receiverId;
        result = await TransferService.receive({ ...rest, actorContext: actorOf(config.payload) });
      } else if (config.action === 'cancel') {
        const { actorId, ...rest } = config.payload;
        void actorId;
        result = await TransferService.cancel({ ...rest, actorContext: actorOf(config.payload) });
      } else if (config.action === 'directTransfer') {
        // CP3-B1.1: direct transfer đi InventoryService.transfer (1 bước,
        // allowlist + role tại service), KHÔNG giả lập qua dispatch.
        const p = config.payload;
        result = await InventoryService.transfer({
          editionId: p.editionId,
          fromWarehouseId: p.fromWarehouseId,
          toWarehouseId: p.toWarehouseId,
          quantity: p.quantity,
          condition: p.condition || 'NEW',
          documentRef: p.documentRef,
          note: p.note || '',
          idempotencyKey: p.idempotencyKey,
          actorContext: actorOf(p, 'ROLE_OWNER'),
        });
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
