/**
 * The conversational email agent.
 *
 * Polls the AgentMail inbox; for each new inbound message it identifies the
 * Probe user by sender address, replays the email thread as chat history,
 * runs an LLM with tools (list / create / run testing agents), and replies
 * in-thread. A test run is kicked off in the background and its result is
 * emailed back into the same thread when it finishes.
 *
 * Webhooks need a public URL, so on localhost we poll. Swapping to the
 * `message.received` webhook later reuses `handleInbound` unchanged.
 */
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, stepCountIs, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import {
  agentMailEnabled,
  ensureInbox,
  listMessages,
  getMessage,
  getThreadMessages,
  reply,
  isOutbound,
  type Mail,
} from './agentmail.ts'
import {
  getUserByEmail,
  listAgents,
  listProjects,
  createAgent,
  getAgent,
  updateAgent,
  overview,
  type TestStep,
} from './store.ts'
import { runAgentInBackground } from './scheduler.ts'

const POLL_MS = 20_000

/** Message ids we've already handled — seeded with inbox history at boot. */
const seen = new Set<string>()
let polling = false

export const EMAIL_SYSTEM = `You are Probe's email assistant. Probe runs autonomous QA testing agents that test websites end-to-end.

Reply over email — friendly, concise, PLAIN TEXT only (no markdown, no asterisks, no headings).

Tools — you MUST use them. Never guess, and never give a generic answer when a tool applies:
- list_agents — call this WHENEVER the user asks what agents, tests, or workspaces they have.
- recent_runs — call this WHENEVER the user asks about recent runs, run results, test history, or what passed or failed.
- list_projects — call this to see the user's projects. Every agent lives inside a project.
- create_agent — create a NEW testing agent for a website, inside one of the user's projects. This makes an EMPTY agent with no test plan yet.
- read_canvas — read an agent's current test plan (its ordered steps on the canvas).
- update_canvas — write or replace an agent's test plan on the canvas. This is how you turn the user's request into a real, ordered test. Whatever you pass BECOMES the plan.
- run_agent — run an agent's test plan once, in the background.

HOW TO HANDLE A "CREATE / TEST THIS WEBSITE" REQUEST — follow this exact sequence:
1. Confirm the project. Call list_projects; if the user did not name one, ASK which project and STOP until they reply.
2. create_agent — creates the empty agent in that project.
3. update_canvas — build the FULL ordered test plan for exactly what the user described: navigate to the page, act (click/fill) for each interaction with the concrete values the user gave, wait where needed, assert the expected outcome, screenshot key states. Ground every step in what the user asked — never an empty or vague plan.
4. The user is emailing you, so they want the result by email. Make the LAST step of update_canvas an "integration" step worded exactly like: "Send email via Gmail to <the user's email address> with the test run summary and results".
5. run_agent — start the run. It is one-time and asynchronous; the testing agent itself emails the summary as the final step of the plan.

Step kinds for update_canvas: navigate, act, assert, login, screenshot, github, integration.

Rules:
- Every email from the user is a real request — act on it. Never reply with a generic "how can I help" or "confirming it works" message.
- If the user asks about their agents, you MUST call list_agents and answer with the real list.
- If the user asks about recent runs, results, or what passed or failed, you MUST call recent_runs and answer with the real data.
- An agent ALWAYS belongs to a project. Never create an agent without knowing which project — ask first.
- Never leave a created agent with an empty canvas when the user told you what to test — always call update_canvas with real steps.
- A run is one-time and asynchronous. Tell the user it has started and the summary will arrive by email. Never wait for, guess, or invent the result.
- Never invent agents, runs, or results.
- End your reply by asking if there is anything else you can help with.

CRITICAL — RUNNING A TEST:
- Whenever the user asks to run, start, re-run, "run again", test, or kick off an agent, you MUST call the run_agent tool in THIS turn. There is NO exception.
- An earlier "the test run has started" message in this email thread does NOT count and does NOT mean a run is in progress. Each new email is a fresh instruction — if it asks to run, you call run_agent again, right now.
- You may ONLY tell the user a run has started AFTER run_agent has actually returned { ok: true } in this turn. If you have not called run_agent, you have not started anything — never claim otherwise.
- If run_agent returns an error, tell the user the exact error. Never paper over it with "it has started".`

/** Find one of a user's agents by exact-then-partial name match. */
async function resolveAgent(userId: string, name: string) {
  const agents = await listAgents(userId)
  const q = name.toLowerCase().trim()
  return (
    agents.find((a) => a.name.toLowerCase() === q) ??
    agents.find((a) => a.name.toLowerCase().includes(q)) ??
    null
  )
}

/** Tools the email agent can use, scoped to one user. */
export function buildTools(userId: string) {
  return {
    list_agents: tool({
      description: "List the user's Probe testing agents (workspaces).",
      inputSchema: z.object({}),
      execute: async () => {
        const agents = await listAgents(userId)
        if (agents.length === 0) return { agents: [], note: 'The user has no testing agents yet.' }
        return {
          agents: agents.map((a) => ({
            name: a.name,
            url: a.url,
            steps: a.steps.length,
            runs: a.runs.length,
          })),
        }
      },
    }),
    recent_runs: tool({
      description:
        "List the user's recent test runs across all their agents — status, summary, when they ran, duration, and per-step results. Use this whenever the user asks about recent runs, results, test history, or what passed or failed.",
      inputSchema: z.object({
        agent: z
          .string()
          .optional()
          .describe('Optional — only return runs for the agent whose name contains this text.'),
        limit: z
          .number()
          .optional()
          .describe('How many recent runs to return, newest first. Default 10.'),
      }),
      execute: async ({ agent, limit }) => {
        const { runs, stats } = await overview(userId)
        let list = runs
        if (agent) {
          const q = agent.toLowerCase().trim()
          list = list.filter((r) => r.agentName.toLowerCase().includes(q))
        }
        list = list.slice(0, Math.max(1, Math.min(limit ?? 10, 25)))
        if (list.length === 0) {
          return { runs: [], note: 'No test runs found yet for this user.' }
        }
        return {
          totalRuns: stats.totalRuns,
          passRate: stats.passRate,
          runs: list.map((r) => ({
            agent: r.agentName,
            status: r.status,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            durationMs: r.durationMs,
            summary: r.summary,
            steps: r.steps?.map((s) => ({
              step: s.index,
              label: s.label,
              status: s.status,
              note: s.note,
            })),
          })),
        }
      },
    }),
    list_projects: tool({
      description:
        "List the user's projects. Every agent belongs to a project, so use this to show the user their options before creating an agent.",
      inputSchema: z.object({}),
      execute: async () => {
        const projects = await listProjects(userId)
        if (projects.length === 0) {
          return { projects: [], note: 'The user has no projects yet.' }
        }
        return { projects: projects.map((p) => ({ name: p.name })) }
      },
    }),
    read_canvas: tool({
      description:
        "Read an agent's current test plan from its canvas — the ordered list of test steps. Call this before changing a plan so you build on what is already there.",
      inputSchema: z.object({
        agent: z.string().describe('Name of the agent whose test plan to read.'),
      }),
      execute: async ({ agent }) => {
        const match = await resolveAgent(userId, agent)
        if (!match) return { ok: false, error: `No agent named "${agent}".` }
        const full = await getAgent(match.id)
        const steps = (full?.steps ?? []).map((s, i) => ({
          index: i + 1,
          kind: s.kind,
          label: s.label,
          ...(s.detail ? { detail: s.detail } : {}),
        }))
        return { ok: true, agent: match.name, stepCount: steps.length, steps }
      },
    }),
    update_canvas: tool({
      description:
        "Replace an agent's test plan (its canvas) with a new, complete, ordered list of steps. Whatever you pass BECOMES the plan. Build the full end-to-end test for what the user asked. When the user wants the results emailed, make the LAST step an 'integration' step worded \"Send email via Gmail to <user email> with the test run summary and results\".",
      inputSchema: z.object({
        agent: z.string().describe('Name of the agent whose test plan to set.'),
        steps: z
          .array(
            z.object({
              kind: z
                .enum(['navigate', 'act', 'assert', 'login', 'screenshot', 'github', 'integration'])
                .describe(
                  'Step kind: navigate (open a URL), act (click/fill/interact), assert (verify an expectation), login, screenshot, github (file an issue), integration (act on a connected app such as Gmail).',
                ),
              label: z.string().describe('Imperative one-line description of the step.'),
              detail: z
                .string()
                .optional()
                .describe('Optional extra context — a URL, the data to enter, what to verify.'),
            }),
          )
          .describe('The complete ordered test plan that becomes the canvas.'),
      }),
      execute: async ({ agent, steps }) => {
        const match = await resolveAgent(userId, agent)
        if (!match) return { ok: false, error: `No agent named "${agent}".` }
        const canvas: TestStep[] = steps.map((s) => ({
          id: crypto.randomUUID(),
          kind: s.kind,
          label: s.label,
          ...(s.detail ? { detail: s.detail } : {}),
        }))
        await updateAgent(match.id, { steps: canvas })
        return { ok: true, agent: match.name, stepCount: canvas.length }
      },
    }),
    create_agent: tool({
      description:
        "Create a new Probe testing agent (a test workspace) for a website, inside one of the user's projects. It starts with an EMPTY canvas — build its test plan with update_canvas afterwards. Do NOT call this until the user has told you which project to use.",
      inputSchema: z.object({
        name: z.string().describe('A short name for the testing agent.'),
        url: z.string().describe('The target website URL the agent will test.'),
        project: z
          .string()
          .describe(
            'The name of the project to create the agent in. Required — ask the user which project before calling this if they have not said.',
          ),
      }),
      execute: async ({ name, url, project }) => {
        const projects = await listProjects(userId)
        const q = project.toLowerCase().trim()
        const match =
          projects.find((p) => p.name.toLowerCase() === q) ??
          projects.find((p) => p.name.toLowerCase().includes(q))
        if (!match) {
          return {
            ok: false,
            error: `No project named "${project}". The user's projects are: ${
              projects.map((p) => p.name).join(', ') || 'none'
            }. Ask the user which project to use — do not guess.`,
          }
        }
        const a = await createAgent(userId, name, url, match.id)
        return { ok: true, name: a.name, url: a.url, project: match.name }
      },
    }),
    run_agent: tool({
      description:
        "Run an agent's test plan once, in the background. The run is one-time and asynchronous; the testing agent emails the summary itself as the final step of its plan.",
      inputSchema: z.object({
        name: z.string().describe('Name of the agent to run.'),
      }),
      execute: async ({ name }) => {
        const match = await resolveAgent(userId, name)
        if (!match) {
          const agents = await listAgents(userId)
          return {
            ok: false,
            error: `No agent named "${name}". Available: ${
              agents.map((a) => a.name).join(', ') || 'none'
            }.`,
          }
        }
        const full = await getAgent(match.id)
        if (!full) return { ok: false, error: 'Agent not found.' }
        if (full.steps.length === 0) {
          return {
            ok: false,
            error: `"${match.name}" has no test plan. Call update_canvas to build its steps before running.`,
          }
        }
        // Fire-and-forget — runs async in the background via the exact same
        // path as the scheduler (runAgentInBackground). The plan's final
        // "Send email via Gmail" step delivers the summary to the user.
        console.log(
          `[email-agent] run_agent → starting "${full.name}" (${full.id}), ${full.steps.length} steps`,
        )
        void runAgentInBackground(full).catch((e) =>
          console.error(`[email-agent] runAgentInBackground threw for "${full.name}":`, e),
        )
        return { ok: true, started: match.name, steps: full.steps.length }
      },
    }),
  }
}

/** Handle one inbound email: identify the user, run the agent, reply. */
export async function handleInbound(m: Mail): Promise<void> {
  const user = await getUserByEmail(m.from)
  if (!user) {
    // Never reply to an unknown sender — a reply to our own address would
    // otherwise loop. Unknown senders are simply ignored.
    console.log(`[email-agent] ignoring mail from unrecognised sender: ${m.from}`)
    return
  }

  // Replay the email thread as chat history (oldest first).
  const thread = await getThreadMessages(m.threadId)
  const history: ModelMessage[] = thread
    .filter((t) => t.text)
    .map((t) => ({ role: isOutbound(t) ? 'assistant' : 'user', content: t.text }))
  // A conversation must start at a user turn — drop any leading agent
  // messages (e.g. a kickoff email the agent sent first), which otherwise
  // make the model treat the exchange as small talk and skip its tools.
  while (history.length && history[0].role === 'assistant') history.shift()
  // If the thread fetch came back empty, fall back to just this message.
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    history.push({ role: 'user', content: m.text || m.subject || '(empty message)' })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('[email-agent] OPENROUTER_API_KEY is not set')
    return
  }
  const openrouter = createOpenRouter({ apiKey })
  // The sender is already verified against a Probe account by the time we get
  // here — tell the model so it never second-guesses identity.
  const system = `${EMAIL_SYSTEM}

CURRENT USER — you are emailing with ${user.name || user.email} (${user.email}). Their Probe account is verified and linked. Never ask them to sign up and never say their email isn't linked — just help them.`
  // Show exactly what the model is being asked to act on.
  console.log(
    `[email-agent] thread for ${m.from} — ${history.length} message(s):\n` +
      history
        .map((h, i) => `  ${i + 1}. ${h.role}: ${String(h.content).replace(/\s+/g, ' ').slice(0, 160)}`)
        .join('\n'),
  )
  try {
    const res = await generateText({
      model: openrouter.chat(process.env.EMAIL_AGENT_MODEL || 'minimax/minimax-m2.7'),
      system,
      messages: history,
      tools: buildTools(user.id),
      stopWhen: stepCountIs(6),
      temperature: 0.3,
    })
    // Log which tools the model actually called this turn — makes it obvious
    // whether a "run started" reply was backed by a real run_agent call.
    const calledTools = res.steps.flatMap((s) => s.toolCalls.map((t) => t.toolName))
    console.log(
      `[email-agent] replied to ${m.from} — tools called: ${calledTools.join(', ') || 'NONE'}\n` +
        `  reply text: ${res.text.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
    )
    await reply(m.messageId, res.text.trim() || 'Done — anything else I can help with?')
  } catch (e) {
    console.error('[email-agent] handleInbound failed:', e)
    await reply(
      m.messageId,
      `Sorry — something went wrong handling your message. (${e instanceof Error ? e.message : String(e)})`,
    )
  }
}

/** One poll cycle — pick up new inbound mail and handle it. */
async function poll(): Promise<void> {
  if (polling) return
  polling = true
  try {
    for (const m of await listMessages()) {
      if (!m.messageId || seen.has(m.messageId)) continue
      seen.add(m.messageId) // mark before handling so a slow run can't double-fire
      if (isOutbound(m)) continue // our own replies
      const full = (await getMessage(m.messageId)) ?? m
      console.log(`[email-agent] handling mail from ${full.from}`)
      void handleInbound(full)
    }
  } catch (e) {
    console.error('[email-agent] poll error:', e)
  } finally {
    polling = false
  }
}

/** Start the email agent — ensure the inbox exists, then poll it. */
export async function startEmailAgent(): Promise<void> {
  if (!agentMailEnabled()) {
    console.log('📭 AgentMail not configured (AGENTMAIL_API_KEY missing) — email agent off')
    return
  }
  const box = await ensureInbox()
  if (!box) {
    console.error('[email-agent] could not obtain an inbox — email agent off')
    return
  }
  // Seed `seen` so a restart never re-answers mail we already handled — but
  // DOES still pick up a genuinely-unanswered message. Group the inbox by
  // thread (listMessages returns newest-first). If a thread's newest message
  // is one of our own replies, the thread is up to date: mark all of it seen.
  // If the newest message is inbound, the user is waiting: seed everything in
  // that thread EXCEPT that newest message, so the first poll answers it.
  const byThread = new Map<string, Mail[]>()
  for (const m of await listMessages()) {
    if (!m.messageId) continue
    const arr = byThread.get(m.threadId) ?? []
    arr.push(m)
    byThread.set(m.threadId, arr)
  }
  let pendingCount = 0
  for (const arr of byThread.values()) {
    const latest = arr[0] // newest message in this thread
    const pending = !isOutbound(latest) // newest is from the user → unanswered
    if (pending) pendingCount++
    for (const m of arr) {
      if (pending && m.messageId === latest.messageId) continue // leave for poll
      seen.add(m.messageId)
    }
  }
  console.log(
    `📬 Probe email agent ready — write to: ${box.address}` +
      (pendingCount ? ` (${pendingCount} unanswered thread(s) will be picked up)` : ''),
  )
  setInterval(() => void poll(), POLL_MS).unref()
}
