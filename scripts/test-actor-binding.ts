/**
 * Chống mạo danh actor (DB cách ly, AUTH_STRICT=true).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-actor-binding
 * 5 cases: settlements receivedBy / rma inspectedBy + resolve header spoof /
 * royalties createdBy / consignments record-sale — body/header 'mallory'
 * đều bị ép về session.actorId, audit ghi đúng người.
 */
import { db, editions, works, auditLogs, rightsContracts } from '../src/db';
import { eq, desc } from 'drizzle-orm';
import { InventoryService } from '../src/services/inventory.service';
import { ConsignmentService } from '../src/services/consignment.service';
import { SettlementService } from '../src/services/settlement.service';
import { toActorContext } from '../src/services/actor-context';
import { POST as postSettlements } from '../src/app/api/settlements/route';
import { POST as postRma } from '../src/app/api/rma/route';
import { POST as postRoyalties } from '../src/app/api/royalties/route';
import { POST as postConsignments } from '../src/app/api/consignments/route';
import { GET as getCashbox, POST as postCashbox } from '../src/app/api/cashbox/route';
import { POST as postLogin } from '../src/app/api/auth/login/route';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-actor-binding');

process.env.AUTH_SECRET = 'test-actor-binding-secret-32chars!!';
process.env.AUTH_STRICT = 'true';

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const J = (o: any) => JSON.stringify(o);

const post = (fn: any, body: any, headers: Record<string, string> = {}) =>
  fn(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: J(body),
    }) as any
  ).then(async (r: any) => ({ status: r.status, body: await r.json(), headers: r.headers }));

function sessionCookie(setCookie: string | null): string {
  const m = `${setCookie || ''}`.match(/formapubli_session=([^;]+)/);
  return m ? `formapubli_session=${m[1]}` : '';
}

async function loginAs(staffId: string, passcode: string) {
  const r: any = await post(postLogin, { staffId, passcode });
  return sessionCookie(r.headers.get('set-cookie'));
}

async function run() {
  console.log('🛡️ CHỐNG MẠO DANH ACTOR (DB cách ly, AUTH_STRICT=true)');
  let passed = 0;
  const total = 8;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  const book = (await db.select().from(editions).limit(1))[0];
  await InventoryService.recordMovement({
    editionId: book.id, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: 50,
    condition: 'NEW', documentRef: 'BIND-PREP', actorId: 'setup',
    idempotencyKey: uniq('bind-prep'),
  });

  // Dựng kỳ CONFIRMED để thu tiền (qua service nội bộ).
  const MCTX = (id: string) => toActorContext(id, 'ROLE_MANAGER');
  const sent = await ConsignmentService.sendToConsignment({
    partnerId: 'part-mao-dinh-le', fromWarehouseId: 'wh-au-co',
    actorContext: MCTX('kho-test'), idempotencyKey: uniq('bind-send'),
    items: [{ editionId: book.id, quantity: 10 }],
  });
  await ConsignmentService.confirmConsignmentReceipt({
    shipmentId: sent.shipmentId, actorContext: MCTX('xe-test'), idempotencyKey: uniq('bind-recv'),
  });
  const stmt = await ConsignmentService.createStatement({
    partnerId: 'part-mao-dinh-le', periodStart: '2026-09-01', periodEnd: '2026-09-30',
    createdBy: 'setup-test',
  });
  await ConsignmentService.recordSale({
    statementId: stmt.statementId, editionId: book.id, quantity: 4, actorId: 'setup-test',
  });
  await ConsignmentService.confirm(stmt.statementId, 'setup-test');

  const cashierCk = { Cookie: await loginAs('NV-01', '1234') };
  const keeperCk = { Cookie: await loginAs('KHO-01', '5678') };
  const managerCk = { Cookie: await loginAs('QL-01', '8888') };
  const ownerCk = { Cookie: await loginAs('ADMIN-01', '9999') };

  // 1. Thu tiền ghi receivedBy:'mallory' → DB ép về NV-01.
  const ref1 = `BIND-${Date.now()}`;
  const r1: any = await post(
    postSettlements,
    {
      action: 'record', statementId: stmt.statementId, amount: 10000,
      paymentMethod: 'CASH', reference: ref1, receivedBy: 'mallory',
    },
    cashierCk
  );
  const bal = await SettlementService.getBalance(stmt.statementId);
  const pay = (await SettlementService.listPayments({ statementId: stmt.statementId })).find(
    (p: any) => p.reference === ref1
  ) as any;
  ok(
    '1. receivedBy spoof bị ép về NV-01',
    r1.status === 200 && pay && pay.receivedBy === 'NV-01' && bal.paid === 10000,
    `receivedBy=${pay?.receivedBy}`
  );

  // 2. Lập RMA ghi inspectedBy:'mallory' → ép về KHO-01.
  const r2: any = await post(
    postRma,
    {
      warehouseId: 'wh-au-co', editionId: book.id, quantity: 1,
      defectReason: 'PRINT_DEFECT', inspectedBy: 'mallory',
    },
    keeperCk
  );
  const { RmaService } = await import('../src/services/rma.service');
  const tickets = await RmaService.listTickets({ warehouseId: 'wh-au-co' });
  const mine = tickets.find((t: any) => t.id === r2.body?.data?.id) as any;
  ok(
    '2. inspectedBy spoof bị ép về KHO-01',
    r2.status === 200 && mine && mine.inspectedBy === 'KHO-01',
    `inspectedBy=${mine?.inspectedBy}`
  );

  // 3. Resolve RMA với header x-formapubli-actor:'mallory' → audit ép về QL-01.
  const r3: any = await post(
    postRma,
    { action: 'resolve', ticketId: mine.id, resolutionAction: 'HOLD_IN_QUARANTINE' },
    { ...managerCk, 'x-formapubli-actor': 'mallory' }
  );
  const rmaAudits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.resource, '/api/rma'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(5);
  const resolveAudit = rmaAudits.find((a: any) => `${a.details || ''}`.includes(mine.id));
  const resolveActor = `${resolveAudit?.actorId || ''}`;
  ok(
    '3. Header actor spoof bị ép về QL-01',
    r3.status === 200 && !!resolveAudit && resolveActor === 'QL-01',
    `audit.actor=${resolveActor}`
  );

  // 4. Ký HĐ bản quyền ghi createdBy:'mallory' → DB ép về ADMIN-01.
  const wid = `wbind-${Date.now()}`;
  await db.insert(works).values({ id: wid, code: wid, title: wid, author: 'Bind' }).catch(() => {});
  const contractNo = `BIND-${Date.now()}`;
  const r4: any = await post(
    postRoyalties,
    {
      action: 'create', contractNumber: contractNo, workId: wid,
      royaltyRate: 0.1, printQuota: 1000, effectiveDate: '2026-01-01',
      expirationDate: '2031-01-01', createdBy: 'mallory',
    },
    ownerCk
  );
  const saved = (
    await db.select().from(rightsContracts).where(eq(rightsContracts.contractNumber, contractNo)).limit(1)
  )[0] as any;
  ok(
    '4. createdBy spoof bị ép về ADMIN-01',
    r4.status === 200 && saved && saved.createdBy === 'ADMIN-01',
    `createdBy=${saved?.createdBy}`
  );

  // 5. Báo bán ký gửi ghi actorId:'mallory' → audit ép về NV-01 (kỳ mới).
  const stmt2 = await ConsignmentService.createStatement({
    partnerId: 'part-mao-dinh-le', periodStart: '2026-11-01', periodEnd: '2026-11-30',
    createdBy: 'setup-test',
  });
  const r5: any = await post(
    postConsignments,
    { action: 'record-sale', statementId: stmt2.statementId, editionId: book.id, quantity: 1, actorId: 'mallory' },
    cashierCk
  );
  const saleAudits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.resource, '/api/consignments'))
    .orderBy(desc(auditLogs.createdAt))
    .limit(5);
  const saleAudit = saleAudits.find((a: any) => a.action === 'CONSIGNMENT_SALE');
  const lastActor = `${saleAudit?.actorId || ''}`;
  ok(
    '5. record-sale spoof: đơn qua + audit ép về NV-01',
    r5.status === 200 && lastActor === 'NV-01',
    `audit.actor=${lastActor}`
  );

  // 6. CASHIER mở két đứng tên 'mallory' → két ép về NV-01.
  const r6: any = await post(
    postCashbox,
    { action: 'OPEN', warehouseId: 'wh-au-co', cashierId: 'mallory', openingCash: 500000 },
    cashierCk
  );
  ok(
    '6. OPEN két mạo tên bị ép về NV-01',
    r6.status === 200 && r6.body?.data?.cashierId === 'NV-01',
    `cashierId=${r6.body?.data?.cashierId}`
  );

  // 7. CASHIER ngó két QL-01 (?cashierId=QL-01) → chỉ thấy của mình.
  const r7q: any = await (async () => {
    const req = new Request('http://localhost/x?cashierId=QL-01', { headers: cashierCk });
    const res: any = await (getCashbox as any)(req);
    return { status: res.status, body: await res.json() };
  })();
  const seenId = `${r7q.body?.data?.cashierId || ''}`;
  ok(
    '7. CASHIER ngó két người khác bị ép về mình',
    r7q.status === 200 && seenId !== 'QL-01',
    `thấy cashierId=${seenId || '(trống)'}`
  );

  // 8. CASHIER chốt két người khác → 403, két vẫn OPEN; Manager chốt hộ được.
  const rVictim: any = await post(
    postCashbox,
    { action: 'OPEN', warehouseId: 'wh-au-co', cashierId: 'victim-01', openingCash: 100000 },
    managerCk
  );
  const victimId = rVictim.body?.data?.id;
  const r8: any = await post(
    postCashbox,
    { action: 'CLOSE', sessionId: victimId, closingCashActual: 100000 },
    cashierCk
  );
  const stillOpen = await (await import('../src/services/order.service')).CashboxService.getActiveSession('victim-01');
  const r8mgr: any = await post(
    postCashbox,
    { action: 'CLOSE', sessionId: victimId, closingCashActual: 100000 },
    managerCk
  );
  ok(
    '8. Chốt két người khác 403 + két còn OPEN, Manager chốt được',
    r8.status === 403 && !!stillOpen && r8mgr.status === 200,
    `cashier=${r8.status}, manager=${r8mgr.status}`
  );

  console.log(`\n${passed === total ? '🎉' : '⚠️'} ACTOR-BINDING: ${passed}/${total} ${passed === total ? 'PASS' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-actor-binding thất bại:', err);
  process.exit(1);
});
