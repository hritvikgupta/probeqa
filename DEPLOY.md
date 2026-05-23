# Deploying probe-app

Two surfaces, one repo:

| Host                | Hosts                  | Serves                                          |
| ------------------- | ---------------------- | ----------------------------------------------- |
| `app.probeqa.com`   | Fly.io (this Dockerfile) | Full app: `/api/*` + the Vite SPA (login, agents, billing, …) |
| `www.probeqa.com`   | Vercel (this `vercel.json`) | Marketing landing + `/blog`, `/docs`. Any authed path (`/login`, `/signup`, `/agents`, `/settings`, `/billing`, `/editor`, …) is 302-redirected to `app.probeqa.com`. |

The same repo is the source for both — Vercel only ships `dist/` (no API), Fly ships the full server.

---

## 1 · Fly.io — `app.probeqa.com`

One-time setup:

```bash
brew install flyctl
fly auth login
fly launch --no-deploy --name probe-app --region iad   # detects fly.toml + Dockerfile
```

Set runtime secrets (never committed):

```bash
fly secrets set \
  DATABASE_URL="<neon-postgres-url>" \
  DODO_ENV="live_mode" \
  DODO_API_KEY="<dodo-api-key>" \
  DODO_PRODUCT_ID="pdt_..." \
  DODO_WEBHOOK_KEY="<dodo-webhook-secret>" \
  APP_URL="https://app.probeqa.com" \
  AGENTMAIL_API_KEY="<agentmail-key>" \
  COMPOSIO_API_KEY="<composio-key>"
```

> `APP_URL` is what the billing success redirect uses in production. Without it, Dodo would bounce users back to the Fly internal hostname.

Deploy and attach the domain:

```bash
fly deploy
fly certs add app.probeqa.com   # then add the printed A/AAAA records at your registrar
```

DB schema (run any time the `users` / `agents` / `projects` schema changes):

```bash
DATABASE_URL="<neon-url>" npm run db:push
```

---

## 2 · Vercel — `www.probeqa.com` (landing only)

In Vercel:

1. **Import Git Repository** → pick the `probe-app` repo.
2. Framework preset: **Vite** (auto-detected). `vercel.json` overrides aren't needed — they're already in the repo.
3. **Project Settings → Domains**: add `www.probeqa.com` and `probeqa.com` (set `www` as primary, redirect apex → www). Add the registrar DNS records Vercel shows.
4. **Environment Variables**: none — the landing is a static SPA and never calls `/api/*`.

Pushing to `main` deploys the landing. The `redirects` block in `vercel.json` automatically forwards any app route someone types on `probeqa.com`/`www.probeqa.com` to `app.probeqa.com`.

---

## 3 · DNS summary

At your registrar:

| Record | Name | Value |
| --- | --- | --- |
| A / AAAA | `app` | (Fly IPs from `fly ips list`) |
| CNAME | `www` | `cname.vercel-dns.com` |
| A | `@` (apex) | `76.76.21.21` (Vercel) |

---

## 4 · Dodo webhook (production)

Dodo dashboard → **Developer → Webhooks**:

- URL: `https://app.probeqa.com/api/billing/webhook`
- Copy the signing secret into Fly: `fly secrets set DODO_WEBHOOK_KEY="<secret>"`

That's it — the webhook flips `plan` to `pro` / `free` automatically on `subscription.active|renewed|cancelled|expired|failed|on_hold`.
