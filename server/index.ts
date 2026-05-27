/**
 * Probe agent server — Hono on Node.
 *
 *   POST /api/auth/register|login|logout · GET /api/auth/me   user auth
 *   GET/POST/PATCH/DELETE /api/agents[...]                    per-user agents
 *   POST /api/agent          run the testing agent, stream steps back
 *   POST /api/agent/reset    close a chat's browser session
 *   GET  /api/browser/stream live screencast of the agent's browser (SSE)
 *   GET  /api/health         liveness check
 *
 * Every /api/agent(s) route is behind a session cookie — all data and
 * secrets stay server-side. Vite proxies /api/* here (single origin).
 */
import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { streamSSE } from 'hono/streaming'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { UIMessage } from 'ai'
import { runAgent } from './agent.ts'
import { resetSession, subscribeFrames, currentFrame, getSession, pushImmediateFrame } from './browser.ts'
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  addRun,
  publicAgent,
  countUsage,
  getUserSubscriptionId,
  getUserDodoIds,
  setUserSubscriptionId,
  setUserPlan,
  listProjects,
  getProject,
  createProject,
  deleteProject,
  overview,
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  claimChat,
  touchChatOwner,
  releaseChat,
  type Agent,
  type RunRecord,
} from './store.ts'
import {
  registerUser, loginUser, logout, userForToken,
  updateUserName, changePassword, type SafeUser,
} from './auth.ts'
import {
  dodoEnabled,
  createCheckout,
  handleWebhook,
  verifyAndApplyPayment,
  fetchSubscriptionDetails,
  cancelSubscription,
  findActiveSubscriptionForCustomer,
  findActiveSubscriptionByEmail,
  findSubscriptionByScan,
  PLAN_LIMITS,
  checkLimit,
} from './billing.ts'
import { startScheduler } from './scheduler.ts'
import { startEmailAgent } from './emailAgent.ts'
import { agentMailEnabled, ensureInbox } from './agentmail.ts'
import {
  INTEGRATIONS,
  composioEnabled,
  connectedToolkits,
  connectToolkit,
  isGithubConnected,
  githubRepos,
  githubItems,
  githubIssues,
  githubCreateIssue,
} from './composio.ts'
import {
  startRecording,
  stopRecording,
  getRecordingSteps,
  saveAsFlow,
  listFlows,
  getFlow,
  renameFlow,
  deleteFlow,
  attachFlow,
  detachFlow,
  listAttachedFlows,
} from './recording.ts'

const app = new Hono<{ Variables: { user: SafeUser } }>()

const COOKIE = 'probe_session'
const MONTH = 60 * 60 * 24 * 30

// Identifies this Fly machine in the multi-machine pool. Populated by Fly
// at boot; falls back to "local" in development where there's only one process.
const INSTANCE_ID = process.env.FLY_MACHINE_ID || 'local'

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    if (typeof o.message === 'string') return o.message
    try {
      return JSON.stringify(o)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

/* --------------------------- auth gate ---------------------------- */

async function requireAuth(c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) {
  const user = await userForToken(getCookie(c, COOKIE))
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  c.set('user', user)
  await next()
}

app.use('/api/agent', requireAuth)
app.use('/api/agent/*', requireAuth)
app.use('/api/agents', requireAuth)
app.use('/api/agents/*', requireAuth)
app.use('/api/projects', requireAuth)
app.use('/api/projects/*', requireAuth)
app.use('/api/overview', requireAuth)
app.use('/api/conversations', requireAuth)
app.use('/api/conversations/*', requireAuth)
app.use('/api/integrations', requireAuth)
app.use('/api/integrations/*', requireAuth)
app.use('/api/tickets', requireAuth)
app.use('/api/tickets/*', requireAuth)
app.use('/api/email', requireAuth)
app.use('/api/email/*', requireAuth)
app.use('/api/recording', requireAuth)
app.use('/api/recording/*', requireAuth)
app.use('/api/flows', requireAuth)
app.use('/api/flows/*', requireAuth)
app.use('/api/chats/*', requireAuth)
// Billing — checkout/status need a session; the webhook is verified by signature.
app.use('/api/billing/checkout', requireAuth)
app.use('/api/billing/status', requireAuth)
app.use('/api/billing/verify', requireAuth)
app.use('/api/billing/info', requireAuth)
app.use('/api/billing/cancel', requireAuth)
app.use('/api/billing/force-downgrade', requireAuth)

/* --------------------------- routes ------------------------------- */

app.get('/api/health', (c) =>
  c.json({ ok: true, model: process.env.LLM_MODEL || 'x-ai/grok-build-0.1' }),
)

/* ---- auth ---- */

app.post('/api/auth/register', async (c) => {
  const b = await c.req.json<{ email?: string; password?: string; name?: string }>().catch(() => ({}))
  const r = await registerUser(b.email ?? '', b.password ?? '', b.name)
  if ('error' in r) return c.json({ error: r.error }, 400)
  setCookie(c, COOKIE, r.token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: MONTH })
  return c.json({ user: r.user })
})

app.post('/api/auth/login', async (c) => {
  const b = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}))
  const r = await loginUser(b.email ?? '', b.password ?? '')
  if ('error' in r) return c.json({ error: r.error }, 401)
  setCookie(c, COOKIE, r.token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: MONTH })
  return c.json({ user: r.user })
})

app.post('/api/auth/logout', async (c) => {
  await logout(getCookie(c, COOKIE))
  deleteCookie(c, COOKIE, { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/auth/me', async (c) => {
  const user = await userForToken(getCookie(c, COOKIE))
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  return c.json({ user })
})

app.patch('/api/auth/profile', async (c) => {
  const user = await userForToken(getCookie(c, COOKIE))
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json<{ name?: string }>().catch(() => ({}))
  const r = await updateUserName(user.id, b.name ?? '')
  if ('error' in r) return c.json({ error: r.error }, 400)
  return c.json({ user: r })
})

app.post('/api/auth/password', async (c) => {
  const user = await userForToken(getCookie(c, COOKIE))
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => ({}))
  const r = await changePassword(user.id, b.currentPassword ?? '', b.newPassword ?? '')
  if ('error' in r) return c.json({ error: r.error }, 400)
  return c.json({ ok: true })
})

/* ---- billing (Dodo Payments) ---- */

app.get('/api/billing/status', (c) =>
  c.json({ plan: c.get('user').plan, enabled: dodoEnabled }),
)

app.post('/api/billing/checkout', async (c) => {
  if (!dodoEnabled) return c.json({ error: 'Billing is not configured.' }, 503)
  // Use the browser's Origin header so the user is sent back to the Vite app
  // (port 3005 in dev), not this API server (port 8787). Falls back to the
  // request URL in environments where the two share an origin.
  const origin = c.req.header('origin') ?? new URL(c.req.url).origin
  try {
    const url = await createCheckout(c.get('user'), `${origin}/billing/success`)
    return c.json({ checkout_url: url })
  } catch (err) {
    console.error('[billing] checkout failed:', errMessage(err))
    return c.json({ error: 'Could not start checkout.' }, 500)
  }
})

// Convenience: if Dodo's return URL ever lands on the API server (e.g. in dev
// when the original checkout was created against port 8787, or in prod if the
// API and frontend live on different hosts), bounce back to the React app so
// the BillingSuccess page renders. APP_URL overrides the default dev origin.
app.get('/billing/success', (c) => {
  const appUrl = process.env.APP_URL || 'http://localhost:3005'
  const search = new URL(c.req.url).search
  return c.redirect(`${appUrl}/billing/success${search}`, 302)
})

app.get('/api/billing/info', async (c) => {
  const user = c.get('user')
  const plan = user.plan === 'pro' ? 'pro' : 'free'
  const limits = PLAN_LIMITS[plan]
  const usage = await countUsage(user.id)
  // Fetch live subscription details from Dodo so the UI can show the
  // renewal date and whether a cancellation is pending.
  let subscription: Awaited<ReturnType<typeof fetchSubscriptionDetails>> | null = null
  const subId = await getUserSubscriptionId(user.id)
  if (subId && dodoEnabled) subscription = await fetchSubscriptionDetails(subId)
  return c.json({ plan, limits, usage, subscription, enabled: dodoEnabled })
})

app.post('/api/billing/cancel', async (c) => {
  if (!dodoEnabled) return c.json({ error: 'Billing is not configured.' }, 503)
  const user = c.get('user')
  // Prefer the subscription id we stored; if it's missing (e.g. the verify
  // endpoint didn't capture it), fall back to looking it up on Dodo via the
  // customer id and persist what we find for next time.
  let { subId, customerId } = await getUserDodoIds(user.id)
  console.log(`[billing] cancel: db subId=${subId ?? '∅'} customerId=${customerId ?? '∅'}`)
  // Fallback 1 — we know the customer, look up the active sub on Dodo.
  if (!subId && customerId) {
    subId = await findActiveSubscriptionForCustomer(customerId)
    if (subId) await setUserSubscriptionId(user.id, subId)
  }
  // Fallback 2 — neither id stored, look up customer by email then sub.
  if (!subId) {
    const found = await findActiveSubscriptionByEmail(user.email)
    if (found) {
      subId = found.subId
      await setUserSubscriptionId(user.id, found.subId)
    }
  }
  // Fallback 3 — Dodo's customer filter sometimes returns nothing; scan the
  // account-wide subscription list and match on the customer email.
  if (!subId) {
    const scanned = await findSubscriptionByScan(user.email)
    if (scanned) {
      subId = scanned
      await setUserSubscriptionId(user.id, scanned)
    }
  }
  if (!subId) {
    return c.json(
      {
        error:
          'No active subscription found on Dodo for this account. ' +
          'If you cancelled or upgraded in another browser, click "Downgrade locally" to move back to Free.',
      },
      400,
    )
  }
  console.log(`[billing] cancel: using subId=${subId}`)
  const body = await c.req
    .json<{ feedback?: string; comment?: string }>()
    .catch(() => ({}))
  try {
    const details = await cancelSubscription(subId, {
      feedback: body.feedback,
      comment: body.comment,
    })
    return c.json({ ok: true, subscription: details })
  } catch (err) {
    const msg = errMessage(err)
    console.error('[billing] cancel failed:', msg)
    return c.json({ error: `Could not cancel subscription: ${msg}` }, 500)
  }
})

// Escape hatch — flips the user back to Free locally without touching Dodo.
// For when the upstream subscription is unrecoverable (deleted, mis-attached,
// or the test/live envs are mixed up) but the user still wants to drop Pro.
app.post('/api/billing/force-downgrade', async (c) => {
  await setUserPlan(c.get('user').id, 'free', 'forced_downgrade')
  console.log(`[billing] force-downgrade applied for user=${c.get('user').id}`)
  return c.json({ ok: true })
})

app.post('/api/billing/verify', async (c) => {
  console.log('[billing] /api/billing/verify hit')
  if (!dodoEnabled) return c.json({ error: 'Billing is not configured.' }, 503)
  const body = await c.req
    .json<{ paymentId?: string; subscriptionId?: string }>()
    .catch(() => ({}))
  if (!body.paymentId && !body.subscriptionId) {
    return c.json({ error: 'Missing paymentId or subscriptionId' }, 400)
  }
  const user = c.get('user')
  try {
    const r = await verifyAndApplyPayment(
      user.id,
      { paymentId: body.paymentId, subscriptionId: body.subscriptionId },
      user.email,
    )
    return c.json(r)
  } catch (err) {
    console.error('[billing] verify failed:', errMessage(err))
    return c.json({ error: 'Could not verify payment.' }, 500)
  }
})

app.post('/api/billing/webhook', async (c) => {
  const raw = await c.req.text()
  try {
    await handleWebhook(raw, {
      'webhook-id': c.req.header('webhook-id') ?? '',
      'webhook-signature': c.req.header('webhook-signature') ?? '',
      'webhook-timestamp': c.req.header('webhook-timestamp') ?? '',
    })
    return c.json({ received: true })
  } catch (err) {
    console.error('[billing] webhook rejected:', errMessage(err))
    return c.json({ error: 'Invalid signature' }, 401)
  }
})

/* ---- the agent run ---- */

app.post('/api/agent', async (c) => {
  const user = c.get('user')
  let body: { messages?: UIMessage[]; chatId?: string; agentId?: string; mode?: 'plan' | 'run' }
  try {
    body = await c.req.json()
  } catch {
    return c.text('Invalid JSON body', 400)
  }
  const { messages, chatId, agentId, mode } = body
  if (!chatId) return c.text('Missing chatId', 400)
  if (!Array.isArray(messages)) return c.text('Missing messages[]', 400)

  // Sticky routing — every chat's Playwright session lives on exactly one
  // machine (the in-process `sessions` Map). Claim the chat for this machine
  // on first request; if a different machine got there first, return the
  // fly-replay header so Fly retries the request against the right box.
  // (No-op when FLY_MACHINE_ID is unset, e.g. local dev with a single process.)
  if (process.env.FLY_MACHINE_ID) {
    const { ownerId, claimed } = await claimChat(chatId, INSTANCE_ID)
    if (!claimed && ownerId !== INSTANCE_ID) {
      c.header('fly-replay', `instance=${ownerId}`)
      return c.body(null, 200)
    }
    void touchChatOwner(chatId)
  }

  // If the run is bound to an agent, that agent must belong to this user.
  if (agentId) {
    const agent = await getAgent(agentId)
    if (!agent || agent.userId !== user.id) return c.text('Agent not found', 404)
  }

  // Quota gate — only real agent runs (mode='run') count toward the runs limit.
  // 'plan' mode is exploratory and free across both tiers. Returned as plain
  // text so the streaming chat UI (useChat) surfaces the message via error.message.
  if (mode === 'run' && agentId) {
    const check = await checkLimit(user.id, user.plan, 'runs')
    if (!check.ok) return c.text(check.error, 402)
  }

  try {
    const result = await runAgent(messages, chatId, agentId, mode, user.id)
    return result.toUIMessageStreamResponse({
      onError: (err) => `Agent error: ${errMessage(err)}`,
    })
  } catch (err) {
    console.error('[probe-agent] request failed:', err)
    return c.text(`Agent failed: ${errMessage(err)}`, 500)
  }
})

app.post('/api/agent/reset', async (c) => {
  const { chatId } = await c.req.json<{ chatId?: string }>().catch(() => ({ chatId: undefined }))
  if (!chatId) return c.json({ ok: true })
  // The browser session lives on the owning machine — close it there.
  if (process.env.FLY_MACHINE_ID) {
    const owner = await claimChat(chatId, INSTANCE_ID)
    if (!owner.claimed && owner.ownerId !== INSTANCE_ID) {
      c.header('fly-replay', `instance=${owner.ownerId}`)
      return c.body(null, 200)
    }
  }
  await resetSession(chatId)
  await releaseChat(chatId)
  return c.json({ ok: true })
})

/* ---- agents (workspaces), all scoped to the signed-in user ---- */

/** Load an agent and confirm it belongs to the signed-in user. */
async function ownedAgent(c: { get: (k: 'user') => SafeUser; req: { param: (k: string) => string } }) {
  const agent = await getAgent(c.req.param('id'))
  if (!agent || agent.userId !== c.get('user').id) return undefined
  return agent
}

app.get('/api/agents', async (c) => {
  const projectId = c.req.query('projectId') || undefined
  return c.json({ agents: await listAgents(c.get('user').id, projectId) })
})

app.post('/api/agents', async (c) => {
  const user = c.get('user')
  const check = await checkLimit(user.id, user.plan, 'agents')
  if (!check.ok) {
    return c.json(
      { error: check.error, code: check.code, usage: check.usage, limit: check.limit, plan: check.plan },
      402,
    )
  }
  const body = await c.req.json<{ name?: string; url?: string; projectId?: string }>().catch(() => ({}))
  // A supplied project must belong to this user.
  let projectId: string | null = null
  if (body.projectId) {
    const proj = await getProject(body.projectId)
    if (!proj || proj.userId !== user.id) return c.text('Project not found', 404)
    projectId = proj.id
  }
  const agent = await createAgent(user.id, body.name ?? '', body.url ?? '', projectId)
  return c.json({ agent: publicAgent(agent) })
})

/* ---- projects (the sidebar grouping) ---- */

app.get('/api/projects', async (c) => c.json({ projects: await listProjects(c.get('user').id) }))

app.post('/api/projects', async (c) => {
  const user = c.get('user')
  const check = await checkLimit(user.id, user.plan, 'projects')
  if (!check.ok) {
    return c.json(
      { error: check.error, code: check.code, usage: check.usage, limit: check.limit, plan: check.plan },
      402,
    )
  }
  const body = await c.req.json<{ name?: string }>().catch(() => ({}))
  const project = await createProject(user.id, body.name ?? '')
  return c.json({ project })
})

app.delete('/api/projects/:id', async (c) => {
  const proj = await getProject(c.req.param('id'))
  if (!proj || proj.userId !== c.get('user').id) return c.text('Not found', 404)
  return c.json({ ok: await deleteProject(proj.id) })
})

/* ---- overview (aggregated run stats) ---- */

app.get('/api/overview', async (c) => {
  const projectId = c.req.query('projectId') || undefined
  return c.json(await overview(c.get('user').id, projectId))
})

/* ---- conversations (saved chat history) ---- */

app.get('/api/conversations', async (c) => {
  const agentId = c.req.query('agentId') || undefined
  const projectId = c.req.query('projectId') || undefined
  return c.json({ conversations: await listConversations(c.get('user').id, { agentId, projectId }) })
})

app.post('/api/conversations', async (c) => {
  const b = await c.req.json<{ agentId?: string; projectId?: string; title?: string }>().catch(() => ({}))
  const userId = c.get('user').id
  // A supplied agent/project must belong to this user.
  if (b.agentId) {
    const a = await getAgent(b.agentId)
    if (!a || a.userId !== userId) return c.text('Agent not found', 404)
  }
  if (b.projectId) {
    const p = await getProject(b.projectId)
    if (!p || p.userId !== userId) return c.text('Project not found', 404)
  }
  const conversation = await createConversation(userId, b)
  return c.json({ conversation })
})

app.get('/api/conversations/:id', async (c) => {
  const conv = await getConversation(c.req.param('id'))
  if (!conv || conv.userId !== c.get('user').id) return c.text('Not found', 404)
  return c.json({ conversation: conv })
})

app.patch('/api/conversations/:id', async (c) => {
  const conv = await getConversation(c.req.param('id'))
  if (!conv || conv.userId !== c.get('user').id) return c.text('Not found', 404)
  const b = await c.req.json<{ messages?: unknown[]; title?: string }>().catch(() => ({}))
  const updated = await updateConversation(conv.id, b)
  return c.json({ conversation: updated })
})

app.delete('/api/conversations/:id', async (c) => {
  const conv = await getConversation(c.req.param('id'))
  if (!conv || conv.userId !== c.get('user').id) return c.text('Not found', 404)
  return c.json({ ok: await deleteConversation(conv.id) })
})

/* ---- integrations (Composio: Slack, GitHub, Notion, Sheets…) ---- */

app.get('/api/integrations', async (c) => {
  const connected = new Set(await connectedToolkits(c.get('user').id))
  return c.json({
    enabled: composioEnabled(),
    integrations: INTEGRATIONS.map((i) => ({ ...i, connected: connected.has(i.slug) })),
  })
})

app.post('/api/integrations/:slug/connect', async (c) => {
  const slug = c.req.param('slug')
  if (!INTEGRATIONS.some((i) => i.slug === slug)) return c.text('Unknown integration', 404)
  const r = await connectToolkit(c.get('user').id, slug)
  if ('error' in r) return c.json({ error: r.error }, 400)
  return c.json(r)
})

// The user's GitHub repositories — populates the PR Testing repo dropdown.
// `connected` tells the UI whether GitHub is linked at all, separately from
// whether the repo list happened to come back (it may fail transiently).
app.get('/api/integrations/github/repos', async (c) => {
  const userId = c.get('user').id
  const connected = await isGithubConnected(userId)
  if (!connected) return c.json({ connected: false, repos: [] })
  return c.json({ connected: true, ...(await githubRepos(userId)) })
})

/* ---- tickets (GitHub issues across the agents' connected repos) ---- */

// The Tickets page: every GitHub issue from the repos the user's agents are
// connected to. Each agent picks a repo in its PR Testing tab; we group agents
// by repo (so a shared repo is fetched once) and tag each issue with the
// agent(s) that own it.
app.get('/api/tickets', async (c) => {
  const userId = c.get('user').id
  const projectId = c.req.query('projectId') || undefined
  if (!composioEnabled()) return c.json({ enabled: false, connected: false, repos: [], tickets: [] })
  if (!(await isGithubConnected(userId)))
    return c.json({ enabled: true, connected: false, repos: [], tickets: [] })

  const agents = await listAgents(userId, projectId)
  const byRepo = new Map<string, string[]>()
  for (const a of agents) {
    const repo = a.settings?.githubRepo?.trim()
    if (!repo) continue
    const names = byRepo.get(repo) ?? []
    if (!names.includes(a.name)) names.push(a.name)
    byRepo.set(repo, names)
  }

  const tickets: Record<string, unknown>[] = []
  let error: string | undefined
  for (const [repo, agentNames] of byRepo) {
    const r = await githubIssues(userId, repo)
    if (!r.ok) {
      error = `${repo}: ${r.error ?? 'GitHub fetch failed.'}`
      continue
    }
    for (const iss of r.issues) tickets.push({ ...iss, repo, agentName: agentNames.join(', ') })
  }
  tickets.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return c.json({ enabled: true, connected: true, repos: [...byRepo.keys()], tickets, error })
})

// File a new GitHub issue — only against a repo one of the user's agents is
// actually connected to.
app.post('/api/tickets', async (c) => {
  const userId = c.get('user').id
  const b = await c.req.json<{ repo?: string; title?: string; body?: string }>().catch(() => ({}))
  const repo = b.repo?.trim()
  const title = b.title?.trim()
  if (!repo || !title) return c.json({ error: 'A repository and title are required.' }, 400)
  const agents = await listAgents(userId)
  const repos = new Set(agents.map((a) => a.settings?.githubRepo?.trim()).filter(Boolean))
  if (!repos.has(repo)) return c.json({ error: 'That repository is not connected to any agent.' }, 400)
  if (!(await isGithubConnected(userId)))
    return c.json({ error: 'Connect GitHub in the Integrations tab first.' }, 400)
  const r = await githubCreateIssue(userId, repo, title, b.body ?? '')
  if (!r.ok) return c.json({ error: r.error ?? 'Could not create the issue.' }, 400)
  return c.json({ ok: true, url: r.url, number: r.number })
})

/* ---- email agent (conversational inbox via AgentMail) ---- */

// The address users write to so the email agent can create and run tests.
app.get('/api/email/inbox', async (c) => {
  if (!agentMailEnabled()) return c.json({ enabled: false, address: null })
  const box = await ensureInbox()
  return c.json({ enabled: true, address: box?.address ?? null })
})

app.get('/api/agents/:id', async (c) => {
  const agent = await ownedAgent(c)
  if (!agent) return c.text('Not found', 404)
  return c.json({ agent: publicAgent(agent) })
})

app.patch('/api/agents/:id', async (c) => {
  if (!(await ownedAgent(c))) return c.text('Not found', 404)
  const patch = await c.req.json<Partial<Agent>>().catch(() => ({}))
  const agent = await updateAgent(c.req.param('id'), patch)
  if (!agent) return c.text('Not found', 404)
  return c.json({ agent: publicAgent(agent) })
})

app.delete('/api/agents/:id', async (c) => {
  if (!(await ownedAgent(c))) return c.text('Not found', 404)
  return c.json({ ok: await deleteAgent(c.req.param('id')) })
})

app.post('/api/agents/:id/runs', async (c) => {
  if (!(await ownedAgent(c))) return c.text('Not found', 404)
  const user = c.get('user')
  const check = await checkLimit(user.id, user.plan, 'runs')
  if (!check.ok) {
    return c.json(
      { error: check.error, code: check.code, usage: check.usage, limit: check.limit, plan: check.plan },
      402,
    )
  }
  const body = await c.req.json<Partial<RunRecord>>().catch(() => ({}))
  const run: RunRecord = {
    id: body.id ?? crypto.randomUUID(),
    startedAt: body.startedAt ?? new Date().toISOString(),
    status: body.status ?? 'running',
    summary: body.summary,
  }
  await addRun(c.req.param('id'), run)
  return c.json({ run })
})

// One run's full detail — includes the heavy screenshot the overview omits.
app.get('/api/agents/:id/runs/:runId', async (c) => {
  const agent = await ownedAgent(c)
  if (!agent) return c.text('Not found', 404)
  const run = agent.runs.find((r) => r.id === c.req.param('runId'))
  if (!run) return c.text('Run not found', 404)
  return c.json({ run })
})

// Pull open PRs + issues from the workspace's GitHub repo.
app.get('/api/agents/:id/github', async (c) => {
  const agent = await ownedAgent(c)
  if (!agent) return c.text('Not found', 404)
  const userId = c.get('user').id
  const { githubRepo, githubToken } = agent.settings
  if (!githubRepo) {
    return c.json({ ok: false, error: 'No repository selected — choose one in PR Testing.' })
  }
  // If GitHub is connected via the Integrations tab (Composio), use ONLY that
  // — never fall back to a stale manual token.
  if (await isGithubConnected(userId)) {
    const r = await githubItems(userId, githubRepo)
    return c.json(
      r.ok ? { ok: true, prs: r.prs, issues: r.issues } : { ok: false, error: r.error || 'GitHub fetch failed.' },
    )
  }
  // Not connected via Composio → legacy manual token, if one was saved.
  if (!githubToken) {
    return c.json({ ok: false, error: 'Connect GitHub in the Integrations tab to load PRs and issues.' })
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${githubRepo}/issues?state=open&per_page=40`,
      { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' } },
    )
    if (!res.ok) return c.json({ ok: false, error: `GitHub API ${res.status}` })
    const items = (await res.json()) as Array<Record<string, unknown>>
    const simplify = (i: Record<string, unknown>) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      author: (i.user as { login?: string } | undefined)?.login ?? 'unknown',
      state: i.state,
    })
    return c.json({
      ok: true,
      prs: items.filter((i) => i.pull_request).map(simplify),
      issues: items.filter((i) => !i.pull_request).map(simplify),
    })
  } catch (e) {
    return c.json({ ok: false, error: String(e) })
  }
})

// Live view of the agent's real browser — a fresh screenshot per poll.
// Reliable in headless Chromium where the CDP screencast often emits nothing.
app.get('/api/browser/frame', async (c) => {
  const chatId = c.req.query('chatId')
  if (!chatId) return c.json({ error: 'Missing chatId' }, 400)
  // The screenshot lives only on the owning machine — replay if asked elsewhere.
  if (process.env.FLY_MACHINE_ID) {
    const { ownerId, claimed } = await claimChat(chatId, INSTANCE_ID)
    if (!claimed && ownerId !== INSTANCE_ID) {
      c.header('fly-replay', `instance=${ownerId}`)
      return c.body(null, 200)
    }
  }
  const f = await currentFrame(chatId)
  return c.json(f ?? { url: '', frame: '' })
})

/* ---- recording: human-driven flow capture ---- */

// Start a new recording. Body: { startUrl }. Returns { recordingId, chatId }
// — chatId is what the frontend passes to /api/browser/frame to watch the
// live browser, same plumbing as quick-chat uses.
app.post('/api/recording/start', async (c) => {
  const user = c.get('user')
  const b = await c.req.json<{ startUrl?: string }>().catch(() => ({}))
  const startUrl = (b.startUrl || '').trim()
  if (!startUrl) return c.json({ error: 'startUrl required' }, 400)
  // Default to https:// if the user typed a bare host — same UX touch as a browser bar.
  const url = /^https?:\/\//i.test(startUrl) ? startUrl : `https://${startUrl}`
  try {
    const { recordingId, chatId } = await startRecording(user.id, url)
    return c.json({ recordingId, chatId })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// Live poll of the in-progress step list — used by the Recording UI to render
// the left pane as steps stream in from the capture script.
app.get('/api/recording/:id/steps', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const steps = await getRecordingSteps(user.id, id)
  if (steps == null) return c.json({ error: 'Not found' }, 404)
  return c.json({ steps })
})

// Stop the recording. Closes the browser session and freezes the step list.
app.post('/api/recording/:id/stop', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await stopRecording(user.id, id)
  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json(result)
})

// Forward a mouse event from the frontend pane to the live browser. The
// frontend captures clicks/moves on the rendered screencast and POSTs the
// viewport-scaled coordinates here. We synthesize the input on the page
// via Playwright; the capture script (running in-page) sees the resulting
// DOM events and records them as steps. The CHAT_ID prefix is "rec-<id>".
//
// Body: { x: number, y: number, action: 'click'|'move'|'down'|'up',
//         button?: 'left'|'right'|'middle', clickCount?: number }
app.post('/api/recording/:id/mouse', async (c) => {
  const id = c.req.param('id')
  const b = await c.req
    .json<{ x?: number; y?: number; action?: string; button?: string; clickCount?: number }>()
    .catch(() => ({}))
  const x = Number(b.x)
  const y = Number(b.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return c.json({ error: 'x/y required' }, 400)
  const action = b.action || 'click'
  // Bound to the recording's known chatId — we don't reuse this for any
  // other browser session, so the prefix is the authorization check.
  const chatId = `rec-${id}`
  try {
    const { page } = await getSession(chatId)
    const button = (b.button as 'left' | 'right' | 'middle' | undefined) || 'left'
    if (action === 'click') {
      await page.mouse.click(x, y, { button, clickCount: b.clickCount || 1 })
    } else if (action === 'move') {
      await page.mouse.move(x, y)
    } else if (action === 'down') {
      await page.mouse.move(x, y)
      await page.mouse.down({ button })
    } else if (action === 'up') {
      await page.mouse.move(x, y)
      await page.mouse.up({ button })
    } else {
      return c.json({ error: `unknown action: ${action}` }, 400)
    }
    // Push a fresh frame immediately so the user sees the result of their
    // input without waiting for the next polling tick. Don't block the
    // response on it — let it race the SSE push instead.
    if (action !== 'move') void pushImmediateFrame(chatId)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// Forward keystrokes from the frontend pane. Two modes:
//   - { key: 'Enter'|'Tab'|... } → page.keyboard.press(key) for named keys
//   - { text: 'hello' }          → page.keyboard.type(text) for plain text
// The capture script's input listener picks up both and records a fill step
// on blur/Enter. Modifiers (ctrl/alt/shift/meta) can be prefixed in `key`,
// e.g. "Meta+a" for select-all — Playwright understands that form.
app.post('/api/recording/:id/key', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json<{ key?: string; text?: string }>().catch(() => ({}))
  const chatId = `rec-${id}`
  try {
    const { page } = await getSession(chatId)
    if (b.text != null) {
      await page.keyboard.type(b.text)
    } else if (b.key) {
      await page.keyboard.press(b.key)
    } else {
      return c.json({ error: 'key or text required' }, 400)
    }
    void pushImmediateFrame(chatId)
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// Forward mouse wheel scrolling. Frontend captures wheel events on the
// pane and forwards deltaX / deltaY in CSS pixels.
app.post('/api/recording/:id/scroll', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json<{ deltaX?: number; deltaY?: number }>().catch(() => ({}))
  const dx = Number(b.deltaX) || 0
  const dy = Number(b.deltaY) || 0
  const chatId = `rec-${id}`
  try {
    const { page } = await getSession(chatId)
    await page.mouse.wheel(dx, dy)
    // Don't push an immediate frame for scroll — wheel events arrive in
    // bursts (60+/sec) and each screenshot is ~100ms. The 250ms cadence
    // tick will catch the repaint without backing up the queue.
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// Promote a recording into a named saved flow. Body:
//   { name, description?, params?: { [stepIndex]: paramName } }
app.post('/api/recording/:id/save', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const b = await c.req
    .json<{
      name?: string
      description?: string
      purpose?: string
      params?: Record<number, string>
    }>()
    .catch(() => ({}))
  const name = (b.name ?? '').trim()
  const purpose = (b.purpose ?? '').trim()
  if (!name) return c.json({ error: 'name required' }, 400)
  // Mandatory: the agent reads `purpose` to know when this flow applies.
  if (!purpose) return c.json({ error: 'purpose required — explain when the agent should use this flow' }, 400)
  const flow = await saveAsFlow(user.id, id, name, b.description ?? '', purpose, b.params ?? {})
  if (!flow) return c.json({ error: 'Recording not found' }, 404)
  return c.json({ flow })
})

/* ---- per-chat flow attachments ---- */

// List the flows currently attached to a chat (quick-chat or workspace).
// Returns the full flow row so the UI can render purpose/step count.
app.get('/api/chats/:chatId/flows', async (c) => {
  const user = c.get('user')
  const chatId = c.req.param('chatId')
  const flows = await listAttachedFlows(user.id, chatId)
  return c.json({ flows })
})

// Attach a flow to a chat. Body: { flowId }
app.post('/api/chats/:chatId/flows', async (c) => {
  const user = c.get('user')
  const chatId = c.req.param('chatId')
  const b = await c.req.json<{ flowId?: string }>().catch(() => ({}))
  if (!b.flowId) return c.json({ error: 'flowId required' }, 400)
  await attachFlow(user.id, chatId, b.flowId)
  return c.json({ ok: true })
})

app.delete('/api/chats/:chatId/flows/:flowId', async (c) => {
  const user = c.get('user')
  await detachFlow(user.id, c.req.param('chatId'), c.req.param('flowId'))
  return c.json({ ok: true })
})

/* ---- flows: per-user saved library ---- */

app.get('/api/flows', async (c) => {
  const user = c.get('user')
  const flows = await listFlows(user.id)
  return c.json({ flows })
})

app.get('/api/flows/:id', async (c) => {
  const user = c.get('user')
  const flow = await getFlow(user.id, c.req.param('id'))
  if (!flow) return c.json({ error: 'Not found' }, 404)
  return c.json({ flow })
})

app.patch('/api/flows/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const b = await c.req.json<{ name?: string; description?: string }>().catch(() => ({}))
  if (b.name == null && b.description == null) {
    return c.json({ error: 'name or description required' }, 400)
  }
  await renameFlow(user.id, id, b.name ?? '', b.description)
  const flow = await getFlow(user.id, id)
  return c.json({ flow })
})

app.delete('/api/flows/:id', async (c) => {
  const user = c.get('user')
  await deleteFlow(user.id, c.req.param('id'))
  return c.json({ ok: true })
})

// Live view of the agent's real browser — JPEG frames over SSE (legacy).
app.get('/api/browser/stream', async (c) => {
  const chatId = c.req.query('chatId')
  if (!chatId) return c.text('Missing chatId', 400)

  // The frame hub lives only on the owning machine — replay if asked elsewhere.
  if (process.env.FLY_MACHINE_ID) {
    const { ownerId, claimed } = await claimChat(chatId, INSTANCE_ID)
    if (!claimed && ownerId !== INSTANCE_ID) {
      c.header('fly-replay', `instance=${ownerId}`)
      return c.body(null, 200)
    }
  }

  return streamSSE(c, async (stream) => {
    let closed = false
    const unsub = subscribeFrames(chatId, (f) => {
      if (!closed) stream.writeSSE({ data: JSON.stringify(f) }).catch(() => {})
    })
    stream.onAbort(() => {
      closed = true
      unsub()
    })
    while (!closed) {
      await stream.sleep(15_000)
      if (!closed) await stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {})
    }
  })
})

/**
 * Production: serve the built Vite SPA from the same Hono process so the
 * Fly machine at app.probeqa.com handles both /api and the React app from
 * one origin (cookies, websockets, billing redirects all stay simple).
 * Local dev keeps Vite on :3005 and proxies /api → :8787.
 */
if (process.env.SERVE_STATIC === '1') {
  // Serve hashed assets, favicon.svg, etc. from dist/.
  app.use('/*', serveStatic({ root: './dist' }))
  // SPA fallback — React Router handles client-side routing.
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

const port = Number(process.env.PORT || process.env.AGENT_PORT) || 8787
serve({ fetch: app.fetch, port }, () => {
  console.log(`🔬 probe agent server → http://localhost:${port}`)
  startScheduler()
  void startEmailAgent()
})
