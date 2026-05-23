/**
 * Playwright-backed browser tools — the agent's hands and eyes —
 * plus a live screencast so the UI can watch the real browser work.
 *
 * Each chat gets its own browser context + page, kept alive between turns.
 * A CDP screencast streams JPEG frames of that page into a per-chat hub;
 * the SSE endpoint in index.ts forwards them to the right-hand pane.
 */
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright'
import { tool } from 'ai'
import { z } from 'zod'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getAgent, updateAgent, type Agent, type TestStep } from './store.ts'
import { githubCreateIssue } from './composio.ts'

/** Per-run context: the agent whose accounts / settings the agent may use. */
export interface AgentContext {
  agent?: Agent
}

/* ----------------------- live frame hub ----------------------- */

export interface Frame {
  url: string
  /** base64-encoded JPEG */
  frame: string
}

interface Hub {
  latest: Frame | null
  subs: Set<(f: Frame) => void>
}

const hubs = new Map<string, Hub>()

function getHub(chatId: string): Hub {
  let h = hubs.get(chatId)
  if (!h) {
    h = { latest: null, subs: new Set() }
    hubs.set(chatId, h)
  }
  return h
}

/** Subscribe to a chat's browser frames. Returns an unsubscribe fn. */
export function subscribeFrames(chatId: string, cb: (f: Frame) => void): () => void {
  const h = getHub(chatId)
  h.subs.add(cb)
  if (h.latest) cb(h.latest) // hand the newcomer the current view immediately
  return () => h.subs.delete(cb)
}

function pushFrame(chatId: string, f: Frame): void {
  const h = getHub(chatId)
  h.latest = f
  for (const cb of h.subs) {
    try {
      cb(f)
    } catch {
      /* ignore a bad subscriber */
    }
  }
}

/* ------------------------- sessions --------------------------- */

interface Session {
  context: BrowserContext
  page: Page
  cdp: CDPSession | null
  consoleErrors: string[]
  lastUsed: number
  lastFrameAt: number
  frameTimer: ReturnType<typeof setInterval> | null
}

const IDLE_MS = 10 * 60 * 1000
const SHOTS_DIR = join(process.cwd(), 'server', '.screenshots')

let browserPromise: Promise<Browser> | null = null
const sessions = new Map<string, Session>()

function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true })
  return browserPromise
}

async function getSession(chatId: string): Promise<Session> {
  const existing = sessions.get(chatId)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing
  }

  const browser = await getBrowser()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  const consoleErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => {
    consoleErrors.push(
      `request failed: ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? 'unknown'}`,
    )
  })

  const session: Session = {
    context,
    page,
    cdp: null,
    consoleErrors,
    lastUsed: Date.now(),
    lastFrameAt: 0,
    frameTimer: null,
  }
  sessions.set(chatId, session)

  // Live screencast → frame hub. If it fails, the agent still works headless.
  try {
    const cdp = await context.newCDPSession(page)
    session.cdp = cdp
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    })
    cdp.on('Page.screencastFrame', (params: any) => {
      session.lastFrameAt = Date.now()
      pushFrame(chatId, { url: page.url(), frame: params.data })
      cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
    })
  } catch (e) {
    console.error('[probe-agent] screencast unavailable:', e)
  }

  // Fallback poller — the CDP screencast is flaky in headless and sometimes
  // emits nothing. While someone is watching, if no screencast frame has
  // arrived recently, push a plain screenshot so the live view never blanks.
  session.frameTimer = setInterval(() => {
    const hub = hubs.get(chatId)
    if (!hub || hub.subs.size === 0) return
    if (Date.now() - session.lastFrameAt < 1500) return
    page
      .screenshot({ type: 'jpeg', quality: 50 })
      .then((buf) => {
        session.lastFrameAt = Date.now()
        pushFrame(chatId, { url: page.url(), frame: buf.toString('base64') })
      })
      .catch(() => {})
  }, 900)

  return session
}

/** Close and forget a chat's browser session + frame hub ("New run"). */
export async function resetSession(chatId: string): Promise<void> {
  hubs.delete(chatId)
  const s = sessions.get(chatId)
  if (!s) return
  sessions.delete(chatId)
  if (s.frameTimer) clearInterval(s.frameTimer)
  await s.context.close().catch(() => {})
}

/**
 * Current view of a chat's browser — a fresh screenshot of the live page.
 * Backs the polling live-view endpoint, which is far more reliable than the
 * CDP screencast in headless Chromium. Returns null if there's no session
 * yet (the agent hasn't opened the browser).
 */
export async function currentFrame(chatId: string): Promise<Frame | null> {
  const s = sessions.get(chatId)
  if (!s) return hubs.get(chatId)?.latest ?? null
  try {
    const buf = await s.page.screenshot({ type: 'jpeg', quality: 55 })
    s.lastUsed = Date.now()
    return { url: s.page.url(), frame: buf.toString('base64') }
  } catch {
    // Page busy mid-action — fall back to the most recent screencast frame.
    return hubs.get(chatId)?.latest ?? null
  }
}

// Evict idle sessions so headless Chromium contexts don't pile up.
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of [...sessions]) {
    if (now - s.lastUsed > IDLE_MS) {
      sessions.delete(id)
      hubs.delete(id)
      if (s.frameTimer) clearInterval(s.frameTimer)
      s.context.close().catch(() => {})
    }
  }
}, 60_000).unref()

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n…[truncated, ${s.length - n} more chars]` : s
}

/* --------------------------- tools ---------------------------- */

/**
 * The test-plan tool. When bound to an agent (plan mode) its result IS the
 * write: the proposed steps are saved straight to that agent's canvas in the
 * DB — the canvas is the single source of truth, so there is nothing to
 * mirror through the frontend and nothing to drift.
 */
export function proposeTestPlanTool(agentId?: string) {
  return tool({
    description:
      'Propose or update a structured, step-by-step test plan. Call this whenever you and the user have agreed on what to test, and again whenever the plan should change. List every step in order — the plan appears on the workspace canvas.',
    inputSchema: z.object({
      title: z
        .string()
        .describe('Short title for the plan, e.g. "Thinking Line — signup & login flow".'),
      steps: z
        .array(
          z.object({
            kind: z
              .enum(['navigate', 'act', 'assert', 'login', 'screenshot', 'github', 'integration'])
              .describe(
                'Step type: navigate (open a URL), act (click/fill/interact), assert (verify an expectation), login (enter credentials), screenshot (capture the page), github (report the run result to the connected repo), integration (act on a connected app — Slack, Gmail, Notion, etc.).',
              ),
            label: z
              .string()
              .describe('Imperative one-line description, e.g. "Click the Sign Up link".'),
            detail: z
              .string()
              .optional()
              .describe('Optional extra context, e.g. the URL, the data to enter, or what to verify.'),
          }),
        )
        .min(1)
        .describe('The ordered list of test steps.'),
    }),
    execute: async ({ title, steps }) => {
      // No agent bound (the Editor's free planning) → nothing to persist.
      if (!agentId) return { ok: true, title, stepCount: steps.length }
      // Plan mode: write the plan straight onto the workspace canvas.
      const canvas: TestStep[] = steps.map((s) => ({
        id: crypto.randomUUID(),
        kind: s.kind,
        label: s.label,
        ...(s.detail ? { detail: s.detail } : {}),
      }))
      await updateAgent(agentId, { steps: canvas })
      return { ok: true, saved: true, title, stepCount: canvas.length }
    },
  })
}

const planStepSchema = z.object({
  kind: z
    .enum(['navigate', 'act', 'assert', 'login', 'screenshot', 'github', 'integration'])
    .describe('Step type: navigate, act, assert, login, screenshot, github (report to GitHub), integration (act on a connected app).'),
  label: z.string().describe('Imperative one-line description of the step.'),
  detail: z.string().optional().describe('Optional extra context — a URL, data to enter, what to verify.'),
})

/** Read the current test plan from the workspace canvas (the source of truth). */
export function getCanvasTool(agentId: string) {
  return tool({
    description:
      'Read the current test plan from the workspace canvas — the single source of truth. The user can hand-edit the canvas directly at any time, so call this to know the real current plan, especially before changing it.',
    inputSchema: z.object({}),
    execute: async () => {
      const agent = await getAgent(agentId)
      const steps = (agent?.steps ?? []).map((s, i) => ({
        index: i + 1,
        kind: s.kind,
        label: s.label,
        ...(s.detail ? { detail: s.detail } : {}),
      }))
      return { ok: true, stepCount: steps.length, steps }
    },
  })
}

/** Replace the workspace canvas with a new plan — this IS the plan. */
export function updateCanvasTool(agentId: string) {
  return tool({
    description:
      'Replace the test plan on the workspace canvas with a new ordered list of steps. Whatever you pass here BECOMES the canvas. Call get_canvas first so you build on the current plan (which the user may have hand-edited), then pass the COMPLETE updated list — every step, in order, not a delta.',
    inputSchema: z.object({
      steps: z.array(planStepSchema).describe('The complete ordered test plan that becomes the canvas.'),
    }),
    execute: async ({ steps }) => {
      const canvas: TestStep[] = steps.map((s) => ({
        id: crypto.randomUUID(),
        kind: s.kind,
        label: s.label,
        ...(s.detail ? { detail: s.detail } : {}),
      }))
      await updateAgent(agentId, { steps: canvas })
      return { ok: true, saved: true, stepCount: canvas.length }
    },
  })
}

/**
 * Planning-only tool set — the workspace chat brainstorms a plan, no browser.
 * The plan lives only on the canvas: the agent reads it with get_canvas and
 * changes it with update_canvas. There is no propose_test_plan here, so no
 * second copy of the plan can ever drift from the canvas.
 */
export function buildPlanTools(agentId?: string) {
  if (!agentId) return { propose_test_plan: proposeTestPlanTool() }
  return {
    get_canvas: getCanvasTool(agentId),
    update_canvas: updateCanvasTool(agentId),
  }
}

/**
 * Build the full browser tool set bound to one chat's session. Passed
 * straight into streamText() so the model can call them in its ReAct loop.
 * `ctx.agent` unlocks the account / GitHub tools.
 */
export function buildBrowserTools(chatId: string, ctx: AgentContext = {}) {
  const agent = ctx.agent

  return {
    navigate: tool({
      description:
        'Open a URL in the browser. Always the first step when testing a page. Returns the final URL, HTTP status, and page title.',
      inputSchema: z.object({
        url: z.string().describe('Full URL including https://, e.g. "https://example.com/checkout".'),
      }),
      execute: async ({ url }) => {
        const { page } = await getSession(chatId)
        try {
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
          return { ok: true, url: page.url(), title: await page.title(), status: resp?.status() ?? null }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    inspect_page: tool({
      description:
        'Get the accessibility tree of the current page — headings, buttons, links, inputs and their accessible names. A quick overview. If a control has no accessible name, or you need to act on something the tree does not show (a clickable div, an icon, a custom widget), call get_html instead — that is the ground truth.',
      inputSchema: z.object({}),
      execute: async () => {
        const { page } = await getSession(chatId)
        try {
          const tree = await page.locator('body').ariaSnapshot()
          return { ok: true, url: page.url(), tree: truncate(tree, 6_000) }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    get_html: tool({
      description:
        'Get the real HTML/DOM of the page — every element, its tag and ALL attributes (id, class, type, name, placeholder, data-*, href, role…) and the nesting structure. This is your ground truth: it shows elements the accessibility tree hides or leaves unnamed, and works for anything clickable — buttons, links, divs, spans, icons, custom widgets. Use it to find a precise CSS selector, then pass that selector to click() or fill(). Pass an optional `selector` to zoom into one region (e.g. "form", "#login", "nav").',
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe('Optional CSS selector to scope output to one region. Omit for the whole page.'),
      }),
      execute: async ({ selector }) => {
        const { page } = await getSession(chatId)
        try {
          const html = await page.evaluate((sel) => {
            const root = sel ? document.querySelector(sel) : document.body
            if (!root) return null
            const clone = root.cloneNode(true) as Element
            clone
              .querySelectorAll('script,style,noscript,svg,template,link,meta')
              .forEach((n) => n.remove())
            return clone.outerHTML.replace(/\s+/g, ' ').trim()
          }, selector ?? null)
          if (html == null) return { ok: false, error: `No element matches selector "${selector}"` }
          return { ok: true, url: page.url(), html: truncate(html, 9_000) }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    click: tool({
      description:
        'Click ANY element on the page. Prefer a precise CSS `selector` taken from get_html — it works for buttons, links, divs, spans, icons, custom widgets, anything. Or pass ARIA `role` + accessible `name` for clearly-labelled elements.',
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe('CSS selector of the element to click, e.g. "button.submit", "a[href=\\"/login\\"]". Most reliable — use this when in doubt.'),
        role: z.string().optional().describe('ARIA role, used only when no selector is given.'),
        name: z.string().optional().describe('Accessible name, used together with role.'),
      }),
      execute: async ({ selector, role, name }) => {
        const { page } = await getSession(chatId)
        const target = selector ?? `${role ?? ''} "${name ?? ''}"`.trim()
        try {
          const loc = selector
            ? page.locator(selector)
            : page.getByRole(role as never, { name: name ?? '' })
          await loc.first().click({ timeout: 8_000 })
          await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {})
          return { ok: true, clicked: target, url: page.url() }
        } catch (e) {
          return { ok: false, error: `Could not click ${target}: ${String(e)}` }
        }
      },
    }),

    fill: tool({
      description:
        'Type text into an input, textarea, or contenteditable element. Prefer a precise CSS `selector` from get_html — that is the only reliable way to target a field whose accessible name is missing or duplicated (e.g. distinguishing a username box from a password box). Or use accessible `name` for clearly-labelled fields.',
      inputSchema: z.object({
        text: z.string().describe('The text to type.'),
        selector: z
          .string()
          .optional()
          .describe('CSS selector of the field, e.g. "input[type=password]", "#email". Most reliable.'),
        name: z.string().optional().describe('Accessible name / label, used only when no selector is given.'),
        role: z.string().default('textbox').describe('Role of the field when using name; usually "textbox".'),
      }),
      execute: async ({ text, selector, name, role }) => {
        const { page } = await getSession(chatId)
        const target = selector ?? name ?? '(unspecified)'
        try {
          const loc = selector
            ? page.locator(selector)
            : page.getByRole(role as never, { name: name ?? '' })
          await loc.first().fill(text, { timeout: 8_000 })
          return { ok: true, filled: target }
        } catch (e) {
          return { ok: false, error: `Could not fill ${target}: ${String(e)}` }
        }
      },
    }),

    press_key: tool({
      description: 'Press a keyboard key on the page, e.g. "Enter", "Tab", "Escape".',
      inputSchema: z.object({ key: z.string().describe('A Playwright key name, e.g. "Enter".') }),
      execute: async ({ key }) => {
        const { page } = await getSession(chatId)
        try {
          await page.keyboard.press(key)
          await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {})
          return { ok: true, pressed: key }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    wait_for: tool({
      description:
        'Wait until the page reaches a condition before continuing. Use this after triggering anything slow — a video/report generation, an upload, a long load, a form submit that processes — instead of asserting immediately or polling with screenshots. It waits server-side in a single call. YOU decide how long: set timeoutSeconds to however long the action realistically needs (e.g. 300 for something that may take about five minutes).',
      inputSchema: z.object({
        text: z
          .string()
          .optional()
          .describe('Wait for this visible text to appear (or, with state "hidden", to disappear).'),
        selector: z
          .string()
          .optional()
          .describe('CSS selector to wait for. Provide either text or selector.'),
        state: z
          .enum(['visible', 'hidden', 'attached', 'detached'])
          .default('visible')
          .describe(
            'Condition: "visible" (appears), "hidden" (disappears — e.g. a loading spinner), "attached", or "detached".',
          ),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(600)
          .default(60)
          .describe(
            'How long to wait, in seconds — set it as high as the action realistically needs. Max 600 (10 minutes).',
          ),
      }),
      execute: async ({ text, selector, state, timeoutSeconds }) => {
        if (!text && !selector) {
          return { ok: false, error: 'wait_for needs either `text` or `selector`.' }
        }
        const session = await getSession(chatId)
        session.lastUsed = Date.now() // keep the session alive through a long wait
        const { page } = session
        const timeout = Math.min(Math.max(timeoutSeconds ?? 60, 1), 600) * 1000
        const startedAt = Date.now()
        try {
          const loc = text
            ? page.getByText(text, { exact: false }).first()
            : page.locator(selector as string).first()
          await loc.waitFor({ state, timeout })
          return {
            ok: true,
            waitedMs: Date.now() - startedAt,
            url: page.url(),
            waitedFor: text ? `text "${text}"` : `${selector} (${state})`,
          }
        } catch (e) {
          return {
            ok: false,
            timedOut: true,
            waitedMs: Date.now() - startedAt,
            error: `Condition not met within ${Math.round(timeout / 1000)}s: ${String(e)}`,
          }
        }
      },
    }),

    get_page_text: tool({
      description: 'Get the visible text content of the current page. Use to read results or verify wording.',
      inputSchema: z.object({}),
      execute: async () => {
        const { page } = await getSession(chatId)
        try {
          return { ok: true, text: truncate(await page.locator('body').innerText(), 4_000) }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    check: tool({
      description:
        'Assert that a piece of text is present and visible on the current page. Records a PASS or FAIL. Use it for every expectation the user asked you to verify.',
      inputSchema: z.object({
        expectation: z.string().describe('What you are verifying, e.g. "Order confirmation is shown".'),
        text: z.string().describe('The exact visible text that must be present for this check to pass.'),
      }),
      execute: async ({ expectation, text }) => {
        const { page } = await getSession(chatId)
        const pass = await page
          .getByText(text, { exact: false })
          .first()
          .isVisible({ timeout: 5_000 })
          .catch(() => false)
        return { ok: true, expectation, pass, result: pass ? 'PASS' : 'FAIL' }
      },
    }),

    screenshot: tool({
      description:
        'Capture a screenshot of the current page AND SEE it. The image is delivered to you as the most-recent-screenshot picture in the conversation — look at it to understand the page visually: layout, what is rendered, where things are, what looks broken. Then use get_html for the exact CSS selector of whatever you decided to act on. Take a screenshot after navigating, when unsure what the page looks like, or to verify an action.',
      inputSchema: z.object({}),
      execute: async () => {
        const { page } = await getSession(chatId)
        try {
          mkdirSync(SHOTS_DIR, { recursive: true })
          const file = join(SHOTS_DIR, `${chatId}-${Date.now()}.jpg`)
          // JPEG, not PNG — a screenshot the model only needs to glance at
          // does not warrant lossless bytes, and tokens are scarce.
          const buf = await page.screenshot({ path: file, type: 'jpeg', quality: 55 })
          return { ok: true, saved: file, image: buf.toString('base64') }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
      // Hand the actual image to the multimodal model as a file-data part.
      toModelOutput: ({ output }) => {
        const o = output as { ok?: boolean; image?: string; error?: string }
        if (!o?.ok || !o.image) {
          return {
            type: 'content',
            value: [{ type: 'text', text: `Screenshot failed: ${o?.error ?? 'unknown error'}` }],
          }
        }
        return {
          type: 'content',
          value: [
            { type: 'text', text: 'Screenshot of the current page:' },
            { type: 'file-data', data: o.image, mediaType: 'image/jpeg' },
          ],
        }
      },
    }),

    propose_test_plan: proposeTestPlanTool(),

    step_status: tool({
      description:
        'Report progress on the approved test plan during a workspace run. Call with status "running" right BEFORE you begin a plan step, and "passed" or "failed" right AFTER you finish it. stepIndex is the 1-based number of the plan step.',
      inputSchema: z.object({
        stepIndex: z.number().int().describe('1-based number of the plan step.'),
        status: z.enum(['running', 'passed', 'failed']).describe('Current state of that step.'),
        note: z.string().optional().describe('Short note — especially the reason on a failure.'),
      }),
      execute: async ({ stepIndex, status, note }) => ({ ok: true, stepIndex, status, note }),
    }),

    list_test_accounts: tool({
      description:
        'List the saved test accounts available for this workspace (labels only, no passwords). Use this when a test needs to sign in, then call use_test_account to get the credentials.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!agent) return { ok: false, error: 'No workspace — test accounts are unavailable.' }
        return {
          ok: true,
          accounts: agent.testAccounts.map((a) => ({ label: a.label, username: a.username, notes: a.notes ?? '' })),
        }
      },
    }),

    use_test_account: tool({
      description:
        'Get the username and password of a saved test account so you can fill a login/signup form. Pass the account label exactly as list_test_accounts reports it.',
      inputSchema: z.object({
        label: z.string().describe('The label of the test account to use.'),
      }),
      execute: async ({ label }) => {
        if (!agent) return { ok: false, error: 'No workspace — test accounts are unavailable.' }
        const acc = agent.testAccounts.find(
          (a) => a.label.toLowerCase() === label.toLowerCase(),
        )
        if (!acc) {
          return {
            ok: false,
            error: `No test account labelled "${label}". Available: ${
              agent.testAccounts.map((a) => a.label).join(', ') || '(none)'
            }`,
          }
        }
        return { ok: true, label: acc.label, username: acc.username, password: acc.password }
      },
    }),

    report_to_github: tool({
      description:
        'File the test result as a GitHub issue on the workspace repository. Use this at the end of a run when you found a bug or want to record the outcome. Only works if a repo and token are configured in the workspace settings.',
      inputSchema: z.object({
        title: z.string().describe('Issue title — concise summary of the result.'),
        body: z.string().describe('Issue body — the full report in markdown.'),
      }),
      execute: async ({ title, body }) => {
        const repo = agent?.settings.githubRepo?.trim()
        if (!repo) return { ok: false, error: 'No GitHub repository selected — choose one in PR Testing.' }
        const fullBody = `${body}\n\n— filed by Probe agent`
        // Prefer the user's Composio GitHub connection.
        if (agent?.userId) {
          const r = await githubCreateIssue(agent.userId, repo, title, fullBody)
          if (r.ok) return { ok: true, url: r.url, number: r.number }
        }
        // Fall back to a manual personal access token if one is set.
        const token = agent?.settings.githubToken?.trim()
        if (!token) {
          return { ok: false, error: 'GitHub is not connected — connect it in the Integrations tab.' }
        }
        try {
          const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title, body: fullBody }),
          })
          if (!res.ok) {
            return { ok: false, error: `GitHub API ${res.status}: ${await res.text()}` }
          }
          const issue = (await res.json()) as { html_url?: string; number?: number }
          return { ok: true, url: issue.html_url, number: issue.number }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    get_console_errors: tool({
      description:
        'Return JavaScript console errors and failed network requests captured since the page was opened. Use to catch hidden bugs before reporting.',
      inputSchema: z.object({}),
      execute: async () => {
        const { consoleErrors } = await getSession(chatId)
        return { ok: true, count: consoleErrors.length, errors: consoleErrors.slice(-30) }
      },
    }),
  }
}
