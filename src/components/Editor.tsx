import { useCallback, useEffect, useState } from 'react'
import type { EditorTarget, ConversationMeta } from '../types'
import AgentChat from './AgentChat'
import BrowserView from './BrowserView'
import { Plus } from 'lucide-react'

interface Props {
  open: boolean
  target: EditorTarget
  projectId: string | null
  onClose: () => void
}

/**
 * Editor — the real testing surface.
 *   left:  AgentChat   (the agent, talking to /api/agent)
 *   right: BrowserView (live screencast of the browser the agent drives)
 *
 * Chats are saved per project: the header dropdown loads past conversations,
 * and the active conversation id doubles as the browser session id so both
 * panes share one session.
 */
export default function Editor({ open, target, projectId, onClose }: Props) {
  const [convs, setConvs] = useState<ConversationMeta[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)

  const refreshConvs = useCallback(async () => {
    const qs = projectId ? `?projectId=${projectId}` : ''
    const list: ConversationMeta[] = await fetch(`/api/conversations${qs}`)
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((d) => d.conversations ?? [])
      .catch(() => [])
    setConvs(list)
    return list
  }, [projectId])

  const createConv = useCallback(async (): Promise<ConversationMeta | null> => {
    return fetch('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: projectId ?? undefined }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.conversation ?? null)
      .catch(() => null)
  }, [projectId])

  // On open: load this project's chats, creating one if there are none.
  useEffect(() => {
    if (!open) return
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
  }, [open, projectId, refreshConvs, createConv])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // New chat: fresh conversation + browser session; reset the old session.
  async function newRun() {
    const old = activeConvId
    const created = await createConv()
    if (created) {
      setConvs((prev) => [created, ...prev])
      setActiveConvId(created.id)
    }
    if (old) {
      fetch('/api/agent/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: old }),
      }).catch(() => {})
    }
  }

  return (
    <div className={`editor${open ? ' on' : ''}`} aria-hidden={!open}>
      <div className="ed-head">
        <button className="ed-back" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <polyline points="15 6 9 12 15 18" />
          </svg>
          Back
        </button>
        <div className="ed-title">
          {target.n} <span className="ink-3">{target.url}</span>
        </div>
        <div className="ed-spacer" />
        <select
          value={activeConvId ?? ''}
          onChange={(e) => setActiveConvId(e.target.value)}
          title="Chat history"
          style={{
            maxWidth: 220,
            padding: '5px 8px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 7,
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
          className="btn-ghost"
          onClick={newRun}
          title="New chat"
          style={{ padding: '5px 9px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <Plus size={12} /> New chat
        </button>
        <div className="ed-state">
          <span className="dot" />
          <span>Live agent</span>
        </div>
      </div>

      <div className="ed-body">
        {activeConvId ? (
          <>
            <AgentChat
              key={`chat-${activeConvId}`}
              chatId={activeConvId}
              targetUrl={target.url}
              onNewRun={newRun}
              onPersisted={refreshConvs}
            />
            <BrowserView key={`view-${activeConvId}`} chatId={activeConvId} />
          </>
        ) : (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            Loading…
          </div>
        )}
      </div>
    </div>
  )
}
