import { useEffect, useRef, useState } from 'react'

/**
 * Quick-chat / workspace flow attachment dropdown.
 *
 * Shows the recorded flows currently attached to this chatId and lets the
 * user attach more from their saved library. Each attached flow becomes
 * visible to the agent via list_flows() during this chat, scoped per-user.
 */

type FlowMini = {
  id: string
  name: string
  purpose: string
  description: string
  meta?: { params?: string[] }
}

export default function FlowAttachments({ chatId }: { chatId: string }) {
  const [attached, setAttached] = useState<FlowMini[]>([])
  const [library, setLibrary] = useState<FlowMini[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  async function loadAttached() {
    try {
      const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}/flows`, {
        credentials: 'include',
      })
      if (r.ok) {
        const d = (await r.json()) as { flows: FlowMini[] }
        setAttached(d.flows ?? [])
      }
    } catch {
      /* ignore */
    }
  }

  async function loadLibrary() {
    try {
      const r = await fetch('/api/flows', { credentials: 'include' })
      if (r.ok) {
        const d = (await r.json()) as { flows: FlowMini[] }
        setLibrary(d.flows ?? [])
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!chatId) return
    loadAttached()
    loadLibrary()
  }, [chatId])

  // Close the popup when the user clicks outside it.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function attach(flowId: string) {
    await fetch(`/api/chats/${encodeURIComponent(chatId)}/flows`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowId }),
    }).catch(() => {})
    loadAttached()
  }

  async function detach(flowId: string) {
    await fetch(`/api/chats/${encodeURIComponent(chatId)}/flows/${flowId}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {})
    loadAttached()
  }

  const attachedIds = new Set(attached.map((f) => f.id))
  const available = library.filter((f) => !attachedIds.has(f.id))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Attach recorded flows to this chat"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 9px',
          background: attached.length > 0 ? 'var(--accent-soft)' : 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 7,
          color: attached.length > 0 ? 'var(--accent)' : 'var(--ink-3)',
          fontSize: 11.5,
          cursor: 'pointer',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.5" fill="currentColor" />
        </svg>
        Flows · {attached.length}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 32,
            right: 0,
            width: 360,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
            zIndex: 8000,
            maxHeight: 480,
            overflow: 'auto',
          }}
        >
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-4)' }}>
            Attached to this chat · {attached.length}
          </div>
          {attached.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-4)' }}>
              None yet. Attach a flow below so the agent can replay it during this chat.
            </div>
          ) : (
            attached.map((f) => (
              <div key={f.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 500 }}>{f.name}</div>
                  <button
                    onClick={() => detach(f.id)}
                    style={{
                      fontSize: 10.5,
                      padding: '2px 8px',
                      background: 'transparent',
                      border: '1px solid var(--line)',
                      borderRadius: 4,
                      color: 'var(--ink-4)',
                      cursor: 'pointer',
                    }}
                  >
                    Detach
                  </button>
                </div>
                {f.purpose && (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.45 }}>
                    Use when: {f.purpose}
                  </div>
                )}
              </div>
            ))
          )}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-4)' }}>
            Available · {available.length}
          </div>
          {available.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-4)' }}>
              {library.length === 0
                ? 'No saved flows yet. Record one in the Recordings tab first.'
                : 'All saved flows are already attached.'}
            </div>
          ) : (
            available.map((f) => (
              <button
                key={f.id}
                onClick={() => attach(f.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 500 }}>+ {f.name}</div>
                {f.purpose && (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3, lineHeight: 1.45, fontStyle: 'italic' }}>
                    Use when: {f.purpose}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
