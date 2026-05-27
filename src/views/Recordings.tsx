import { useEffect, useRef, useState } from 'react'
import BrowserView from '../components/BrowserView'

/**
 * Recordings tab — human-driven flow capture and the saved-flow library.
 *
 * Two modes:
 *   1. Library  — show the user's saved flows; "New recording" starts a session.
 *   2. Recording — URL bar + live step list (left) + live screencast (right);
 *      Stop & save promotes the in-progress steps into a named flow.
 *
 * The recording is owned by the server: we just hit /api/recording/start,
 * the page user interacts via the live browser, and we poll /api/recording/:id/steps
 * to mirror the captured steps in the left pane. /api/recording/:id/stop ends it;
 * /api/recording/:id/save promotes it into the recorded_flows library.
 */

type FlowStep = {
  kind: 'navigate' | 'click' | 'fill' | 'press_key' | 'wait_for'
  selector?: string
  role?: string
  name?: string
  value?: string
  paramName?: string
  label: string
  at?: number
}

type FlowSummary = {
  id: string
  name: string
  description: string
  purpose: string
  steps: FlowStep[]
  meta: { params: string[]; endUrl?: string }
  createdAt: string
  lastUsedAt: string | null
}

export default function Recordings() {
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [startUrl, setStartUrl] = useState('')
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const [steps, setSteps] = useState<FlowStep[]>([])
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDesc, setSaveDesc] = useState('')
  const [savePurpose, setSavePurpose] = useState('')
  const [paramByIdx, setParamByIdx] = useState<Record<number, string>>({})
  const [openFlow, setOpenFlow] = useState<FlowSummary | null>(null)
  const [error, setError] = useState('')
  const pollRef = useRef<number | null>(null)

  // Library load + refresh after save.
  async function loadFlows() {
    setLoading(true)
    try {
      const r = await fetch('/api/flows', { credentials: 'include' })
      if (r.ok) {
        const d = (await r.json()) as { flows: FlowSummary[] }
        setFlows(d.flows)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFlows()
  }, [])

  // Step polling while a recording is active. 800ms — same cadence as the
  // browser frame poll, so the left and right panes feel in sync.
  useEffect(() => {
    if (!recordingId) {
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    const tick = async () => {
      try {
        const r = await fetch(`/api/recording/${recordingId}/steps`, { credentials: 'include' })
        if (r.ok) {
          const d = (await r.json()) as { steps: FlowStep[] }
          setSteps(d.steps)
        }
      } catch {
        /* transient network blip — next tick will retry */
      }
    }
    tick()
    const id = window.setInterval(tick, 800)
    pollRef.current = id
    return () => {
      window.clearInterval(id)
      pollRef.current = null
    }
  }, [recordingId])

  async function startNew() {
    if (!startUrl.trim()) {
      setError('Enter a URL to start recording.')
      return
    }
    setStarting(true)
    setError('')
    try {
      const r = await fetch('/api/recording/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrl: startUrl.trim() }),
      })
      const d = (await r.json()) as { recordingId?: string; chatId?: string; error?: string }
      if (!r.ok || !d.recordingId || !d.chatId) {
        setError(d.error || `Failed (${r.status})`)
        return
      }
      setRecordingId(d.recordingId)
      setChatId(d.chatId)
      setSteps([])
    } finally {
      setStarting(false)
    }
  }

  async function stopAndOpenSave() {
    if (!recordingId) return
    setStopping(true)
    try {
      const r = await fetch(`/api/recording/${recordingId}/stop`, {
        method: 'POST',
        credentials: 'include',
      })
      if (r.ok) {
        const d = (await r.json()) as { steps: FlowStep[] }
        setSteps(d.steps)
      }
      setSaveOpen(true)
      // Default name = host of start URL.
      try {
        const u = new URL(startUrl.match(/^https?:/i) ? startUrl : `https://${startUrl}`)
        setSaveName(`${u.hostname} flow`)
      } catch {
        setSaveName('Untitled flow')
      }
    } finally {
      setStopping(false)
    }
  }

  async function discardRecording() {
    if (!recordingId) return
    // The recording is already saved server-side; we just close the browser
    // and clear local state. The auto-saved (unnamed) row stays in the DB
    // until cleanup. Future enhancement: explicit delete endpoint.
    await fetch(`/api/recording/${recordingId}/stop`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})
    resetSession()
  }

  function resetSession() {
    setRecordingId(null)
    setChatId(null)
    setSteps([])
    setStartUrl('')
    setSaveOpen(false)
    setSaveName('')
    setSaveDesc('')
    setSavePurpose('')
    setParamByIdx({})
  }

  async function submitSave() {
    if (!recordingId) return
    if (!saveName.trim()) {
      setError('Name the flow first.')
      return
    }
    if (!savePurpose.trim()) {
      setError('Add a purpose — explain when the agent should use this flow.')
      return
    }
    const r = await fetch(`/api/recording/${recordingId}/save`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: saveName.trim(),
        description: saveDesc.trim(),
        purpose: savePurpose.trim(),
        params: paramByIdx,
      }),
    })
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      setError(d.error || `Save failed (${r.status})`)
      return
    }
    resetSession()
    loadFlows()
  }

  async function deleteFlow(id: string) {
    if (!confirm('Delete this flow? This cannot be undone.')) return
    await fetch(`/api/flows/${id}`, { method: 'DELETE', credentials: 'include' })
    if (openFlow?.id === id) setOpenFlow(null)
    loadFlows()
  }

  async function renameFlow(id: string, currentName: string) {
    const next = prompt('Rename flow:', currentName)
    if (!next || next.trim() === currentName) return
    await fetch(`/api/flows/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next.trim() }),
    })
    loadFlows()
  }

  // ---------- recording mode ----------
  if (recordingId && chatId) {
    return (
      <div className="rec-shell">
        <div className="rec-bar">
          <span className="rec-dot" /> Recording
          <span className="rec-url" title={startUrl}>{startUrl}</span>
          <div className="rec-spacer" />
          <button className="rec-btn rec-btn-ghost" onClick={discardRecording} disabled={stopping}>
            Discard
          </button>
          <button className="rec-btn rec-btn-stop" onClick={stopAndOpenSave} disabled={stopping}>
            {stopping ? 'Stopping…' : 'Stop & save'}
          </button>
        </div>

        <div className="rec-body">
          <aside className="rec-steps">
            <div className="rec-steps-head">Captured steps · {steps.length}</div>
            {steps.length === 0 ? (
              <div className="rec-empty">
                Interact with the page on the right. Each click and field entry will appear here.
              </div>
            ) : (
              <ol className="rec-step-list">
                {steps.map((s, i) => (
                  <li key={i} className={`rec-step rec-step-${s.kind}`}>
                    <span className="rec-step-idx">{i + 1}</span>
                    <span className="rec-step-label">{s.label}</span>
                  </li>
                ))}
              </ol>
            )}
          </aside>

          <div className="rec-browser">
            <BrowserView chatId={chatId} recordingId={recordingId} />
          </div>
        </div>

        {saveOpen && (
          <div className="rec-modal-bg" onClick={() => setSaveOpen(false)}>
            <div className="rec-modal" onClick={(e) => e.stopPropagation()}>
              <div className="rec-modal-head">Save flow</div>
              <label className="rec-field">
                <span>Name</span>
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Send LinkedIn DM"
                />
              </label>
              <label className="rec-field">
                <span>Use this flow when… <em className="rec-req">required</em></span>
                <textarea
                  rows={2}
                  value={savePurpose}
                  onChange={(e) => setSavePurpose(e.target.value)}
                  placeholder="e.g. The user asks to send a LinkedIn DM to a specific person."
                />
                <p className="rec-hint">
                  This is the instruction the agent reads to decide whether this flow applies.
                  Be specific — the agent matches the user's request against this string.
                </p>
              </label>
              <label className="rec-field">
                <span>Description (optional)</span>
                <textarea
                  rows={2}
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  placeholder="Internal notes for yourself (not shown to the agent)."
                />
              </label>

              {steps.some((s) => s.kind === 'fill') && (
                <div className="rec-field">
                  <span>Parameters (optional)</span>
                  <p className="rec-hint">
                    Every text field you typed into is listed below. If you give one a parameter
                    name, the typed value becomes a placeholder — when the agent replays the flow,
                    you (or the agent) can substitute a different value. Leave blank to always use
                    the literal text you typed.
                  </p>
                  <div className="rec-params">
                    {steps
                      .map((s, i) => ({ s, i }))
                      .filter(({ s }) => s.kind === 'fill')
                      .map(({ s, i }) => (
                        <div key={i} className="rec-param-row">
                          <div className="rec-param-info">
                            <div className="rec-param-line">
                              <span className="rec-param-step">Step {i + 1}</span>
                              <span className="rec-param-field">{s.name || s.selector || 'field'}</span>
                            </div>
                            <div className="rec-param-typed">
                              typed <span className="rec-param-val">"{(s.value || '').slice(0, 40)}"</span>
                            </div>
                          </div>
                          <input
                            className="rec-param-input"
                            placeholder="parameter name (e.g. search_term)"
                            value={paramByIdx[i] || ''}
                            onChange={(e) =>
                              setParamByIdx((prev) => ({ ...prev, [i]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {error && <div className="rec-error">{error}</div>}

              <div className="rec-modal-actions">
                <button className="rec-btn rec-btn-ghost" onClick={() => setSaveOpen(false)}>
                  Cancel
                </button>
                <button className="rec-btn rec-btn-primary" onClick={submitSave}>
                  Save flow
                </button>
              </div>
            </div>
          </div>
        )}

        <RecordingStyles />
      </div>
    )
  }

  // ---------- library / start mode ----------
  return (
    <div className="rec-shell">
      <div className="rec-start">
        <div className="rec-start-head">
          <div>
            <div className="rec-title">Recordings</div>
            <div className="rec-sub">
              Record any flow once by hand — login, send-DM, fill-form. The agent can replay it later with different inputs.
            </div>
          </div>
        </div>
        <div className="rec-start-row">
          <input
            className="rec-url-input"
            placeholder="https://app.example.com  or  linkedin.com/in/someone"
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') startNew()
            }}
          />
          <button className="rec-btn rec-btn-primary" onClick={startNew} disabled={starting}>
            {starting ? 'Starting…' : 'Start recording'}
          </button>
        </div>
        {error && <div className="rec-error">{error}</div>}
      </div>

      <div className="rec-library">
        <div className="rec-library-head">Saved flows · {flows.length}</div>
        {loading ? (
          <div className="rec-empty">Loading…</div>
        ) : flows.length === 0 ? (
          <div className="rec-empty">
            No saved flows yet. Start a recording above to capture one.
          </div>
        ) : (
          <ul className="rec-flow-list">
            {flows.map((f) => (
              <li key={f.id} className={`rec-flow${openFlow?.id === f.id ? ' open' : ''}`}>
                <div className="rec-flow-row" onClick={() => setOpenFlow(openFlow?.id === f.id ? null : f)}>
                  <div>
                    <div className="rec-flow-name">
                      {f.name}
                      {f.meta.params?.length > 0 && (
                        <span className="rec-flow-params">
                          {f.meta.params.map((p) => (
                            <span key={p} className="rec-param-chip">{p}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    {f.purpose && <div className="rec-flow-purpose">Use when: {f.purpose}</div>}
                  </div>
                  <div className="rec-flow-meta">
                    {f.steps.length} step{f.steps.length === 1 ? '' : 's'} ·{' '}
                    {new Date(f.createdAt).toLocaleDateString()}
                  </div>
                  <div className="rec-flow-actions">
                    <button className="rec-mini" onClick={(e) => { e.stopPropagation(); renameFlow(f.id, f.name) }}>
                      Rename
                    </button>
                    <button className="rec-mini rec-mini-danger" onClick={(e) => { e.stopPropagation(); deleteFlow(f.id) }}>
                      Delete
                    </button>
                  </div>
                </div>
                {openFlow?.id === f.id && (
                  <ol className="rec-step-list rec-flow-steps">
                    {f.steps.map((s, i) => (
                      <li key={i} className={`rec-step rec-step-${s.kind}`}>
                        <span className="rec-step-idx">{i + 1}</span>
                        <span className="rec-step-label">
                          {s.label}
                          {s.paramName && <span className="rec-param-chip">{s.paramName}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <RecordingStyles />
    </div>
  )
}

function RecordingStyles() {
  return (
    <style>{`
      /* Bind to viewport minus the 54px Topbar so the step list scrolls
         inside its own pane instead of pushing the whole page taller.
         overflow:hidden makes us the scroll container for children. */
      .rec-shell { display: flex; flex-direction: column; height: calc(100vh - 54px); background: var(--bg); overflow: hidden; }
      .rec-start { padding: 24px 24px 12px; }
      .rec-start-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
      .rec-title { font-size: 18px; font-weight: 600; color: var(--ink); }
      .rec-sub { font-size: 12.5px; color: var(--ink-4); margin-top: 4px; max-width: 720px; line-height: 1.5; }
      .rec-start-row { display: flex; gap: 8px; align-items: center; }
      .rec-url-input {
        flex: 1; padding: 10px 12px; background: var(--panel); color: var(--ink);
        border: 1px solid var(--line); border-radius: 8px; outline: none; font-size: 13px;
      }
      .rec-url-input:focus { border-color: var(--accent); }
      .rec-btn {
        padding: 9px 14px; border-radius: 8px; border: 1px solid var(--line);
        background: var(--panel); color: var(--ink); cursor: pointer; font-size: 12.5px;
      }
      .rec-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .rec-btn-primary { background: var(--accent); color: #0E0F0C; border-color: var(--accent); font-weight: 600; }
      .rec-btn-ghost { background: transparent; }
      .rec-btn-stop { background: #d04848; color: #fff; border-color: #d04848; }
      .rec-error { margin-top: 10px; padding: 8px 10px; background: rgba(208,72,72,0.1); border: 1px solid #d04848; border-radius: 6px; color: #d04848; font-size: 12.5px; }

      .rec-library { padding: 0 24px 24px; flex: 1; overflow: auto; }
      .rec-library-head { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-4); margin: 18px 0 10px; }
      .rec-empty { padding: 24px; text-align: center; color: var(--ink-4); font-size: 13px; border: 1px dashed var(--line); border-radius: 8px; }

      .rec-flow-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .rec-flow { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
      .rec-flow.open { border-color: var(--accent-soft); }
      .rec-flow-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 10px 14px; cursor: pointer; }
      .rec-flow-name { font-size: 13.5px; color: var(--ink); font-weight: 500; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .rec-flow-purpose { font-size: 11.5px; color: var(--ink-4); margin-top: 3px; font-style: italic; }
      .rec-flow-meta { font-size: 11.5px; color: var(--ink-4); white-space: nowrap; }
      .rec-flow-actions { display: flex; gap: 4px; }
      .rec-mini { font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: var(--ink-3); cursor: pointer; }
      .rec-mini:hover { color: var(--ink); border-color: var(--ink-4); }
      .rec-mini-danger:hover { color: #d04848; border-color: #d04848; }
      .rec-flow-params { display: inline-flex; gap: 4px; }
      .rec-param-chip { font-size: 10.5px; padding: 1px 6px; background: var(--accent-soft); color: var(--accent); border-radius: 4px; }
      .rec-flow-steps { padding: 0 14px 12px 14px; border-top: 1px solid var(--line); }

      .rec-bar {
        display: flex; align-items: center; gap: 10px; padding: 10px 16px;
        background: var(--panel); border-bottom: 1px solid var(--line); font-size: 12.5px;
      }
      .rec-dot { width: 8px; height: 8px; border-radius: 50%; background: #d04848; animation: rec-pulse 1.4s infinite ease-in-out; }
      @keyframes rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      .rec-url { color: var(--ink-4); max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rec-spacer { flex: 1; }

      .rec-body { flex: 1; display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 0; }
      .rec-steps {
        overflow: auto; padding: 14px 12px; border-right: 1px solid var(--line);
        background: var(--bg); min-width: 0;
      }
      .rec-steps-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-4); margin-bottom: 10px; }
      .rec-step-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
      .rec-step { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; font-size: 12px; color: var(--ink-2); }
      .rec-step-idx { color: var(--ink-4); font-variant-numeric: tabular-nums; min-width: 18px; }
      .rec-step-label { flex: 1; line-height: 1.45; word-break: break-word; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .rec-step-navigate { border-left: 2px solid #4a8fd6; }
      .rec-step-click { border-left: 2px solid var(--accent); }
      .rec-step-fill { border-left: 2px solid #d6a23e; }
      .rec-step-press_key { border-left: 2px solid #9e9e9e; }
      .rec-step-wait_for { border-left: 2px solid #b56cd1; }

      .rec-browser { min-height: 0; min-width: 0; padding: 12px; overflow: hidden; }
      .rec-browser .pane { height: 100%; min-width: 0; }
      .rec-browser .browser { min-width: 0; }
      .rec-browser .br-url { min-width: 0; overflow: hidden; }
      .rec-browser .br-url-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .rec-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 9000; }
      .rec-modal { width: 540px; max-width: 92vw; max-height: 85vh; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; box-shadow: 0 18px 48px rgba(0,0,0,0.45); }
      .rec-modal-head { font-size: 15px; font-weight: 600; color: var(--ink); margin-bottom: 12px; }
      .rec-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
      .rec-field > span { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-4); display: flex; align-items: center; gap: 8px; }
      .rec-req { font-style: normal; font-size: 10px; color: var(--accent); border: 1px solid var(--accent-soft); padding: 1px 6px; border-radius: 4px; letter-spacing: 0.04em; }
      .rec-field input, .rec-field textarea {
        padding: 8px 10px; background: var(--bg); color: var(--ink);
        border: 1px solid var(--line); border-radius: 6px; outline: none;
        font-size: 13px; font-family: inherit; resize: vertical;
      }
      .rec-field input:focus, .rec-field textarea:focus { border-color: var(--accent); }
      .rec-hint { margin: 0 0 8px; font-size: 11.5px; color: var(--ink-4); line-height: 1.45; }
      .rec-params { display: flex; flex-direction: column; gap: 8px; }
      .rec-param-row { display: grid; grid-template-columns: 1fr 200px; gap: 12px; align-items: center; background: var(--bg); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line); }
      .rec-param-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .rec-param-line { display: flex; align-items: center; gap: 8px; }
      .rec-param-step { font-size: 10.5px; font-weight: 600; padding: 2px 6px; background: var(--panel); color: var(--ink-3); border-radius: 4px; border: 1px solid var(--line); white-space: nowrap; }
      .rec-param-field { font-size: 12.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rec-param-typed { font-size: 11.5px; color: var(--ink-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rec-param-val { color: var(--ink-2); font-style: italic; }
      .rec-param-input { padding: 7px 9px; border-radius: 5px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); font-size: 12px; outline: none; }
      .rec-param-input:focus { border-color: var(--accent); }
      .rec-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
    `}</style>
  )
}
