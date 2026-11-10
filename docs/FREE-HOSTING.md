# Free deployment: Render dashboard + laptop scanner

## Architecture

Safari / laptop browser -> Render Free dashboard -> Neon Free PostgreSQL.
Laptop scanner -> FYERS real market data -> same Neon database.

The scanner runs on your laptop, independently of the dashboard. Render sleeping does not stop that scanner. Keep your laptop plugged in, awake, online, and the scanner window open. Closing Safari is fine. Closing the laptop lid may suspend Windows and stop scanning: configure Windows sleep settings yourself for the trading session.

Only simulated paper orders are supported by these launchers. FYERS supplies actual market data after authorization. Quotes and candles are polled, not exchange tick streaming. The fixed 5-minute strategy and premium 10-point stop / 20-point target remain unchanged. These are simulated exit thresholds; gaps and downtime can result in different observed fills. No missing ticks or stops are reconstructed during outages.

## One-time cloud setup

1. Upload the contents of the release ZIP into the root of your private quantpilot-platform GitHub repository, replacing the old files. Do not upload the ZIP itself or your parent working folder.
2. In Render: New > Blueprint > select that repository. Use **render.yaml** (default). It must show only **one Free web service**, no database or paid worker. Cancel the old paid Blueprint/payment form. The optional paid configuration is now render-paid.yaml.
3. Reuse your Neon Free project **quantpilot-paper** (project ID royal-band-39977149, Singapore). Get its direct/unpooled connection URL from the Neon console, database quantpilot, role quantpilot_owner. Use sslmode=verify-full. Do not use a hostname containing -pooler: the scanner uses a session advisory lock. Do not upgrade the Neon plan.
4. Enter DATABASE_URL, FYERS_APP_ID and FYERS_APP_SECRET in the Render Blueprint inputs. These are platform app credentials, not your FYERS login password. Never commit secrets. Render generates ENCRYPTION_KEY and REGISTRATION_CODE. Leave all live flags false.
5. Deploy. Build: npm ci --include=dev && npm run build && npm test. Start: npm run start:cloud. Health path: /healthz. Startup applies migrations automatically; no paid pre-deploy feature is needed.
6. Copy the assigned HTTPS service URL. Register **that URL + /api/broker/callback** as the redirect URL in your FYERS app. APP_ORIGIN defaults to Render's assigned URL; set it explicitly if using a custom domain.
7. Visit the URL, create your account with the generated REGISTRATION_CODE, then connect FYERS. Share the invitation code only with invited testers. SMTP/password reset email is not configured; standard SMTP ports are blocked on Render Free.

## One-time laptop setup

1. Install Node.js 22 if needed. Extract the same release package into a local folder.
2. Copy .env.laptop.example to **.env** in that folder (do not overwrite an existing .env without checking it).
3. Copy DATABASE_URL, ENCRYPTION_KEY, REGISTRATION_CODE, FYERS_APP_ID and FYERS_APP_SECRET from your Render settings into .env. The database and encryption key MUST be identical on both hosts so the scanner can decrypt stored authorization tokens. Set APP_ORIGIN to your actual Render HTTPS URL.
4. Double-click **Start Paper Scanner.cmd**. The first start installs dependencies, builds the scanner, and starts it in a visible terminal. Leave that window open. Do not run the older sample-preview launcher for real paper scanning.

## Each trading morning

1. Start Paper Scanner.cmd on the laptop. Check that Windows will stay awake and online.
2. Open your Render HTTPS URL on your laptop or iPhone Safari. Sign in and renew FYERS authorization if expired.
3. Select Paper -> Options (or Equity), configure market and risk limits, and click Start monitoring. Worker restarts deliberately pause new entries: explicitly start them again.
4. Confirm worker online and FYERS connected. Signals and paper positions appear only when market data is valid and the strategy conditions actually match; an empty journal is not itself a failure.
5. On iPhone, open the same URL and sign in with the SAME QuantPilot account. The dashboard polls while visible. Safari may pause browser updates in the background, but the laptop scanner continues. Reopen/refresh to see current results. No laptop port forwarding or shared Wi-Fi is needed.
6. At session end, pause new entries and close remaining paper positions using the dashboard. Confirm closure before closing the scanner terminal.

## Verification and limits

Check /healthz, signup/login, FYERS callback, worker heartbeat, then a paper position from a valid signal. Compare contract, expiry, timestamp, entry and exits with FYERS. Authenticated FYERS acceptance testing remains required; automated tests do not establish live-market correctness.

Render Free sleeps after 15 minutes without inbound traffic; waking can take about a minute. While the dashboard sleeps, the laptop continues scanning through Neon. Database outages, laptop sleep, and free quotas interrupt scanning. Emergency controls require the dashboard and scanner to be reachable. After any scanner restart, new entries need explicit resumption. Do not use this setup for real-money orders.

Free usage is quota-limited, not unlimited hosting. No paid resources are requested by render.yaml. Render's free PostgreSQL expires after 30 days, so use the existing Neon Free database instead.

References checked 10 November 2026: https://render.com/docs/free and https://neon.com/pricing
