<div align="center">
  <img width="48" src="https://www.probeqa.com/favicon.svg" alt="Probe logo" />
  <h1 align="center">Probe</h1>
  <p align="center"><strong>Agentic testing for the AI-native team</strong></p>

  <p align="center">
    <a href="https://www.probeqa.com">Website</a> ·
    <a href="https://www.probeqa.com/docs">Docs</a> ·
    <a href="https://www.probeqa.com/blog">Blog</a> ·
    <a href="https://github.com/hritvikgupta/probeqa">GitHub</a>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff" alt="TypeScript" />
    <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=000" alt="React" />
    <img src="https://img.shields.io/badge/Playwright-45BA4B?logo=playwright&logoColor=fff" alt="Playwright" />
    <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=fff" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=fff" alt="Hono" />
  </p>
</div>

---

Probe is an **autonomous, AI-native testing platform** that drives real browsers to test your web applications. Instead of writing and maintaining brittle test scripts, you describe what to test in plain English — Probe's agents plan, execute, verify, and report the results. They file verified bug reports straight to your GitHub, Linear, or Slack, complete with screenshots, console traces, and reproduction steps.

## How it works

1. **Create an agent** — point it at your application's URL and describe what you want to test.
2. **Plan in natural language** — the agent proposes a step-by-step test plan. Approve, modify, or iterate on it as you would with a human QA engineer.
3. **Run** — the agent drives a real Playwright browser: navigates, clicks, fills forms, runs assertions, and captures screenshots at every step.
4. **Verify** — each step is recorded with pass/fail status, console error logs, and visual evidence.
5. **Report** — failures are automatically filed as GitHub issues, posted to Slack, or emailed — wherever your team works.

## Key capabilities

| Capability | Description |
|---|---|
| **🧠 Autonomous agents** | AI agents that reason, act, and observe in a ReAct loop — planning and executing tests without hand-coded selectors. |
| **🌐 Real browser control** | Full Playwright/Chromium integration — navigate, click, fill, assert, and inspect the accessibility tree. |
| **📝 Natural language test plans** | Generate and iterate on step-by-step test plans by conversation with the agent. |
| **🔄 Record & replay** | Capture manual flows through the browser and save them as replayable automated tests. |
| **📅 Scheduled runs** | Cron-based automated execution — hourly, daily, or monthly. |
| **🐛 GitHub issue filing** | Failed checks auto-create issues with screenshots, console errors, and reproduction steps in the connected repository. |
| **🔌 Multi-channel integrations** | Post results to Slack, Gmail, Notion, Linear, or any Composio-connected service. |
| **📊 Pass/fail tracking** | Per-step status, duration, summary reports, and historical run records. |
| **📁 Project & agent grouping** | Organize agents into projects with team-level visibility. |
| **💳 Usage-based billing** | Free and Pro tiers via Dodo Payments. |

## Technology stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, React Router, MDX |
| **Backend** | Hono (Node.js), TypeScript, Server-Sent Events |
| **AI/LLM** | OpenRouter gateway (Grok, Claude, Gemini, etc.) via Vercel AI SDK |
| **Browser automation** | Playwright (Chromium) |
| **Database** | PostgreSQL via Drizzle ORM (Neon serverless) |
| **Integrations** | Composio (GitHub, Slack, Gmail, Notion, Linear, and 200+ tools) |
| **Auth** | Session-based with bcrypt password hashing |
| **Billing** | Dodo Payments |
| **Email** | AgentMail |
| **Deployment** | Fly.io (full app) + Vercel (landing page) |
| **Containerization** | Docker multi-stage build |

## Architecture

```
┌─────────────┐     ┌─────────────────────────────────────────────┐
│   Browser   │     │           Fly.io / Docker (app)              │
│  (Vite SPA) │────▶│                                             │
└─────────────┘     │  ┌──────────┐  ┌─────────────────────┐      │
                    │  │  Hono    │  │  Playwright Browser  │      │
┌─────────────┐     │  │  Server  │──│  (per-session)      │      │
│  Vercel     │     │  └────┬─────┘  └─────────────────────┘      │
│  (landing)  │     │       │                                      │
│  /blog/docs │     │  ┌────▼─────┐  ┌─────────────────────┐      │
└─────────────┘     │  │PostgreSQL│  │  OpenRouter LLM     │      │
                    │  │ (Drizzle)│  │                     │      │
                    │  └──────────┘  └─────────────────────┘      │
                    └─────────────────────────────────────────────┘
```

The application runs as a single Node.js server (Hono) that handles both the API and serves the Vite-built SPA. Each active agent session gets a dedicated Playwright browser context. The server auto-scales across Fly.io machine pools: a 1 GB baseline for everyday load and suspended 8 GB workers that wake on demand.

## Getting started

### Prerequisites

- Node.js 20+
- A PostgreSQL database (Neon recommended for serverless)

### Local development

```bash
# Clone the repository
git clone https://github.com/hritvikgupta/probeqa.git
cd probeqa

# Install dependencies
npm install

# Install Playwright Chromium
npx playwright install --with-deps chromium

# Set up environment variables
cp .env.example .env  # or configure your shell with the vars below
```

#### Required environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENROUTER_API_KEY` | API key for OpenRouter LLM gateway |
| `LLM_MODEL` | Model identifier (default: `x-ai/grok-build-0.1`) |

Optional — needed for integrations and billing:

| Variable | Description |
|---|---|
| `COMPOSIO_API_KEY` | Composio API key for third-party integrations |
| `AGENTMAIL_API_KEY` | AgentMail API key for email sending |
| `DODO_API_KEY` | Dodo Payments API key for billing |
| `DODO_PRODUCT_ID` | Dodo Payments product ID |
| `DODO_WEBHOOK_KEY` | Dodo Payments webhook signing secret |
| `APP_URL` | Public URL for billing redirects |

```bash
# Push schema changes to your PostgreSQL database
npm run db:push

# Start both the Vite dev server and the API server
npm run dev
```

The Vite dev server runs on `http://localhost:3005` and proxies `/api/*` requests to the Hono server on port 8787.

### Available scripts

| Script | Description |
|---|---|
| `npm run dev` | Start both web and API dev servers concurrently |
| `npm run dev:web` | Start only the Vite dev server |
| `npm run dev:agent` | Start only the Hono API server (with file watching) |
| `npm run build` | Type-check and build the SPA |
| `npm run preview` | Preview the production build |
| `npm run db:push` | Push Drizzle schema changes to the database |

## Project structure

```
probeqa/
├── server/               # Backend (Hono + TypeScript)
│   ├── index.ts          # Server entry — routes, auth, middleware
│   ├── agent.ts          # AI agent orchestration (ReAct loop)
│   ├── browser.ts        # Playwright browser tools & session management
│   ├── prompt.ts         # System prompts for planning and execution modes
│   ├── auth.ts           # Authentication & session management
│   ├── billing.ts        # Dodo Payments integration
│   ├── scheduler.ts      # Cron-based scheduled test execution
│   ├── recording.ts      # Browser flow recording
│   ├── store.ts          # Data access layer
│   ├── composio.ts       # Third-party integration toolkit
│   ├── emailAgent.ts     # AgentMail email agent
│   ├── agentmail.ts      # AgentMail client
│   └── db/               # Database layer
│       ├── schema.ts     # Drizzle schema (users, agents, projects, flows)
│       └── index.ts      # DB client
├── src/                  # Frontend (React + Vite)
│   ├── main.tsx          # App entry
│   ├── App.tsx           # Root component with routing
│   ├── types.ts          # Shared TypeScript types
│   ├── data.ts           # API helpers
│   ├── views/            # Page components
│   │   ├── Landing.tsx   # Marketing landing page
│   │   ├── Overview.tsx  # Dashboard overview with stats & recent runs
│   │   ├── Agents.tsx    # Agent management
│   │   ├── Runs.tsx      # Run history
│   │   ├── Tickets.tsx   # GitHub issue tracking
│   │   ├── Targets.tsx   # Target management
│   │   ├── Recordings.tsx # Flow recording UI
│   │   ├── Settings.tsx  # User settings
│   │   ├── Billing.tsx   # Subscription management
│   │   ├── Blog.tsx      # Blog with MDX posts
│   │   └── Docs.tsx      # Documentation pages
│   ├── components/       # Reusable UI components
│   │   ├── AgentChat.tsx, AgentWorkspace.tsx, ...
│   │   ├── BrowserView.tsx, Editor.tsx, ...
│   │   └── Sidebar.tsx, Topbar.tsx, Toast.tsx, ...
│   └── blog/             # MDX blog posts
├── public/               # Static assets (favicon, site.webmanifest)
├── index.html            # SPA shell with SEO meta tags
├── Dockerfile            # Multi-stage Docker build
├── fly.toml              # Fly.io deployment config
├── vercel.json           # Vercel deployment config
├── drizzle.config.ts     # Drizzle Kit config
├── DEPLOY.md             # Deployment instructions
└── tsconfig.json         # TypeScript configuration
```

## Deployment

The project deploys to two surfaces from the same repository:

| Host | Provider | Serves |
|---|---|---|
| `app.probeqa.com` | Fly.io (Docker) | Full app: API + SPA (agents, billing, runs) |
| `www.probeqa.com` | Vercel (static) | Marketing landing, blog, docs |

See [`DEPLOY.md`](./DEPLOY.md) for full deployment instructions, including Fly.io machine pool configuration, Vercel setup, and DNS records.

## Contributing

Contributions are welcome. Please open an issue to discuss your proposed change before opening a pull request.

## License

This project is provided under a proprietary license. All rights reserved. Contact the maintainers for licensing inquiries.

---

<div align="center">
  <p>Built by <a href="https://github.com/hritvikgupta">hritvikgupta</a> · <a href="https://www.probeqa.com">probeqa.com</a></p>
</div>