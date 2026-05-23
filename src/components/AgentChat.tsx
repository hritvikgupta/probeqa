import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Globe,
  Camera,
  Code2,
  ScanSearch,
  MousePointerClick,
  TextCursorInput,
  CornerDownLeft,
  FileText,
  CheckCircle2,
  Terminal,
  ListChecks,
  ChevronRight,
  Clock,
  Loader2,
  type LucideIcon,
} from 'lucide-react'

/* ---------- helpers: read the AI SDK message `parts` ---------- */

function partText(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p: any) => p?.type === 'text')
    .map((p: any) => p.text as string)
    .join('')
}

interface ToolStep {
  name: string
  state: string
  toolCallId: string
  input?: any
  output?: any
}

/** Drop heavy strings (screenshot base64, raw HTML) before saving a chat. */
function slimOutput(o: any): any {
  if (!o || typeof o !== 'object') return o
  const out: any = {}
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.length > 2000) continue
    out[k] = v
  }
  return out
}

function sanitizeForStore(messages: UIMessage[]): any[] {
  return messages.map((m) => ({
    ...m,
    parts: ((m.parts || []) as any[]).map((p) =>
      typeof p?.type === 'string' && p.type.startsWith('tool-') && p.output
        ? { ...p, output: slimOutput(p.output) }
        : p,
    ),
  }))
}

function deriveTitle(messages: UIMessage[]): string {
  const u = messages.find((m) => m.role === 'user')
  const t = u ? partText(u.parts).trim() : ''
  return t ? t.slice(0, 80) : 'New chat'
}

function toolSteps(m: UIMessage): ToolStep[] {
  const out: ToolStep[] = []
  for (const p of (m.parts || []) as any[]) {
    if (typeof p?.type === 'string' && p.type.startsWith('tool-')) {
      out.push({
        name: p.type.slice(5),
        state: p.state,
        toolCallId: p.toolCallId,
        input: p.input,
        output: p.output,
      })
    }
  }
  return out
}

/** Human label for a tool call — mirrors the browser tools in server/browser.ts. */
function toolLabel(s: ToolStep): string {
  const i = s.input || {}
  switch (s.name) {
    case 'navigate': return `Open ${i.url ?? 'page'}`
    case 'inspect_page': return 'Inspect page'
    case 'get_html': return i.selector ? `Read HTML of ${i.selector}` : 'Read page HTML'
    case 'click': return `Click ${i.selector ?? `${i.role ?? ''} “${i.name ?? ''}”`}`.trim()
    case 'fill': return `Fill ${i.selector ?? `“${i.name ?? ''}”`}`
    case 'press_key': return `Press ${i.key ?? ''}`
    case 'wait_for': return i.text ? `Wait for “${i.text}”` : i.selector ? `Wait for ${i.selector}` : 'Wait for page'
    case 'get_page_text': return 'Read page text'
    case 'check': return `Check — ${i.expectation ?? i.text ?? ''}`
    case 'screenshot': return 'Capture screenshot'
    case 'get_console_errors': return 'Check console'
    case 'propose_test_plan': return 'Test plan'
    case 'get_canvas': return 'Read the canvas'
    case 'update_canvas': return 'Update the canvas'
    default: return s.name
  }
}

/** Icon for each tool — mirrors the browser tools in server/browser.ts. */
const TOOL_ICON: Record<string, LucideIcon> = {
  navigate: Globe,
  screenshot: Camera,
  get_html: Code2,
  inspect_page: ScanSearch,
  click: MousePointerClick,
  fill: TextCursorInput,
  press_key: CornerDownLeft,
  wait_for: Clock,
  get_page_text: FileText,
  check: CheckCircle2,
  get_console_errors: Terminal,
  propose_test_plan: ListChecks,
  get_canvas: FileText,
  update_canvas: ListChecks,
}

function toolStatus(s: ToolStep): 'run' | 'ok' | 'fail' {
  if (s.state === 'output-error') return 'fail'
  if (s.state !== 'output-available') return 'run'
  if (s.name === 'check' && s.output?.pass === false) return 'fail'
  if (s.output?.ok === false) return 'fail'
  return 'ok'
}

function toolDetail(s: ToolStep): string {
  if (s.state === 'output-error') return 'error'
  if (s.state !== 'output-available') return 'running…'
  const o = s.output || {}
  if (s.name === 'check') return o.result ?? (o.pass ? 'PASS' : 'FAIL')
  if (s.name === 'navigate') return o.ok ? String(o.status ?? 'ok') : 'failed'
  if (s.name === 'wait_for') return o.timedOut ? 'timed out' : `${Math.round((o.waitedMs ?? 0) / 1000)}s`
  if (s.name === 'get_canvas' || s.name === 'update_canvas')
    return o.ok === false ? 'failed' : `${o.stepCount ?? 0} steps`
  if (s.name === 'get_console_errors') return `${o.count ?? 0} found`
  return o.ok === false ? 'failed' : 'done'
}

/* ---------------------------- panel ---------------------------- */

/**
 * The real testing agent — drives a headless browser server-side and
 * streams its ReAct steps in as tool pills. Embedded as the left panel
 * of the Editor. `chatId` is owned by the Editor so the browser pane
 * can subscribe to the same session.
 */
export default function AgentChat({
  chatId,
  targetUrl,
  onNewRun,
  agentId,
  runNonce,
  runPrompt,
  mode,
  onPersisted,
  onBeforeSend,
}: {
  chatId: string
  targetUrl?: string
  onNewRun: () => void
  agentId?: string
  /** Called after the conversation is saved — lets the parent refresh history. */
  onPersisted?: () => void
  /** Awaited before a message is sent — e.g. to flush the canvas to the DB. */
  onBeforeSend?: () => Promise<void> | void
  /** Incremented by an external "Run" button to fire `runPrompt` into the chat. */
  runNonce?: number
  runPrompt?: string
  /** 'plan' = brainstorm a plan only; 'run' = drive the browser. */
  mode?: 'plan' | 'run'
}) {
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId
  const agentIdRef = useRef(agentId)
  agentIdRef.current = agentId
  const modeRef = useRef(mode)
  modeRef.current = mode

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/agent',
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...(body || {}),
            messages,
            chatId: chatIdRef.current,
            agentId: agentIdRef.current,
            mode: modeRef.current,
          },
        }),
      }),
    [],
  )

  const { messages, sendMessage, addToolResult, status, error, stop, setMessages } = useChat({
    transport,
    // After the user approves/declines a test plan in the UI, resume the agent.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })
  const busy = status === 'streaming' || status === 'submitted'

  // Load this conversation's saved messages (the chatId doubles as the
  // conversation id). Runs on mount — the component is keyed by chatId.
  // `loaded` gates sending so a follow-up can't race ahead of the history.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/conversations/${chatId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const msgs = d?.conversation?.messages
        if (!cancelled && Array.isArray(msgs) && msgs.length) setMessages(msgs as UIMessage[])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [chatId, setMessages])

  // Persist the conversation each time a turn finishes (status → ready).
  const persist = useCallback(
    (msgs: UIMessage[]) => {
      if (!msgs.length) return
      fetch(`/api/conversations/${chatId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: sanitizeForStore(msgs), title: deriveTitle(msgs) }),
      })
        .then(() => onPersisted?.())
        .catch(() => {})
    },
    [chatId, onPersisted],
  )
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current !== 'ready' && status === 'ready') persist(messages)
    prevStatusRef.current = status
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 40)
  }, [])

  // External "Run" button → send the run prompt into the chat.
  const runRef = useRef(0)
  useEffect(() => {
    if (!runNonce || runNonce === runRef.current) return
    runRef.current = runNonce
    if (runPrompt && !busy && loaded) sendMessage({ text: runPrompt })
  }, [runNonce, runPrompt, busy, loaded, sendMessage])

  async function send() {
    const q = input.trim()
    if (!q || busy || !loaded) return
    setInput('')
    // Flush any pending parent state (the workspace canvas) so the agent
    // reads the current plan, not a stale copy.
    if (onBeforeSend) await onBeforeSend()
    sendMessage({ text: q })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const last = messages[messages.length - 1]
  const lastHasContent =
    last?.role === 'assistant' && (partText(last.parts).length > 0 || toolSteps(last).length > 0)

  return (
    <div className="chat">
      {/* slim toolbar — the Editor's own header sits above this */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--ink-3)', fontSize: 11, fontWeight: 500 }}>Testing agent</span>
        <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 10.5 }}>
          grok-build-0.1 · playwright
        </span>
        <button
          className="btn-ghost"
          onClick={onNewRun}
          style={{ marginLeft: 'auto', padding: '3px 9px', fontSize: 11 }}
        >
          New run
        </button>
      </div>

      {/* messages */}
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !busy && (
          <div style={{ color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.7 }}>
            {mode === 'plan' ? (
              <>
                Let's plan your tests. Tell me what flow or page you want covered — I'll draft a
                step-by-step plan on the canvas. You won't run anything here; press <strong>Run</strong>{' '}
                when the plan looks right.
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <em>“Plan a test for the {targetUrl || 'login'} page.”</em>
                  <em>“Cover the full signup flow end to end.”</em>
                  <em>“Add a step that checks for console errors.”</em>
                </div>
              </>
            ) : (
              <>
                Tell me what to test — give a real URL and what to verify. For example:
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <em>“Open {targetUrl || 'example.com'} and check the main heading.”</em>
                  <em>“Sign in with test credentials, verify the dashboard.”</em>
                  <em>“Run the checkout flow and report any console errors.”</em>
                </div>
              </>
            )}
          </div>
        )}

        {messages.map((m, idx) =>
          m.role === 'user' ? (
            <UserMsg key={m.id ?? idx} text={partText(m.parts)} />
          ) : (
            <AgentMsg key={m.id ?? idx} message={m} addToolResult={addToolResult} busy={busy} />
          ),
        )}

        {busy && !lastHasContent && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              color: 'var(--ink-3)',
            }}
          >
            <Loader2 size={12} className="spin" /> Thinking…
          </div>
        )}

        {error && (
          <div className="err" style={{ borderColor: 'var(--fail)' }}>
            <div className="err-msg" style={{ color: 'var(--fail)' }}>
              {error.message}
            </div>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="composer">
        <div className="composer-box">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={
              mode === 'plan'
                ? 'Describe what to test — I’ll build the plan…'
                : 'Describe what to test — a URL and what to verify…'
            }
          />
          <div className="composer-foot">
            {busy ? (
              <button
                className="btn-ghost"
                style={{ marginLeft: 'auto', padding: '4px 11px', fontSize: 11.5 }}
                onClick={() => stop()}
              >
                Stop
              </button>
            ) : (
              <button
                className="composer-send"
                onClick={send}
                disabled={!input.trim() || !loaded}
                style={{ marginLeft: 'auto', opacity: input.trim() && loaded ? 1 : 0.4 }}
              >
                <svg viewBox="0 0 24 24">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="6 11 12 5 18 11" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- bubbles --------------------------- */

function UserMsg({ text }: { text: string }) {
  return (
    <div className="msg you">
      <div className="msg-head">
        <span className="msg-av">JD</span>
        <span>You</span>
      </div>
      <div className="msg-body" style={{ whiteSpace: 'pre-wrap' }}>
        {text}
      </div>
    </div>
  )
}

/** One agent action, rendered as a rounded icon pill: icon · label · detail. */
function ToolPill({ step }: { step: ToolStep }) {
  const status = toolStatus(step)
  const Icon = TOOL_ICON[step.name] ?? ChevronRight
  return (
    <div className={`tool-pill ${status}`}>
      <span className="tp-ic">
        {status === 'run' ? <Loader2 size={12} className="spin" /> : <Icon size={12} />}
      </span>
      <span className="tp-label">{toolLabel(step)}</span>
      <span className="tp-sep">·</span>
      <span className="tp-detail">{toolDetail(step)}</span>
    </div>
  )
}

/**
 * One assistant turn — rendered as a flat, flowing transcript (no card, no
 * repeated header): the message's parts are shown in stream order, so
 * reasoning text and tool pills interleave exactly as the agent produced
 * them. An assistant message with nothing in it yet renders nothing.
 */
function AgentMsg({
  message,
  addToolResult,
  busy,
}: {
  message: UIMessage
  addToolResult: (args: { tool: string; toolCallId: string; output: unknown }) => void
  busy: boolean
}) {
  const out: ReactNode[] = []

  for (const [i, p] of ((message.parts || []) as any[]).entries()) {
    const type: string = p?.type ?? ''

    if (type === 'text' && typeof p.text === 'string' && p.text.trim()) {
      out.push(
        <div key={i} className="agent-md" style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
        </div>,
      )
      continue
    }

    if (type.startsWith('tool-')) {
      const step: ToolStep = {
        name: type.slice(5),
        state: p.state,
        toolCallId: p.toolCallId,
        input: p.input,
        output: p.output,
      }
      if (step.name === 'propose_test_plan') {
        out.push(<TestPlanCard key={i} step={step} />)
      } else if (step.name === 'screenshot' && step.output?.image) {
        out.push(
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <ToolPill step={step} />
            <img
              src={`data:image/jpeg;base64,${step.output.image}`}
              alt="Page screenshot the agent is looking at"
              style={{ width: '100%', display: 'block', borderRadius: 8, border: '1px solid var(--line)' }}
            />
          </div>,
        )
      } else {
        out.push(<ToolPill key={i} step={step} />)
      }
    }
  }

  if (out.length === 0) return null

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{out}</div>
}

/* ----------------------- test plan card ------------------------ */

const KIND_COLOR: Record<string, string> = {
  navigate: '#3b82f6',
  act: '#6366f1',
  assert: '#22c55e',
  login: '#a855f7',
  screenshot: '#94a3b8',
  github: '#d29922',
  integration: '#06b6d4',
}

/**
 * Renders a propose_test_plan tool call. While the call is awaiting a
 * result (the server tool has no execute), it shows Approve / Request
 * changes controls; clicking one supplies the tool result, which
 * sendAutomaticallyWhen then uses to resume the agent.
 */
/** Display-only test-plan card — the plan also lands on the workspace canvas. */
function TestPlanCard({ step }: { step: ToolStep }) {
  const plan = step.input || {}
  const steps: any[] = Array.isArray(plan.steps) ? plan.steps : []

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        margin: '4px 0',
        overflow: 'hidden',
        background: 'var(--panel)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 11px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>
          📋 {plan.title || 'Test plan'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-4)' }}>
          {steps.length} step{steps.length === 1 ? '' : 's'} · synced to canvas
        </span>
      </div>

      <ol style={{ margin: 0, padding: '8px 11px', listStyle: 'none' }}>
        {steps.map((st, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0' }}>
            <span style={{ color: 'var(--ink-4)', fontSize: 10.5, width: 16, flexShrink: 0 }}>
              {i + 1}
            </span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                color: KIND_COLOR[st?.kind] ?? '#94a3b8',
                width: 64,
                flexShrink: 0,
                letterSpacing: 0.4,
              }}
            >
              {st?.kind ?? '—'}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
              {st?.label}
              {st?.detail && <span style={{ color: 'var(--ink-4)' }}> — {st.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
