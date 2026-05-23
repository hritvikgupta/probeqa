import { useEffect, useState } from 'react'
import StatusBadge from '../components/StatusBadge'
import { RUN_STATUS, type Overview as OverviewData, type OverviewRun } from '../types'

type Filter = 'all' | OverviewRun['status']

interface Props {
  projectId: string | null
  onRunClick: (run: OverviewRun) => void
}

function ago(iso: string): string {
  const diff = Date.now() - +new Date(iso)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Flatten markdown to a clean single line for a table-cell preview. */
function plainSummary(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function Runs({ projectId, onRunClick }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const qs = projectId ? `?projectId=${projectId}` : ''
    fetch(`/api/overview${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [projectId])

  const q = query.trim().toLowerCase()
  const filtered = (data?.runs ?? []).filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false
    if (q && !`${r.agentName} ${r.agentUrl} ${r.summary ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'failed', label: 'Failed' },
    { key: 'running', label: 'Running' },
    { key: 'passed', label: 'Passed' },
    { key: 'issues', label: 'Issues' },
  ]

  return (
    <section className="page">
      <div className="toolbar">
        <div className="runs-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/>
          </svg>
          <input
            placeholder="Search by agent, target, or summary"
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
              <th>Agent</th><th>Target</th><th>Status</th>
              <th>Summary</th><th className="right">Started</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
                {data && data.runs.length === 0 ? 'No runs yet.' : 'No runs match.'}
              </td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => onRunClick(r)}>
                <td><span className="name">{r.agentName}</span></td>
                <td className="mono">{r.agentUrl || '—'}</td>
                <td><StatusBadge status={RUN_STATUS[r.status]} /></td>
                <td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.summary ? plainSummary(r.summary) : '—'}
                </td>
                <td className="right muted mono">{ago(r.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
