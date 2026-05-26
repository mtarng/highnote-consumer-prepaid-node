# highnote-consumer-prepaid-node

A reference application demonstrating a **consumer prepaid card** workflow on
the [Highnote](https://highnote.com) platform, built with the
[`@highnote-oss/nodejs-sdk`](https://github.com/highnote-oss/nodejs-sdk).

**Stack:** Fastify 5 + React 19 + SQLite (Drizzle ORM) + Highnote Node SDK.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/highnote-oss/highnote-consumer-prepaid-node)

For other Highnote example scenarios, see the
[`highnote-examples`](https://github.com/highnote-oss/highnote-examples)
catalog.

## Deploy to Render

1. Click the **Deploy to Render** button above (or fork this repo and create a new Web Service from `render.yaml`)
2. Set the required environment variables:
   - `HIGHNOTE_API_KEY` — your Highnote API key (from [dashboard.highnote.com](https://dashboard.highnote.com))
   - `HIGHNOTE_CARD_PRODUCT_ID` — your card product ID
3. Click **Create Web Service**

Once deployed, your app is available at `https://<your-app>.onrender.com`:

| Endpoint | Description |
|----------|-------------|
| `/` | Web app (login, dashboard, card management) |
| `/docs` | Swagger UI — interactive API documentation |
| `/health` | Health check |
| `/webhooks` | Webhook events viewer (requires login) |

### Webhooks

On Render, webhooks register themselves automatically. Each deploy:

1. Detects the public URL via `RENDER_EXTERNAL_URL` (auto-injected by Render).
2. Removes any prior `bay19-auto-*` notification targets so the dashboard stays clean.
3. Calls Highnote to register a fresh notification target named `bay19-auto-<commit-sha>` subscribed to all events.
4. Holds the returned signing key in process memory (never logged, never persisted, never exposed via the API). The key rotates every deploy by design.

Visit the **Webhook Events** page in the app to see the registration status (Active / Pending / Failed / Deactivated) and a live event log. The status panel live-refreshes from Highnote, so it reflects the true state of the target. If registration fails (e.g., transient Highnote outage), use the **Re-register** button on that page to retry.

To use webhooks during local development, set `WEBHOOK_PUBLIC_URL` to a public tunnel URL (e.g., from ngrok) and the same auto-registration flow runs locally.

## Local Development

### Prerequisites

- Node.js 22+
- A Highnote test API key
- A card product ID from your Highnote dashboard

### Setup

```bash
# API server (port 3000)
cd api
cp .env.template .env  # fill in your Highnote credentials
npm install
npm run dev

# Web frontend (port 5173) — in a separate terminal
cd web
npm install
npm run dev
```

The web dev server proxies `/api` requests to the API server automatically.

### Docker (local)

```bash
docker compose up --build
# App available at http://localhost:3000
```

## Architecture

The demo runs as a single Fastify process serving both the API and the prebuilt React app. SQLite is used purely as an event log — Highnote is the source of truth for all card, account, and application state. Behavior diverges in one place: **how webhooks are registered**.

### On Render (deployed)

```
Render Web Service (single container)

  Fastify Server (port 3000)
  │
  ├── On boot
  │     └── webhookRegistration.init()
  │           ├── reads RENDER_EXTERNAL_URL (auto-injected)
  │           ├── highnote.webhooks.list()       ─── removes prior bay19-auto-* targets
  │           └── highnote.webhooks.add()        ─── registers fresh target, all events
  │                 └── signing key held in-process (never logged or persisted)
  │
  ├── /                          → React SPA (Vite build, served static)
  ├── /docs                      → Swagger UI
  ├── /health                    → Liveness probe
  │
  ├── /api/* (JWT-protected)     → Application/card/transaction routes
  │
  └── /api/webhooks/*
        ├── POST   /                       → public, signature-verified, deduped on event_id
        ├── GET    /events                 → local event log from SQLite
        ├── GET    /status                 → registration state, live-refreshed via webhooks.get()
        ├── POST   /register               → manual retry (re-runs init())
        ├── GET    /delivery-attempts      → Highnote's record via webhooks.listEvents()
        └── POST   /events/:id/replay      → re-fires via webhooks.replay()

  SQLite (ephemeral, wiped on every deploy)
```

Key property of the deployed flow: signing keys live only in process memory and rotate every deploy. There's nothing to copy or persist anywhere. Past deploys' targets are removed during boot so the Highnote dashboard stays clean.

### Locally

```
Local dev (no public URL)

  Fastify Server (port 3000)
  │
  ├── On boot
  │     └── webhookRegistration.init()
  │           ├── no WEBHOOK_PUBLIC_URL set
  │           ├── RENDER not "true"
  │           └── logs "skipping auto-register" → server stays up, no signing key
  │
  └── Webhook receiver still mounted, but Highnote can't reach it
        └── frontend polling (TanStack Query refetchInterval) drives the UI

  Vite dev server (port 5173) → proxies /api/* to :3000
```

The receiver is still there if needed — set `WEBHOOK_PUBLIC_URL` to an ngrok-style tunnel URL (e.g. `https://abc123.ngrok.io`) and the **same** auto-registration flow runs locally, producing the same in-memory signing key behavior as production. Without that env var, the demo runs entirely on polling and Highnote never sees the local instance.

## Security

This is a **reference demo, not a production-hardened build.** See
[`SECURITY.md`](./SECURITY.md) for the deliberate gaps and a note on what the
word "production" means in this codebase (short version: it means "the
deployed-demo mode," not "production-grade").

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HIGHNOTE_API_KEY` | Yes | Highnote API key (test or live) |
| `HIGHNOTE_ENVIRONMENT` | Yes | `test` or `live` (default: `test`) |
| `HIGHNOTE_CARD_PRODUCT_ID` | Yes | Card product for applications |
| `WEBHOOK_PUBLIC_URL` | No | Public URL to register with Highnote. On Render, leave unset — `RENDER_EXTERNAL_URL` is auto-detected. Set this only for local-tunnel testing (ngrok, etc.). |
| `JWT_SECRET` | When `NODE_ENV=production` (any hosted instance) | JWT signing key. Auto-generated by Render; set explicitly on other hosts. In local dev a per-process random secret is used and tokens invalidate on restart. |
| `PORT` | No | Defaults to `3000` |
| `CORS_ORIGIN` | No | Defaults to `http://localhost:5173` |
| `DATABASE_URL` | No | SQLite path, defaults to `./data/highnote-demo.db` |

## License

[MIT](LICENSE).
