# Operations and recovery

## State ownership

The web service never sends broker orders. It records setup controls and exit requests in PostgreSQL. The trading worker owns execution, uses a dedicated PostgreSQL session lease, and persists each entry intent before a network request.

An uncertain entry is never automatically resubmitted. An uncertain exit is not blindly sent twice. Broker order IDs/tags, filled quantity and observed positions are reconciled. A newly filled order with lagging position visibility stays active; it is not assumed closed. Flat positions require successive observations.

The worker pauses entry monitoring after restart. It still reconciles existing trades. A lost database lease or an excessively long cycle terminates the worker; Render should restart it. Supervise restart loops and alert on missed heartbeats.

## Controls

- **Pause entries** stops new entries for that setup. It does not close positions.
- **Request exit** persists an exit request; it does not claim an immediate fill.
- **Emergency stop** pauses all of the user's setups and queues exits across both modes.
- If the worker, market data or broker is unavailable, queued exits cannot be guaranteed. Inspect and manage actual positions directly in FYERS.
- **Renew authorization** permits renewal to the same broker account while exposure exists. Switching accounts or disconnecting is blocked until exposure is resolved.
- Accounts are not allowed to share the same broker identity in this deployment.

## Attention states

Review an attention/unknown state directly against FYERS orders, fills and positions. Do not clear database state or submit replacement orders solely because an HTTP request timed out. If quantities differ because of manual trading, the system refuses to close a possibly unrelated position. Reconcile with the broker and platform operator.

Use a dedicated trading account/workflow for automated exposure. Do not manually mix the same symbol while it is managed by QuantPilot.

Live trade P&L remains unavailable until exact fills can be attributed reliably. Use FYERS's statement; an account-level aggregate is not a per-trade profit figure.

## Monitoring

Monitor web health and worker heartbeat separately. Alert on:
- worker heartbeat older than 45 seconds;
- prolonged order uncertainty, failed protection or pending exits;
- recurring broker authentication failures;
- long scan cycles, API throttling and stale quotes;
- database connection errors and backup failures.

The UI shows these execution states and audit events. External paging/alert delivery must be configured by the operator; this release does not silently assume such monitoring exists.

The worker currently uses sequential REST polling. It is suitable for a measured pilot only; run load tests under the actual broker API plan before increasing users. Market-data streaming, per-account work partitioning and horizontally scaled execution would require additional implementation and tests.

## Data and security

- Passwords are hashed with salted scrypt.
- Session and recovery/OAuth tokens are stored as hashes.
- Broker access tokens are encrypted with AES-256-GCM and bound to user ID as authenticated data.
- Mutations require the configured origin and a session CSRF token.
- Sessions use HttpOnly, SameSite=Lax cookies and Secure cookies in production.
- Account identifiers in browser responses are masked; platform secrets are server-only.
- Authentication throttles persist in PostgreSQL. Expired sessions/tokens/rate-limit rows are cleaned by the worker.
- No real broker credentials or legacy databases are included in the release archive.

Protect Render, GitHub, email and FYERS accounts with MFA. End-user application MFA, an administrative console, user self-service deletion, billing and a complete public-product legal/onboarding process are not implemented in this beta.

## Backups

Enable the selected database plan's supported backups/PITR and test a restore to an isolated database. Back up the encryption key separately. Never restore an old database and immediately resume live execution: reconcile every active intent with the broker first, because the broker may have accepted orders after the backup.

No previous Python accounts or tokens are auto-imported. Create new platform accounts and reauthorize FYERS.

