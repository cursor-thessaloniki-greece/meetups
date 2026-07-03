# Luma → GitHub Sync

This repo includes:

- `api/luma-webhook.ts` — Vercel Serverless Function (TypeScript) that verifies Luma HMAC-SHA256 signatures and triggers a `repository_dispatch` to GitHub.
- `workers/luma-webhook.js` — Cloudflare Worker equivalent.
- `.github/workflows/luma-sync.yml` — GitHub Actions workflow listening for `repository_dispatch` type `luma_webhook` and writing `data/latest_event.json`.

Environment variables required for the middleware:

- `LUMA_WEBHOOK_SECRET` — your webhook secret from Luma.
- `GITHUB_TOKEN` — a GitHub personal access token with `repo` (or `repo:status` + `repo_deployment` + `public_repo`) scope, or use an Action/secret that can call the dispatch API.
- `GITHUB_REPOSITORY` — the repo in `owner/repo` format (e.g. `cursor-thessaloniki-greece/meetups`).

Vercel deployment (quick):

1. In your project on Vercel, go to Settings → Environment Variables and add `LUMA_WEBHOOK_SECRET`, `GITHUB_TOKEN`, and `GITHUB_REPOSITORY`.
2. Deploy the project (the file is at `api/luma-webhook.ts`).
3. The function will be available at `https://<your-deployment>/api/luma-webhook`.

Cloudflare Workers deployment (quick):

1. Create a new Worker and copy `workers/luma-webhook.js` content.
2. Set the Worker secrets `LUMA_WEBHOOK_SECRET`, `GITHUB_TOKEN`, and `GITHUB_REPOSITORY` via `wrangler secret put` or the Cloudflare dashboard.
3. Deploy and note the Worker URL.

Registering the endpoint in Luma Developer Dashboard:

1. In Luma, add a new webhook integration.
2. Set the webhook URL to your deployed endpoint (from Vercel or Cloudflare).
3. Set the secret to the same `LUMA_WEBHOOK_SECRET` value used by the middleware.
4. Choose the event types you want to forward.

Notes

- The middleware expects the `Webhook-Signature` header in the form `t=<timestamp>,v1=<hex>` and verifies `HMAC_SHA256(secret, "<timestamp>.<raw-body>")`.
- The GitHub Action will create or update `data/latest_event.json` on the `main` branch whenever a `repository_dispatch` with type `luma_webhook` is received.
