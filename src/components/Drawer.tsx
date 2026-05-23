import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import StatusBadge from './StatusBadge'
import { RUN_STATUS, type OverviewRun, type RunRecord, type RunStep } from '../types'

interface Props {
  run: OverviewRun | null
  onClose: () => void
}

const STATUS_TEXT: Record<OverviewRun['status'], string> = {
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  issues: 'Issues found',
}

const STEP_CLASS: Record<RunStep['status'], string> = {
  passed: 'ok',
  failed: 'fail',
  running: '',
  pending: '',
}

const STEP_RESULT: Record<RunStep['status'], string> = {
  passed: 'passed',
  failed: 'failed',
  running: 'cut off',
  pending: 'not reached',
}

function fmtDuration(ms?: number): string {
  if (ms == null || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export default function Drawer({ run, onClose }: Props) {
  const open = run !== null
  const [detail, setDetail] = useState<RunRecord | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Pull the full run (with screenshot) whenever a run is opened — the
  // overview list omits the heavy screenshot.
  useEffect(() => {
    setDetail(null)
    if (!run) return
    let cancelled = false
    fetch(`/api/agents/${run.agentId}/runs/${run.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.run) setDetail(d.run as RunRecord) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [run])

  const steps = detail?.steps ?? run?.steps ?? []
  const screenshot = detail?.screenshot
  const durationMs = detail?.durationMs ?? run?.durationMs
  const summary = detail?.summary ?? run?.summary

  return (
    <>
      <div className={`scrim${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-hidden={!open}>
        <div className="dr-head">
          <div className="dr-title">{run?.agentName ?? 'Run details'}</div>
          <button className="dr-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
            </svg>
          </button>
        </div>
        {run && (
          <div className="dr-body">
            <div className="meta-grid">
              <div>
                <div className="meta-l">Status</div>
                <div className="meta-v"><StatusBadge status={RUN_STATUS[run.status]} /></div>
              </div>
              <div>
                <div className="meta-l">Agent</div>
                <div className="meta-v">{run.agentName}</div>
              </div>
              <div>
                <div className="meta-l">Target</div>
                <div className="meta-v mono">{run.agentUrl || '—'}</div>
              </div>
              <div>
                <div className="meta-l">Duration</div>
                <div className="meta-v mono">{fmtDuration(durationMs)}</div>
              </div>
              <div>
                <div className="meta-l">Started</div>
                <div className="meta-v mono">{new Date(run.startedAt).toLocaleString()}</div>
              </div>
            </div>

            {steps.length > 0 && (
              <div>
                <div className="meta-l" style={{ marginBottom: 10 }}>Step timeline</div>
                <div className="timeline">
                  {steps.map((s) => (
                    <div key={s.index} className={`step ${STEP_CLASS[s.status]}`}>
                      <span>{s.index}. {s.label}</span>
                      <span className="step-dur">{STEP_RESULT[s.status]}</span>
                    </div>
                  ))}
                </div>
                {steps.some((s) => s.note) && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {steps.filter((s) => s.note).map((s) => (
                      <div
                        key={s.index}
                        style={{
                          fontSize: 11.5,
                          color: s.status === 'failed' ? 'var(--fail)' : 'var(--ink-3)',
                        }}
                      >
                        Step {s.index}: {s.note}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="meta-l" style={{ marginBottom: 8 }}>Summary</div>
              <div
                className="agent-md"
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  background: 'var(--panel)',
                }}
              >
                {summary ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                ) : (
                  `Run ${STATUS_TEXT[run.status].toLowerCase()}. No summary was recorded.`
                )}
              </div>
            </div>

            {screenshot && (
              <div>
                <div className="meta-l" style={{ marginBottom: 8 }}>Final screenshot</div>
                <img
                  src={`data:image/jpeg;base64,${screenshot}`}
                  alt="Final state of the page"
                  style={{
                    width: '100%',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    display: 'block',
                  }}
                />
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
