# Free hosted paper-testing pilot

Use **render-free.yaml**, not the paid render.yaml. This creates one Render Free web service and no paid Render resources. Accounts and paper trades require a separate dedicated Neon Free PostgreSQL database. Choose the Free plan and keep paid upgrades disabled.

## Limits that testers must know

Render can sleep after 15 minutes without inbound requests and can suspend service at free usage limits. The web process and scanner stop together. On wake-up, running setups are paused and require an explicit start. Existing paper positions resume using observed quotes: missed intraday stops/targets cannot be reconstructed, and paper results across downtime are incomplete. This is supervised testing, not uninterrupted intraday automation. Do not add artificial keep-alive traffic to evade provider limits.

The free launcher rejects live execution, even if LIVE_TRADING_ENABLED is changed to true. Use a dedicated paper database; the launcher refuses a database containing unresolved live trades. Never share this database with another deployment.

Neon Free has no time limit but has monthly compute, storage, and transfer quotas. A scanner uses database compute while running; quota exhaustion interrupts the pilot. Free Render PostgreSQL is deliberately omitted because it expires after 30 days.

## Deploy

1. Create a Neon **Free** project in a region close to Singapore. Use its direct/unpooled PostgreSQL connection: the scanner holds a session advisory lock, which is incompatible with transaction pooling. Preserve certificate verification (sslmode=verify-full); never disable TLS verification. Do not paste the database password into chat or commit it.
2. In Render select the private quantpilot-platform repository and set Blueprint Path to **render-free.yaml**. Review that only one **Free** web service is proposed. Do not apply the earlier paid Blueprint.
3. Supply DATABASE_URL directly in Render. ENCRYPTION_KEY and REGISTRATION_CODE are generated. APP_ORIGIN defaults to Render's assigned HTTPS URL. Migrations run at startup because paid pre-deploy commands are unavailable.
4. Deploy and verify /healthz, login, and worker heartbeat. Restart monitoring explicitly after any restart. The application displays a free-hosting notice.
5. Configure FYERS_APP_ID and FYERS_APP_SECRET securely in Render for broker authorization. Register the actual HTTPS origin plus /api/broker/callback with FYERS. Until this is configured, users can try the sample workspace but cannot start real-market paper scans.
6. Share the verified public application URL plus the invitation code with your invited testers. Keep invite registration for the pilot. SMTP/password recovery is not configured by this free Blueprint.

No deployment or broker-connected validation is implied by the existence of this file.

Official limits checked 2 November 2026:
- https://render.com/docs/free
- https://neon.com/pricing
