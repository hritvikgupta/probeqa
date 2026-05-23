import { useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

/**
 * Blocking modal shown to a user with no projects yet — every agent, run and
 * test lives inside a project, so one must exist before the app is usable.
 */
export default function FirstProjectModal({
  onCreate,
}: {
  onCreate: (name: string) => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      await onCreate(name.trim())
    } finally {
      setBusy(false)
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit()
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        zIndex: 200,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        style={{
          width: 380,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <svg className="brand-mark" viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true">
            <polygon points="12,2 22,7 12,12 2,7" fill="#FFFFFF" />
            <polygon points="2,7 12,12 12,22 2,17" fill="#BFBFBF" />
            <polygon points="22,7 12,12 12,22 22,17" fill="#8A8A8A" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>Probe</span>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Create your first project</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
            A project groups your test agents, runs and memory. You can add more later.
          </div>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
          placeholder="Project name — e.g. Acme Web"
          style={{
            width: '100%',
            padding: '9px 11px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            color: 'var(--ink)',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          style={{
            padding: '9px 12px',
            background: 'var(--ink)',
            color: '#111',
            border: 0,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !name.trim() ? 'default' : 'pointer',
            opacity: busy || !name.trim() ? 0.55 : 1,
          }}
        >
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
