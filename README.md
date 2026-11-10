# QuantPilot: free dashboard and real-market paper scanner

Deploy the dashboard on Render Free, store accounts/results in Neon Free, and run the FYERS paper scanner on your laptop each trading morning. View the same account from iPhone Safari over HTTPS.

**Follow [docs/FREE-HOSTING.md](docs/FREE-HOSTING.md) for the complete setup and daily workflow.**

- `render.yaml` is the default Free dashboard Blueprint; `render-free.yaml` is identical.
- `Start Paper Scanner.cmd` starts the laptop scanner; copy `.env.laptop.example` to `.env` and configure matching cloud credentials first.
- `render-paid.yaml` preserves the optional paid architecture. Do not select it for free hosting.
- `Start QuantPilot.cmd` is the older local sample UI preview, not the real-market scanner.

The supplied fixed strategy is built in: five-minute completed candles, previous-session breakout, nearest-expiry ATM options, SMA20, RSI14/20 crossover, positive MACD, volume confirmation, and 10/20 premium-point exits. Live trading is blocked by the paper launchers.

Run `npm ci` and `npm run check` to build and test. The current suite contains 52 tests. Automated tests do not replace authenticated FYERS acceptance testing. No successful hosted deployment or broker authorization is implied by this repository.

Render can sleep; the independent laptop scanner continues while the laptop and Neon remain available. Keep the laptop awake, plugged in, and online. Free quotas apply. Broker tokens and secrets must never be committed.
