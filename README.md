# WhiteMail Sender

A responsive email sender UI and server-side API built with HTML, CSS and JavaScript. Designed for Vercel + Supabase + Brevo.

## Important sending limits

The app supports a configurable app-side cap, defaulting to 1,000 sends/day. This is not a provider quota. Brevo's official Free plan currently documents **300 email sends/day**, so this project defaults `PROVIDER_DAILY_LIMIT=300`. For 1,000/day, use a provider plan/account that explicitly permits that volume and configure the cap to match. Do not try to evade provider limits by rotating accounts or keys.

No sender can guarantee inbox placement. Use a verified sender domain, SPF/DKIM/DMARC, consent-based lists, unsubscribe handling and bounce/complaint suppression.

## Deploy

1. Create a Supabase project.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. Create a Brevo account and API key; verify the sender/domain in Brevo and publish the DNS records it gives you.
4. Push this folder to a GitHub repository and import it into Vercel.
5. Add environment variables from `.env.example` in Vercel Project Settings. Generate a long random `WHITEMAIL_ADMIN_TOKEN` (32+ random characters). Enter the same token via the dashboard's **Set access token** button. Keep `WHITEMAIL_ADMIN_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` and `BREVO_API_KEY` server-side; never prefix them with `NEXT_PUBLIC_` or put their values in frontend JavaScript.
6. Deploy and open the site. Test with your own address first.
7. Confirm provider daily caps and account status before production use.

## Features

- WhiteMail Sender branded responsive dashboard and message composer.\n- CSV contact import and deduplication.\n- Scheduled sends using a Supabase-backed queue.\n- Queue worker with bounded retries for temporary errors.\n- Admin-token gate for the API; keep the app private and rotate the token if exposed.
- Unique recipient parsing and client/server validation.
- Consent confirmation and batch cap of 50 recipients/request.
- Server-side provider API call; API keys are never exposed to browser.
- Supabase send logs and advisory-lock-backed quota reservations.
- UTC daily quota accounting and recent activity.

## API endpoints

- `GET /api/status` — application quota and latest logs.
- `POST /api/send` — sends a message to 1–50 unique recipients.\n- `POST /api/campaign` — queues a scheduled message for 1–50 recipients.\n- `GET /api/worker` — processes due jobs when invoked by a supported Vercel Cron deployment; `WHITEMAIL_CRON_SECRET` can authorize manual runs.

## Production hardening before public launch

This is a protected single-admin starter, not a complete multi-tenant ESP. The shared admin token is a basic gate, not a substitute for Supabase Auth or per-user authorization. Before opening it to public users, add Supabase Auth, per-user quotas, provider webhook signature validation for delivered/bounced/complained events, a real one-click unsubscribe endpoint and suppression table, rate limiting/WAF, and a durable queue for larger campaigns. Keep access restricted.

## Email consent

Only send to people who explicitly opted in or where you otherwise have a lawful basis. Do not use this application for unsolicited bulk email, purchased lists, scraping, or evading spam controls. Respect provider policies and applicable law.

## Scope note\nThis version supports live one-by-one transactional sends through Brevo, CSV import, a quota dashboard and send logs. True delivery/bounce webhooks, one-click unsubscribe endpoint, and multi-user login are not implemented in this starter. Scheduled queue jobs and bounded retries for temporary worker failures are included. The provider's API acceptance is not the same as confirmed inbox delivery.\n\n\n## Scheduling note\nVercel Cron availability and frequency depend on your Vercel plan. If your plan cannot run every five minutes, adjust `vercel.json` to an allowed schedule or invoke the worker securely from an external scheduler. The worker uses a simple conditional claim; for high concurrency, replace this with a PostgreSQL `FOR UPDATE SKIP LOCKED` claim RPC.\n