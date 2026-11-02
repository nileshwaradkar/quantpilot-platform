# QuantPilot 2 — Render application

A Node.js/TypeScript implementation of the supplied intraday strategy. The blue, responsive web UI uses the required flow:

**Sign in → Paper / Live → Equity / Options → Market → Risk settings → Start monitoring**

There is no strategy builder. Indicator periods, five-minute timeframe, nearest-expiry ATM selection, green option candle, and 10/20 premium-point exits are enforced by the server.

## Status

Deployable **paper-trading beta**, with a gated live execution adapter. Automated tests and public FYERS instrument-master checks are implemented. Real broker authorization, authenticated market data, live orders/TPSL, Render deployment, SMTP delivery, load testing, and production PostgreSQL failover still require acceptance testing. Do not describe this release as a verified live-trading product.

The older Python application and packaged desktop programs are retained in sibling directories. Their databases, sessions, passwords, and broker tokens are not migrated automatically. The previously published Sites demo is a separate older UI and is not updated by this build.

## Open the local preview

On Windows, double-click **Start QuantPilot.cmd**, or run:

```powershell
npm ci
npm run demo
```

Open http://127.0.0.1:3000/ and select **Explore sample workspace**. Sample actions never call trading APIs. The local preview also supports local account and risk-setting flows using an embedded PostgreSQL-compatible development database. It deliberately has **no trading worker and no broker credentials**. A worker-offline indicator is expected for actual local accounts.

The launcher keeps the preview process running in the background. Logs and the preview database are under `data/`, excluded from the release archive. The preview is accessible only on this laptop.

## Production components

- Node.js 22 + TypeScript + Fastify API
- Responsive HTML/CSS/JavaScript frontend, served from the same origin
- PostgreSQL for accounts, sessions, setups, orders, audit events, and daily locks
- Separate Node.js worker with a PostgreSQL advisory lease
- FYERS v3 REST adapter; no credentials or trading operations in browser code
- Render Blueprint for the web service, worker, and private PostgreSQL database

Keeping the UI and API on the same origin simplifies cookie security and deployment. No Redis service is needed for this bounded single-worker release: PostgreSQL persists execution intent and coordinates ownership. Capacity must be measured before a broader rollout; the worker currently processes accounts sequentially.

## Free testing deployment

Use [docs/FREE-HOSTING.md](docs/FREE-HOSTING.md) and **render-free.yaml** for a free Render + Neon paper-testing pilot. It sleeps, has usage quotas, and cannot provide unattended live trading. The original render.yaml below provisions paid services.

## Deploy

Follow [docs/RENDER.md](docs/RENDER.md). Upload **this directory only** as the root of a private repository; do not upload the parent folder containing legacy broker files.

`render.yaml` creates paid always-running services in Singapore and a private PostgreSQL instance. Automatic deployment is disabled so code does not roll out unexpectedly during trading. Live execution defaults to off.

## Run against local PostgreSQL

```powershell
docker compose up -d db
Copy-Item .env.example .env
# Generate a strong ENCRYPTION_KEY, edit .env, then:
npm ci
npm run build
npm run migrate
npm start
# In a second terminal:
npm run worker
```

The PostgreSQL container binds to loopback only. Its password is a local development placeholder. Never reuse it in production.

## Verify

```powershell
npm run check
npm audit --audit-level=moderate
node --check public/app.js
node --import tsx scripts/check-instruments.ts
```

Tests use PGlite by default for SQL-backed integration tests. Set `TEST_DATABASE_URL` to an isolated PostgreSQL 17 test database to run the same suites against PostgreSQL. **Tests truncate test tables. Never point this variable at a real account database.** The GitHub Actions workflow provisions its own PostgreSQL service.

Read [strategy semantics](docs/STRATEGY.md), [operations](docs/OPERATIONS.md), and [release checks](docs/ACCEPTANCE.md) before enabling broker execution.

