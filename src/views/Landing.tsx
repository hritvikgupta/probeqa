import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SiGithub, SiSlack, SiNotion, SiGooglesheets, SiGmail, SiLinear, SiGooglecalendar } from 'react-icons/si'
import { FaLinkedinIn, FaXTwitter, FaInstagram } from 'react-icons/fa6'
import showcaseBg from '../assets/showcase-bg.jpg'
import showcaseVid from '../assets/showcase.mp4'
import spot1 from '../assets/spot-1.jpg'
import spot2 from '../assets/spot-2.jpg'
import spot3 from '../assets/spot-3.jpg'
import emailReport from '../assets/email-report.jpg'
import githubIssue from '../assets/github-issue.jpg'
import './Landing.css'

type Pt = { x: number; y: number }

/** Marketing landing page — a faithful React port of the voxel HTML mockup. */
export default function Landing() {
  const navigate = useNavigate()
  const [announce, setAnnounce] = useState(true)
  const [typed, setTyped] = useState('')
  const [heroPrompt, setHeroPrompt] = useState('')

  const heroCanvasRef = useRef<HTMLCanvasElement>(null)
  const nrCanvasRef = useRef<HTMLCanvasElement>(null)
  const cardsRef = useRef<(HTMLDivElement | null)[]>([])
  const dotsRef = useRef<(HTMLSpanElement | null)[]>([])

  /* ============ Hero canvas: fan-out flow animation ============ */
  useEffect(() => {
    const cv = heroCanvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    let W = 0
    let H = 0
    const hub: Pt = { x: 0, y: 0 }
    let paths: any[] = []

    const DESTS = [
      { label: 'checkout', value: '+12 bugs' },
      { label: 'signup', value: '+8 bugs' },
      { label: 'api.v1.orders', value: '+5 bugs' },
      { label: 'password-reset', value: '+3 bugs' },
      { label: 'mobile-webview', value: '+7 bugs' },
      { label: 'cart', value: '+9 bugs' },
      { label: 'billing', value: '+11 bugs' },
      { label: 'settings', value: '+2 bugs' },
    ]
    const palette = [
      'rgba(120,90,55,A)',
      'rgba(60,75,95,A)',
      'rgba(90,90,80,A)',
      'rgba(60,60,55,A)',
      'rgba(140,110,75,A)',
      'rgba(100,100,90,A)',
    ]
    let particles: any[] = []

    function resize() {
      const r = cv!.getBoundingClientRect()
      W = r.width
      H = r.height
      cv!.width = Math.floor(W * dpr)
      cv!.height = Math.floor(H * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx!.font = '12px "JetBrains Mono", ui-monospace, monospace'
      let maxW = 0
      for (let j = 0; j < DESTS.length; j++) {
        const w =
          ctx!.measureText(' ' + DESTS[j].label + ' ').width +
          ctx!.measureText(DESTS[j].value + ' ').width +
          18
        if (w > maxW) maxW = w
      }

      // Keep the whole flow inside the centred 1116px content column so the
      // destination pills and tails sit comfortably inside the grid rails.
      const contentW = Math.min(1116, W)
      const colLeft = (W - contentW) / 2
      const colRight = colLeft + contentW

      const rightMargin = 14
      const tailLen = 22
      const pillEndX = colRight - rightMargin - tailLen
      const pillStartX = pillEndX - maxW
      const curveEndX = pillStartX - 8

      hub.x = Math.max(colLeft + 60, Math.min(colLeft + contentW * 0.44, curveEndX - 240))
      hub.y = H * 0.5

      const top = H * 0.1
      const bot = H * 0.92
      const n = DESTS.length
      paths = DESTS.map((d, i) => {
        const t = (i + 0.5) / n
        const endY = top + (bot - top) * t
        const dx = curveEndX - hub.x
        const c1 = { x: hub.x + dx * 0.45, y: hub.y }
        const c2 = { x: curveEndX - dx * 0.3, y: endY }
        return {
          label: d.label,
          value: d.value,
          p0: { x: hub.x, y: hub.y },
          p1: c1,
          p2: c2,
          p3: { x: curveEndX, y: endY },
          pillX: pillStartX,
          pillW: maxW,
          pillY: endY,
          tailEndX: pillEndX + tailLen,
        }
      })
    }
    resize()
    window.addEventListener('resize', resize)

    function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
      const mt = 1 - t
      return {
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
      }
    }

    function spawn() {
      const pi = (Math.random() * paths.length) | 0
      particles.push({
        path: pi,
        t: 0,
        speed: 0.0025 + Math.random() * 0.0035,
        size: 1.5 + Math.random() * 2,
        color: palette[(Math.random() * palette.length) | 0],
        life: 0,
      })
    }

    for (let k = 0; k < paths.length * 3; k++) {
      spawn()
      const p = particles[particles.length - 1]
      p.t = Math.random()
    }

    function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      c.beginPath()
      c.moveTo(x + r, y)
      c.arcTo(x + w, y, x + w, y + h, r)
      c.arcTo(x + w, y + h, x, y + h, r)
      c.arcTo(x, y + h, x, y, r)
      c.arcTo(x, y, x + w, y, r)
      c.closePath()
    }

    function drawPaths() {
      ctx!.save()
      ctx!.strokeStyle = 'rgba(80,75,60,0.30)'
      ctx!.lineWidth = 1
      ctx!.setLineDash([2.5, 5])
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i]
        ctx!.beginPath()
        ctx!.moveTo(p.p0.x, p.p0.y)
        ctx!.bezierCurveTo(p.p1.x, p.p1.y, p.p2.x, p.p2.y, p.p3.x, p.p3.y)
        ctx!.stroke()
      }
      ctx!.restore()
    }

    function drawLabels() {
      ctx!.save()
      ctx!.font = '12px "JetBrains Mono", ui-monospace, monospace'
      ctx!.textBaseline = 'middle'
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i]
        const label = ' ' + p.label + ' '
        const lw = ctx!.measureText(label).width
        const h = 26
        const bx = p.pillX
        const by = p.pillY - h / 2

        ctx!.fillStyle = 'rgba(255,255,255,0.85)'
        ctx!.strokeStyle = 'rgba(80,75,60,0.40)'
        ctx!.lineWidth = 1
        roundRect(ctx!, bx, by, p.pillW, h, 4)
        ctx!.fill()
        ctx!.stroke()

        ctx!.save()
        ctx!.setLineDash([2.5, 5])
        ctx!.strokeStyle = 'rgba(80,75,60,0.30)'
        ctx!.beginPath()
        ctx!.moveTo(bx + p.pillW, p.pillY)
        ctx!.lineTo(p.tailEndX, p.pillY)
        ctx!.stroke()
        ctx!.restore()

        ctx!.fillStyle = 'rgba(40,40,35,0.95)'
        ctx!.fillText(label, bx + 4, p.pillY + 0.5)
        ctx!.fillStyle = 'rgba(196,52,40,0.95)'
        ctx!.fillText(p.value, bx + 4 + lw + 6, p.pillY + 0.5)
      }
      ctx!.restore()
    }

    let raf = 0
    function tick() {
      // Clear each frame so the hero shares the page background.
      ctx!.clearRect(0, 0, W, H)

      drawPaths()
      drawLabels()

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.t += p.speed
        p.life += 1
        if (p.t >= 1) {
          particles.splice(i, 1)
          continue
        }
        const path = paths[p.path]
        if (!path) {
          particles.splice(i, 1)
          continue
        }
        const pt = bezier(path.p0, path.p1, path.p2, path.p3, p.t)
        const alpha = Math.min(1, p.life / 8) * Math.min(1, (1 - p.t) * 1.3 + 0.6)
        ctx!.fillStyle = p.color.replace('A', alpha.toFixed(3))
        ctx!.beginPath()
        ctx!.arc(pt.x, pt.y, p.size, 0, Math.PI * 2)
        ctx!.fill()
      }

      const target = paths.length * 5
      const deficit = target - particles.length
      for (let s = 0; s < deficit; s++) spawn()

      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  /* ============ Narrative canvas: drifting voxel-tinted particles ============ */
  useEffect(() => {
    const cv = nrCanvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    let W = 0
    let H = 0
    let particles: any[] = []
    const palette = [
      'rgba(120,90,55,A)',
      'rgba(90,90,80,A)',
      'rgba(60,75,95,A)',
      'rgba(140,110,75,A)',
      'rgba(60,60,55,A)',
      'rgba(100,100,90,A)',
    ]

    function spawn(initial: boolean) {
      const bias = Math.random()
      const x = W * (0.3 + 0.7 * Math.pow(bias, 0.7))
      const y = H * (0.1 + 0.8 * Math.random())
      return {
        x,
        y,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.18 - 0.04,
        size: 0.7 + Math.random() * 1.5,
        color: palette[(Math.random() * palette.length) | 0],
        life: initial ? Math.random() * 240 : 0,
        max: 200 + Math.random() * 260,
      }
    }

    function resize() {
      const r = cv!.getBoundingClientRect()
      W = r.width
      H = r.height
      cv!.width = Math.floor(W * dpr)
      cv!.height = Math.floor(H * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      const target = Math.max(140, Math.min(360, Math.floor((W * H) / 4500)))
      particles = []
      for (let i = 0; i < target; i++) particles.push(spawn(true))
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    function tick() {
      ctx!.fillStyle = 'rgba(244,242,234,0.18)'
      ctx!.fillRect(0, 0, W, H)
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        p.life++
        if (p.life > p.max || p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
          particles[i] = spawn(false)
          continue
        }
        const fade = Math.min(1, p.life / 30) * Math.min(1, (p.max - p.life) / 60)
        ctx!.fillStyle = p.color.replace('A', (fade * 0.85).toFixed(3))
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx!.fill()
      }
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  /* ============ Typer animation for the prompt spotlight ============ */
  useEffect(() => {
    const full =
      'Test the checkout flow on shop.acme.com. Focus on payment edge cases — expired cards, declined cards, malformed CVCs, and slow networks across mobile and desktop.'
    let i = 0
    let typing = true
    let pauseAt = 0
    const id = setInterval(() => {
      if (typing) {
        i++
        if (i >= full.length) {
          typing = false
          pauseAt = performance.now()
        }
      } else if (performance.now() - pauseAt > 5000) {
        i = 0
        typing = true
      }
      setTyped(full.slice(0, i))
    }, 32)
    return () => clearInterval(id)
  }, [])

  /* ============ Typer animation for the hero prompt box ============ */
  useEffect(() => {
    const prompts = [
      'Test the checkout flow on shop.acme.com',
      'Verify a user can sign up and log in',
      'Check the API returns 200 for valid requests',
      'Find regressions in the mobile nav menu',
    ]
    let p = 0
    let i = 0
    let typing = true
    let pauseAt = 0
    const id = setInterval(() => {
      const full = prompts[p]
      if (typing) {
        i++
        if (i >= full.length) {
          typing = false
          pauseAt = performance.now()
        }
      } else if (performance.now() - pauseAt > 1800) {
        i--
        if (i <= 0) {
          typing = true
          p = (p + 1) % prompts.length
        }
      }
      setHeroPrompt(prompts[p].slice(0, Math.max(0, i)))
    }, 45)
    return () => clearInterval(id)
  }, [])

  /* ============ Step 04: cycling bug cards ============ */
  useEffect(() => {
    const cards = cardsRef.current.filter(Boolean) as HTMLDivElement[]
    const dots = dotsRef.current.filter(Boolean) as HTMLSpanElement[]
    if (!cards.length) return
    let idx = 0
    let timeout = 0

    function show(i: number) {
      cards.forEach((c) => c.classList.remove('is-active', 'is-exit'))
      cards[i].classList.add('is-active')
      dots.forEach((d, j) => d.classList.toggle('is-active', j === i))
    }
    function next() {
      cards[idx].classList.remove('is-active')
      cards[idx].classList.add('is-exit')
      idx = (idx + 1) % cards.length
      timeout = window.setTimeout(() => {
        cards.forEach((c) => c.classList.remove('is-exit'))
        show(idx)
      }, 380)
    }
    show(0)
    const interval = setInterval(next, 3600)
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [])

  const CARDS = [
    { kind: 'pass', title: 'Checkout page', body: 'Stripe payment elements render and form submission completes without errors.' },
    { kind: 'fail', title: 'Mobile navigation', body: 'Hamburger menu overlay stays open when navigating between routes on mobile.' },
    { kind: 'fail', title: 'Broken link', body: 'Footer link to /pricing/annual returns 404 instead of the expected 200 response.' },
    { kind: 'pass', title: 'Auth & sessions', body: 'Login, refresh-token rotation and logout all complete inside 800 ms across regions.' },
    { kind: 'run', title: 'Search index', body: 'Re-running full-text search across 12k product SKUs to validate ranking changes.' },
    { kind: 'fail', title: 'Locale: de-DE', body: 'Tax line on the order summary renders as "NaN €" when cart contains a digital item.' },
  ]

  const arrow = (
    <svg className="arrow" viewBox="0 0 24 24">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="9 7 17 7 17 15" />
    </svg>
  )
  /** Smooth-scroll to a section by id. */
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="lp">
      {announce && (
        <div className="announce">
          <span className="tag">NEW</span>
          <span>Probe 2.0 — agents now file Linear tickets automatically.</span>
          <a onClick={() => navigate('/blog/announcing-probe-2')} style={{ cursor: 'pointer' }}>
            View changelog
          </a>
          <button className="announce-x" aria-label="Dismiss" onClick={() => setAnnounce(false)}>
            ×
          </button>
        </div>
      )}

      <header className="nav">
        <div className="nav-inner">
        <a className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <span className="brand-cube">
            <svg viewBox="0 0 24 24" shapeRendering="crispEdges">
              <polygon points="12,2 22,7 12,12 2,7" fill="#A8A8A8" />
              <polygon points="12,2 22,7 12,12 2,7" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
              <polygon points="2,7 12,12 12,22 2,17" fill="#545454" />
              <polygon points="2,7 12,12 12,22 2,17" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
              <polygon points="22,7 12,12 12,22 22,17" fill="#3A3A3A" />
              <polygon points="22,7 12,12 12,22 22,17" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
            </svg>
          </span>
          Probe
        </a>
        <nav className="menu">
          <a onClick={() => scrollTo('how')} style={{ cursor: 'pointer' }}>How it works</a>
          <a onClick={() => scrollTo('demo')} style={{ cursor: 'pointer' }}>Demo</a>
          <a onClick={() => scrollTo('features')} style={{ cursor: 'pointer' }}>Features</a>
          <a onClick={() => scrollTo('integrations')} style={{ cursor: 'pointer' }}>Integrations</a>
          <a onClick={() => scrollTo('pricing')} style={{ cursor: 'pointer' }}>Pricing</a>
          <a onClick={() => navigate('/blog')} style={{ cursor: 'pointer' }}>Blog</a>
          <a onClick={() => navigate('/docs')} style={{ cursor: 'pointer' }}>Docs</a>
        </nav>
        <div className="nav-spacer" />
        <div className="nav-right">
          <button className="icon-btn" aria-label="Search">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.6" y2="16.6" />
            </svg>
          </button>
          <a className="btn-text" href="/login">
            Log in
          </a>
          <a className="btn-pixel" href="/signup">
            Sign up
            {arrow}
          </a>
        </div>
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="hero">
        <div className="hero-stage">
          <canvas className="hero-canvas" ref={heroCanvasRef} aria-hidden="true" />

          <div className="hero-content">
            <div className="hero-left">
              <div className="hero-text">
                <h1 className="hero-h">
                  One agent for all QA.
                  <span className="soft">We test while you ship.</span>
                </h1>
                <p className="hero-sub">
                  Autonomous agents test your web, mobile and APIs end-to-end. Find regressions in hours,
                  not weeks. No scripts to maintain.
                </p>
                <div className="hero-ctas">
                  <a className="hero-btn-dark" href="/signup">
                    Get started
                    {arrow}
                  </a>
                  <a className="hero-btn-ghost" onClick={() => navigate('/docs')} style={{ cursor: 'pointer' }}>
                    API docs
                    {arrow}
                  </a>
                </div>
              </div>

              <div className="hero-prompt">
                <div className="hero-prompt-body">
                  {heroPrompt}
                  <span className="hero-prompt-caret" />
                </div>
                <div className="hero-prompt-foot">
                  <span className="hp-pill hp-pill-agent">
                    <span className="hp-pill-ic">∞</span> Agent
                  </span>
                  <span className="hp-pill">Auto ▾</span>
                  <span className="hp-spacer" />
                  <span className="hp-ic">@</span>
                  <span className="hp-ic">◷</span>
                  <span className="hp-ic">▦</span>
                  <span className="hp-mic">🎤</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TECH STACK ============ */}
      <section className="stack" id="integrations">
        <div className="stack-inner">
          <h2 className="stack-h">
            Connects to the tools <span className="soft">you already use.</span>
          </h2>
          <div className="stack-row">
            {[
              { label: 'GitHub', Icon: SiGithub },
              { label: 'Slack', Icon: SiSlack },
              { label: 'Notion', Icon: SiNotion },
              { label: 'Google Sheets', Icon: SiGooglesheets },
              { label: 'Gmail', Icon: SiGmail },
              { label: 'Linear', Icon: SiLinear },
              { label: 'Google Calendar', Icon: SiGooglecalendar },
            ].map(({ label, Icon }) => (
              <div className="stack-item" key={label}>
                <Icon />
                <span className="sl">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ SHOWCASE VIDEO ============ */}
      <section className="showcase" id="demo" style={{ backgroundImage: `url(${showcaseBg})` }}>
        <video
          className="showcase-video"
          src={showcaseVid}
          autoPlay
          muted
          loop
          playsInline
        />
      </section>

      {/* ============ FLOW ============ */}
      <section className="flow" id="how">
        <h2>
          <span className="ink">Plan</span>
          <svg className="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          <span className="ink">Drive</span>
          <svg className="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          <span className="ink">Observe</span>
          <svg className="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          <span className="ink">File.</span>
        </h2>
        <p className="flow-sub">
          Four layers between your intent and a closed ticket. The planner picks the path, the agent
          drives the surface, and the observer catches everything in between.
        </p>
        <a className="btn-pixel flow-cta" href="/signup">
          Explore the platform
          {arrow}
        </a>

        {/* ============ FLOW SPOTLIGHTS ============ */}
        <div className="spotlights">
          {/* Spotlight 1: Prompt */}
          <div className="spot">
            <div className="spot-text">
              <div className="spot-eyebrow">Step 01 · Intent</div>
              <h3 className="spot-h">Describe what to test in plain English.</h3>
              <p className="spot-body">
                No selectors, no fixtures, no DSL. Type a sentence about the surface you care about —
                Probe expands it into a full suite of edge cases across data, locale and device.
              </p>            </div>
            <div className="spot-visual" style={{ backgroundImage: `url(${spot1})` }}>
              <div className="sv-prompt">
                <div className="sv-prompt-head">
                  <span className="d" />
                  <span>New test intent</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>⌘↵ run</span>
                </div>
                <div className="sv-prompt-body">
                  {typed}
                  <span className="sv-caret" />
                </div>
                <div className="sv-prompt-foot">
                  <button className="sv-chip">+ Attach repo</button>
                  <button className="sv-chip">+ Auth</button>
                  <button className="sv-chip">+ Locale: de-DE</button>
                  <button className="sv-chip">+ Device: iPhone 14</button>
                </div>
              </div>
            </div>
          </div>

          {/* Spotlight 2: Generated test cases */}
          <div className="spot">
            <div className="spot-text">
              <div className="spot-eyebrow">Step 02 · Plan</div>
              <h3 className="spot-h">Probe drafts your test cases.</h3>
              <p className="spot-body">
                From one intent, the planner enumerates every meaningful variation — happy path,
                validation errors, race conditions, locale quirks. Approve, edit, or let it run.
              </p>            </div>
            <div className="spot-visual" style={{ backgroundImage: `url(${spot2})` }}>
              <div className="sv-plan">
                {[
                  ['tag-nav', 'NAVIGATE', 'Navigate to /checkout'],
                  ['tag-screen', 'SCREENSHOT', 'Capture checkout before payment'],
                  ['tag-act', 'ACT', 'Fill card 4242 4242 4242 4242'],
                  ['tag-act', 'ACT', 'Enter 4-digit CVC 1234'],
                  ['tag-act', 'ACT', 'Submit the payment form'],
                  ['tag-assert', 'ASSERT', 'Verify server returns 200, not 500'],
                  ['tag-screen', 'SCREENSHOT', 'Capture final confirmation state'],
                ].map(([tag, label, text], i) => (
                  <div className="plan-step" key={i}>
                    <span className={`plan-tag ${tag}`}>{label}</span>
                    <span className="plan-text">{text}</span>
                    <button className="plan-x" aria-label="Remove">
                      <svg viewBox="0 0 24 24">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button className="plan-add">+ Add step</button>
              </div>
            </div>
          </div>

          {/* Spotlight 3: Drive — execute the plan */}
          <div className="spot">
            <div className="spot-text">
              <div className="spot-eyebrow">Step 03 · Drive</div>
              <h3 className="spot-h">Probe drives every page itself.</h3>
              <p className="spot-body">
                The agent opens each surface and performs exactly what you planned in Step 02 —
                navigating, clicking and typing like a real user — recording the result of every
                step as it goes.
              </p>            </div>
            <div className="spot-visual" style={{ backgroundImage: `url(${spot3})` }}>
              <div className="sv-cases">
                <div className="sv-cases-head">Running · checkout flow</div>
                {[
                  ['ok', 'Navigate to /checkout', '0.4s'],
                  ['ok', 'Capture checkout before payment', '0.2s'],
                  ['ok', 'Fill card 4242 4242 4242 4242', '0.6s'],
                  ['ok', 'Enter 4-digit CVC 1234', '0.3s'],
                  ['ok', 'Submit the payment form', '0.5s'],
                  ['run', 'Verify server returns 200, not 500', 'running'],
                ].map(([mark, label, meta], i) => (
                  <div className="sv-case" key={i}>
                    <span className={`mark ${mark}`} />
                    <span className="label">{label}</span>
                    <span className="meta">{meta}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Spotlight 4: Auto-filed ticket */}
          <div className="spot">
            <div className="spot-text">
              <div className="spot-eyebrow">Step 04 · File</div>
              <h3 className="spot-h">Every bug ships ready to fix.</h3>
              <p className="spot-body">
                When something breaks, Probe writes the full ticket for you — a clear title, how
                serious it is, the exact steps to reproduce it, and screenshots of what went wrong.
                It lands in GitHub, Linear or Jira before standup, so your team can fix it instead
                of chasing it.
              </p>            </div>
            <div className="spot-visual" style={{ backgroundImage: `url(${showcaseBg})` }}>
              <div className="sv-scene" aria-hidden="true">
                <div className="bug-stack">
                  {CARDS.map((c, i) => (
                    <div className="bug-card" key={i} ref={(el) => { cardsRef.current[i] = el }}>
                      <span className={`bug-badge ${c.kind}`}>
                        {c.kind === 'run' ? 'RUN' : c.kind.toUpperCase()}
                      </span>
                      <span className="bug-text">
                        <span className="bug-title">{c.title}</span>
                        <span className="bug-body">{c.body}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="scene-dots">
                  {CARDS.map((_, i) => (
                    <span className="sd" key={i} ref={(el) => { dotsRef.current[i] = el }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ HANDOFF — emails the report, files the GitHub issue ============ */}
      <section className="handoff">
        <div className="handoff-inner">
          <div className="handoff-head">
            <h2 className="handoff-h">
              Chat with the agent over email. <span className="soft">It files the GitHub issue.</span>
            </h2>
            <p className="handoff-sub">
              Email the agent in plain English — ask it to test a flow, kick off a run, or check on
              results, and it replies right in the thread. When it finds a bug, it opens a complete,
              reproducible ticket on GitHub for you.
            </p>
          </div>

          <div className="handoff-grid">
            <div className="handoff-card">
              <div className="handoff-card-head">
                <SiGmail />
                <div>
                  <div className="hc-title">Chat with it in your inbox</div>
                  <div className="hc-sub">Ask, run, and get answers — all in the thread</div>
                </div>
              </div>
              <div className="handoff-shot">
                <img src={emailReport} alt="Probe email agent test run summary" />
              </div>
            </div>

            <div className="handoff-card">
              <div className="handoff-card-head">
                <SiGithub />
                <div>
                  <div className="hc-title">Files &amp; resolves on GitHub</div>
                  <div className="hc-sub">A ready-to-fix ticket, opened automatically</div>
                </div>
              </div>
              <div className="handoff-shot">
                <img src={githubIssue} alt="GitHub issue opened by the Probe agent" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FEATURES ============ */}
      <section className="features" id="features">
        <div className="feat-grid">
          <div className="feat">
            <div className="feat-head">
              <div>
                <div className="feat-eyebrow">All surfaces</div>
                <h3 className="feat-h">Every endpoint</h3>
              </div>
              <div className="feat-art">
                <svg viewBox="0 0 80 80" shapeRendering="crispEdges">
                  <polygon points="40,8 72,24 40,40 8,24" fill="#A8A8A8" />
                  <polygon points="40,8 72,24 40,40 8,24" fill="none" stroke="#0E0F0C" strokeWidth="1" />
                  <polygon points="8,24 40,40 40,72 8,56" fill="#7A5230" />
                  <polygon points="8,24 40,40 40,72 8,56" fill="none" stroke="#0E0F0C" strokeWidth="1" />
                  <polygon points="72,24 40,40 40,72 72,56" fill="#5A3A1F" />
                  <polygon points="72,24 40,40 40,72 72,56" fill="none" stroke="#0E0F0C" strokeWidth="1" />
                  <polygon points="8,24 40,40 40,46 8,30" fill="#6E6E6E" />
                  <polygon points="72,24 40,40 40,46 72,30" fill="#5A5A5A" />
                </svg>
              </div>
            </div>
            <p className="feat-body">
              One config covers your web app, mobile webview, public API and webhooks. Agents adapt to
              the surface — no separate framework per target.
            </p>
            <div className="feat-spacer" />
            <div className="feat-bullets">
              <div className="bullet">No selectors, no fixtures</div>
              <div className="bullet">Auto-discovers new routes</div>
              <div className="bullet">Web · API · Mobile · Webhooks</div>
            </div>
          </div>

          <div className="feat">
            <div className="feat-head">
              <div>
                <div className="feat-eyebrow">Engineered for</div>
                <h3 className="feat-h">Real coverage</h3>
              </div>
              <div className="feat-art">
                <svg viewBox="0 0 80 80" shapeRendering="crispEdges">
                  <polygon points="10,52 26,60 26,76 10,68" fill="#7A5230" />
                  <polygon points="10,52 26,60 26,76 10,68" fill="none" stroke="#0E0F0C" />
                  <polygon points="10,52 26,44 42,52 26,60" fill="#A8A8A8" />
                  <polygon points="10,52 26,44 42,52 26,60" fill="none" stroke="#0E0F0C" />
                  <polygon points="42,52 26,60 26,76 42,68" fill="#5A3A1F" />
                  <polygon points="42,52 26,60 26,76 42,68" fill="none" stroke="#0E0F0C" />
                  <polygon points="26,36 42,44 42,60 26,52" fill="#7A5230" />
                  <polygon points="26,36 42,44 42,60 26,52" fill="none" stroke="#0E0F0C" />
                  <polygon points="26,36 42,28 58,36 42,44" fill="#A8A8A8" />
                  <polygon points="26,36 42,28 58,36 42,44" fill="none" stroke="#0E0F0C" />
                  <polygon points="58,36 42,44 42,60 58,52" fill="#5A3A1F" />
                  <polygon points="58,36 42,44 42,60 58,52" fill="none" stroke="#0E0F0C" />
                  <polygon points="42,20 58,28 58,44 42,36" fill="#7A5230" />
                  <polygon points="42,20 58,28 58,44 42,36" fill="none" stroke="#0E0F0C" />
                  <polygon points="42,20 58,12 74,20 58,28" fill="#A8A8A8" />
                  <polygon points="42,20 58,12 74,20 58,28" fill="none" stroke="#0E0F0C" />
                  <polygon points="74,20 58,28 58,44 74,36" fill="#5A3A1F" />
                  <polygon points="74,20 58,28 58,44 74,36" fill="none" stroke="#0E0F0C" />
                </svg>
              </div>
            </div>
            <p className="feat-body">
              Agents explore the long tail your hand-written tests miss — empty carts, malformed
              inputs, slow connections, weird locales.
            </p>
            <div className="feat-spacer" />
            <div className="feat-bullets">
              <div className="bullet">10× more edge cases per run</div>
              <div className="bullet">Reproducible repros, every time</div>
              <div className="bullet">Pay per run, no seats</div>
            </div>
          </div>

          <div className="feat">
            <div className="feat-head">
              <div>
                <div className="feat-eyebrow">Built for</div>
                <h3 className="feat-h">Your stack</h3>
              </div>
              <div className="feat-art">
                <svg viewBox="0 0 80 80" shapeRendering="crispEdges">
                  <polygon points="22,16 36,22 22,28 8,22" fill="#A8A8A8" />
                  <polygon points="22,16 36,22 22,28 8,22" fill="none" stroke="#0E0F0C" />
                  <polygon points="8,22 22,28 22,40 8,34" fill="#7A5230" />
                  <polygon points="8,22 22,28 22,40 8,34" fill="none" stroke="#0E0F0C" />
                  <polygon points="36,22 22,28 22,40 36,34" fill="#5A3A1F" />
                  <polygon points="36,22 22,28 22,40 36,34" fill="none" stroke="#0E0F0C" />
                  <polygon points="58,16 72,22 58,28 44,22" fill="#9A9A90" />
                  <polygon points="58,16 72,22 58,28 44,22" fill="none" stroke="#0E0F0C" />
                  <polygon points="44,22 58,28 58,40 44,34" fill="#7A7A70" />
                  <polygon points="44,22 58,28 58,40 44,34" fill="none" stroke="#0E0F0C" />
                  <polygon points="72,22 58,28 58,40 72,34" fill="#5E5E56" />
                  <polygon points="72,22 58,28 58,40 72,34" fill="none" stroke="#0E0F0C" />
                  <polygon points="22,48 36,54 22,60 8,54" fill="#A8A8A8" />
                  <polygon points="22,48 36,54 22,60 8,54" fill="none" stroke="#0E0F0C" />
                  <polygon points="8,54 22,60 22,72 8,66" fill="#7A5230" />
                  <polygon points="8,54 22,60 22,72 8,66" fill="none" stroke="#0E0F0C" />
                  <polygon points="36,54 22,60 22,72 36,66" fill="#5A3A1F" />
                  <polygon points="36,54 22,60 22,72 36,66" fill="none" stroke="#0E0F0C" />
                  <polygon points="58,48 72,54 58,60 44,54" fill="#A8A8A8" />
                  <polygon points="58,48 72,54 58,60 44,54" fill="none" stroke="#0E0F0C" />
                  <polygon points="44,54 58,60 58,72 44,66" fill="#7A5230" />
                  <polygon points="44,54 58,60 58,72 44,66" fill="none" stroke="#0E0F0C" />
                  <polygon points="72,54 58,60 58,72 72,66" fill="#5A3A1F" />
                  <polygon points="72,54 58,60 58,72 72,66" fill="none" stroke="#0E0F0C" />
                </svg>
              </div>
            </div>
            <p className="feat-body">
              Plug into GitHub, Linear, Jira and Slack in minutes. Results land where your team already
              lives, with traces, screenshots, and one-click rerun.
            </p>
            <div className="feat-spacer" />
            <div className="feat-bullets">
              <div className="bullet">GitHub · Linear · Jira · Slack</div>
              <div className="bullet">PR-blocking checks</div>
              <div className="bullet">Self-host or managed</div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ NARRATIVE ============ */}
      <section className="narrative">
        <canvas
          ref={nrCanvasRef}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }}
        />
        <div className="narrative-grid">
          <div className="narrative-text">
            <div className="narrative-eyebrow">Why Probe</div>
            <p>
              Every product is a sprawl of <span className="mute">surfaces</span> — checkout flows,
              mobile webviews, public APIs, locale quirks, third-party flakes — and each release
              multiplies the ways they can break.
            </p>
            <p>
              Hand-written tests can't keep up. They rot, on-call burns out, and regressions slip into
              production while the suite still shows green.
            </p>
            <p>
              <span className="accent">Probe sends agents through every surface, every release</span> —
              so the test pyramid scales with the product, not your headcount.
            </p>
          </div>
          <div className="narrative-stage" aria-hidden="true">
            <div className="nr-card s1">
              <span className="nr-tag">checkout</span>
              <div className="nr-rows">
                <div className="nr-row"><span className="dot" /><span className="ln" /></div>
                <div className="nr-row"><span className="dot" /><span className="ln" style={{ width: '70%' }} /></div>
                <div className="nr-row"><span className="dot" /><span className="ln" style={{ width: '55%' }} /></div>
              </div>
            </div>
            <div className="nr-card s2">
              <span className="nr-tag">api.v1.orders</span>
              <div className="nr-line" style={{ width: '80%' }} />
              <div className="nr-line" style={{ width: '60%' }} />
              <div className="nr-line" style={{ width: '90%' }} />
            </div>
            <div className="nr-card s3">
              <span className="nr-tag">signup</span>
              <div className="nr-rows">
                <div className="nr-row"><span className="dot" /><span className="ln" /></div>
                <div className="nr-row"><span className="dot" /><span className="ln" style={{ width: '60%' }} /></div>
              </div>
            </div>
            <div className="nr-card s4">
              <span className="nr-tag">mobile-webview</span>
              <div className="nr-thumb">
                <svg viewBox="0 0 24 24">
                  <rect x="6" y="2" width="12" height="20" rx="1" />
                  <line x1="10" y1="18" x2="14" y2="18" />
                </svg>
              </div>
              <div className="nr-line" style={{ width: '70%' }} />
            </div>
            <div className="nr-card s5">
              <span className="nr-tag">password-reset</span>
              <div className="nr-line" style={{ width: '85%' }} />
              <div className="nr-line" style={{ width: '55%' }} />
              <div className="nr-line" style={{ width: '70%' }} />
            </div>
            <div className="nr-card s6">
              <span className="nr-tag">billing</span>
              <div className="nr-thumb">
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="6" width="18" height="12" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="nr-rows">
                <div className="nr-row"><span className="dot" /><span className="ln" style={{ width: '65%' }} /></div>
                <div className="nr-row"><span className="dot" /><span className="ln" style={{ width: '80%' }} /></div>
              </div>
            </div>
            <div className="nr-card s7">
              <span className="nr-tag">search</span>
              <div className="nr-line" style={{ width: '90%' }} />
              <div className="nr-line" style={{ width: '60%' }} />
            </div>
            <div className="nr-card s8">
              <span className="nr-tag">auth</span>
              <div className="nr-line" style={{ width: '75%' }} />
              <div className="nr-line" style={{ width: '55%' }} />
            </div>
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section className="pricing" id="pricing">
        <div className="pricing-inner">
          <div className="pricing-head">
            <div className="pricing-eyebrow">Pricing</div>
            <h2 className="pricing-h">
              One simple plan. <span className="soft">Cancel anytime.</span>
            </h2>
            <p className="pricing-sub">
              Start free. Upgrade when your team is ready to let the agents run the whole suite.
            </p>
          </div>

          <div className="pricing-grid">
            {/* Free */}
            <div className="price-card">
              <div className="price-name">Free</div>
              <div className="price-amt">
                <span className="price-cur">$</span>0
                <span className="price-per">/ month</span>
              </div>
              <p className="price-desc">For trying Probe on a single surface.</p>
              <ul className="price-feats">
                <li>1 testing agent</li>
                <li>Manual test runs</li>
                <li>Web &amp; API testing</li>
                <li>Community support</li>
              </ul>
              <a className="price-cta ghost" href="/signup">
                Get started
                {arrow}
              </a>
            </div>

            {/* Pro */}
            <div className="price-card featured">
              <div className="price-badge">Most popular</div>
              <div className="price-name">Pro</div>
              <div className="price-amt">
                <span className="price-cur">$</span>49
                <span className="price-per">/ month</span>
              </div>
              <p className="price-desc">For teams shipping every day.</p>
              <ul className="price-feats">
                <li>Unlimited testing agents</li>
                <li>Scheduled &amp; automated runs</li>
                <li>Web, mobile &amp; API testing</li>
                <li>GitHub, Slack &amp; Linear integrations</li>
                <li>Priority support</li>
              </ul>
              <a className="price-cta" href="/signup">
                Start with Pro
                {arrow}
              </a>
            </div>
          </div>
          <p className="pricing-foot">
            Secure checkout by Dodo Payments · billed monthly · cancel anytime.
          </p>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="cta" style={{ backgroundImage: `url(${spot1})` }}>
        <div className="cta-inner">
          <div className="cta-eyebrow">Get started</div>
          <h2 className="cta-h">Ship faster — let the agents test.</h2>
          <a className="cta-btn" href="/signup">
            Get started
            {arrow}
          </a>
        </div>
      </section>

      <footer>
        <div className="footer-contact">
          <span>548 Market St, San Francisco CA 94104, United States</span>
          <span className="sep">|</span>
          <a href="mailto:founders@probe.dev">founders@probe.dev</a>
        </div>
        <div className="footer-wordmark">Probe</div>
        <div className="footer-bar">
          <div className="footer-copy">© 2026 Probe Labs. All rights reserved.</div>
          <div className="footer-social">
            <a aria-label="LinkedIn"><FaLinkedinIn /></a>
            <a aria-label="X"><FaXTwitter /></a>
            <a aria-label="Instagram"><FaInstagram /></a>
          </div>
          <a className="footer-legal">Terms &amp; Privacy Policy</a>
        </div>
      </footer>
    </div>
  )
}
