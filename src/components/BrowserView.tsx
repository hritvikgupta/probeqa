import { useEffect, useRef, useState } from 'react'

/**
 * Live view of the agent's real headless browser.
 *
 * Two modes:
 *   - Passive (default): polls /api/browser/frame and renders the JPEG.
 *     What the agent sees, the user sees.
 *   - Interactive (when `recordingId` is set): the same image, but every
 *     mouse/keyboard/scroll event is forwarded to the backend, which calls
 *     Playwright's page.mouse / page.keyboard / page.mouse.wheel to drive
 *     the live browser. The in-page capture script records the resulting
 *     DOM events as flow steps.
 *
 * The viewport on the server is 1280x800; we scale the user's click from
 * image-relative coordinates to that viewport before sending so the click
 * lands on the same pixel the user pressed.
 */
export default function BrowserView({
  chatId,
  recordingId,
}: {
  chatId: string
  /** When set, this pane is interactive — clicks/keys are forwarded to the live browser. */
  recordingId?: string
}) {
  const [frame, setFrame] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [live, setLive] = useState(false)
  const [focused, setFocused] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setFrame(null)
    setUrl('')
    setLive(false)

    let stopped = false

    // Push-based delivery via SSE — the server emits a frame whenever the
    // CDP screencast or the fallback poller has a new image. No client-side
    // wait; clicks during recording show their result as soon as the next
    // frame is encoded (~200ms for recording sessions).
    const es = new EventSource(`/api/browser/stream?chatId=${encodeURIComponent(chatId)}`)
    es.onopen = () => {
      if (!stopped) setLive(true)
    }
    es.onmessage = (ev) => {
      if (stopped) return
      try {
        const d = JSON.parse(ev.data) as { url?: string; frame?: string }
        if (d.frame) setFrame(d.frame)
        if (d.url) setUrl(d.url)
      } catch {
        /* ignore malformed payload */
      }
    }
    es.onerror = () => {
      if (!stopped) setLive(false)
    }

    // Belt-and-suspenders fallback: occasional poll in case SSE silently
    // hangs (some proxies / VPNs buffer EventSource). 1.5s is fine because
    // it's only filling gaps the SSE stream missed.
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
        /* SSE will surface the offline state */
      } finally {
        inFlight = false
      }
    }
    poll()
    const fallbackId = setInterval(poll, 1500)

    return () => {
      stopped = true
      es.close()
      clearInterval(fallbackId)
    }
  }, [chatId, recordingId])

  // ---- coordinate scaling helpers (interactive mode only) ----
  // The image is rendered with object-fit:contain inside a flex box, so the
  // image's drawn area may be smaller than the <img>'s bounding box (letterbox
  // black bars on either side). We compute the actual drawn rect and scale
  // pointer coords from there to the 1280x800 server viewport.
  function eventToViewport(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const img = imgRef.current
    if (!img || !img.naturalWidth) return null
    const rect = img.getBoundingClientRect()
    // naturalWidth/Height = 1280/800 (server viewport). Compute the actual
    // drawn area inside the <img> element after object-fit:contain.
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
    const drawnW = img.naturalWidth * scale
    const drawnH = img.naturalHeight * scale
    const offsetX = rect.left + (rect.width - drawnW) / 2
    const offsetY = rect.top + (rect.height - drawnH) / 2
    const px = e.clientX - offsetX
    const py = e.clientY - offsetY
    if (px < 0 || py < 0 || px > drawnW || py > drawnH) return null
    return { x: Math.round(px / scale), y: Math.round(py / scale) }
  }

  // ---- event forwarders ----
  async function forwardClick(e: React.MouseEvent) {
    if (!recordingId) return
    const pt = eventToViewport(e)
    if (!pt) return
    await fetch(`/api/recording/${recordingId}/mouse`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: pt.x, y: pt.y, action: 'click' }),
    }).catch(() => {})
  }

  // Wheel events fire 60+/sec while actively scrolling. We:
  //   1. Accumulate deltas in a ref instead of sending each event.
  //   2. Keep only ONE wheel request in flight at a time — when it
  //      resolves, drain whatever accumulated during its round trip.
  // This eliminates parallel-fired wheel requests racing each other on
  // the server (which was causing massive scroll jumps and mid-paint
  // screenshots), without dropping any user intent.
  const wheelAccum = useRef({ dx: 0, dy: 0, inFlight: false })
  useEffect(() => {
    if (!recordingId) return
    const el = wrapperRef.current
    if (!el) return
    const drain = async () => {
      if (wheelAccum.current.inFlight) return
      while (wheelAccum.current.dx !== 0 || wheelAccum.current.dy !== 0) {
        const dx = wheelAccum.current.dx
        const dy = wheelAccum.current.dy
        wheelAccum.current.dx = 0
        wheelAccum.current.dy = 0
        wheelAccum.current.inFlight = true
        try {
          await fetch(`/api/recording/${recordingId}/scroll`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deltaX: dx, deltaY: dy }),
          })
        } catch {
          /* network blip — drop this batch, next wheel event will retry */
        }
        wheelAccum.current.inFlight = false
      }
    }
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      wheelAccum.current.dx += e.deltaX
      wheelAccum.current.dy += e.deltaY
      void drain()
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [recordingId])

  // Keyboard — only forward when the pane has focus, to avoid stealing keys
  // from the rest of the React UI (e.g. the URL bar above). Single non-text
  // keys go via { key }; printable characters use { text } so dead keys and
  // composition work correctly.
  useEffect(() => {
    if (!recordingId || !focused) return
    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Don't intercept keys destined for our own modal inputs.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      // For modifier-only events skip — Playwright handles the modifier via
      // the modifiers field when a real key fires alongside.
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return

      const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      e.preventDefault()
      let payload: Record<string, unknown>
      if (isPrintable) {
        payload = { text: e.key }
      } else {
        // Build a Playwright-style key string with modifiers.
        const parts: string[] = []
        if (e.ctrlKey) parts.push('Control')
        if (e.metaKey) parts.push('Meta')
        if (e.altKey) parts.push('Alt')
        if (e.shiftKey) parts.push('Shift')
        parts.push(e.key)
        payload = { key: parts.join('+') }
      }
      await fetch(`/api/recording/${recordingId}/key`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [recordingId, focused])

  const isInteractive = !!recordingId

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
            {isInteractive ? (focused ? '● interactive' : 'click to type') : frame ? '● live' : live ? 'connected' : 'offline'}
          </div>
        </div>

        <div
          ref={wrapperRef}
          className="br-stage"
          tabIndex={isInteractive ? 0 : -1}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={(e) => {
            if (isInteractive) {
              // Make sure the pane is focused so subsequent keystrokes are forwarded.
              wrapperRef.current?.focus()
              forwardClick(e)
            }
          }}
          style={{
            background: '#101010',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isInteractive ? (focused ? 'crosshair' : 'pointer') : 'default',
            outline: isInteractive && focused ? '2px solid var(--accent-soft)' : 'none',
            outlineOffset: '-2px',
          }}
        >
          {frame ? (
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${frame}`}
              alt="agent browser"
              draggable={false}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none' }}
            />
          ) : (
            <div style={{ color: 'var(--ink-4)', fontSize: 12.5, textAlign: 'center', padding: 24, lineHeight: 1.6 }}>
              {isInteractive
                ? 'Loading live browser…'
                : <>The agent's live browser appears here.<br />Ask it to open a page on the left.</>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
