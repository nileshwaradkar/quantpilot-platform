# Release acceptance

## Verified locally

The TypeScript compiler, SQL-backed API/integration tests, strategy tests, and execution-state tests are run with this release. See VERIFICATION.md for the final result.

Public FYERS metadata was fetched on 2026-11-01. Nearest-expiry selection resolved NIFTY, BANKNIFTY, FINNIFTY and CRUDEOIL. The commodity underlying mapped to its actual listed futures contract. This validates public metadata parsing, not authenticated data or order execution.

## Required before real orders

- Confirm platform app category/permissions, applicable broker/exchange requirements and registered outbound IPs with FYERS.
- Confirm OAuth callback and actual token expiry/renewal behaviour.
- Compare five-minute candle boundaries, indicator values and previous trading-day levels to a trusted independent calculation.
- Verify selected CE/PE expiry, strike, trade status, lot, tick, freeze quantity, and commodity price multiplier.
- Verify INTRADAY product support and the Positions TPSL offset semantics on every supported segment.
- Confirm whether TP/SL acknowledgement means protective orders are active; inspect resulting broker orders.
- Verify partial fill, remainder cancellation, protection, target/stop fill, and sibling exit cancellation.
- Test delayed order and position visibility, lost responses, duplicate process startup, restart, and disconnect.
- Test risk at fills different from limit prices, gaps through a stop, daily loss lock and account capital reservation.
- Test scheduled square-off against broker cutoff, holidays, same-day expiry and MCX session changes.
- Run a sustained paper-forward test with real broker market data, then an owner-supervised minimal-size live pilot only after the above passes.
- Verify native PostgreSQL integration/lease tests, restore procedure, worker watchdog, external alerts and actual Render deployment.
- Configure public registration email, MFA/admin operating procedures, privacy terms and support responsibilities before opening access broadly.

## Intentionally not claimed

No live broker order was submitted during development. No profitability, fill quality, maximum-loss guarantee, or production uptime guarantee is made by these tests. The public sample UI is not a trading account.

