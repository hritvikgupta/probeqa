import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { TestStep } from '../types'
import BrowserView from './BrowserView'
import {
  Globe,
  Zap,
  Eye,
  Camera,
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  ChevronDown,
  FlaskConical,
  AlertTriangle,
  MinusCircle,
  Send,
  Plug,
  X,
} from 'lucide-react'

const KIND_ICON: Record<string, typeof Globe> = {
  navigate: Globe,
  act: Zap,
  assert: Eye,
  screenshot: Camera,
  login: KeyRound,
  github: Send,
  integration: Plug,
}

type StepState = 'pending' | 'running' | 'passed' | 'failed'

interface ToolPart {
  name: string
  state: string
  input: any
  output: any
}

/** Human label + result detail for one agent tool call. */
function describe(t: ToolPart): { label: string; detail: string } {
  const i = t.input || {}
  const o = t.output || {}
  const done = o?.ok === false ? 'failed' : 'done'
  switch (t.name) {
    case 'navigate':
      return { label: `Open ${i.url ?? 'page'}`, detail: o?.status ? String(o.status) : done }
    case 'screenshot':
      return { label: 'Screenshot', detail: done }
    case 'get_html':
      return { label: i.selector ? `Read HTML ${i.selector}` : 'Read page HTML', detail: done }
    case 'inspect_page':
      return { label: 'Inspect page', detail: done }
    case 'click':
      return { label: `Click ${i.selector ?? i.name ?? ''}`.trim(), detail: done }
    case 'fill':
      return { label: `Fill ${i.selector ?? i.name ?? ''}`.trim(), detail: done }
    case 'press_key':
      return { label: `Press ${i.key ?? ''}`, detail: done }
    case 'wait_for':
      return {
        label: i.text ? `Wait for “${i.text}”` : `Wait for ${i.selector ?? 'page'}`,
        detail: o?.timedOut ? 'timed out' : o?.waitedMs != null ? `${Math.round(o.waitedMs / 1000)}s` : done,
      }
    case 'get_page_text':
      return { label: 'Read page text', detail: done }
    case 'check':
      return {
        label: `Check — ${i.expectation ?? i.text ?? ''}`,
        detail: o?.pass === true ? 'PASS' : o?.pass === false ? 'FAIL' : '…',
      }
    case 'get_console_errors':
      return { label: 'Check console', detail: `${o?.count ?? 0} found` }
    case 'use_test_account':
      return { label: `Use account ${i.label ?? ''}`.trim(), detail: done }
    case 'list_test_accounts':
      return { label: 'List test accounts', detail: done }
    case 'report_to_github':
      return { label: 'Report to GitHub', detail: o?.number ? `#${o.number}` : done }
    default:
      return { label: t.name, detail: done }
  }
}

/**
 * RunView — the live run modal opened by the workspace "Run" button.
 *
 *   left:  the approved plan, executed strictly in order. Each row lights up
 *          from the agent's step_status calls, and expands to show every tool
 *          call the agent made for that step (the chat-style activity).
 *   right: BrowserView — live screencast of the real browser.
 */
export default function RunView({
  agentId,
  title,
  targetUrl,
  prompt,
  steps,
  onClose,
}: {
  agentId: string
  title: string
  targetUrl?: string
  prompt: string
  steps: TestStep[]
  onClose: () => void
}) {
  const [chatId] = useState(() => crypto.randomUUID())
  const chatIdRef = useRef(chatId)
  const agentIdRef = useRef(agentId)
  agentIdRef.current = agentId
  const [manualOpen, setManualOpen] = useState<string | null>(null)

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
            mode: 'run',
          },
        }),
      }),
    [],
  )

  const { messages, sendMessage, status, stop, error } = useChat({ transport })
  const running = status === 'streaming' || status === 'submitted'

  // Fire the run exactly once on open.
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    sendMessage({ text: prompt })
  }, [prompt, sendMessage])

  // Escape closes the modal. Kept separate from the session-reset effect so
  // an unstable `onClose` identity never triggers a reset.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Close the agent's browser session ONLY when the run modal truly unmounts —
  // chatId is stable, so this cleanup never runs mid-run.
  useEffect(() => {
    return () => {
      fetch('/api/agent/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId }),
      }).catch(() => {})
    }
  }, [chatId])

  /**
   * Walk the stream in order: step_status("running") opens a step, and every
   * tool call after it is attributed to that step. step_status(passed/failed)
   * records the result.
   */
  const { stepInfo, activity } = useMemo(() => {
    const info: Record<number, { state: StepState; note?: string }> = {}
    const acts: Record<number, ToolPart[]> = {}
    let cur = 0
    for (const m of messages) {
      for (const p of (m.parts || []) as any[]) {
        const type: string = p?.type ?? ''
        if (type === 'tool-step_status' && p.input) {
          const idx = Number(p.input.stepIndex)
          const st = p.input.status as StepState
          if (idx && st) {
            info[idx] = { state: st, note: p.input.note }
            if (st === 'running') cur = idx
          }
          continue
        }
        if (type.startsWith('tool-') && cur > 0) {
          ;(acts[cur] ??= []).push({
            name: type.slice(5),
            state: p.state,
            input: p.input,
            output: p.output,
          })
        }
      }
    }
    return { stepInfo: info, activity: acts }
  }, [messages])

  // Auto-open whichever step is currently running.
  const runningId = steps.find((_, i) => stepInfo[i + 1]?.state === 'running')?.id ?? null
  const openId = manualOpen ?? runningId

  const finished = !running && fired.current && messages.some((m) => m.role === 'assistant')
  const passed = steps.filter((_, i) => stepInfo[i + 1]?.state === 'passed').length
  const failed = steps.filter((_, i) => stepInfo[i + 1]?.state === 'failed').length

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(0,0,0,0.6)',
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          inset: 26,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 16px',
            height: 48,
            borderBottom: '1px solid var(--line)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
          {targetUrl && (
            <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              {targetUrl}
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 0,
              color: 'var(--ink-3)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={17} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '420px minmax(0, 1fr)' }}>
          {/* left — the plan, executed in order */}
          <div
            style={{
              borderRight: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 16px' }}>
              {steps.length === 0 && (
                <div style={{ padding: 24, fontSize: 12.5, color: 'var(--ink-3)', textAlign: 'center' }}>
                  This workspace has no saved plan. Build one in the Tests tab first.
                </div>
              )}
              {steps.map((s, i) => {
                const info = stepInfo[i + 1] ?? { state: 'pending' as StepState }
                // Once the run has ended, a step still "running" was cut off,
                // and an untouched step was never reached — don't keep spinning.
                let shown: StepState | 'interrupted' | 'skipped' = info.state
                if (finished && shown === 'running') shown = 'interrupted'
                else if (finished && shown === 'pending') shown = 'skipped'
                const KindIcon = KIND_ICON[s.kind] ?? Globe
                const isOpen = openId === s.id
                const tools = activity[i + 1] ?? []
                return (
                  <div key={s.id} style={{ marginBottom: 1 }}>
                    <div
                      onClick={() => setManualOpen(isOpen ? '' : s.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '9px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: shown === 'running' ? 'var(--panel)' : 'transparent',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: 'var(--mono)',
                          color: 'var(--ink-4)',
                          width: 16,
                          flexShrink: 0,
                          textAlign: 'right',
                          marginTop: 1,
                        }}
                      >
                        {i + 1}
                      </span>
                      <KindIcon size={14} style={{ color: 'var(--ink-3)', flexShrink: 0, marginTop: 1 }} />
                      <span
                        style={{
                          flex: 1,
                          fontSize: 12.5,
                          lineHeight: 1.5,
                          color: shown === 'pending' || shown === 'skipped' ? 'var(--ink-3)' : 'var(--ink)',
                        }}
                      >
                        {s.label}
                      </span>
                      <StatusIcon state={shown} />
                      <ChevronDown
                        size={14}
                        style={{
                          color: 'var(--ink-4)',
                          flexShrink: 0,
                          marginTop: 1,
                          transform: isOpen ? 'rotate(180deg)' : 'none',
                          transition: 'transform .15s',
                        }}
                      />
                    </div>

                    {isOpen && (
                      <div style={{ margin: '2px 10px 8px 46px' }}>
                        {info.note && (
                          <div
                            style={{
                              fontSize: 11.5,
                              color: info.state === 'failed' ? 'var(--fail)' : 'var(--ink-3)',
                              marginBottom: 6,
                            }}
                          >
                            {info.note}
                          </div>
                        )}
                        {tools.length === 0 ? (
                          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                            {info.state === 'pending' ? 'Waiting…' : 'No tool activity recorded.'}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {tools.map((t, k) => (
                              <ActivityRow key={k} tool={t} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {error && (
                <div style={{ margin: '8px 10px', fontSize: 11.5, color: 'var(--fail)' }}>
                  {error.message}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '10px 14px',
                borderTop: '1px solid var(--line)',
                flexShrink: 0,
              }}
            >
              <FlaskConical size={15} style={{ color: 'var(--ink-3)' }} />
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                {running
                  ? 'Testing your website…'
                  : finished
                  ? passed + failed < steps.length
                    ? `Run stopped early — ${passed} passed, ${failed} failed, ${
                        steps.length - passed - failed
                      } not completed`
                    : `Run complete — ${passed} passed, ${failed} failed`
                  : 'Preparing run…'}
              </span>
              {running ? (
                <button
                  onClick={() => stop()}
                  style={{
                    marginLeft: 'auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 11px',
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    borderRadius: 7,
                    color: 'var(--ink)',
                    fontSize: 11.5,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 8, height: 8, background: 'var(--ink)', borderRadius: 2 }} />
                  Stop Test
                </button>
              ) : (
                <button
                  onClick={onClose}
                  className="btn-ghost"
                  style={{ marginLeft: 'auto', padding: '5px 11px', fontSize: 11.5 }}
                >
                  Close
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
            <BrowserView chatId={chatId} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function StatusIcon({ state }: { state: StepState | 'interrupted' | 'skipped' }) {
  if (state === 'running')
    return <Loader2 size={15} className="spin" style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
  if (state === 'passed')
    return <CheckCircle2 size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
  if (state === 'failed')
    return <XCircle size={15} style={{ color: 'var(--fail)', flexShrink: 0 }} />
  if (state === 'interrupted')
    return <AlertTriangle size={14} style={{ color: '#e0a800', flexShrink: 0, marginTop: 1 }} />
  if (state === 'skipped')
    return <MinusCircle size={14} style={{ color: 'var(--ink-4)', flexShrink: 0, marginTop: 1 }} />
  return <Circle size={14} style={{ color: 'var(--ink-4)', flexShrink: 0, marginTop: 1 }} />
}

/** One tool call inside an expanded step — a pill plus an inline screenshot. */
function ActivityRow({ tool }: { tool: ToolPart }) {
  const { label, detail } = describe(tool)
  const failed = tool.state === 'output-error' || tool.output?.ok === false || detail === 'FAIL'
  const img = tool.name === 'screenshot' ? tool.output?.image : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          alignSelf: 'flex-start',
          maxWidth: '100%',
          padding: '4px 9px',
          background: 'var(--panel)',
          border: `1px solid ${failed ? 'var(--fail)' : 'var(--line)'}`,
          borderRadius: 999,
          fontSize: 11,
          color: 'var(--ink-2)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ color: 'var(--ink-4)' }}>·</span>
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10,
            color: failed ? 'var(--fail)' : 'var(--accent-ink)',
          }}
        >
          {tool.state === 'output-available' || tool.state === 'output-error' ? detail : 'running…'}
        </span>
      </div>
      {img && (
        <img
          src={`data:image/jpeg;base64,${img}`}
          alt="step screenshot"
          style={{ width: '100%', borderRadius: 6, border: '1px solid var(--line)' }}
        />
      )}
    </div>
  )
}
