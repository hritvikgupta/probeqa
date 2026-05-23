import { useEffect, useState, useCallback } from 'react'
import FileTicketModal from '../components/FileTicketModal'
import type { Ticket, TicketsResponse } from '../types'

type Filter = 'all' | 'open' | 'closed'

interface Props {
  projectId: string | null
  onToast: (msg: string) => void
}

function ago(iso: string): string {
  if (!iso) return '—'
  const diff = Date.now() - +new Date(iso)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

export default function Tickets({ projectId, onToast }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<TicketsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const qs = projectId ? `?projectId=${projectId}` : ''
    fetch(`/api/tickets${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TicketsResponse | null) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const fileTicket = useCallback(
    async (repo: string, title: string, body: string) => {
      const r = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo, title, body }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || 'Could not file the ticket.')
      onToast(`Filed ${repo}#${d.number}`)
      load()
    },
    [onToast, load],
  )

  const repos = data?.repos ?? []
  const tickets = data?.tickets ?? []

  const q = query.trim().toLowerCase()
  const filtered = tickets.filter((t) => {
    if (filter !== 'all' && t.state !== filter) return false
    if (q && !`${t.title} ${t.repo} ${t.agentName} ${t.labels.join(' ')}`.toLowerCase().includes(q))
      return false
    return true
  })

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'closed', label: 'Closed' },
  ]

  function emptyMessage(): string {
    if (!data) return 'Could not load tickets.'
    if (!data.enabled) return 'GitHub integration is not configured on the server.'
    if (!data.connected) return 'Connect GitHub in the Integrations tab to see tickets.'
    if (repos.length === 0)
      return 'No agent has a repository connected — pick one in an agent’s PR Testing tab.'
    if (data.error) return data.error
    if (tickets.length === 0) return 'No issues in the connected repositories.'
    return 'No tickets match.'
  }

  return (
    <section className="page">
      <div className="page-head">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {repos.length > 0 ? (
            repos.map((repo) => (
              <a
                key={repo}
                className="gh-repo"
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noreferrer"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18.92-.26 1.9-.39 2.88-.39s1.96.13 2.88.39c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.08 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
                </svg>
                <span className="mono">{repo}</span>
              </a>
            ))
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>No repositories connected</span>
          )}
          <button className="btn" onClick={() => setModalOpen(true)} disabled={repos.length === 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            File ticket
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="runs-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/>
          </svg>
          <input
            placeholder="Search title, repo, agent, or label"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips">
          {chips.map((c) => (
            <button key={c.key} className={`chip${filter === c.key ? ' on' : ''}`} onClick={() => setFilter(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Issue</th><th>Agent</th><th>Labels</th>
              <th>Status</th><th>Author</th><th className="right">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>{emptyMessage()}</td></tr>
            ) : filtered.map((t: Ticket) => (
              <tr key={`${t.repo}#${t.number}`}>
                <td>
                  <div className="tk-issue">
                    <span className="tk-title">{t.title}</span>
                    <span className="tk-id">
                      <a href={t.url} target="_blank" rel="noreferrer">{t.repo}#{t.number}</a>
                    </span>
                  </div>
                </td>
                <td className="muted">{t.agentName}</td>
                <td>
                  {t.labels.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className="tk-labels">
                      {t.labels.map((l) => <span key={l} className="tk-label">{l}</span>)}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`st ${t.state === 'open' ? 'warn' : 'ok'}`}>
                    <span className="dot" />
                    {t.state === 'open' ? 'Open' : 'Closed'}
                  </span>
                </td>
                <td className="muted">{t.author}</td>
                <td className="right muted mono">{ago(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FileTicketModal
        open={modalOpen}
        repos={repos}
        onClose={() => setModalOpen(false)}
        onSubmit={fileTicket}
      />
    </section>
  )
}
