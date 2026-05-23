/**
 * Scheduled runs — a cron-style job per agent.
 *
 * A minute-tick loop checks every agent with an enabled schedule and, when one
 * is due, runs its saved test plan HEADLESSLY (no browser tab open). The run
 * records into Run History exactly like a manual run, and reports to GitHub if
 * the plan contains a github node — the same single path as any other run.
 */
import type { UIMessage } from 'ai'
import { runAgent } from './agent.ts'
import { resetSession } from './browser.ts'
import { listScheduledAgents, updateAgent, type Agent, type AgentSchedule } from './store.ts'

/** Is this schedule due to run right now? */
function isDue(s: AgentSchedule, now: Date): boolean {
  if (!s.enabled) return false
  const last = s.lastRunAt ? new Date(s.lastRunAt) : null
  const hour = s.hour ?? 9
  const dom = s.dayOfMonth ?? 1
  switch (s.frequency) {
    case 'minute':
      return !last || now.getTime() - last.getTime() >= 50_000
    case 'hourly':
      // ~1h since the last run (30s slack so the minute-tick never skips it).
      return !last || now.getTime() - last.getTime() >= 60 * 60 * 1000 - 30_000
    case 'daily':
      // fire once during the configured hour.
      if (now.getHours() !== hour) return false
      return !last || last.toDateString() !== now.toDateString()
    case 'monthly':
      // fire once during the configured hour on the configured day.
      if (now.getDate() !== dom || now.getHours() !== hour) return false
      return (
        !last ||
        last.getMonth() !== now.getMonth() ||
        last.getFullYear() !== now.getFullYear()
      )
    default:
      return false
  }
}

/**
 * Run an agent's saved plan to completion, headless, in the background.
 * Shared by the scheduler tick and the email agent's run_agent tool — both
 * fire it the same way: `void runAgentInBackground(agent)`.
 */
export async function runAgentInBackground(agent: Agent): Promise<void> {
  const chatId = crypto.randomUUID()
  const prompt =
    agent.steps.length > 0
      ? 'Run the saved test plan for this workspace now — go through every step in order, check each assertion, and give me a final report.'
      : `Open ${agent.url || 'the target site'} and run an exploratory test, then report what you find.`
  const messages = [
    { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: prompt }] },
  ] as UIMessage[]
  try {
    const result = await runAgent(messages, chatId, agent.id, 'run', agent.userId)
    // Drain the stream — this drives the agent to completion, and runAgent's
    // onFinish then records the RunRecord (and the github node reports).
    await result.consumeStream()
  } catch (e) {
    console.error(`[scheduler] run failed for agent ${agent.id}:`, e)
  } finally {
    await resetSession(chatId)
  }
}

const inFlight = new Set<string>()
let ticking = false

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const now = new Date()
    const agents = await listScheduledAgents()
    for (const agent of agents) {
      if (inFlight.has(agent.id) || !isDue(agent.schedule, now)) continue
      inFlight.add(agent.id)
      // Stamp lastRunAt up front so a slow run can't double-fire next tick.
      await updateAgent(agent.id, {
        schedule: { ...agent.schedule, lastRunAt: now.toISOString() },
      })
      console.log(`[scheduler] running scheduled agent ${agent.id} (${agent.name})`)
      void runAgentInBackground(agent).finally(() => inFlight.delete(agent.id))
    }
  } catch (e) {
    console.error('[scheduler] tick error:', e)
  } finally {
    ticking = false
  }
}

/** Start the minute-tick scheduler. Call once on server boot. */
export function startScheduler(): void {
  setInterval(() => void tick(), 60_000).unref()
  console.log('⏰ probe scheduler started (checks every 60s)')
}
