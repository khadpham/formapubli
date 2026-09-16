# CP3 Execution Plan — Single Source of Truth

## 1. Authority and status

This document is the canonical execution contract for Phase 0 Checkpoint 3 (CP3).
It supersedes lane chat reports, draft design v2.1, and design v2.2 where they conflict.

- CP2 is closed and integrated.
- CP3 covers transfer, return, equal-value exchange, void, reconciliation, and migration hardening.
- A checkpoint is not PASS until its evidence is reproduced on the named commit and an isolated database.
- Lane reports are evidence, not contract changes.
- Any contract change requires a dedicated documentation decision before either lane changes code or tests.

## 2. Scope

### Included

1. Two-step transfer shipment: dispatch, receive, cancel.
2. Direct internal transfer with a fail-closed server-side pair allowlist.
3. Return request, approve, reject, complete, and void.
4. Cash refund using the existing completed-return projection.
5. Defective replacement and equal-value exchange.
6. RMA linkage for damaged transfer and defective return stock.
7. Idempotency and fingerprint verification for every CP3 mutation.
8. Fresh and upgrade migration verification.
9. Cashbox, inventory, and analytics reconciliation.

### Deferred

1. Different-value exchange for VAT orders.
2. Automatic bank refund integration.
3. Financial void after the original cashbox session is closed.
4. Freight allocation into COGS.
5. Serverless, shared network filesystem, and multi-region database guarantees.

## 3. Business invariants

1. No transfer or exchange may consume stock reserved by active pending orders.
2. Dispatch is atomic: source OUT, transit IN, shipment, items, and action either all commit or all roll back.
3. Receive satisfies `received + damaged + lost = dispatched` for every edition.
4. Receive removes `received + damaged` through `TRANSFER_OUT` and removes `lost` through `TRANSFER_LOSS`; lost stock is never deducted twice.
5. Receive and cancel have exactly one winning state transition from `IN_TRANSIT`.
6. A return line references an original `order_item`; cumulative active return quantity cannot exceed that source line's sold quantity.
7. `REQUESTED`, `APPROVED`, and `COMPLETED` reserve return quota; `REJECTED` and `VOIDED` release it.
8. Defective stock increases `QUARANTINE`, never `NEW`, and creates an RMA ticket in the same transaction.
9. Exchange replacement ATP is checked inside the same write transaction as return inbound and replacement outbound.
10. Equal-value exchange uses server snapshots and requires exact equality in integer VND.
11. Replay with the same key and fingerprint returns the original result without another effect.
12. The same key with a different fingerprint returns `IDEMPOTENCY_CONFLICT`.
13. Actor identity and role come only from the authenticated `ActorContext`.
14. `SQLITE_BUSY`, timeout, orphan rows, partial ledgers, or leaked database journals are acceptance failures.

## 4. Financial definitions

For a sale of two books at cover price 100,000 VND with a 10% discount:

- List Gross: 200,000
- Discount: 20,000
- Sales Collected: 180,000
- Refund for one book: 90,000
- Net Revenue: 90,000
- Expected Cash: opening cash + completed cash sales - completed cash refunds

`return_orders` in `COMPLETED` status remains the source for refunds. CP3 does not introduce a `CASH_OUT` mutation or directly increment a nonexistent `totalRefunds` column.

Cash refund completion and financial void are allowed only while the cashbox session stored on the return remains `OPEN`. Cross-session and closed-session financial void are deferred.

## 5. Equal-value exchange policy

Each return line references `order_item_id`. The server snapshots `unitRefund` from the original `order_items.unitSellingPrice`.

Replacement prices are read from `editions.coverPrice` and stored as integer VND snapshots.

```text
oldRefundableValue = sum(returnQty * unitRefundSnapshot)
replacementValue = sum(replacementQty * coverPriceSnapshot)
```

An `EXCHANGE` is accepted only when the two values are exactly equal and `refundAmount = 0`.
`DAMAGED_REPLACE` for the purchased edition is a zero-money warranty replacement and is not rejected because the current cover price changed.

## 6. Error contract

Required structured codes:

| Code | HTTP | Meaning |
|---|---:|---|
| `INVALID_INPUT` | 400 | Invalid or missing CP3 input, including missing idempotency key |
| `FORBIDDEN` | 403 | Role or direct-transfer pair is not permitted |
| `INSUFFICIENT_ATP` | 409 | Transfer or replacement would consume unavailable ATP |
| `STATE_CONFLICT` | 409 | State transition lost or is not permitted |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key with a different fingerprint |
| `OVER_RETURN_LIMIT` | 409 | Active cumulative return quantity exceeds the source sale line |

`AppError` factories take a message and optional details. HTTP status is mapped in `handleApiError`; it is not passed as an `AppError` constructor detail.

## 7. Required schema delta

Migration `0016_cp3_transfer_return_hardening` and Drizzle schema must include:

1. `transfer_shipments.idempotency_key` with a unique index for non-null keys.
2. `transfer_shipments.fingerprint`.
3. `return_orders.fingerprint` for request creation.
4. `return_order_items.order_item_id` referencing `order_items.id`; new CP3 requests require it.
5. `rma_tickets.transfer_shipment_id` referencing `transfer_shipments.id`.
6. `transfer_actions` with shipment, action, actor, resulting status, unique idempotency key, fingerprint, and timestamp.
7. `return_actions` with return, action, actor, resulting status, unique idempotency key, fingerprint, and timestamp.
8. `exchange_replacement_items` with return, edition, positive quantity, integer VND unit price snapshot, and a unique `(return_id, edition_id)` key after input consolidation.
9. Required indexes and migration journal/meta entries.

Legacy rows may have null values in newly added compatibility columns. Every new CP3 mutation requires a non-empty client idempotency key.

### Migration metadata policy

- Migrations 0015 and 0016 are manual SQL migrations registered in meta/_journal.json; the repository snapshot chain currently ends at 0014_snapshot.json.
- Independent audit confirmed that running drizzle-kit generate from the current snapshot baseline regenerates the 0015 and 0016 schema changes. Such generated output is duplicate and must not be committed.
- CP3 continues to use reviewed manual SQL plus a journal entry and fresh/upgrade migration tests.
- Do not run or commit output from drizzle-kit generate until a separate metadata-baseline repair is approved.
- Snapshot normalization is tracked as migration-tooling debt and must be resolved before automated generation is re-enabled.

## 8. Transaction order

### Dispatch

```text
BEGIN IMMEDIATE
-> replay/fingerprint check
-> validate warehouses and direct/transit restrictions
-> consolidate items
-> ATP check in tx
-> insert shipment and shipment items
-> source TRANSFER_OUT
-> transit TRANSFER_IN
-> COMMIT
```

### Receive

```text
BEGIN IMMEDIATE
-> action replay/fingerprint check
-> load shipment and dispatched items
-> validate and consolidate received/damaged/lost input
-> verify R + D + L = X
-> conditional UPDATE where status = IN_TRANSIT
-> require affectedRows = 1
-> transit TRANSFER_OUT -(R + D)
-> transit TRANSFER_LOSS -L
-> destination NEW +R
-> destination QUARANTINE +D
-> create RMA for damaged quantity
-> insert transfer action
-> COMMIT
```

### Cancel

```text
BEGIN IMMEDIATE
-> action replay/fingerprint check
-> load shipment and items
-> conditional UPDATE where status = IN_TRANSIT
-> require affectedRows = 1
-> transit OUT and source IN for the full dispatched quantity
-> insert cancel action
-> COMMIT
```

### Return request

```text
BEGIN IMMEDIATE
-> request replay/fingerprint check
-> load completed source order and referenced order items
-> consolidate by order_item_id
-> calculate active returned quantity per source line
-> enforce return quota and refund cap
-> validate open cashbox for cash refund
-> insert return and return items with server price snapshots
-> COMMIT
```

### Approve or reject

```text
BEGIN IMMEDIATE
-> action replay/fingerprint check
-> conditional UPDATE where status = REQUESTED
-> require affectedRows = 1
-> insert return action
-> COMMIT
```

Approve and reject do not create inventory, RMA, refund, or cashbox effects.

### Complete return or exchange

```text
BEGIN IMMEDIATE
-> action replay/fingerprint check
-> load APPROVED return, source lines, and replacement input
-> revalidate return quota and cashbox
-> validate equal-value exchange and replacement ATP
-> conditional UPDATE where status = APPROVED
-> require affectedRows = 1
-> return inbound NEW or QUARANTINE
-> create RMA when defective
-> persist replacement snapshots and dispatch replacements
-> insert return action
-> COMMIT
```

### Void

```text
BEGIN IMMEDIATE
-> action replay/fingerprint check
-> require original cashbox still OPEN when refundAmount > 0
-> conditional UPDATE where status = COMPLETED
-> require affectedRows = 1
-> create one reversal for every unreversed inventory effect
-> fail closed when inventory cannot be reversed
-> insert return action
-> COMMIT
```

## 9. Direct transfer policy

Direct transfer is restricted to `ROLE_OWNER` and `ROLE_MANAGER`.

- Allowed warehouse pairs come from a server-side configuration.
- Pair comparison is bidirectional and normalized.
- The default allowlist is empty, so the endpoint fails closed until explicitly configured.
- Transit, consignment, quarantine, and other virtual warehouse families are always forbidden.
- The service enforces the rule; route-only enforcement is insufficient.
- UI hides the operation when no valid pair is configured.

## 10. Lane ownership

### Lane A owns production implementation

- `src/db/schema.ts`
- `drizzle/**` and migration `0016`
- `src/services/app-error.ts`
- `src/lib/api-response.ts`
- `src/services/transfer.service.ts`
- `src/services/return.service.ts`
- `src/services/inventory.service.ts`
- `src/app/api/transfers/route.ts`
- `src/app/api/inventory/transfer/route.ts`
- `src/app/api/returns/route.ts`
- Direct-transfer UI visibility
- `scripts/run-isolated.ts` during final integration

### Lane B owns adversarial tests only

- `scripts/cp3-concurrency-worker.ts`
- `scripts/test-cp3-transfer-concurrency.ts`
- `scripts/test-cp3-return-concurrency.ts`
- `scripts/test-cp3-reconciliation.ts`
- `scripts/test-cp3-migrations.ts`

Lane B must not edit `src/**`, migrations, package files, existing CP2 tests, or `scripts/run-isolated.ts`.

## 11. Checkpoints and branch flow

### CP3-A — Schema and contract

Lane A creates `lanea/cp3-schema-contract` from the commit containing this plan.

Allowed work:

- Schema and migration 0016.
- Error contract and HTTP mapping.
- CP3 TypeScript interfaces.
- Direct-transfer allowlist helper/config.
- Fresh and upgrade migration verification.

No transfer/return transaction behavior changes are allowed in CP3-A.

CP3-A PASS requires fresh migration, upgrade of a database copy, uniqueness checks, TypeScript, unchanged production DB, clean Git, and a reviewable commit.

### CP3-B — Parallel implementation and tests

After CP3-A is accepted:

1. Lane A continues production implementation from CP3-A.
2. Lane B creates `laneb/cp3-adversarial-tests` from CP3-A and writes only the owned test files.
3. Lane B may report expected red tests once; repeated debugging of missing implementation is prohibited.
4. Lane A does not weaken Lane B assertions. Contract disagreement stops both lanes until resolved.

### CP3-C — Integration and acceptance

1. Lane A integrates the Lane B test-only commit after production implementation is ready.
2. Lane A adds the new suites to `scripts/run-isolated.ts`.
3. Run fresh migration, upgrade migration, CP3 probes, CP2 regressions, full isolated suites, TypeScript, and production build.
4. Lane B checks the integrated commit independently on new databases.
5. Any surfaced `SQLITE_BUSY`, timeout, orphan row, partial ledger, production DB mutation, or flaky round keeps CP3 open.

## 12. Acceptance probes

The Lane B CP3 Adversarial Acceptance Spec v1.1 is normative. It includes:

- Dispatch versus immediate sale.
- Receive versus receive.
- Receive versus cancel.
- Direct transfer versus pending hold.
- Same transfer key with different payload.
- Concurrent return requests competing for quota.
- Approve versus reject, with no inventory or money effect.
- Complete versus complete.
- Complete versus void under the legal state machine.
- Defective return affects QUARANTINE only.
- Exchange versus sale for the final replacement copy.
- Exchange replay with different replacement items.
- Void twice.
- Sale/refund/cashbox/analytics reconciliation.
- Fresh and upgrade migrations.

For a same-key/same-fingerprint race, exactly one response is the original commit and the other is an idempotent replay. For different fingerprints, exactly one wins and the other receives `IDEMPOTENCY_CONFLICT`.

## 13. Stop rules

1. A repeated identical blocker twice ends the lane turn and requires a report.
2. Maximum two temporary debug scripts per lane; they are never merged.
3. No unbounded retries, sleeps used for race ordering, process-local mutexes, or lowered assertions.
4. No lane may edit the other lane's owned files.
5. No merge from rescue branches.
6. No claim of PASS from a lane's self-test alone.
7. Production database size and modification time are recorded before and after every acceptance run.

## 14. Handoff format

Every checkpoint report must contain:

1. Lane, branch, and commit SHA.
2. Base SHA.
3. Files changed.
4. Schema and contract changes.
5. Exact test commands and results.
6. Fresh/upgrade database evidence where applicable.
7. Production database before/after evidence.
8. Known limitations.
9. Decisions required from the other lane.


