import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Agent, TestStep, MemoryCategory, MemoryImportance, ConversationMeta, AgentSchedule } from '../types'
import AgentChat from './AgentChat'
import RunView from './RunView'
import {
  FlaskConical,
  GitPullRequest,
  Plug,
  KeyRound,
  Paperclip,
  Brain,
  Settings as SettingsIcon,
  Save,
  Play,
  MessageSquare,
  History,
  Trash2,
  Plus,
  X,
  User,
  ChevronDown,
  RefreshCw,
  CircleDot,
  Clock,
  Check,
} from 'lucide-react'

/* --------------------------- shared bits --------------------------- */

const TABS = [
  ['Tests', FlaskConical],
  ['PR Testing', GitPullRequest],
  ['Integrations', Plug],
  ['Test Accounts', KeyRound],
  ['Files', Paperclip],
  ['Memory', Brain],
  ['Settings', SettingsIcon],
] as const
type Tab = (typeof TABS)[number][0]

const KIND_COLOR: Record<string, string> = {
  navigate: '#3b82f6',
  act: '#6366f1',
  assert: '#22c55e',
  login: '#a855f7',
  screenshot: '#94a3b8',
  github: '#d29922',
  integration: '#06b6d4',
}

const uid = () => Math.random().toString(36).slice(2, 10)

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 34,
        height: 19,
        borderRadius: 999,
        border: '1px solid var(--line)',
        background: on ? 'var(--accent)' : 'var(--panel)',
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background .15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: on ? 16 : 1,
          width: 15,
          height: 15,
          borderRadius: 999,
          background: '#fff',
          transition: 'left .15s',
        }}
      />
    </button>
  )
}

function field(value: string, onChange: (v: string) => void, placeholder: string, type = 'text') {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '7px 10px',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        color: 'var(--ink)',
        fontSize: 12.5,
        fontFamily: 'inherit',
        outline: 'none',
      }}
    />
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 9,
        background: 'var(--panel)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{children}</div>
  )
}

/* --------------------------- step canvas --------------------------- */

function StepCanvas({
  steps,
  onChange,
}: {
  steps: TestStep[]
  onChange: (s: TestStep[]) => void
}) {
  function edit(id: string, label: string) {
    onChange(steps.map((s) => (s.id === id ? { ...s, label } : s)))
  }
  function remove(id: string) {
    onChange(steps.filter((s) => s.id !== id))
  }
  function add() {
    onChange([...steps, { id: uid(), kind: 'act', label: 'New step' }])
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
        padding: '28px 20px',
        background:
          'radial-gradient(circle, var(--line-2) 1px, transparent 1px) 0 0 / 22px 22px',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
        {steps.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 12.5,
              padding: '40px 0',
              lineHeight: 1.7,
            }}
          >
            No test steps yet.
            <br />
            Ask the assistant to <em>“create a test plan”</em> — it will appear here.
          </div>
        )}
        {steps.map((s, i) => (
          <div key={s.id}>
            {i > 0 && (
              <div
                style={{
                  height: 22,
                  width: 1,
                  background: 'var(--line)',
                  margin: '0 auto',
                }}
              />
            )}
            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: 9,
                background: 'var(--panel)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: KIND_COLOR[s.kind] ?? '#94a3b8',
                  border: `1px solid ${KIND_COLOR[s.kind] ?? '#94a3b8'}55`,
                  borderRadius: 5,
                  padding: '3px 6px',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {s.kind}
              </span>
              <input
                value={s.label}
                onChange={(e) => edit(s.id, e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 0,
                  background: 'transparent',
                  color: 'var(--ink)',
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => remove(s.id)}
                title="Remove step"
                style={{
                  background: 'transparent',
                  border: 0,
                  color: 'var(--ink-4)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
        <div style={{ height: 22, width: 1, background: 'var(--line)', margin: '0 auto' }} />
        <button
          onClick={add}
          style={{
            alignSelf: 'center',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 11px',
            border: '1px dashed var(--line)',
            borderRadius: 7,
            background: 'transparent',
            color: 'var(--ink-3)',
            fontSize: 11.5,
            cursor: 'pointer',
          }}
        >
          <Plus size={12} /> Add step
        </button>
      </div>
    </div>
  )
}

/* --------------------------- the workspace --------------------------- */

export default function AgentWorkspace({
  agentId,
  open,
  onClose,
}: {
  agentId: string | null
  open: boolean
  onClose: () => void
}) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [tab, setTab] = useState<Tab>('Tests')
  const [side, setSide] = useState<'chat' | 'history'>('chat')
  // Saved planning chats for this agent; the active id doubles as the chatId.
  const [convs, setConvs] = useState<ConversationMeta[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [steps, setSteps] = useState<TestStep[]>([])
  const [dirty, setDirty] = useState(false)
  // Non-null while the Run modal (live execution view) is open.
  const [runPrompt, setRunPrompt] = useState<string | null>(null)

  const refreshConvs = useCallback(async (): Promise<ConversationMeta[]> => {
    if (!agentId) return []
    const list: ConversationMeta[] = await fetch(`/api/conversations?agentId=${agentId}`)
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((d) => d.conversations ?? [])
      .catch(() => [])
    setConvs(list)
    return list
  }, [agentId])

  const createConv = useCallback(async (): Promise<ConversationMeta | null> => {
    if (!agentId) return null
    return fetch('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.conversation ?? null)
      .catch(() => null)
  }, [agentId])

  useEffect(() => {
    if (!open || !agentId) return
    setTab('Tests')
    setSide('chat')
    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then((d) => {
        setAgent(d.agent)
        setSteps(d.agent.steps ?? [])
        setDirty(false)
      })
      .catch(() => {})
  }, [open, agentId])

  // Load this agent's planning chats, creating one if there are none.
  useEffect(() => {
    if (!open || !agentId) return
    let cancelled = false
    ;(async () => {
      let list = await refreshConvs()
      if (cancelled) return
      if (list.length === 0) {
        const created = await createConv()
        if (cancelled || !created) return
        list = [created]
        setConvs(list)
      }
      setActiveConvId(list[0]?.id ?? null)
    })()
    return () => { cancelled = true }
  }, [open, agentId, refreshConvs, createConv])

  async function newChat() {
    const created = await createConv()
    if (created) {
      setConvs((prev) => [created, ...prev])
      setActiveConvId(created.id)
    }
  }

  const patch = useCallback(
    async (partial: Partial<Agent>) => {
      if (!agentId) return
      const r = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(partial),
      })
      const d = await r.json()
      setAgent(d.agent)
      return d.agent as Agent
    },
    [agentId],
  )

  // Re-pull the agent (e.g. after a run) so freshly-learned Test Insights
  // show up — without clobbering unsaved canvas edits.
  const reloadAgent = useCallback(() => {
    if (!agentId) return
    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then((d) => setAgent(d.agent))
      .catch(() => {})
  }, [agentId])

  // Persist any unsaved canvas edits to the DB. Used before closing the
  // workspace AND before a planning message is sent — so the agent always
  // reasons over the current canvas, never a stale copy.
  const flushCanvas = useCallback(async () => {
    if (dirty && agentId) {
      await patch({ steps })
      setDirty(false)
    }
  }, [dirty, agentId, patch, steps])

  const handleClose = useCallback(async () => {
    await flushCanvas()
    onClose()
  }, [flushCanvas, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) void handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  // After a planning turn the agent has written the plan straight to the DB
  // (propose_test_plan saves it). Re-pull the canvas so it shows that update —
  // the DB is the single source of truth, nothing is mirrored from the chat.
  const reloadCanvas = useCallback(() => {
    if (!agentId) return
    fetch(`/api/agents/${agentId}`)
      .then((r) => r.json())
      .then((d) => {
        setAgent(d.agent)
        setSteps(d.agent.steps ?? [])
        setDirty(false)
      })
      .catch(() => {})
  }, [agentId])

  function setCanvas(next: TestStep[]) {
    setSteps(next)
    setDirty(true)
  }

  async function saveSteps() {
    await patch({ steps })
    setDirty(false)
  }

  // Autosave — persist canvas edits ~0.8s after the user stops editing, so a
  // manual Save is never required and changes survive navigating away.
  useEffect(() => {
    if (!dirty || !agentId) return
    const t = setTimeout(() => {
      patch({ steps }).then(() => setDirty(false)).catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [steps, dirty, agentId, patch])

  // Opening the Run modal — the agentic browser run happens there, not in the
  // workspace chat (which only plans). The canvas plan is persisted first so
  // the run-mode agent on the server actually has the steps to follow.
  async function runWith(prompt: string) {
    if (dirty) {
      await patch({ steps })
      setDirty(false)
    }
    setRunPrompt(prompt)
  }

  function run() {
    runWith(
      steps.length > 0
        ? 'Run the saved test plan for this workspace now — go through every step in order, check each assertion, and give me a final report.'
        : `Open ${agent?.url || 'the target site'} and run an exploratory test, then report what you find.`,
    )
  }

  if (!open || !agent) return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* header + tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 16px',
          height: 46,
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => void handleClose()}
          className="btn-ghost"
          style={{ padding: '4px 9px', fontSize: 11.5 }}
        >
          ← Back
        </button>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{agent.name}</span>
        <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
          {agent.url}
        </span>

        {tab === 'Tests' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              {steps.length} step{steps.length === 1 ? '' : 's'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {dirty ? 'Saving…' : 'All changes saved'}
            </span>
            <button
              onClick={saveSteps}
              disabled={!dirty}
              className="btn-ghost"
              style={{ padding: '5px 11px', fontSize: 11.5, opacity: dirty ? 1 : 0.5 }}
            >
              <Save size={12} /> Save
            </button>
            <button
              onClick={run}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 13px',
                background: 'var(--ink)',
                color: '#111',
                border: 0,
                borderRadius: 6,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Play size={12} /> Run
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '0 16px',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0,
        }}
      >
        {TABS.map(([name, Icon]) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 12px',
              background: 'transparent',
              border: 0,
              borderBottom: `2px solid ${tab === name ? 'var(--ink)' : 'transparent'}`,
              color: tab === name ? 'var(--ink)' : 'var(--ink-3)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            <Icon size={13} /> {name}
          </button>
        ))}
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {tab === 'Tests' ? (
          <>
            <StepCanvas steps={steps} onChange={setCanvas} />
            <div
              style={{
                width: 430,
                flexShrink: 0,
                borderLeft: '1px solid var(--line)',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              {/* side sub-tabs */}
              <div style={{ display: 'flex', gap: 2, padding: '0 10px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
                {([
                  ['chat', 'Planning', MessageSquare],
                  ['history', 'Run History', History],
                ] as const).map(([k, label, Icon]) => (
                  <button
                    key={k}
                    onClick={() => setSide(k)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '8px 9px',
                      background: 'transparent',
                      border: 0,
                      borderBottom: `2px solid ${side === k ? 'var(--ink)' : 'transparent'}`,
                      color: side === k ? 'var(--ink)' : 'var(--ink-3)',
                      fontSize: 11.5,
                      cursor: 'pointer',
                      marginBottom: -1,
                    }}
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>

              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {side === 'chat' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderBottom: '1px solid var(--line)',
                        flexShrink: 0,
                      }}
                    >
                      <select
                        value={activeConvId ?? ''}
                        onChange={(e) => setActiveConvId(e.target.value)}
                        title="Chat history"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          padding: '5px 8px',
                          background: 'var(--panel)',
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          color: 'var(--ink)',
                          fontSize: 11.5,
                          fontFamily: 'inherit',
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        {convs.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={newChat}
                        className="btn-ghost"
                        title="New chat"
                        style={{ padding: '5px 9px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                      >
                        <Plus size={12} /> New chat
                      </button>
                    </div>
                    {activeConvId && (
                      <AgentChat
                        key={activeConvId}
                        chatId={activeConvId}
                        mode="plan"
                        agentId={agent.id}
                        targetUrl={agent.url}
                        onNewRun={newChat}
                        onPersisted={() => { void refreshConvs(); reloadCanvas() }}
                        onBeforeSend={flushCanvas}
                      />
                    )}
                  </>
                )}
                {side === 'history' && <RunHistory agent={agent} />}
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '26px 34px' }}>
            {tab === 'PR Testing' && <PRTab agent={agent} patch={patch} onTest={runWith} />}
            {tab === 'Integrations' && <IntegrationsTab />}
            {tab === 'Test Accounts' && <AccountsTab agent={agent} patch={patch} />}
            {tab === 'Files' && <FilesTab agent={agent} patch={patch} />}
            {tab === 'Memory' && <MemoryTab agent={agent} patch={patch} />}
            {tab === 'Settings' && <SettingsTab agent={agent} patch={patch} onClose={onClose} />}
          </div>
        )}
      </div>

      {runPrompt !== null && (
        <RunView
          agentId={agent.id}
          title={agent.name}
          targetUrl={agent.url}
          prompt={runPrompt}
          steps={steps}
          onClose={() => {
            setRunPrompt(null)
            // The post-run reflection LLM runs server-side and takes a few
            // seconds — re-pull now and again so new Test Insights appear.
            reloadAgent()
            setTimeout(reloadAgent, 5000)
            setTimeout(reloadAgent, 12000)
          }}
        />
      )}
    </div>,
    document.body,
  )
}

/* --------------------------- tab panels --------------------------- */

type PatchFn = (p: Partial<Agent>) => Promise<Agent | undefined>

interface GhItem {
  number: number
  title: string
  url: string
  author: string
  state: string
}

/** Full-width tab page: a title + subtitle, an optional top-right action. */
function TabShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>{subtitle}</div>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function PrimaryBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '8px 14px',
        background: 'var(--bg-elev)',
        color: 'var(--ink)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px dashed var(--line)',
        borderRadius: 9,
        padding: '30px 20px',
        textAlign: 'center',
        color: 'var(--ink-3)',
        fontSize: 12.5,
      }}
    >
      {children}
    </div>
  )
}

function fieldLabel(text: string) {
  return (
    <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}>{text}</label>
  )
}

function RunHistory({ agent }: { agent: Agent }) {
  if (agent.runs.length === 0) {
    return (
      <div style={{ padding: 20, fontSize: 12, color: 'var(--ink-3)' }}>
        No runs yet. Press <strong>Run</strong> to start one.
      </div>
    )
  }
  const dot: Record<string, string> = {
    passed: 'var(--accent)',
    failed: 'var(--fail)',
    issues: '#e0a800',
    running: 'var(--ink-3)',
  }
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7, overflowY: 'auto' }}>
      {agent.runs.map((r) => (
        <div
          key={r.id}
          style={{
            border: '1px solid var(--line)',
            borderRadius: 7,
            padding: '8px 11px',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
          }}
        >
          <span
            style={{ width: 7, height: 7, borderRadius: 999, background: dot[r.status], flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--ink)' }}>{r.summary || r.status}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
              {new Date(r.startedAt).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function GhList({
  title,
  icon,
  items,
  empty,
  actionLabel,
  onAction,
}: {
  title: string
  icon: ReactNode
  items: GhItem[]
  empty: string
  actionLabel: string
  onAction: (it: GhItem) => void
}) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--panel)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        {icon} {title}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-4)', fontSize: 11 }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-3)' }}>{empty}</div>
      ) : (
        items.map((it) => (
          <div
            key={it.number}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderTop: '1px solid var(--line-2)',
            }}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>
              #{it.number}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {it.title}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>by {it.author}</div>
            </div>
            <button
              onClick={() => onAction(it)}
              className="btn-ghost"
              style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
            >
              <Play size={11} /> {actionLabel}
            </button>
          </div>
        ))
      )}
    </div>
  )
}

function PRTab({
  agent,
  patch,
  onTest,
}: {
  agent: Agent
  patch: PatchFn
  onTest: (prompt: string) => void
}) {
  const [repo, setRepo] = useState(agent.settings.githubRepo)
  const [repos, setRepos] = useState<string[] | null>(null)
  const [ghConnected, setGhConnected] = useState(false)
  const [data, setData] = useState<{ prs: GhItem[]; issues: GhItem[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // The user's GitHub repos, via the Composio connection (Integrations tab).
  const loadRepos = useCallback(() => {
    fetch('/api/integrations/github/repos')
      .then((r) => (r.ok ? r.json() : { connected: false, repos: [] }))
      .then((d) => {
        setGhConnected(!!d.connected)
        setRepos(d.repos ?? [])
      })
      .catch(() => setRepos([]))
  }, [])
  useEffect(() => {
    loadRepos()
  }, [loadRepos])

  // Pull requests + issues for the selected repo.
  const load = useCallback(async () => {
    if (!repo) {
      setData(null)
      return
    }
    setLoading(true)
    setErr('')
    try {
      const r = await fetch(`/api/agents/${agent.id}/github`)
      const d = await r.json()
      if (d.ok) setData({ prs: d.prs, issues: d.issues })
      else setErr(d.error || 'Failed to load from GitHub')
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [agent.id, repo])

  useEffect(() => {
    void load()
  }, [load])

  function selectRepo(v: string) {
    setRepo(v)
    void patch({ settings: { ...agent.settings, githubRepo: v } })
  }

  function testPR(it: GhItem) {
    onTest(
      `Test pull request #${it.number} — "${it.title}". Open ${agent.url || 'the target site'}, exercise the functionality this PR changes, and report whether it works correctly. Reference: ${it.url}`,
    )
  }
  function testIssue(it: GhItem) {
    onTest(
      `Reproduce GitHub issue #${it.number} — "${it.title}" on ${agent.url || 'the target site'}. Try to trigger the described bug and report exactly what happens. Reference: ${it.url}`,
    )
  }

  return (
    <TabShell
      title="PR Testing"
      subtitle="Pick a repository, then pull a pull request or issue for the agent to test."
      action={
        ghConnected ? (
          <PrimaryBtn
            onClick={() => {
              loadRepos()
              void load()
            }}
          >
            <RefreshCw size={13} /> {loading ? 'Loading…' : 'Refresh'}
          </PrimaryBtn>
        ) : undefined
      }
    >
      {repos === null ? (
        <Empty>Loading…</Empty>
      ) : !ghConnected ? (
        <Empty>
          Connect <strong>GitHub</strong> in the Integrations tab to test pull requests and issues.
        </Empty>
      ) : repos.length === 0 ? (
        <Empty>
          GitHub is linked, but no repositories loaded — its access token is likely invalid or
          expired. Re-connect <strong>GitHub</strong> in the Integrations tab, then Refresh.
        </Empty>
      ) : (
        <>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <GitPullRequest size={16} style={{ color: 'var(--ink-2)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Repository</span>
              <Dropdown
                value={repo}
                options={[
                  ['', 'Select a repository…'],
                  ...repos.map((r) => [r, r] as [string, string]),
                ]}
                onChange={selectRepo}
                width={320}
              />
            </div>
          </Card>

          {!repo ? (
            <Empty>Select a repository above to load its pull requests and issues.</Empty>
          ) : err ? (
            <Empty>⚠ {err}</Empty>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <GhList
                title="Pull requests"
                icon={<GitPullRequest size={14} style={{ color: 'var(--ink-3)' }} />}
                items={data?.prs ?? []}
                empty={loading ? 'Loading…' : 'No open pull requests.'}
                actionLabel="Test PR"
                onAction={testPR}
              />
              <GhList
                title="Issues"
                icon={<CircleDot size={14} style={{ color: 'var(--ink-3)' }} />}
                items={data?.issues ?? []}
                empty={loading ? 'Loading…' : 'No open issues.'}
                actionLabel="Reproduce"
                onAction={testIssue}
              />
            </div>
          )}
        </>
      )}
    </TabShell>
  )
}

interface Integration {
  slug: string
  name: string
  description: string
  connected: boolean
}

function IntegrationsTab() {
  const [data, setData] = useState<{ enabled: boolean; integrations: Integration[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    fetch('/api/integrations')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Re-check connections when the user returns from the OAuth tab.
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  async function connect(slug: string) {
    setBusy(slug)
    setErr('')
    try {
      const r = await fetch(`/api/integrations/${slug}/connect`, { method: 'POST' })
      const d = await r.json()
      if (d.redirectUrl) window.open(d.redirectUrl, '_blank', 'noopener,noreferrer')
      else setErr(d.error || 'Could not start the connection.')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <TabShell
      title="Integrations"
      subtitle="Connect third-party apps so the agent can act on them during a test or run."
      action={
        <PrimaryBtn onClick={load}>
          <RefreshCw size={13} /> Refresh
        </PrimaryBtn>
      }
    >
      {data && !data.enabled && (
        <Empty>Integrations are not configured on the server (COMPOSIO_API_KEY is missing).</Empty>
      )}
      {err && <Empty>⚠ {err}</Empty>}
      {(data?.integrations ?? []).map((it) => (
        <div
          key={it.slug}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            padding: '13px 16px',
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--panel)',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--line)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink-2)',
              flexShrink: 0,
            }}
          >
            <Plug size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{it.description}</div>
          </div>
          {it.connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  padding: '4px 10px',
                  borderRadius: 999,
                  color: 'var(--accent)',
                  background: 'var(--accent-soft)',
                }}
              >
                CONNECTED
              </span>
              <button
                onClick={() => connect(it.slug)}
                disabled={busy === it.slug}
                className="btn-ghost"
                style={{ padding: '5px 11px', fontSize: 11 }}
                title="Re-authorize — use this if its token expired"
              >
                {busy === it.slug ? 'Opening…' : 'Reconnect'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => connect(it.slug)}
              disabled={busy === it.slug}
              className="btn-ghost"
              style={{ padding: '6px 14px', fontSize: 12, flexShrink: 0 }}
            >
              {busy === it.slug ? 'Opening…' : 'Connect'}
            </button>
          )}
        </div>
      ))}
    </TabShell>
  )
}

function AccountsTab({ agent, patch }: { agent: Agent; patch: PatchFn }) {
  const [adding, setAdding] = useState(false)
  const [a, setA] = useState({ label: '', username: '', password: '', notes: '' })
  const [openId, setOpenId] = useState<string | null>(null)
  const accounts = agent.testAccounts

  function save() {
    if (!a.label.trim() || !a.username.trim()) return
    patch({ testAccounts: [...accounts, { id: uid(), ...a }] })
    setA({ label: '', username: '', password: '', notes: '' })
    setAdding(false)
  }

  return (
    <TabShell
      title="Test Accounts"
      subtitle="Test login-protected pages without manual setup every run."
      action={
        <PrimaryBtn onClick={() => setAdding((v) => !v)}>
          <Plus size={13} /> Add Credential
        </PrimaryBtn>
      }
    >
      {adding && (
        <Card>
          <SectionTitle>New credential</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {field(a.label, (v) => setA({ ...a, label: v }), 'Label (e.g. "QA Tester")')}
            {field(a.username, (v) => setA({ ...a, username: v }), 'Username / email')}
            {field(a.password, (v) => setA({ ...a, password: v }), 'Password', 'password')}
            {field(a.notes, (v) => setA({ ...a, notes: v }), 'Notes (optional)')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} className="btn" style={{ padding: '6px 14px' }}>
              Save credential
            </button>
            <button
              onClick={() => setAdding(false)}
              className="btn-ghost"
              style={{ padding: '6px 12px' }}
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      {accounts.length === 0 && !adding && (
        <Empty>No test accounts yet. Add one so the agent can sign in.</Empty>
      )}

      {accounts.map((acc) => (
        <div
          key={acc.id}
          style={{
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--panel)',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: '1px solid var(--line)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--ink-3)',
                flexShrink: 0,
              }}
            >
              <User size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{acc.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Username / Password</div>
            </div>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: 'var(--accent)',
                background: 'var(--accent-soft)',
                padding: '3px 9px',
                borderRadius: 999,
              }}
            >
              Active
            </span>
            <button
              onClick={() => patch({ testAccounts: accounts.filter((x) => x.id !== acc.id) })}
              style={{ background: 'transparent', border: 0, color: 'var(--ink-4)', cursor: 'pointer', padding: 2 }}
            >
              <Trash2 size={15} />
            </button>
            <button
              onClick={() => setOpenId(openId === acc.id ? null : acc.id)}
              style={{ background: 'transparent', border: 0, color: 'var(--ink-3)', cursor: 'pointer', padding: 2 }}
            >
              <ChevronDown
                size={15}
                style={{
                  transform: openId === acc.id ? 'rotate(180deg)' : 'none',
                  transition: 'transform .15s',
                }}
              />
            </button>
          </div>
          {openId === acc.id && (
            <div
              style={{
                borderTop: '1px solid var(--line-2)',
                padding: '10px 16px',
                display: 'flex',
                gap: 22,
                fontSize: 12,
                fontFamily: 'var(--mono)',
              }}
            >
              <div>
                <span style={{ color: 'var(--ink-4)' }}>username </span>
                <span style={{ color: 'var(--ink)' }}>{acc.username}</span>
              </div>
              <div>
                <span style={{ color: 'var(--ink-4)' }}>password </span>
                <span style={{ color: 'var(--ink)' }}>{acc.password}</span>
              </div>
              {acc.notes && (
                <div>
                  <span style={{ color: 'var(--ink-4)' }}>notes </span>
                  <span style={{ color: 'var(--ink)' }}>{acc.notes}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </TabShell>
  )
}

function FilesTab({ agent, patch }: { agent: Agent; patch: PatchFn }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', content: '' })
  const files = agent.files

  function save() {
    if (!f.name.trim()) return
    patch({ files: [...files, { id: uid(), ...f }] })
    setF({ name: '', content: '' })
    setAdding(false)
  }

  return (
    <TabShell
      title="Files"
      subtitle="Reference material for the test — specs, sample data, notes."
      action={
        <PrimaryBtn onClick={() => setAdding((v) => !v)}>
          <Plus size={13} /> Add File
        </PrimaryBtn>
      }
    >
      {adding && (
        <Card>
          <SectionTitle>New file</SectionTitle>
          {field(f.name, (v) => setF({ ...f, name: v }), 'File name')}
          <textarea
            value={f.content}
            onChange={(e) => setF({ ...f, content: e.target.value })}
            placeholder="Paste file contents…"
            rows={5}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              color: 'var(--ink)',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} className="btn" style={{ padding: '6px 14px' }}>
              Save file
            </button>
            <button onClick={() => setAdding(false)} className="btn-ghost" style={{ padding: '6px 12px' }}>
              Cancel
            </button>
          </div>
        </Card>
      )}

      {files.length === 0 && !adding && <Empty>No files attached.</Empty>}

      {files.map((file) => (
        <div
          key={file.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            padding: '12px 16px',
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--panel)',
          }}
        >
          <Paperclip size={15} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{file.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {file.content.length.toLocaleString()} chars
            </div>
          </div>
          <button
            onClick={() => patch({ files: files.filter((x) => x.id !== file.id) })}
            style={{ background: 'transparent', border: 0, color: 'var(--ink-4)', cursor: 'pointer' }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </TabShell>
  )
}

const MEM_CAT: Record<MemoryCategory, string> = {
  site_structure: 'Site Structure',
  test_insights: 'Test Insights',
  user_preferences: 'User Preferences',
}
const MEM_CAT_COLOR: Record<MemoryCategory, string> = {
  site_structure: '#3b82f6',
  test_insights: '#22c55e',
  user_preferences: '#a855f7',
}
const IMPORTANCE: MemoryImportance[] = ['low', 'medium', 'high']

function selectInput<T extends string>(
  value: T,
  onChange: (v: T) => void,
  options: [T, string][],
) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        padding: '7px 10px',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        color: 'var(--ink)',
        fontSize: 12.5,
        fontFamily: 'inherit',
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

function MemoryTab({ agent, patch }: { agent: Agent; patch: PatchFn }) {
  const [adding, setAdding] = useState(false)
  const [m, setM] = useState<{
    category: MemoryCategory
    importance: MemoryImportance
    title: string
    body: string
  }>({ category: 'site_structure', importance: 'medium', title: '', body: '' })
  const memory = agent.memory

  function save() {
    if (!m.title.trim() || !m.body.trim()) return
    patch({ memory: [...memory, { id: uid(), ...m }] })
    setM({ category: 'site_structure', importance: 'medium', title: '', body: '' })
    setAdding(false)
  }

  return (
    <TabShell
      title="Memory"
      subtitle="Context injected into the agent every run. Test Insights are learned automatically after each run."
      action={
        <PrimaryBtn onClick={() => setAdding((v) => !v)}>
          <Plus size={13} /> Add Memory
        </PrimaryBtn>
      }
    >
      {adding && (
        <Card>
          <SectionTitle>New memory</SectionTitle>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {fieldLabel('Category')}
              {selectInput<MemoryCategory>(
                m.category,
                (v) => setM({ ...m, category: v }),
                [
                  ['site_structure', 'Site Structure'],
                  ['test_insights', 'Test Insights'],
                  ['user_preferences', 'User Preferences'],
                ],
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {fieldLabel('Importance')}
              {selectInput<MemoryImportance>(
                m.importance,
                (v) => setM({ ...m, importance: v }),
                IMPORTANCE.map((i) => [i, i[0].toUpperCase() + i.slice(1)]),
              )}
            </div>
          </div>
          {fieldLabel('Brief summary')}
          {field(m.title, (v) => setM({ ...m, title: v }), 'Brief summary')}
          {fieldLabel('Content')}
          <textarea
            value={m.body}
            onChange={(e) => setM({ ...m, body: e.target.value })}
            placeholder="Detailed information to remember…"
            rows={4}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              color: 'var(--ink)',
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} className="btn" style={{ padding: '6px 14px' }}>
              Add Memory
            </button>
            <button onClick={() => setAdding(false)} className="btn-ghost" style={{ padding: '6px 12px' }}>
              Cancel
            </button>
          </div>
        </Card>
      )}

      {memory.length === 0 && !adding && (
        <Empty>
          No memory yet. Add site facts or preferences — and Test Insights will appear here
          automatically as the agent learns from runs.
        </Empty>
      )}

      {(['test_insights', 'site_structure', 'user_preferences'] as MemoryCategory[]).map((cat) => {
        const docs = memory.filter((d) => d.category === cat)
        if (docs.length === 0) return null
        return (
          <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginTop: 4,
              }}
            >
              <span
                style={{ width: 7, height: 7, borderRadius: 999, background: MEM_CAT_COLOR[cat] }}
              />
              {MEM_CAT[cat]}
              {cat === 'test_insights' && (
                <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--ink-4)' }}>
                  · auto-learned after runs
                </span>
              )}
            </div>
            {docs.map((doc) => (
              <div
                key={doc.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  width: '100%',
                  padding: '13px 16px',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  background: 'var(--panel)',
                }}
              >
                <Brain size={15} style={{ color: 'var(--ink-3)', marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{doc.title}</span>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        color: 'var(--ink-4)',
                      }}
                    >
                      {doc.importance}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--ink-3)',
                      whiteSpace: 'pre-wrap',
                      marginTop: 3,
                      lineHeight: 1.55,
                    }}
                  >
                    {doc.body}
                  </div>
                </div>
                <button
                  onClick={() => patch({ memory: memory.filter((x) => x.id !== doc.id) })}
                  style={{ background: 'transparent', border: 0, color: 'var(--ink-4)', cursor: 'pointer' }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )
      })}
    </TabShell>
  )
}

function formatHour(h: number): string {
  return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`
}

function ordinal(d: number): string {
  const s = d % 10
  const suffix =
    s === 1 && d !== 11 ? 'st' : s === 2 && d !== 12 ? 'nd' : s === 3 && d !== 13 ? 'rd' : 'th'
  return `${d}${suffix}`
}

const FREQ_OPTIONS: [AgentSchedule['frequency'], string][] = [
  ['minute', 'Every minute'],
  ['hourly', 'Every hour'],
  ['daily', 'Every day'],
  ['monthly', 'Every month'],
]
const HOUR_OPTIONS: [string, string][] = Array.from({ length: 24 }, (_, h) => [
  String(h),
  formatHour(h),
])
const DOM_OPTIONS: [string, string][] = Array.from({ length: 28 }, (_, i) => [
  String(i + 1),
  ordinal(i + 1),
])

const SCHEDULE_DEFAULT: AgentSchedule = {
  enabled: false,
  frequency: 'daily',
  hour: 9,
  dayOfMonth: 1,
  lastRunAt: null,
}

const FREQ_SUMMARY: Record<AgentSchedule['frequency'], string> = {
  minute: 'Runs once every minute.',
  hourly: 'Runs once every hour.',
  daily: 'Runs once a day at the chosen time.',
  monthly: 'Runs once a month on the chosen day and time.',
}

/** A themed custom dropdown — replaces the unstyleable native <select>. */
function Dropdown<T extends string>({
  value,
  options,
  onChange,
  width = 190,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const current = options.find(([v]) => v === value)?.[1] ?? ''

  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 11px',
          background: 'var(--panel)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--line)'}`,
          borderRadius: 7,
          color: 'var(--ink)',
          fontSize: 12.5,
          fontFamily: 'inherit',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {current}
        </span>
        <ChevronDown
          size={14}
          style={{
            color: 'var(--ink-3)',
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .12s',
          }}
        />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: '100%',
            maxHeight: 240,
            overflowY: 'auto',
            zIndex: 50,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 14px 36px rgba(0,0,0,0.5)',
          }}
        >
          {options.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                onChange(v)
                setOpen(false)
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 9px',
                background: v === value ? 'var(--bg-elev)' : 'transparent',
                border: 0,
                borderRadius: 6,
                color: v === value ? 'var(--ink)' : 'var(--ink-2)',
                fontSize: 12.5,
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = v === value ? 'var(--bg-elev)' : 'transparent')
              }
            >
              <span style={{ flex: 1 }}>{label}</span>
              {v === value && <Check size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** One labelled row in the schedule card. */
function SchedRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', width: 96, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  )
}

/** Scheduled-runs card — a cron-style job for this agent. */
function ScheduleCard({ agent, patch }: { agent: Agent; patch: PatchFn }) {
  const [sched, setSched] = useState<AgentSchedule>({ ...SCHEDULE_DEFAULT, ...agent.schedule })
  const [saved, setSaved] = useState(true)

  function update(next: Partial<AgentSchedule>) {
    setSched((s) => ({ ...s, ...next }))
    setSaved(false)
  }

  const showTime = sched.frequency === 'daily' || sched.frequency === 'monthly'

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Clock size={16} style={{ color: 'var(--ink-2)' }} />
        <SectionTitle>Scheduled runs</SectionTitle>
        <div style={{ marginLeft: 'auto' }}>
          <Toggle on={sched.enabled} onChange={(v) => update({ enabled: v })} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
        Run this agent's saved test plan automatically, like a CI job. Add a <strong>GitHub</strong>{' '}
        step to the plan to file each run's result to the connected repo.
      </div>

      {sched.enabled && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '13px 14px',
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--bg)',
          }}
        >
          <SchedRow label="Frequency">
            <Dropdown
              value={sched.frequency}
              options={FREQ_OPTIONS}
              onChange={(v) => update({ frequency: v })}
            />
          </SchedRow>
          {sched.frequency === 'monthly' && (
            <SchedRow label="Day of month">
              <Dropdown
                value={String(sched.dayOfMonth)}
                options={DOM_OPTIONS}
                onChange={(v) => update({ dayOfMonth: Number(v) })}
                width={130}
              />
            </SchedRow>
          )}
          {showTime && (
            <SchedRow label="Time">
              <Dropdown
                value={String(sched.hour)}
                options={HOUR_OPTIONS}
                onChange={(v) => update({ hour: Number(v) })}
                width={150}
              />
            </SchedRow>
          )}
          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{FREQ_SUMMARY[sched.frequency]}</div>
        </div>
      )}

      {sched.lastRunAt && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          Last scheduled run: {new Date(sched.lastRunAt).toLocaleString()}
        </div>
      )}
      <button
        onClick={() => {
          void patch({ schedule: sched })
          setSaved(true)
        }}
        disabled={saved}
        className="btn-ghost"
        style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12, opacity: saved ? 0.5 : 1 }}
      >
        {saved ? 'Saved' : 'Save schedule'}
      </button>
    </Card>
  )
}

function SettingsTab({
  agent,
  patch,
  onClose,
}: {
  agent: Agent
  patch: PatchFn
  onClose: () => void
}) {
  const [name, setName] = useState(agent.name)
  const [url, setUrl] = useState(agent.url)
  return (
    <TabShell title="Settings" subtitle="Workspace configuration and agentic-run behaviour.">
      <Card>
        <SectionTitle>Workspace</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {fieldLabel('Name')}
            {field(name, setName, 'Agent name')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {fieldLabel('Target URL')}
            {field(url, setUrl, 'https://example.com')}
          </div>
        </div>
        <button
          onClick={() => patch({ name, url })}
          className="btn-ghost"
          style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12 }}
        >
          Save
        </button>
      </Card>
      <ScheduleCard agent={agent} patch={patch} />
      <Card>
        <SectionTitle>Danger zone</SectionTitle>
        <button
          onClick={async () => {
            if (!confirm('Delete this workspace? This cannot be undone.')) return
            await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' })
            onClose()
          }}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid var(--fail)',
            borderRadius: 6,
            color: 'var(--fail)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={13} /> Delete workspace
        </button>
      </Card>
    </TabShell>
  )
}
