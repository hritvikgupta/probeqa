import { useState, useEffect } from 'react'

interface Props {
  open: boolean
  repos: string[]
  onClose: () => void
  /** Files the issue. Reject the promise to surface an error in the modal. */
  onSubmit: (repo: string, title: string, body: string) => Promise<void>
}

export default function FileTicketModal({ open, repos, onClose, onSubmit }: Props) {
  const [repo, setRepo] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default the repo to the first connected one whenever the modal opens.
  useEffect(() => {
    if (open) {
      setRepo((cur) => (cur && repos.includes(cur) ? cur : repos[0] ?? ''))
      setError(null)
    }
  }, [open, repos])

  const handleSubmit = async () => {
    if (!repo || !title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(repo, title.trim(), body)
      setTitle('')
      setBody('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file the ticket.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={`modal-scrim${open ? ' on' : ''}`} onClick={busy ? undefined : onClose} />
      <div className={`modal${open ? ' on' : ''}`} aria-hidden={!open}>
        <div className="modal-head">
          <div className="modal-title">File ticket on GitHub</div>
          <button className="dr-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <label>Repository</label>
            <select value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="modal-field">
            <label>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary of the issue"
            />
          </div>
          <div className="modal-field">
            <label>Description</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Steps to reproduce, expected vs. actual behaviour…"
            />
          </div>
          {error && (
            <div className="modal-field" style={{ color: 'var(--fail)', fontSize: 12 }}>{error}</div>
          )}
        </div>
        <div className="modal-foot">
          <div className="meta">
            <svg viewBox="0 0 24 24">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18.92-.26 1.9-.39 2.88-.39s1.96.13 2.88.39c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.08 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
            </svg>
            {repo || 'no repository'}
          </div>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn" onClick={handleSubmit} disabled={busy || !repo || !title.trim()}>
              {busy ? 'Filing…' : 'File ticket'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
