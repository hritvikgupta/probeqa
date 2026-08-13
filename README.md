<div align="center">

<img src="docs/assets/og.jpg" alt="Probe — autonomous agents for web testing" width="100%" />

# Probe

**Autonomous QA agents that drive a real browser. One sentence describes the flow. The agent plans it, runs it, and files the ticket.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?style=flat-square&logo=hono&logoColor=white)](https://hono.dev)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![Postgres](https://img.shields.io/badge/Postgres-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)

[Demo](#watch-it-work) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Configuration](#configuration) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

---

https://github.com/user-attachments/assets/3f1d44bc-7707-4592-b938-4ac281383b59

> *"Test the checkout flow on shop.acme.com — payment edge cases, expired cards, declined cards, slow networks."*  
> One sentence in. The agent plans the steps, drives a real browser, and sends you the report.

---

## At a glance

| | |
|---|---|
| **Describe, don't script** | Type what you want tested. The agent plans the steps, navigates the page, and reports what it found. No selectors, no fixtures. |
| **Real browser, real results** | Probe drives a live Chromium page — no mocks, no source access. A green run means the thing your customers touch actually worked. |
| **Delivers where you work** | Emails a report, files a GitHub/Linear issue, posts to Slack — all from the same run record. |
| **Schedules itself** | Set it and forget it. Runs on a cron so regressions surface before your users find them. |
| **Integrates with what you use** | GitHub, Slack, Notion, Gmail, Linear, Google Sheets, Google Calendar — all through OAuth. |

---

## Watch it work

<img src="docs/assets/demo.gif" alt="Probe planning a test, then driving a real browser through a demo-request flow" width="100%" />

The left panel is the agent's step-by-step plan, checked off as it completes each action. The right panel is the live browser it is controlling — the same frames streamed in real time, so you can watch a run in progress instead of reading a log afterward.

<img src="docs/assets/run.jpg" alt="A Probe run: agent step list on the left, live browser view on the right" width="100%" />

### A run produces

| Output | Where it lands | How |
|---|---|---|
| **Written report** | Your inbox | Email via AgentMail — including signup links and OTPs the agent can use end to end |
| **GitHub issue** | The repo that changed | Full reproduction steps, screenshots, environment detail |
| **Run trace** | The app dashboard | Every step, every screenshot, every verdict — browsable |

<img src="docs/assets/email-report.jpg" alt="Email report from Probe" width="49%" /> <img src="docs/assets/github-issue.jpg" alt="GitHub issue opened automatically" width="49%" />

---

## How it works

Probe is a **ReAct loop** over a single persistent browser page. Every turn is: reason about the next step → call one tool → observe the result → repeat, until the goal is met or proven unreachable.

<img src="docs/assets/diagram-1.svg" alt="Architecture diagram" width="100%" />

### 1 — Perception: accessibility tree first

**Screenshots alone** are expensive and ambiguous — an LLM staring at pixels guesses at what's clickable.  
**Raw DOM** is the opposite failure — tens of thousands of tokens, almost all noise.

Probe leads with the **accessibility tree** (the browser's own semantic model) and falls back to the DOM only when needed.

| Tool | What it returns | When |
|---|---|---|
| `inspect_page()` | Accessibility tree, active scope, every interactive control with role, label, testid, bounding rect | **Default** — the primary way the agent sees the page |
| `look()` | Screenshot + tree + URL + title in one call | After navigating or any state-changing action |
| `screenshot()` | Just the rendered image | Visual-only checks: alignment, broken images, overlays |
| `get_html()` | Full DOM, every attribute | Fallback when the tree didn't name a custom widget |

### 2 — Active scope: no more clicking behind modals

The single most common way browser agents fail is interacting with something behind an open dialog. `inspect_page()` reports an **`activeScope`** — `"dialog"` when a modal is open, `"menu"` for a popover, `"main"` otherwise — and lists **only the controls inside it**. While a dialog is open, everything outside is ineligible.

### 3 — Icon-only buttons

Real pages have buttons with no accessible name (✕, ←, paperclips). Each candidate carries `iconOnly: true`, an `svgHint`, and a bounding rect `{x, y, w, h}` — so the agent can identify the submit control by shape and position when there is no text to match.

### 4 — Acting

`click(role, name)` and `fill(name, text)` address elements by the accessible names the agent just read. CSS selectors are the escape hatch, never the default. Two rules keep the loop honest:

- **One tool call per reasoning step** — every action has exactly one observation, and a failed run is readable top to bottom.
- **Never act on an unobserved element** — the agent may only touch something it just saw. No blind clicking.

When several actions need no decision between them, `do_steps([...])` chains them in a single call, cutting both latency and token spend.

### 5 — Reflection & recovery

After every state-changing action, Probe asks whether the page actually changed the way the agent predicted. A mismatch is a signal, not a failure — the agent re-observes and picks a different route rather than continuing down a plan that has already diverged from reality.

---

## Quick start

**Requirements:** Node ≥ 22, a Postgres database ([Neon](https://neon.tech) has a free tier), and Chromium.

```bash
git clone https://github.com/hritvikgupta/probeqa.git
cd probeqa
npm install
npx playwright install chromium

cp .env.example .env            # fill in DATABASE_URL + OPENROUTER_API_KEY
npm run db:push
npm run dev                     # starts web + agent server
```

| Command | What it does |
|---|---|
| `npm run dev` | Web and agent server together |
| `npm run dev:web` / `dev:agent` | Either half on its own |
| `npm run build` / `preview` | Production bundle |
| `npm run db:push` | Push the Drizzle schema |

---

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `OPENROUTER_API_KEY` | ✅ | Model access for the agent loop |
| `COMPOSIO_API_KEY` | | Third-party tool connections (GitHub, Slack, Gmail, etc.) |
| `AGENTMAIL_API_KEY` | | Inbox for signup/OTP flows and email reports |
| `GITHUB_TOKEN` | | Filing issues from a run |
| `DODO_API_KEY` | | Billing — omit and everyone stays free |

> [!WARNING]
> Every key above is **server-side only**. Probe drives a real browser against real credentials — treat a deployment like a CI runner that can log into your app, and point it at staging before production.

---

## Project layout

```
server/
  agent.ts        the ReAct loop
  prompt.ts       the system prompt — the agent's operating manual
  browser.ts      Playwright + CDP: inspector, click, fill, do_steps
  reflect.ts      post-action self-check and recovery
  emailAgent.ts   conversational email interface via AgentMail
  scheduler.ts    recurring runs
  composio.ts     integrations layer (GitHub, Slack, Gmail, etc.)
  recording.ts    session capture
  billing.ts  auth.ts  store.ts
  db/             Drizzle schema and client
src/
  views/          Overview, Agents, Runs, Recordings, Billing, Docs, Blog, Landing
  components/     AgentChat, BrowserView, Editor, Sidebar, …
  blog/           5 MDX posts
```

Read [`server/prompt.ts`](server/prompt.ts) first — it is the clearest statement of how the agent is meant to behave, and most behaviour changes start there or in `browser.ts`.

---

## Roadmap

- [ ] Parallel runs across a browser pool
- [ ] Assertion primitives alongside natural-language verdicts
- [ ] Cross-browser targets (Firefox, WebKit)
- [ ] Flake detection by re-running divergent steps
- [ ] Self-hosted model support
- [ ] Trace export to OpenTelemetry

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

The highest-leverage contribution is **perception**: a widget pattern `inspect_page()` doesn't describe well is concrete, testable, and improves every run the agent will ever make. That work belongs in `server/browser.ts`, not in the prompt.

---

## License

[GNU AGPL-3.0](LICENSE) © 2026 Hritvik Gupta.

You may use, modify and self-host Probe freely. If you run a modified version as a **network service**, the AGPL requires you to publish your changes under the same license.