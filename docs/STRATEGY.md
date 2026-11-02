# Fixed intraday rules

## Options: agreed requirements

Markets: NIFTY, BANKNIFTY, FINNIFTY, standard MCX CRUDEOIL. Crude oil mini is deliberately excluded.

1. Evaluate completed **five-minute** candles.
2. Use the prior trading session's daily high and low from the underlying's daily history.
3. Underlying above prior high selects an ATM CE. Underlying below prior low selects an ATM PE.
4. Select the nearest available, unexpired contract expiry. Same-day expiry is eligible before the trading cutoff.
5. Select the listed strike nearest the underlying price, using the lower strike for an exact tie.
6. Require all of these on the selected option's own latest completed candle:
   - Close > open.
   - Open > SMA(close, 20) and close > SMA(close, 20).
   - MACD(12,26) > its EMA(9) signal.
   - RSI(14) crosses from <= RSI(20) on the preceding candle to > RSI(20) now.
   - Volume > average volume of the preceding five candles, excluding the signal candle.
7. Buy the selected CE or PE. Both are long-premium trades.
8. Stop-loss = actual average fill minus 10 premium points.
9. Target = actual average fill plus 20 premium points.

Exchange tick rounding applies. Slippage, gaps, fees, and partial fills mean realised results need not equal exactly -1R or +2R.

## Explicit implementation choices

These resolve details that were not specified as separate inputs:

- **Breakout confirmation uses the underlying's matching five-minute candle close**, rather than a transient intrabar tick. The underlying and option candle timestamps must match.
- Retests are eligible while the underlying closes beyond the prior level, but each entry still requires a fresh RSI crossover. One entry intent per setup per signal candle is enforced.
- ATM is selected at the signal candle's underlying close. History always belongs to that exact contract. History from different strikes/expiries is never stitched.
- At least 100 closed option candles are required. This may skip newly listed or illiquid contracts.
- Wilder RSI and EMA-based MACD are used. Both current RSI values and prior values must exist.
- Stale signals (>90 seconds after candle close), stale quotes (>30 seconds), missing recent intraday bars, unsynchronized data, invalid OHLCV, or unavailable metadata prevent entry.
- A quote more than half a stop-distance away from the signal close prevents entry.
- Intraday equity/index entries run 09:15–15:15 IST; positions are queued for square-off at 15:15. Commodity entries start at 09:00 with a conservative default square-off at 23:00. These operator-configured exchange schedules must be checked against broker rules, holidays, expiry sessions, and special sessions.
- Weekends are blocked. Operator-maintained NSE_HOLIDAYS and MCX_HOLIDAYS supplement freshness checks. Special weekend sessions are not enabled automatically.
- No trailing stop, averaging down, pyramiding, or overnight intent is included.

## Metadata and commodity sizing

The active FYERS JSON symbol master supplies expiry, exchange token, lot size, tick size, freeze quantity, and price multiplier. No index lot size is hardcoded.

MCX option underlying tokens may contain a zero-padded exchange token rather than the dated futures fyToken. Resolve the exchange code to exactly one active standard CRUDEOIL future. Ambiguous or missing mappings prevent entry.

For broker quantity Q and price multiplier M:

- Premium capital = entry premium × Q × M.
- Nominal stop risk = 10 × Q × M.
- Paper P&L = (exit - entry) × Q × M.

For example, if metadata specifies Q=1 lot and M=100, a ten-point premium stop risks ₹1,000 before costs, not ₹10. Tests cover this distinction.

## Equity preset

The stock preset retains the initial equity setup: same-stock prior-day breakout; five-minute directional candle touching SMA20 with at least 60% of its body beyond the line; directional RSI14/20 crossover; MACD sign; preceding-five-bar volume confirmation. Long and short directions are mirrored. Stop is the prior two candles' low/high, and target is 2R. The fixed 10/20 premium-point exits apply only to options. Named engulfing/hammer filters and configurable swing stops are not required in this release.

## Risk and execution

Whole-lot quantity is bounded by risk per trade, capital, and broker freeze quantity. The strictest daily loss cap among a user's saved setups applies per mode. Active risk/capital is reserved across setups, and a daily loss lock remains sticky until the next IST day. The daily threshold is an entry/exit control, not a guarantee against gaps.

Paper entries/exits use observed quotes and exclude charges. A gap through the stop is filled at the observed quote, not an invented ideal stop price.

Live entries use a limit order; partial remainders are cancelled before an exit. TPSL protection is attached to the confirmed position with broker offset semantics. The position must remain monitored until an authoritative flat state is confirmed. Live P&L is not invented from a shared position aggregate; use the broker statement. Account-wide broker P&L is used for the live daily loss guard.

Broker semantics and availability must pass [acceptance testing](ACCEPTANCE.md) before enabling live mode.

