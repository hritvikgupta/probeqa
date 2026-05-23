import { useEffect, useState } from 'react'
import StatusBadge from '../components/StatusBadge'
import { RUN_STATUS, type Overview as OverviewData, type OverviewRun } from '../types'

interface Props {
  projectId: string | null
  onRunClick: (run: OverviewRun) => void
  onViewRuns: () => void
}

/** Relative "time ago" for an ISO timestamp. */
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

export default function Overview({ projectId, onRunClick, onViewRuns }: Props) {
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

  const stats = data?.stats
  const recent = data?.runs.slice(0, 6) ?? []

  return (
    <section className="page">
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Pass rate</div>
          <div className="kpi-val">
            {stats?.passRate != null ? stats.passRate : '—'}
            {stats?.passRate != null && <span className="unit">%</span>}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total runs</div>
          <div className="kpi-val">{stats?.totalRuns ?? '—'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Running now</div>
          <div className="kpi-val">{stats?.running ?? '—'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Agents</div>
          <div className="kpi-val">{stats?.agents ?? '—'}</div>
        </div>
      </div>

      <div className="section-head">
        <div className="section-title">Recent runs</div>
        <a className="section-meta" style={{ cursor: 'pointer' }} onClick={onViewRuns}>View all →</a>
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
            ) : recent.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
                No runs yet. Create an agent and run it to see results here.
              </td></tr>
            ) : recent.map((r) => (
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
