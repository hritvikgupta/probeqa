<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.probeqa.com/favicon.svg" />
    <img alt="Probe" src="https://www.probeqa.com/favicon.svg" height="64" />
  </picture>
  <h1 align="center">Probe</h1>
  <p align="center"><strong>Agentic testing for the AI-native team.</strong><br />
  One autonomous agent covers your web, mobile, and APIs end-to-end.</p>
  <p align="center">
    <a href="https://www.probeqa.com">www.probeqa.com</a> ·
    <a href="https://app.probeqa.com">app.probeqa.com</a> ·
    <a href="https://www.probeqa.com/docs">Docs</a> ·
    <a href="https://www.probeqa.com/blog">Blog</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
  </p>
</div>

---

## What is Probe?

Probe is an **autonomous QA platform** that tests your applications without scripts, fixtures, or selectors.

Describe what you want to test in plain English — a checkout flow, an API endpoint, a signup form. Probe's agent plans the full test suite, drives every surface in a real browser, records what happens, and files verified bug reports straight into GitHub, Linear, or Slack.

**No test framework to maintain. No flaky selectors to chase. No manual triage.**

### How it works

1. **Describe your intent** — "Test the checkout flow on shop.acme.com. Focus on payment edge cases."
2. **Probe plans the tests** — The agent enumerates every meaningful variation: happy path, validation errors, race conditions, locale quirks. Approve, edit, or let it run.
3. **The agent drives the surface** — It navigates, clicks, and types like a real user, recording the result of every step.
4. **Verified bug reports land in your tools** — When something breaks, Probe writes a complete ticket with reproduction steps and screenshots in GitHub, Linear or Jira.

## Key features

- **All surfaces** — Web app, mobile webview, public APIs, webhooks. One config, no separate frameworks.
- **Real coverage** — Agents explore the long tail hand-written tests miss: empty carts, malformed inputs, slow networks, weird locales.
- **Your stack** — Plug into GitHub, Linear, Jira and Slack in minutes. Results land where your team already lives.
- **Email agent** — Chat with the agent over email. Ask it to test a flow, kick off a run, or check results — it replies in the thread and files issues automatically.
- **Pay per run, no seats** — No per-user pricing. Pay for what you use.

## Tech stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 18, TypeScript, Vite, React Router, Hono |
| **Backend** | Node.js, Hono, tsx |
| **Database** | PostgreSQL via Neon, Drizzle ORM |
| **AI** | OpenRouter AI SDK, Vercel AI SDK |
| **Browser automation** | Playwright (Chromium) |
| **Payments** | Dodo Payments |
| **Integrations** | Composio (GitHub, Slack, Linear, Gmail, Notion, Google Sheets, Google Calendar) |
| **Infrastructure** | Docker, Fly.io, Vercel |

## Getting started

### Prerequisites

- Node.js 20+
- npm
- A PostgreSQL database (Neon recommended)
- API keys for OpenRouter, Composio, AgentMail and Dodo Payments (see `DEPLOY.md`)

### Local development

```bash
# Clone the repository
git clone https://github.com/hritvikgupta/probeqa.git
cd probeqa

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env   # fill in your keys

# Push the database schema
npm run db:push

# Start the development server
npm run dev
```

The dev server starts both the Vite dev server (SPA) and the Hono API server concurrently.

### Available scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start both web and API dev servers concurrently |
| `npm run dev:web` | Start only the Vite dev server |
| `npm run dev:agent` | Start only the Hono API server (with file watching) |
| `npm run build` | Type-check and build the SPA |
| `npm run preview` | Preview the production build |
| `npm run db:push` | Push Drizzle schema changes to the database |

## Deployment

Probe deploys to two surfaces from the same repository:

| Host | Domain | Serves |
| --- | --- | --- |
| **Fly.io** | `app.probeqa.com` | Full app: API + SPA (login, agents, billing, etc.) |
| **Vercel** | `www.probeqa.com` | Marketing landing + blog + docs (static SPA, no API) |

See [`DEPLOY.md`](./DEPLOY.md) for the full deployment guide.

## Project structure

```
probeqa/
├── public/             # Static assets
├── server/             # Hono API server
│   ├── agent.ts        # Agent orchestration
│   ├── browser.ts      # Playwright browser management
│   ├── db/             # Database schema and client
│   ├── billing.ts      # Payment processing (Dodo)
│   └── ...
├── src/                # React SPA
│   ├── components/     # Reusable UI components
│   ├── views/          # Page-level components
│   ├── blog/           # MDX blog posts
│   ├── App.tsx         # Root component
│   └── main.tsx        # Entry point
├── DEPLOY.md           # Deployment instructions
├── Dockerfile          # Fly.io container build
├── vercel.json         # Vercel configuration
└── fly.toml            # Fly.io configuration
```

## Contributing

We welcome contributions! Please open an issue to discuss your idea before submitting a pull request.

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/my-feature`).
3. Make your changes.
4. Run the build (`npm run build`) to verify everything compiles.
5. Commit and push your branch.
6. Open a pull request.

## License

[MIT](./LICENSE) — see the LICENSE file for details.

---

<p align="center">
  <a href="https://www.probeqa.com">Probe Labs</a> ·
  <a href="mailto:founders@probe.dev">founders@probe.dev</a> ·
  548 Market St, San Francisco CA 94104
</p>