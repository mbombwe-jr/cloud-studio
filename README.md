# Zoostudios Backend

Secure multi-service cloud provisioning backend for **Zoostudios** — an internal, API + web based
cloud services platform (money collection, money disbursement incl. batch, SMS). This is an
**internal tool**: not for sale, distribution or marketing.

Built with **NestJS 11 + PostgreSQL (Prisma ORM)**, with the **iii** engine (https://iii.dev)
used for queues, cron, logs, analytics and full-flow tracing (with local DB-backed fallback
drivers when no iii engine is attached).

---

## 1. Quick start

```bash
npm install                 # installs deps + generates Prisma client (postinstall)
npm run db:server           # boots embedded PostgreSQL 17 on 127.0.0.1:5433 (no root needed)
                            #   -> creates databases: zoostudios (dev) and zoostudios_test
npm run db:push             # push schema to dev DB (set ZOO_DATABASE_URL, see .env.example)
npm run db:seed             # seed admin login + shared sender name + sample plan
npm run start:dev           # run the API on :3000
```

`.env` (copy from `.env.example`):

```bash
ZOO_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/zoostudios?schema=public
JWT_SECRET=<32+ random chars>
MOCK_PROVIDERS=true          # simulate ClickPesa/Beem for local dev & CI
```

Default seeded admin: `admin@zoostudios.internal` / `ChangeMe!2025` (override via `SEED_ADMIN_*`).

Interactive API docs: **http://localhost:3000/docs** (OpenAPI/Swagger).

### Production database

Point `ZOO_DATABASE_URL` at your managed PostgreSQL and use `npm run db:migrate` / `db:deploy`
(Prisma migrations under `prisma/migrations/`). The embedded DB server is for local dev only.

---

## 2. Architecture

```
src/
├── auth/            staff login (JWT), roles: ADMIN | SERVICEMAN
├── accounts/        account provisioning, API keys, service permissions
├── wallets/         COLLECTION / DISBURSEMENT wallets + full ledger
├── collections/     USSD push (preview + initiate), status, refresh
├── disbursements/   mobile money payout, bank payout, batch payouts
├── sms/             send + history, shared & dedicated sender names
├── billing/         plans, subscriptions, PAYG, manual admin bills
├── admin/           staff mgmt, overview, computations (anti-fraud), audit, analytics, traces
├── webhooks/        inbound ClickPesa/Beem webhooks + outbound signed webhooks (retries)
├── clickpesa/       provider client (token, checksum, USSD push, payouts, queries)
├── beem/            Beem Africa SMS client
├── providers/       provider interfaces + mock providers (MOCK_PROVIDERS=true)
├── iii/             iii engine driver: queue, cron, logger, tracing, analytics (+ local fallback)
├── audit/           audit trail service
├── prisma/          Prisma service/module
├── common/          guards, decorators, interceptors, filters, utils (references, api keys, phone)
└── health/          liveness probe
```

Key invariants (secure-first):

- Accounts start with **zero service access**; every permission must be granted by an admin.
- API keys are ≥ 32 chars, shown **once**, stored only as SHA-256 hashes.
- Every service reference is exactly **20 chars**: 5-char per-account source code + 15-char
  client reference (client-provided or random-padded). Unique, indexed, verifiable.
- Wallet movements are **exactly-once** and idempotent (webhook + poller converge through one
  status engine). Every movement has before/after balances in the ledger.
- Payouts **hold funds** on request; failures auto-refund; successes finalize the debit.
- Accounts are **never auto-suspended** for billing. Suspension is manual, admin-only, audited,
  with a mandatory reason.
- SERVICEMAN role is **read-only** at the guard level (all non-GET requests → 403).
- Inbound webhooks are checksum-verified; status is treated as advisory and re-queried from the
  provider before wallet movements are finalized. Raw payloads are always persisted to traces.

---

## 3. Endpoints overview (prefix: none; auth noted per group)

### Public
| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | liveness + DB + iii status |
| POST | `/webhooks/clickpesa` | ClickPesa payment/payout callbacks |
| POST | `/webhooks/beem` | Beem delivery reports |

### Staff (Bearer JWT)
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | login (admin/serviceman) |
| GET  | `/auth/me` | current staff profile |
| POST/GET | `/admin/users` | create/list staff (servicemen) accounts |
| POST/GET | `/admin/accounts` | create/list accounts (on behalf of owners) |
| GET/PATCH | `/admin/accounts/:id` | account detail / update |
| POST | `/admin/accounts/:id/suspend` `…/activate` | manual suspension (reason required) |
| POST/DELETE | `/admin/accounts/:id/api-keys` | issue/revoke API keys (key shown once) |
| PUT  | `/admin/accounts/:id/permissions` | grant/revoke COLLECTION / DISBURSEMENT / SMS |
| GET/POST | `/admin/accounts/:id/wallets/:type/...` | balances, ledger, deposit, withdraw, freeze, activate |
| GET  | `/admin/accounts/:id/overview` | full account data: txs, SMS, bills, wallets |
| GET  | `/admin/accounts/:id/computations?preset=day\|month\|custom&from=&to=` | anti-fraud review (opening/credits/debits/closing per wallet, ledger consistency, totals by status) |
| GET  | `/admin/audit-logs` `/admin/traces` `/admin/analytics/summary` | audit trail, trace spans, analytics |
| GET  | `/admin/accounts/:id/bills` · POST | manual billing assignment (never auto-suspends) |
| GET/POST/PUT | `/admin/accounts/:id/settlement...` | settlement accounts (list / add / update) |
| PUT  | `/admin/accounts/:id/settlement/auto-sweep` | toggle the daily 00:00 EAT auto-sweep (default on) |
| POST | `/admin/accounts/:id/settlement/sweep-now` | sweep the collection wallet immediately |
| GET/PUT | `/admin/accounts/:id/fees` | per-customer fee schedule (bps tiers) |

### Account services (header `X-API-Key`)
| Method | Path | Purpose |
|---|---|---|
| GET  | `/me` | account profile, permissions, wallets, keys (masked) |
| POST | `/collections/ussd-push/preview` | preview + sender details (fetchSenderDetails) |
| POST | `/collections/ussd-push` | initiate USSD push collection |
| GET  | `/collections` `/collections/:reference` | history / detail |
| POST | `/collections/:reference/refresh` | re-query provider for authoritative status |
| POST | `/disbursements/mobile-money/preview` | mobile money payout preview (operator detect + fee, no execution) |
| POST | `/disbursements/mobile-money` `…/bank` `…/batches` | payouts (batch up to 500 items) |
| GET  | `/disbursements...` | history / detail / batch detail |
| POST | `/sms/send` | send SMS (shared or approved dedicated sender) |
| GET  | `/sms` `/sms/:reference` `/sms/sender-names` | history, detail, sender names |
| GET  | `/wallets` `/wallets/:type/transactions` | balances and ledger |
| POST | `/wallets/deposits` (+ `/preview`, `/:reference/refresh`) | deposit processed like a collection: USSD push -> ClickPesa authorises -> DISBURSEMENT wallet credited |
| POST/GET | `/wallets/transfers` | instant COLLECTION -> DISBURSEMENT move at the custom transfer fee (default 2%) |
| POST/GET | `/wallets/withdrawals` | settle an amount from the COLLECTION wallet to the settlement account (bank -> bank payout, phone -> mobile payout) |
| GET  | `/wallets/settlement-accounts` | the account's settlement accounts |
| POST | `/wallets/:type/deposit` `…/withdraw` | direct API float actions (needs `walletActions` meta permission) |

---

## 3b. Settlements, deposits, transfers & custom fees (v2)

**Settlement accounts (onboarding).** Every account can carry settlement details captured at creation
(`POST /admin/accounts` with a `settlement` object): mobile money (`method`: AIRTEL / TIGO / VODACOM /
HALOPESA + Tanzanian `phoneNumber`) or bank (`bankName`, optional `bankInitials` such as CRDB/NMB,
`accountNumber`, `accountName`). All settlement goes through these accounts via the payout rail — there
is no custom/manual settlement method.

**Auto-sweep (default: ON).** A daily cron at **00:00 Africa/Dar_es_Salaam** sweeps the entire COLLECTION
wallet balance into the account's default settlement account: bank settlement -> bank payout, mobile
settlement -> mobile money payout. The platform fee is deducted from the swept amount; the payout
reference is recorded with `payoutKind=AUTO_SWEEP`. Toggle per account with
`PUT /admin/accounts/:id/settlement/auto-sweep` (`{ "enabled": false }`); trigger immediately with
`POST .../settlement/sweep-now`.

**Deposits like collections (into the DISBURSEMENT wallet).** `POST /wallets/deposits` initiates a USSD
push to the payer exactly like a collection; when ClickPesa authorises the amount (webhook or cron poll)
the value is credited to the **DISBURSEMENT** wallet (never the collection wallet) with a `DEPOSIT`
ledger entry. Idempotent like every other status path; `GET /wallets/deposits` for history and
`POST /wallets/deposits/:reference/refresh` for manual re-query. No platform fee is charged on deposits.

**Wallet transfer (COLLECTION -> DISBURSEMENT).** `POST /wallets/transfers` moves funds instantly between
the account's own wallets inside ONE database transaction (overdraft impossible). The transfer fee is
custom per customer (default **2%**).

**Withdrawals (manual settlement).** `POST /wallets/withdrawals` settles a specific amount from the
COLLECTION wallet to the default settlement account. Failed provider payouts refund the full debit
(amount + fee) to the same wallet automatically.

**Custom fees per customer.** Every account has a fee schedule (`fee_configs`): below the tier threshold
(default TZS 3,000) the fee is **5%** (500 bps); at/above it is **2%** (200 bps) — identical defaults for
collection and disbursement; transfers default 2%. Fees apply to ALL transactions: collections credit the
wallet net of fee, payouts debit amount + fee. Admins override any value via
`GET/PUT /admin/accounts/:id/fees` and see it live in the Admin Portal ("Settlement & fees" tab).

---

## 4. Provider integrations

### ClickPesa (collection + disbursement)
- `POST /third-parties/generate-token` with `api-key` + `client-id` headers → Bearer token (cached).
- `POST /payments/preview-ussd-push-request` → `activeMethods[]`, `sender{...}`.
- `POST /payments/initiate-ussd-push-request` → `{id, status, channel, orderReference, ...}`.
- `GET /payments/{orderReference}` / `GET /payments/all` → authoritative status queries.
- Payouts via the payout endpoint with per-channel payload builders in
  `src/clickpesa/clickpesa.client.ts`.
- **Bank payout payload includes BOTH `accountCurrency: "TZS"` and `currency: "TZS"`** —
  this is a required deviation from the official docs and is encoded in the client:
  ```json
  { "amount": 1000, "accountNumber": "0676544740", "accountName": "DEOGRATIUS DENIS MBOMBWE",
    "orderReference": "<20-char ref>", "bic": "ACTZTZTZ",
    "accountCurrency": "TZS", "currency": "TZS", "checksum": "..." }
  ```
- Checksum: HMAC/SHA per `CLICKPESA_CHECKSUM_*` env (see `.env.example`); disable with
  `CLICKPESA_CHECKSUM_ENABLED=false` while onboarding.
- Set `MOCK_PROVIDERS=true` to run without live credentials (mock simulates full lifecycle).

### Beem Africa (SMS)
- Basic-auth `POST /v1/send` with `recipients: [{recipient_id, dest_addr}]`.
- Delivery reports land on `POST /webhooks/beem`; a cron job also pulls reports.
- Shared sender = platform-wide (`SMS_DEFAULT_SENDER`); dedicated sender names are requested,
  approved and stored per account with full send history.

---

## 5. iii integration (queues, cron, logs, analytics, tracing)

`III_ENABLED=true` attaches the platform to a running iii engine (`III_URL`), used for:
- **Queues** — SMS dispatch, webhook fan-out, status polling (at-least-once, exponential backoff)
- **Cron** — provider status reconciliation, delivery-report sync, housekeeping
- **Logs** — structured JSON logs with trace ids on every request and provider call
- **Analytics** — business events (collection.succeeded, payout.succeeded, sms.sent, ...)
- **Tracing** — every step of every transaction stored as ordered trace spans (never dropped)

With `III_ENABLED=false` the platform runs on **local fallback drivers**: the same jobs/crons/
spans are persisted in PostgreSQL (`jobs`, `trace_spans`, `analytics_events` tables), so nothing
is lost and behaviour is identical — inspect via `/admin/traces` and `/admin/analytics/summary`.

---

## 6. Testing (every stage)

```bash
npm test           # unit: reference generator, api keys, checksum, phone utils   (22 tests)
npm run test:e2e   # full HTTP e2e: auth, accounts, wallets, collections, payouts, sms, admin, settlements/deposits/transfers/fees (66 tests)
npm run db:server  # embedded postgres needed by both suites (zoostudios_test DB)
bash scripts/smoke.sh http://127.0.0.1:3010   # 41-check live API walkthrough (mock providers)
```

E2E runs against a dedicated `zoostudios_test` database with `MOCK_PROVIDERS=true` and covers,
among other flows: permission gating, wallet math and overdraw protection, idempotent webhook
credits, batch payouts, billing, computations review, serviceman read-only enforcement,
API key lifecycle and suspension semantics.

---

## 7. Security checklist

- Helmet security headers, CORS allow-list, global rate limiting (throttler).
- Strict validation: whitelist + forbidNonWhitelisted on every endpoint.
- Passwords: bcrypt (cost configurable); JWT 8h default expiry.
- API keys: 256-bit, hashed at rest, revocable, last-used tracking.
- RBAC guards + serviceman write-block at the framework level.
- Audit logs on every admin action (actor, IP, user-agent, before/after).
- Outbound webhooks signed with HMAC-SHA256 per-endpoint secrets; deliveries retried with
  exponential backoff and dead-lettering.
- Uniform error envelope — no stack traces or internals leak to clients.

---

## 8. Docker Compose — run the full stack (PostgreSQL + iii + API + both portals)

```bash
cd /home/mbombwe/Documents/zoostudios-dev
cp .env .env.compose    # keep the host .env untouched
# set at minimum in .env (or .env.compose): JWT_SECRET
docker compose up -d --build
```

| service | internal | host port (override via .env) |
|---|---|---|
| postgres 18 | 5432 | `POSTGRES_HOST_PORT` (default 5433, loopback) |
| iii engine | ws://iii:49134 | `III_HOST_PORT` (default 49135) |
| backend API | 3000 | `BACKEND_HOST_PORT` (default 3077) |
| user-portal | 3000 | `USER_PORTAL_HOST_PORT` (default 3012) |
| admin-portal | 3000 | `ADMIN_PORTAL_HOST_PORT` (default 3013) |

Notes:
- The backend container applies `prisma migrate deploy` and the idempotent seed on every start, then
  serves — no manual bootstrap.
- The iii service bind-mounts the static-pie engine binary from
  `${III_BINARY:-/home/mbombwe/.local/bin/iii}` and the config from `./iii` (`config.yaml`, workers in
  `./iii/config`). To ship a self-contained image instead, copy the binary next to `iii/Dockerfile`:
  `FROM debian:stable-slim` + `COPY iii /usr/local/bin/iii`.
- The portals are built inside their images with `VITE_API_BASE=http://${PUBLIC_IP}:${BACKEND_HOST_PORT}`
  baked in, and served by the hardened `server.mjs` (CSP pinned to the API origin, SPA fallback, no-store
  index, immutable assets, traversal-hardened).
- Defaults deliberately sit on shifted ports (3077/3012/3013) so the compose stack can run NEXT TO the
  systemd deployment (3076/3010/3011) without interference. Override in `.env` to make compose primary.
- Browser-facing origin: set `PUBLIC_IP` (default `10.8.0.28`) — it must match the IP clients use.

---

## 9. Security hardening (v2)

- **Global throttle** (@nestjs/throttler): 120 req/min per IP default (`THROTTLE_TTL` / `THROTTLE_LIMIT`),
  applied via a global guard; provider webhooks are exempt (signature-verified + authoritative re-query).
- **Credential-stuffing lockout**: per-email failure counter in `AuthService` — 10 failures in a 15-minute
  window locks the credential for 15 minutes (`AUTH_MAX_FAILURES`, `AUTH_FAILURE_WINDOW_MS`,
  `AUTH_LOCKOUT_MS`); lockout responses are indistinguishable from wrong passwords.
- **Payload caps**: JSON/urlencoded bodies hard-capped at 256 KB; 30 s socket timeouts (slowloris guard).
- **Helmet**: strict headers incl. `no-referrer`, `same-site` CORP, HSTS in production; `x-powered-by` off.
- **CORS**: explicit origin allowlist (`CORS_ORIGINS`) with credentials, no wildcard reflection.
- **Validation**: global `ValidationPipe` with `whitelist + forbidNonWhitelisted` — unknown fields are
  rejected on every route (all new DTOs included).
- **Money safety**: serializable wallet movements with conditional balance floors, atomic double-leg
  transfers, exactly-once webhook/poll status application, full-fee refunds on provider rejections,
  duplicate client-reference rejection everywhere.
- **Observability**: every request, provider call, queue job and cron run is trace-spotted with the traceId
  propagated end-to-end; audit records for every staff action; nothing is dropped.
