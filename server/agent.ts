/**
 * The Probe testing agent — a ReAct loop over OpenRouter (Grok).
 *
 *   streamText({ tools, stopWhen: stepCountIs(N) })
 *     ↳ model thinks → calls a browser tool → observes result → thinks → …
 *     ↳ stops when it writes a final answer or hits the step cap.
 *
 * Same provider/stack as agentvault-app; only the tools differ — here they
 * drive a real browser instead of searching a vault.
 */
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type ModelMessage,
  type UIMessage,
} from 'ai'
import { buildBrowserTools, buildPlanTools } from './browser.ts'
import { SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, RUN_PLAN_PROTOCOL } from './prompt.ts'
import { getAgent, addRun, updateRun, type Agent, type RunRecord, type RunStep } from './store.ts'
import { reflectOnRun } from './reflect.ts'
import { composioToolsFor, connectedToolkits } from './composio.ts'

const MEMORY_LABEL: Record<string, string> = {
  site_structure: 'SITE STRUCTURE',
  test_insights: 'TEST INSIGHT — learned from past runs',
  user_preferences: 'USER PREFERENCE',
}

export type AgentMode = 'plan' | 'run'

/**
 * The workspace facts both planning and running agents should know.
 * `includePlan` injects the saved plan into the prompt — done for run mode
 * (the runner follows it), but NOT for plan mode, where the agent reads the
 * plan live via the get_canvas tool so there is only one source.
 */
function workspaceContext(agent: Agent, includePlan: boolean, connected: string[]): string {
  const lines: string[] = ['— WORKSPACE CONTEXT —', `Workspace: "${agent.name}".`]
  if (agent.url) lines.push(`Target site: ${agent.url}`)
  if (agent.testAccounts.length > 0) {
    lines.push(
      `Test accounts available (use list_test_accounts / use_test_account to sign in): ${agent.testAccounts
        .map((a) => a.label)
        .join(', ')}.`,
    )
  }
  if (agent.settings.githubRepo && agent.settings.githubToken) {
    lines.push(
      `GitHub is connected (${agent.settings.githubRepo}) — call report_to_github to file findings as an issue.`,
    )
  }
  if (connected.length > 0) {
    lines.push(
      '',
      `CONNECTED INTEGRATIONS — these apps are connected and their actions are available to you as tools: ${connected.join(', ')}.`,
    )
  }
  if (includePlan && agent.steps.length > 0) {
    lines.push('', 'CURRENT TEST PLAN ON THE CANVAS:')
    agent.steps.forEach((s, i) => {
      lines.push(`${i + 1}. [${s.kind}] ${s.label}${s.detail ? ` — ${s.detail}` : ''}`)
    })
  }
  for (const m of agent.memory) {
    lines.push('', `MEMORY [${MEMORY_LABEL[m.category] ?? 'NOTE'}] — ${m.title}:`, m.body)
  }
  return lines.join('\n')
}

/** System prompt for the given mode, extended with workspace context. */
function systemPromptFor(
  agent: Agent | undefined,
  mode: AgentMode | undefined,
  connected: string[],
): string {
  const base = mode === 'plan' ? PLAN_SYSTEM_PROMPT : SYSTEM_PROMPT
  if (!agent) return base
  let prompt = `${base}\n\n${workspaceContext(agent, mode !== 'plan', connected)}`
  if (mode !== 'plan' && agent.steps.length > 0) {
    prompt += `\n${RUN_PLAN_PROTOCOL}`
  }
  return prompt
}

/**
 * The ReAct loop re-sends the whole history every step, so screenshots and
 * big DOM dumps pile up fast — enough to blow past the model's context
 * limit. The agent only needs the *current* page state, so before each
 * step we keep just the most recent heavy tool results and replace older
 * ones with a short placeholder.
 */
const KEEP_RECENT: Record<string, number> = {
  screenshot: 2,
  get_html: 5,
  inspect_page: 5,
  get_page_text: 5,
}

function pruneHeavyResults(messages: ModelMessage[]): ModelMessage[] {
  const seen: Record<string, number> = {}
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue
    for (let j = m.content.length - 1; j >= 0; j--) {
      const part = m.content[j] as { type?: string; toolName?: string; output?: unknown }
      if (part?.type !== 'tool-result') continue
      const name = part.toolName ?? ''
      const keep = KEEP_RECENT[name]
      if (!keep) continue
      seen[name] = (seen[name] ?? 0) + 1
      if (seen[name] > keep) {
        part.output = {
          type: 'text',
          value: `[earlier ${name} result dropped to keep within the model's context limit — re-run the tool if you need it again]`,
        }
      }
    }
  }
  return messages
}

/**
 * Persist a finished workspace run — updates the 'running' record created at
 * run start (matched by runId) with its duration, per plan-step result (from
 * the agent's step_status calls), the final screenshot, and overall status.
 */
async function recordRun(
  agentId: string,
  runId: string,
  startedAt: string,
  text: string,
  modelSteps: unknown[],
  planSteps: Agent['steps'],
): Promise<void> {
  const statusByIndex = new Map<number, { status: string; note?: string }>()
  let screenshot: string | undefined
  let checkIssues = 0

  for (const s of modelSteps ?? []) {
    for (const tr of ((s as { toolResults?: unknown[] }).toolResults ?? [])) {
      const t = tr as { toolName?: string; output?: Record<string, unknown> }
      const out = t.output ?? {}
      if (t.toolName === 'step_status' && typeof out.stepIndex === 'number') {
        statusByIndex.set(out.stepIndex as number, {
          status: String(out.status ?? 'running'),
          note: typeof out.note === 'string' ? out.note : undefined,
        })
      }
      if (t.toolName === 'screenshot' && out.ok && typeof out.image === 'string') {
        screenshot = out.image as string
      }
      if (t.toolName === 'check' && out.pass === false) checkIssues++
    }
  }

  // One RunStep per saved plan step, carrying the result the agent reported.
  const runSteps: RunStep[] = (planSteps ?? []).map((p, i) => {
    const r = statusByIndex.get(i + 1)
    const st = r?.status
    return {
      index: i + 1,
      label: p.label,
      kind: p.kind,
      status: st === 'passed' || st === 'failed' || st === 'running' ? st : 'pending',
      note: r?.note,
    }
  })

  const failed = runSteps.filter((s) => s.status === 'failed').length
  const status: RunRecord['status'] =
    failed > 0 ? 'failed' : checkIssues > 0 ? 'issues' : 'passed'
  const finishedAt = new Date().toISOString()

  await updateRun(agentId, {
    id: runId,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    status,
    summary: (text || 'Run completed.').trim().slice(0, 4000),
    steps: runSteps.length ? runSteps : undefined,
    screenshot,
  }).catch((e) => console.error('[probe-agent] recordRun failed:', e))
}

export async function runAgent(
  messages: UIMessage[],
  chatId: string,
  agentId?: string,
  mode?: AgentMode,
  userId?: string,
) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (check probe-app/.env)')

  const openrouter = createOpenRouter({ apiKey })
  const agent = agentId ? await getAgent(agentId) : undefined
  const planning = mode === 'plan'
  const startedAt = new Date().toISOString()
  const runId = crypto.randomUUID()
  const isRun = mode === 'run' && !!agentId

  // Write a 'running' RunRecord up front so the run shows on the platform the
  // MOMENT it starts — not only when it finishes. onFinish updates this same
  // record (matched by runId) to its final status; onError flips it to failed.
  if (isRun) {
    await addRun(agentId!, { id: runId, startedAt, status: 'running' }).catch((e) =>
      console.error('[probe-agent] could not create running record:', e),
    )
  }

  // Integrations the user has connected (Slack, Gmail, Notion…). The names go
  // into the prompt so the planning agent knows which integration nodes it may
  // add; the tools are merged in for run/editor so the agent can act on them.
  const connected = userId ? await connectedToolkits(userId) : []
  const composioTools =
    !planning && userId && connected.length > 0 ? await composioToolsFor(userId, connected) : {}

  return streamText({
    model: openrouter.chat(process.env.LLM_MODEL || 'x-ai/grok-build-0.1'),
    system: systemPromptFor(agent, mode, connected),
    messages: await convertToModelMessages(messages),
    // Planning mode gets only the plan tool — it cannot drive a browser.
    tools: planning
      ? buildPlanTools(agentId)
      : { ...buildBrowserTools(chatId, { agent }), ...composioTools },
    // Trim stale screenshots / DOM dumps from history before every step so
    // the re-sent context stays well under the model's token limit.
    prepareStep: ({ messages }) => ({ messages: pruneHeavyResults(messages) }),
    // Planning is short; a full plan run needs many tool calls per step.
    stopWhen: stepCountIs(planning ? 8 : 130),
    temperature: 0.2,
    maxRetries: 2,
    // A stream error means the run never reaches onFinish — flip the
    // 'running' record to 'failed' so it doesn't hang as running forever.
    onError: ({ error }) => {
      console.error('[probe-agent] stream error:', error)
      if (isRun) {
        const finishedAt = new Date().toISOString()
        void updateRun(agentId!, {
          id: runId,
          startedAt,
          finishedAt,
          durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
          status: 'failed',
          summary: `Run failed: ${error instanceof Error ? error.message : String(error)}`,
        }).catch((e) => console.error('[probe-agent] could not mark run failed:', e))
      }
    },
    // After a workspace RUN finishes: update its RunRecord, and a separate
    // LLM reflects on it to update test-insight memory.
    onFinish: ({ text, steps }) => {
      if (isRun) {
        void recordRun(agentId!, runId, startedAt, text, steps as unknown[], agent?.steps ?? [])
        void reflectOnRun(agentId!, text)
      }
    },
  })
}
