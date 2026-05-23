import { useEffect, useState } from 'react'

/**
 * Live view of the agent's real headless browser. Polls the server for a
 * fresh screenshot of the page (~every 800ms) and renders it — so you watch
 * the agent navigate, click and type for real. Polling is used instead of a
 * CDP screencast because the screencast emits nothing reliably in headless.
 */
export default function BrowserView({ chatId }: { chatId: string }) {
  const [frame, setFrame] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [live, setLive] = useState(false)

  useEffect(() => {
    setFrame(null)
    setUrl('')
    setLive(false)

    let stopped = false
    let inFlight = false

    async function poll() {
      if (stopped || inFlight) return
      inFlight = true
      try {
        const r = await fetch(`/api/browser/frame?chatId=${encodeURIComponent(chatId)}`)
        if (r.ok) {
          const d = (await r.json()) as { url?: string; frame?: string }
          if (!stopped) {
            setLive(true)
            if (d.frame) setFrame(d.frame)
            if (d.url) setUrl(d.url)
          }
        }
      } catch {
        if (!stopped) setLive(false)
      } finally {
        inFlight = false
      }
    }

    poll()
    const id = setInterval(poll, 800)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [chatId])

  return (
    <div className="pane">
      <div className="browser">
        <div className="br-chrome">
          <div className="br-btns">
            <span />
            <span />
            <span />
          </div>
          <div className="br-url">
            <svg viewBox="0 0 24 24">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span className="br-url-text">{url || 'about:blank'}</span>
          </div>
          <div
            className="br-viewport-pill"
            style={{
              color: frame ? 'var(--accent)' : 'var(--ink-4)',
              borderColor: frame ? 'var(--accent-soft)' : 'var(--line)',
            }}
          >
            {frame ? '● live' : live ? 'connected' : 'offline'}
          </div>
        </div>

        <div
          className="br-stage"
          style={{
            background: '#101010',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {frame ? (
            <img
              src={`data:image/jpeg;base64,${frame}`}
              alt="agent browser"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div style={{ color: 'var(--ink-4)', fontSize: 12.5, textAlign: 'center', padding: 24, lineHeight: 1.6 }}>
              The agent's live browser appears here.
              <br />
              Ask it to open a page on the left.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
