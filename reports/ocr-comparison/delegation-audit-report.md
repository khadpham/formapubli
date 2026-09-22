# OCR Delegation Full-Project Audit

Date: 2026-09-18
Repository: `D:/Data Project/formapubli`
Mode: OCR deterministic rule selection + Codex analysis
Mutation policy: report only; no source edits

## Coverage

- 197 Git-tracked source/configuration files were included.
- OCR resolved rules for all 197 files in 5 batches.
- OCR rule-resolution time: 2.379 seconds.
- Approximate elapsed time from rule mapping through report preparation: 5 minutes 31 seconds.
- Included extensions: 141 `.ts`, 31 `.tsx`, 17 `.sql`, 3 `.json`, 2 `.mjs`, 1 `.js`, 1 `.css`, and 1 `.toml`.
- Excluded: `.env*`, `*.db*`, dependencies, build output, coverage, generated directories, Drizzle migration snapshots, `next-env.d.ts`, `package-lock.json`, and the generated evaluation JSON.
- `npx tsc --noEmit --incremental false` completed successfully with no TypeScript errors.
- No uses of `dangerouslySetInnerHTML`, direct `.innerHTML`, `eval`, `new Function`, or `document.write` were found in the audited source.
- Raw scope and rule mapping are stored in `delegation-rules-and-scope.json`.

Semantic inspection emphasized authentication, authorization, API routes, financial/audit identity, inventory movements, settlements, consignments, cashbox sessions, RMA, royalties, SQL usage, async behavior, and LLM guardrails. Generic style findings and unproven `any`-type concerns were discarded.

## Findings

### High — Cashiers can read and mutate other cashiers' cashbox sessions

`src/app/api/cashbox/route.ts:11` authorizes `ROLE_CASHIER` for the GET endpoint, but line 14 accepts an arbitrary `cashierId`; without that parameter, line 29 returns the general session list. The POST endpoint also authorizes cashiers at line 41, trusts a client-supplied `cashierId` at line 46, and closes any client-supplied `sessionId` at line 86. `CashboxService` performs no ownership check.

Impact: an authenticated cashier can view other shifts, open a shift attributed to another cashier with arbitrary opening cash, or close another cashier's session and supply the counted amount. This compromises financial reconciliation and accountability.

Remediation: for `ROLE_CASHIER`, force `cashierId = session.actorId`, restrict GET results to that actor, and verify ownership before closing. Preserve cross-cashier operations only for owner/manager roles.

### High — Client-controlled actor identities contaminate audit and ledger records

Several authenticated routes prefer identity supplied by headers or request bodies instead of the verified session:

- `src/app/api/rma/route.ts:42` and `:73` prefer `x-formapubli-actor`, `body.actorId`, or `body.inspectedBy` over `session.actorId`.
- `src/app/api/consignments/route.ts:185-258` persists and audits client-supplied `createdBy`/`actorId`.
- `src/app/api/settlements/route.ts:70-109` persists `receivedBy` and VOID actor IDs from the request body.
- `src/app/api/royalties/route.ts:72-94` accepts client-supplied creator and termination actor IDs.

Impact: a valid user can attribute stock, settlement, consignment, RMA, and royalty actions to another staff member. This undermines the append-only ledger and makes audit evidence unreliable.

Remediation: always derive the acting identity from `session.actorId`. If the business needs a distinct subject or recipient, store it under a separate field that cannot be confused with the authenticated actor.

### High — Staff and manager PIN hashes use a fast single-round SHA-256 construction

`src/lib/auth-session.ts:292-300` hashes passcodes by concatenating them with a salt and calling `hashString`; `src/lib/export-hash.ts:96-98` is a direct SHA-256 implementation. Default staff PINs include four-digit values at `src/lib/auth-session.ts:337-358`. Manager PIN hashing uses the same fast construction.

Impact: if the account database or PIN hash configuration is exposed, four-digit PINs can be exhaustively recovered almost instantly. Per-account salts prevent precomputed rainbow tables but do not meaningfully slow brute-force search.

Remediation: use a password KDF such as Argon2id, scrypt, or PBKDF2 with a strong work factor and unique random salt. Migrate existing hashes on successful login and require longer production credentials for privileged roles.

### Medium — Most audit writes are fire-and-forget

49 of 57 `recordAuditLog(...)` call sites in `src/app` and `src/services` do not await the returned promise. Examples include login at `src/app/api/auth/login/route.ts:250`, transfers at `src/app/api/transfers/route.ts:102`, and orders at `src/app/api/orders/route.ts:318`. The async writer is defined at `src/lib/rbac-guard.ts:98`.

Impact: serverless/edge runtimes may freeze or terminate request execution immediately after the response is returned, dropping unresolved audit inserts. The most security-sensitive operations can therefore succeed without durable audit evidence.

Remediation: await audit writes where the audit record is part of the operation's integrity contract, or use a runtime-supported background primitive such as `waitUntil`. For strict financial trails, write business mutation and audit record in the same transaction or use a durable outbox.

### Medium — Login and API rate limits are process-local and not reliable on the deployed architecture

`src/lib/auth-session.ts:119` and `:237` store login and sliding-window limits in module-level `Map` objects. The project targets Cloudflare/edge deployment, where isolates can restart or requests can land on different instances.

Impact: an attacker can bypass brute-force and request limits by distributing attempts across instances or waiting for isolate resets. Conversely, the state disappears on deployment/restart, so the advertised lockout is not durable.

Remediation: store counters in a shared atomic backend such as a Durable Object, Redis, or a database table with expiration and transactional increments.

### Medium — Default client-IP resolution can turn rate limiting into a global lockout

`src/lib/auth-session.ts:453-463` trusts Cloudflare's IP only when `TRUST_PROXY=cloudflare`; otherwise requests without a runtime-specific `req.ip` are mapped to `127.0.0.1`.

Impact: if the deployment omits or misconfigures `TRUST_PROXY`, unrelated users share one IP bucket. Ten failed attempts can lock out every user behind the application for fifteen minutes, while audit logs record a misleading loopback address.

Remediation: fail deployment validation when the trusted-proxy mode is missing in production, or obtain the client identity from a platform-verified request property. Do not silently collapse all clients into one rate-limit key.

## Limitations

- OCR delegation supplied generic TypeScript/React/security rules and default correctness rules for SQL/TOML; it did not provide project-specific Formapubli invariants.
- Every included file was enumerated and assigned rules, but deep semantic inspection concentrated on high-risk server and financial paths. UI and test scripts received rule-driven static inspection rather than equal line-by-line manual analysis.
- No database-mutating test scripts were run, because this audit was report-only.
- Dependency vulnerability intelligence was not fetched from the network.
