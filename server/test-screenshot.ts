/**
 * Vision smoke test — does the screenshot image actually reach the model?
 *
 *   npx tsx server/test-screenshot.ts
 *
 * Phase 1: a plain one-shot tool call (does file-data vision work at all).
 * Phase 2: the REAL run conditions — streamText, the screenshot buried behind
 *          several heavy get_html results, with the same prepareStep pruning
 *          the agent uses. If the model still recalls the secret, vision works
 *          end-to-end; if not, the multi-step path is the culprit.
 */
import 'dotenv/config'
import { chromium } from 'playwright'
import {
  generateText,
  streamText,
  stepCountIs,
  tool,
  type ModelMessage,
} from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'

const SECRET = 'PLUTO-ZEBRA-9284'
const BG = '#0b3d2e'

const PAGE_HTML = `<!doctype html><html><body style="margin:0;background:${BG};
  font-family:Arial,sans-serif;color:#fff;height:100vh;display:flex;
  flex-direction:column;align-items:center;justify-content:center;gap:24px">
  <div style="font-size:34px">Vision check page</div>
  <div style="font-size:46px;color:#ffd400;font-weight:700">Secret code: ${SECRET}</div>
  <div style="width:140px;height:140px;border-radius:50%;background:orange"></div>
</body></html>`

/** Same pruning the real agent uses (copied from server/agent.ts). */
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
      const keep = KEEP_RECENT[part.toolName ?? '']
      if (!keep) continue
      seen[part.toolName!] = (seen[part.toolName!] ?? 0) + 1
      if (seen[part.toolName!] > keep) {
        part.output = { type: 'text', value: `[earlier ${part.toolName} dropped]` }
      }
    }
  }
  return messages
}

async function captureSecretPage(): Promise<string> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } } as never)
  await page.setContent(PAGE_HTML)
  const buf = await page.screenshot({ type: 'jpeg', quality: 60 })
  await browser.close()
  return buf.toString('base64')
}

function screenshotTool(imageBase64: string) {
  return tool({
    description: 'Capture a screenshot of the current page so you can see it.',
    inputSchema: z.object({}),
    execute: async () => ({ ok: true, image: imageBase64 }),
    toModelOutput: ({ output }) => {
      const o = output as { ok?: boolean; image?: string }
      if (!o?.ok || !o.image)
        return { type: 'content', value: [{ type: 'text', text: 'Screenshot failed.' }] }
      return {
        type: 'content',
        value: [
          { type: 'text', text: 'Screenshot of the current page:' },
          { type: 'file-data', data: o.image, mediaType: 'image/jpeg' },
        ],
      }
    },
  })
}

const got = (answer: string) => answer.toUpperCase().includes(SECRET)

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set (check probe-app/.env)')
  const model = process.env.LLM_MODEL || 'x-ai/grok-build-0.1'
  const openrouter = createOpenRouter({ apiKey })

  console.log(`\n🔬 Vision test — model: ${model}`)
  console.log(`   secret embedded in the image: ${SECRET}`)
  const imageBase64 = await captureSecretPage()
  console.log(`   screenshot captured: ${((imageBase64.length * 0.75) / 1024).toFixed(1)} KB\n`)

  /* ---------- Phase 1: plain one-shot ---------- */
  console.log('— Phase 1: single tool call —')
  const p1 = await generateText({
    model: openrouter.chat(model),
    tools: { screenshot: screenshotTool(imageBase64) },
    stopWhen: stepCountIs(4),
    system: 'Call screenshot, then answer only from what you see in the returned image.',
    prompt: 'Take a screenshot and tell me the exact secret code printed on the page.',
  })
  console.log(`  answer: ${p1.text.trim().replace(/\n/g, ' ')}`)
  const phase1 = got(p1.text)
  console.log(phase1 ? '  ✅ Phase 1 PASS\n' : '  ❌ Phase 1 FAIL\n')

  /* ---------- Phase 2: real run conditions ---------- */
  console.log('— Phase 2: streamText + heavy get_html + pruning (real run path) —')
  const junkHtml = '<div>' + 'lorem ipsum dolor sit amet '.repeat(180) + '</div>'
  const p2 = streamText({
    model: openrouter.chat(model),
    tools: {
      screenshot: screenshotTool(imageBase64),
      get_html: tool({
        description: 'Read the raw HTML of the page.',
        inputSchema: z.object({ selector: z.string().optional() }),
        execute: async () => ({ ok: true, html: junkHtml }),
      }),
    },
    stopWhen: stepCountIs(12),
    prepareStep: ({ messages }) => ({ messages: pruneHeavyResults(messages) }),
    temperature: 0.2,
    system:
      'You are testing vision across a multi-step run. Do exactly this: (1) call screenshot once, (2) then call get_html SIX times in a row, (3) then WITHOUT any more tool calls state the exact secret code that was printed on the page in the screenshot image.',
    prompt: 'Begin the sequence now.',
  })
  const p2text = await p2.text
  console.log(`  answer: ${p2text.trim().replace(/\n/g, ' ')}`)
  const phase2 = got(p2text)
  console.log(phase2 ? '  ✅ Phase 2 PASS\n' : '  ❌ Phase 2 FAIL\n')

  console.log('— verdict —')
  if (phase1 && phase2) {
    console.log('✅ Vision works in BOTH the simple and the real multi-step run path.')
  } else if (phase1 && !phase2) {
    console.log('⚠️  Vision works one-shot but is LOST in the multi-step run — the streamText / pruning path is the bug.')
  } else {
    console.log('❌ Vision is not reaching the model even one-shot — the tool result mechanism is wrong.')
  }
  console.log()
  process.exit(phase1 && phase2 ? 0 : 1)
}

main().catch((e) => {
  console.error('❌ test crashed:', e)
  process.exit(1)
})
