/**
 * scripts/cp3-return-complete-worker.ts (Lane A CP3-R2, test-only)
 *
 * Worker tiến trình con độc lập cho CP3-R2 complete probes (REFUND-only).
 * Mọi action tự dựng actorContext CP3 chuẩn từ payload.
 * Thêm 'openCashbox'/'closeCashbox' để dựng phiên két cho R-CASH.
 */
import { assertIsolatedTestDb } from './test-guard';
import { ReturnService } from '../src/services/return.service';
import { OrderService, CashboxService } from '../src/services/order.service';
import { toActorContext } from '../src/services/actor-context';

assertIsolatedTestDb('cp3-return-complete-worker');

interface WorkerConfig {
  action: 'request' | 'approve' | 'complete' | 'void' | 'createOrder' | 'openCashbox' | 'closeCashbox';
  payload: any;
}

const configArg = process.env.WORKER_CONFIG;
if (!configArg) {
  console.error('WORKER_CONFIG env var is missing');
  process.exit(1);
}

const config: WorkerConfig = JSON.parse(configArg);

function actorOf(payload: any, fallbackRole: 'ROLE_OWNER' | 'ROLE_MANAGER' | 'ROLE_CASHIER' = 'ROLE_MANAGER') {
  const staffId = payload.actorStaffId || payload.cashierId || 'cp3-r2-worker';
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
      } else if (config.action === 'complete') {
        const p = config.payload;
        const ctx = p.noActorContext ? undefined : actorOf(p);
        result = await ReturnService.complete(
          p.returnId, ctx?.role || p.actorRole, p.exchangeItems, ctx, p.idempotencyKey
        );
      } else if (config.action === 'void') {
        const p = config.payload;
        const ctx = p.noActorContext ? undefined : actorOf(p);
        const key = p.idempotencyKey || `idem-void-${p.returnId}-${ctx?.staffId || p.actorStaffId || 'mgr'}`;
        result = await ReturnService.voidReturn(
          p.returnId, ctx?.role || p.actorRole, p.voidReason || 'LaneB adversarial void', ctx, key
        );
      } else if (config.action === 'createOrder') {
        result = await OrderService.createOrder(config.payload);
      } else if (config.action === 'openCashbox') {
        const p = config.payload;
        result = await CashboxService.openSession({
          warehouseId: p.warehouseId, cashierId: p.cashierId, openingCash: p.openingCash || 0,
        });
      } else if (config.action === 'closeCashbox') {
        const p = config.payload;
        result = await CashboxService.closeSession({ sessionId: p.sessionId, closingCashActual: 0 });
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
