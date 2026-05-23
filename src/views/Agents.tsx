import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Agent } from '../types'
import { FlaskConical, Plus, ChevronRight } from 'lucide-react'

/**
 * Agents page — each "agent" is a test workspace (a Agent). Clicking one
 * opens the full workspace modal; "New agent" creates one and opens it.
 */
interface Props {
  projectId: string | null
  onOpen: (id: string) => void
}

export default function Agents({ projectId, onOpen }: Props) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', url: '' })
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    const qs = projectId ? `?projectId=${projectId}` : ''
    fetch(`/api/agents${qs}`)
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => {})
  }, [projectId])

  async function create() {
    if (busy) return
    setBusy(true)
    setCreateError(null)
    try {
      const r = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, projectId: projectId ?? undefined }),
      })
      const d = await r.json().catch(() => ({}))
      // Plan-limit gate (HTTP 402) — keep the modal open and show the message.
      if (!r.ok || !d.agent) {
        setCreateError(d.error || 'Could not create agent')
        return
      }
      setCreating(false)
      setForm({ name: '', url: '' })
      onOpen(d.agent.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Agents</div>
          <div className="sub">Test workspaces — each drives the browser agent against a target.</div>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="btn"
          style={{ marginLeft: 'auto' }}
        >
          <Plus size={14} /> New agent
        </button>
      </div>

      {agents.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--line)',
            borderRadius: 10,
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: 13,
          }}
        >
          No agents yet. Create one to build and run a test workspace.
        </div>
      ) : (
        <div className="agents">
          {agents.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              className="agent"
              style={{ cursor: 'pointer', textAlign: 'left', alignItems: 'stretch' }}
            >
              <div className="agent-head">
                <div className="agent-ic">
                  <FlaskConical size={15} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="agent-name">{p.name}</div>
                  <div className="agent-purpose">{p.url || 'No target URL'}</div>
                </div>
                <ChevronRight size={15} style={{ color: 'var(--ink-4)' }} />
              </div>
              <div className="agent-stats">
                <div>
                  <div className="agent-stat-l">Steps</div>
                  <div className="agent-stat-v">{p.steps.length}</div>
                </div>
                <div>
                  <div className="agent-stat-l">Runs</div>
                  <div className="agent-stat-v">{p.runs.length}</div>
                </div>
                <div>
                  <div className="agent-stat-l">Accounts</div>
                  <div className="agent-stat-v">{p.testAccounts.length}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && createPortal(
        <div
          onClick={() => {
            setCreating(false)
            setCreateError(null)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 380,
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>New agent</div>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Workspace name"
              style={inputStyle}
            />
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://example.com"
              onKeyDown={(e) => e.key === 'Enter' && create()}
              style={inputStyle}
            />
            {createError && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 6,
                  background: 'rgba(139,58,42,0.15)',
                  border: '1px solid #5a2418',
                  color: '#f0b0a4',
                  fontSize: 12.5,
                  lineHeight: 1.45,
                }}
              >
                {createError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn-ghost"
                onClick={() => {
                  setCreating(false)
                  setCreateError(null)
                }}
                style={{ padding: '6px 12px' }}
              >
                Cancel
              </button>
              <button className="btn" onClick={create} disabled={busy}>
                Create & open
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 11px',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 7,
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}
