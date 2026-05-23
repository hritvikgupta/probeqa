/**
 * The learning loop. After a workspace test RUN finishes, a separate LLM
 * reflects on what happened and distils durable "test insights" — facts
 * about the target site that make the next run faster and more reliable.
 *
 * It merges the existing insights with what the latest run revealed, so the
 * memory stays a concise, deduplicated, up-to-date set rather than growing
 * forever. Those insights are then injected into every future run's prompt.
 */
import { generateObject } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { getAgent, updateAgent } from './store.ts'

const REFLECT_SYSTEM = `You are the LEARNING module of an autonomous web-testing agent. A test run just finished. Your job is to distil durable TEST INSIGHTS about the target site — knowledge that will make future runs of this workspace faster and more reliable.

Good test insights are concrete and reusable, e.g.:
- "The login page is at /login but 404s on direct navigation — reach it by clicking the 'Login' link in the nav."
- "Signup uses a temporary-email field; the submit button is labelled 'Create Account'."
- "Many R2-hosted videos fail to load site-wide (ERR_NAME_NOT_RESOLVED) — unrelated to the feature under test."
- "There is no 'Sign Up' link on the homepage; registration is reached via 'Get Started'."

Rules:
- MERGE the existing insights with what this run revealed. Keep what is still true, update what changed, drop what is obsolete or wrong.
- Deduplicate. Keep each insight short and actionable. Do not record transient run results (pass/fail counts) — only durable facts about the site.
- Return the COMPLETE updated set of test insights, not just the new ones.`

/** Reflect on a finished run and update the agent's test-insight memory. */
export async function reflectOnRun(agentId: string, runReport: string): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || !runReport.trim()) return
  const agent = await getAgent(agentId)
  if (!agent) return

  const existing = agent.memory.filter((m) => m.category === 'test_insights')
  const openrouter = createOpenRouter({ apiKey })

  try {
    const { object } = await generateObject({
      model: openrouter.chat(process.env.LLM_MODEL || 'x-ai/grok-build-0.1'),
      schema: z.object({
        insights: z
          .array(
            z.object({
              title: z.string().describe('Short summary of the insight.'),
              body: z.string().describe('The durable, actionable detail.'),
              importance: z.enum(['low', 'medium', 'high']),
            }),
          )
          .describe('The full, updated, deduplicated set of test insights.'),
      }),
      system: REFLECT_SYSTEM,
      prompt:
        `Workspace: ${agent.name} (${agent.url})\n\n` +
        `Existing test insights:\n${
          existing.map((m) => `- ${m.title}: ${m.body}`).join('\n') || '(none yet)'
        }\n\n` +
        `Latest run report:\n${runReport}\n\n` +
        'Return the updated full set of test insights.',
    })

    const fresh = object.insights.map((i) => ({
      id: randomUUID(),
      category: 'test_insights' as const,
      importance: i.importance,
      title: i.title,
      body: i.body,
    }))

    // Re-read in case the agent changed meanwhile; replace only the
    // test_insights category, leaving site_structure / user_preferences.
    const current = await getAgent(agentId)
    if (!current) return
    const kept = current.memory.filter((m) => m.category !== 'test_insights')
    await updateAgent(agentId, { memory: [...kept, ...fresh] })
    console.log(`[probe-reflect] ${agent.name}: ${fresh.length} test insight(s) updated`)
  } catch (e) {
    console.error('[probe-reflect] failed:', e)
  }
}
