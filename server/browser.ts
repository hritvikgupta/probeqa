/**
 * Playwright-backed browser tools — the agent's hands and eyes —
 * plus a live screencast so the UI can watch the real browser work.
 *
 * Each chat gets its own browser context + page, kept alive between turns.
 * A CDP screencast streams JPEG frames of that page into a per-chat hub;
 * the SSE endpoint in index.ts forwards them to the right-hand pane.
 */
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright'
import { tool } from 'ai'
import { z } from 'zod'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { totalmem } from 'node:os'
import { getAgent, updateAgent, type Agent, type TestStep } from './store.ts'
import { githubCreateIssue } from './composio.ts'
import { getFlowByName, listAttachedFlows, touchFlowUsed } from './recording.ts'

/**
 * Per-machine cap on concurrent Chromium contexts. Sized from the machine's
 * actual RAM so the 1 GB baseline and the 8 GB workers each get the right
 * ceiling without any per-process config:
 *   1 GB  → 3   2 GB → 5   4 GB → 8   8 GB → 12   16 GB+ → 20
 * Override at boot with BROWSER_CONCURRENCY if you need to pin it.
 */
const BROWSER_CONCURRENCY = (() => {
  const override = Number(process.env.BROWSER_CONCURRENCY)
  if (Number.isFinite(override) && override > 0) return Math.floor(override)
  const gb = totalmem() / (1024 ** 3)
  if (gb < 1.5) return 3
  if (gb < 3) return 5
  if (gb < 6) return 8
  if (gb < 12) return 12
  return 20
})()

/**
 * Tiny FIFO semaphore. Anyone wanting a Chromium context first awaits a
 * permit; when concurrency is at the cap, new callers queue instead of
 * spawning yet another browser and OOMing the machine.
 */
const browserPermits = {
  inUse: 0,
  waiters: [] as Array<() => void>,
  async acquire(): Promise<void> {
    if (this.inUse < BROWSER_CONCURRENCY) {
      this.inUse++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.inUse++
  },
  release(): void {
    this.inUse--
    const next = this.waiters.shift()
    if (next) next()
  },
}

console.log(`[probe-agent] browser concurrency cap: ${BROWSER_CONCURRENCY}`)

/** Per-run context: the agent whose accounts / settings the agent may use. */
export interface AgentContext {
  agent?: Agent
  /** The user owning this run — needed for per-user flow attachments (Quick chat case where there's no workspace agent). */
  userId?: string
}

/* ----------------------- live frame hub ----------------------- */

export interface Frame {
  url: string
  /** base64-encoded JPEG */
  frame: string
}

interface Hub {
  latest: Frame | null
  subs: Set<(f: Frame) => void>
}

const hubs = new Map<string, Hub>()

function getHub(chatId: string): Hub {
  let h = hubs.get(chatId)
  if (!h) {
    h = { latest: null, subs: new Set() }
    hubs.set(chatId, h)
  }
  return h
}

/** Subscribe to a chat's browser frames. Returns an unsubscribe fn. */
export function subscribeFrames(chatId: string, cb: (f: Frame) => void): () => void {
  const h = getHub(chatId)
  h.subs.add(cb)
  if (h.latest) cb(h.latest) // hand the newcomer the current view immediately
  return () => h.subs.delete(cb)
}

function pushFrame(chatId: string, f: Frame): void {
  const h = getHub(chatId)
  h.latest = f
  for (const cb of h.subs) {
    try {
      cb(f)
    } catch {
      /* ignore a bad subscriber */
    }
  }
}

/* ------------------------- sessions --------------------------- */

interface Session {
  context: BrowserContext
  page: Page
  cdp: CDPSession | null
  consoleErrors: string[]
  lastUsed: number
  lastFrameAt: number
  frameTimer: ReturnType<typeof setInterval> | null
}

const IDLE_MS = 10 * 60 * 1000
const SHOTS_DIR = join(process.cwd(), 'server', '.screenshots')

let browserPromise: Promise<Browser> | null = null
const sessions = new Map<string, Session>()

function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true })
  return browserPromise
}

export async function getSession(chatId: string): Promise<Session> {
  const existing = sessions.get(chatId)
  if (existing) {
    existing.lastUsed = Date.now()
    return existing
  }

  // Block until a Chromium permit is free. This is what keeps a single
  // machine from spawning more browsers than its RAM can hold; once the cap
  // is reached, the next agent call waits here instead of crashing the box.
  await browserPermits.acquire()

  let context: BrowserContext
  let page: Page
  try {
    const browser = await getBrowser()
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    page = await context.newPage()
  } catch (e) {
    // Hand the permit back if we never managed to create the context.
    browserPermits.release()
    throw e
  }

  const consoleErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => {
    consoleErrors.push(
      `request failed: ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? 'unknown'}`,
    )
  })

  // Per-context init: re-runs on every navigation. Three responsibilities:
  //   1. Keep navigations in this tab (strip target= + override window.open)
  //   2. Inject a virtual cursor overlay so the screencast shows where the
  //      mouse is moving (Playwright's synthesized clicks have no visible OS
  //      cursor in headless mode — we draw our own that follows mousemove
  //      events the agent's mouse.move() calls generate).
  await context.addInitScript(() => {
    /* -------- popup / tab containment -------- */
    const stripTargets = () => {
      document.querySelectorAll('a[target]').forEach((a) => a.removeAttribute('target'))
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).open = function (url?: string | URL) {
        if (url) window.location.href = String(url)
        return null
      }
    } catch {
      /* ignore */
    }
    if (document.readyState !== 'loading') stripTargets()
    document.addEventListener('DOMContentLoaded', stripTargets)
    new MutationObserver(stripTargets).observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributeFilter: ['target'],
    })

    /* -------- virtual cursor overlay --------
       Reasoning: the CDP screencast only emits frames on big repaints, and
       the fallback poller fires every 900ms. The cursor must be BIG (visible
       in a single low-frequency frame), persist its last position across
       repaints, and start at a visible spot so screenshots taken before the
       first click still show "the mouse is here". */
    const installCursor = () => {
      // Use documentElement (never replaced by React) so React-heavy SPAs
      // like LinkedIn can't wipe our overlay during their render cycles.
      const root = document.documentElement || document.body
      if (!root || document.getElementById('__probe_cursor')) return
      const c = document.createElement('div')
      c.id = '__probe_cursor'
      c.setAttribute('aria-hidden', 'true')
      // Start visible — pulled from storage if we have a position from a prior
      // page in this session; otherwise centered-ish near the top-left.
      const last = (() => {
        try {
          const raw = sessionStorage.getItem('__probe_cursor_pos')
          if (!raw) return null
          const [x, y] = raw.split(',').map(Number)
          if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
        } catch {
          /* sessionStorage may be unavailable on some origins */
        }
        return null
      })() ?? { x: 200, y: 200 }
      c.style.cssText =
        'position:fixed;left:0;top:0;width:32px;height:32px;' +
        'pointer-events:none;z-index:2147483647;' +
        `transform:translate3d(${last.x}px,${last.y}px,0);` +
        'transition:transform 80ms linear,filter 80ms ease;' +
        'filter:drop-shadow(0 3px 6px rgba(0,0,0,0.55));' +
        'will-change:transform'
      c.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" ' +
        'xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M5 3 L5 19 L9 15 L11 21 L14 20 L12 14 L18 14 Z" ' +
        'fill="#FFFFFF" stroke="#0E0F0C" stroke-width="2" ' +
        'stroke-linejoin="round"/></svg>'
      root.appendChild(c)

      const move = (e: MouseEvent) => {
        c.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`
        try {
          sessionStorage.setItem('__probe_cursor_pos', `${e.clientX},${e.clientY}`)
        } catch {
          /* ignore */
        }
      }
      window.addEventListener('mousemove', move, { capture: true })

      // Click ripple — green pulse on mousedown.
      const ring = document.createElement('div')
      ring.id = '__probe_cursor_ring'
      ring.style.cssText =
        'position:fixed;left:0;top:0;width:40px;height:40px;border-radius:50%;' +
        'border:3px solid #5BBA3B;pointer-events:none;z-index:2147483646;' +
        'transform:translate3d(-100px,-100px,0) scale(0.3);opacity:0;'
      root.appendChild(ring)
      window.addEventListener(
        'mousedown',
        (e) => {
          ring.style.transition = 'none'
          ring.style.transform = `translate3d(${e.clientX - 20}px,${e.clientY - 20}px,0) scale(0.3)`
          ring.style.opacity = '1'
          requestAnimationFrame(() => {
            ring.style.transition = 'transform 500ms ease-out,opacity 500ms ease-out'
            ring.style.transform = `translate3d(${e.clientX - 20}px,${e.clientY - 20}px,0) scale(1.6)`
            ring.style.opacity = '0'
          })
        },
        { capture: true },
      )

      // No MutationObserver — observing documentElement with subtree:true
      // fires on every DOM change (hundreds/sec on LinkedIn) and we noticed
      // it was interfering with React-driven overlays (the compose dialog
      // would re-open then immediately close). The setInterval watchdog in
      // ensureCursor is enough — it's debounced and self-stops once stable.
    }
    if (document.body) installCursor()
    else document.addEventListener('DOMContentLoaded', installCursor)
  })

  const session: Session = {
    context,
    page,
    cdp: null,
    consoleErrors,
    lastUsed: Date.now(),
    lastFrameAt: 0,
    frameTimer: null,
  }
  sessions.set(chatId, session)

  // Safety net: if a popup *does* still slip through (e.g. an OAuth flow that
  // bypasses our overrides), swap the session's page reference to it so the
  // agent acts against the user's actual landing tab.
  context.on('page', (newPage) => {
    console.log(`[session ${chatId.slice(0, 8)}] popup detected → switching to`, newPage.url())
    session.page = newPage
    newPage.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  })

  // Live screencast → frame hub. If it fails, the agent still works headless.
  try {
    const cdp = await context.newCDPSession(page)
    session.cdp = cdp
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    })
    cdp.on('Page.screencastFrame', (params: any) => {
      session.lastFrameAt = Date.now()
      pushFrame(chatId, { url: page.url(), frame: params.data })
      cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
    })
  } catch (e) {
    console.error('[probe-agent] screencast unavailable:', e)
  }

  // Fallback poller — the CDP screencast is flaky in headless and sometimes
  // emits nothing. While someone is watching, push a fresh screenshot at a
  // cadence chosen for the use case:
  //   • Recording (rec-*) sessions need near-realtime feedback after each
  //     click → 200ms throttle / 250ms tick / quality 65
  //   • Agent-watch sessions (run modal, quick chat) are watching the
  //     agent click around live → 500ms throttle / 600ms tick / quality 55.
  //     Faster than the old 1500ms throttle (which made the virtual cursor
  //     visibly lag), still well under the bandwidth a recording would use.
  //   • If no subscribers, the screenshot is skipped entirely (hub.subs.size).
  const isRecording = chatId.startsWith('rec-')
  const tickMs = isRecording ? 250 : 600
  const throttleMs = isRecording ? 200 : 500
  session.frameTimer = setInterval(() => {
    const hub = hubs.get(chatId)
    if (!hub || hub.subs.size === 0) return
    if (Date.now() - session.lastFrameAt < throttleMs) return
    page
      .screenshot({ type: 'jpeg', quality: isRecording ? 65 : 55 })
      .then((buf) => {
        session.lastFrameAt = Date.now()
        pushFrame(chatId, { url: page.url(), frame: buf.toString('base64') })
      })
      .catch(() => {})
  }, tickMs)

  return session
}

/** Close and forget a chat's browser session + frame hub ("New run"). */
export async function resetSession(chatId: string): Promise<void> {
  hubs.delete(chatId)
  const s = sessions.get(chatId)
  if (!s) return
  sessions.delete(chatId)
  if (s.frameTimer) clearInterval(s.frameTimer)
  await s.context.close().catch(() => {})
  browserPermits.release()
}

/**
 * Current view of a chat's browser — a fresh screenshot of the live page.
 * Backs the polling live-view endpoint, which is far more reliable than the
 * CDP screencast in headless Chromium. Returns null if there's no session
 * yet (the agent hasn't opened the browser).
 */
export async function currentFrame(chatId: string): Promise<Frame | null> {
  const s = sessions.get(chatId)
  if (!s) return hubs.get(chatId)?.latest ?? null
  try {
    const buf = await s.page.screenshot({ type: 'jpeg', quality: 55 })
    s.lastUsed = Date.now()
    return { url: s.page.url(), frame: buf.toString('base64') }
  } catch {
    // Page busy mid-action — fall back to the most recent screencast frame.
    return hubs.get(chatId)?.latest ?? null
  }
}

/**
 * Capture and broadcast a fresh frame for this session right now. Called by
 * the recording mouse/key endpoints so the user sees the result of their
 * input within one screenshot's worth of latency instead of waiting for
 * the next cadence tick.
 *
 * Two safeguards prevent the "half-rendered page" artifact you see when a
 * click triggers navigation: (a) brief wait for domcontentloaded so the new
 * page has at least basic structure, (b) per-chat throttle so back-to-back
 * clicks don't queue concurrent screenshots that all capture intermediate
 * paints.
 */
const lastImmediateAt = new Map<string, number>()
export async function pushImmediateFrame(chatId: string): Promise<void> {
  const last = lastImmediateAt.get(chatId) ?? 0
  if (Date.now() - last < 120) return
  lastImmediateAt.set(chatId, Date.now())
  const s = sessions.get(chatId)
  if (!s) return
  try {
    // If a navigation is in flight from the click we just forwarded, wait
    // briefly for the new page to reach domcontentloaded. Cap at 600ms so a
    // hanging page doesn't make the UI feel frozen — the cadence ticker
    // will fill in once it stabilizes.
    await s.page.waitForLoadState('domcontentloaded', { timeout: 600 }).catch(() => {})
    const buf = await s.page.screenshot({ type: 'jpeg', quality: 65 })
    s.lastFrameAt = Date.now()
    pushFrame(chatId, { url: s.page.url(), frame: buf.toString('base64') })
  } catch {
    /* page is mid-transition — next tick will catch up */
  }
}

// Evict idle sessions so headless Chromium contexts don't pile up.
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of [...sessions]) {
    if (now - s.lastUsed > IDLE_MS) {
      sessions.delete(id)
      hubs.delete(id)
      if (s.frameTimer) clearInterval(s.frameTimer)
      s.context.close().catch(() => {})
      // Return the Chromium permit so the next waiting agent can run.
      browserPermits.release()
    }
  }
}, 60_000).unref()

/**
 * Enumerate visible buttons in the "active scope" — the topmost open dialog,
 * else an open popover/menu, else <main>. Used both by inspect_page to surface
 * icon-only buttons proactively, and by click() to self-diagnose when a click
 * fails so the model gets back a useful candidate list instead of just an
 * error message. No site-specific logic — pure generic geometry / DOM facts.
 */
const ENUMERATE_BUTTONS_SCRIPT = `(() => {
  const isVisible = (el) => {
    if (!el || el.tagName === 'DIALOG' && !el.open) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false
    return true
  }
  const findScope = () => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog')).filter(isVisible)
    if (dialogs.length > 0) return { el: dialogs[dialogs.length - 1], kind: 'dialog' }
    const menus = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], [role="alertdialog"]')).filter(isVisible)
    if (menus.length > 0) return { el: menus[menus.length - 1], kind: 'menu' }
    const main = document.querySelector('main')
    if (main) return { el: main, kind: 'main' }
    return { el: document.body, kind: 'body' }
  }
  const scope = findScope()
  if (!scope.el) return { scope: 'none', buttons: [], inputs: [] }

  const SHORT = (s) => (s || '').toString().trim().replace(/\\s+/g, ' ').slice(0, 80)

  const buttons = []
  // Note: include real <a> links + interactive role-tagged divs. Models often
  // guess role="link" when the real element is a button, or vice versa —
  // surfacing both in one list means a failed click can show the right
  // candidate regardless of which role the model originally tried.
  scope.el.querySelectorAll('button, [role="button"], a, [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"]').forEach((el) => {
    if (!isVisible(el)) return
    if (el.disabled) return
    const aria = el.getAttribute('aria-label') || ''
    const ariaLabelledby = el.getAttribute('aria-labelledby') || ''
    const testid = el.getAttribute('data-testid') || ''
    // Best-guess interactive role: explicit aria role first, then tag-based
    // mapping. an a-href defaults to "link", button to "button". So a model
    // looking at role link candidates can tell at a glance whether the
    // element it wanted is actually a button.
    const tag = el.tagName.toLowerCase()
    const explicitRole = el.getAttribute('role') || ''
    const role = explicitRole || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag)
    const text = SHORT(el.innerText || el.value || '')
    const svgEl = el.querySelector('svg')
    const hasSvg = !!svgEl
    const svgAria = svgEl ? (svgEl.getAttribute('aria-label') || '') : ''
    const svgTitle = svgEl ? (svgEl.querySelector('title')?.textContent || '') : ''
    const title = el.getAttribute('title') || ''
    const href = (tag === 'a' ? el.getAttribute('href') || '' : '')
    const r = el.getBoundingClientRect()
    buttons.push({
      ariaLabel: aria || undefined,
      title: title || undefined,
      testid: testid || undefined,
      tag,
      role,
      text: text || undefined,
      hasSvg,
      iconOnly: hasSvg && !text,
      svgHint: SHORT(svgAria || svgTitle) || undefined,
      ariaLabelledby: ariaLabelledby || undefined,
      href: href || undefined,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    })
  })

  // Also surface text-style inputs in the active scope so contenteditable
  // composers / search fields don't get missed.
  const inputs = []
  scope.el.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]').forEach((el) => {
    if (!isVisible(el)) return
    if (el.disabled) return
    const aria = el.getAttribute('aria-label') || ''
    const ariaPlaceholder = el.getAttribute('aria-placeholder') || ''
    const placeholder = el.getAttribute('placeholder') || ''
    const role = el.getAttribute('role') || (el.tagName === 'INPUT' ? el.type || 'input' : el.tagName.toLowerCase())
    const contenteditable = el.getAttribute('contenteditable') === 'true'
    const testid = el.getAttribute('data-testid') || ''
    const r = el.getBoundingClientRect()
    inputs.push({
      ariaLabel: aria || undefined,
      ariaPlaceholder: ariaPlaceholder || undefined,
      placeholder: placeholder || undefined,
      testid: testid || undefined,
      role,
      contenteditable: contenteditable || undefined,
      tag: el.tagName.toLowerCase(),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    })
  })

  return { scope: scope.kind, buttons: buttons.slice(0, 25), inputs: inputs.slice(0, 15) }
})()`

/**
 * Per-element hints for inspect_page (the existing "find a selector for this
 * unnamed input" data). String form so esbuild/tsx doesn't inject __name()
 * helpers that fail in the browser context.
 */
const HINTS_SCRIPT = `(() => {
  const pick = (el) => {
    const id = el.id ? '#' + el.id : ''
    const testid = el.getAttribute('data-testid') || ''
    const aria = el.getAttribute('aria-label') || ''
    const role = el.getAttribute('role') || ''
    const type = el.type || el.tagName.toLowerCase()
    const placeholder = el.placeholder || ''
    const nameAttr = el.name || ''
    const text = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60)
    let selector = el.tagName.toLowerCase()
    if (id) selector += id
    if (testid) selector += '[data-testid="' + testid + '"]'
    else if (type && el.tagName.toLowerCase() === 'input') selector += '[type="' + type + '"]'
    else if (nameAttr) selector += '[name="' + nameAttr + '"]'
    return {
      selector,
      tag: el.tagName.toLowerCase(),
      type: type || undefined,
      testid: testid || undefined,
      ariaLabel: aria || undefined,
      role: role || undefined,
      placeholder: placeholder || undefined,
      name: nameAttr || undefined,
      text: text || undefined,
    }
  }
  const out = []
  const seen = new Set()
  document
    .querySelectorAll('input, textarea, select, button, [role="button"], [data-testid]')
    .forEach((el) => {
      if (seen.has(el)) return
      seen.add(el)
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const info = pick(el)
      if (info.ariaLabel && !info.placeholder && !info.testid) return
      out.push(info)
    })
  return out.slice(0, 40)
})()`

/**
 * Server-side cursor injection. Belt + suspenders to addInitScript: ensures
 * the cursor exists right before any animation, even if the page's own
 * scripts wiped it or if addInitScript silently failed.
 */
const CURSOR_INJECT_SCRIPT = `(() => {
  if (window.__probeCursorReady && document.getElementById('__probe_cursor')) return 'already-present';
  // Inject into <html> (documentElement), NOT body — React-heavy SPAs like
  // LinkedIn replace body subtrees on every navigation and would wipe our
  // overlay between renders. <html> is essentially never touched.
  const root = document.documentElement || document.body;
  if (!root) return 'no-root';
  const existing = document.getElementById('__probe_cursor');
  if (existing) existing.remove();
  const existingRing = document.getElementById('__probe_cursor_ring');
  if (existingRing) existingRing.remove();
  const c = document.createElement('div');
  c.id = '__probe_cursor';
  c.setAttribute('aria-hidden', 'true');
  // Restore last known position from sessionStorage so the cursor persists
  // across page navigations.
  let lx = 200, ly = 200;
  try {
    const raw = sessionStorage.getItem('__probe_cursor_pos');
    if (raw) {
      const [x, y] = raw.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) { lx = x; ly = y; }
    }
  } catch (e) {}
  c.style.cssText =
    'position:fixed!important;left:0!important;top:0!important;' +
    'width:36px!important;height:36px!important;' +
    'pointer-events:none!important;z-index:2147483647!important;' +
    'transform:translate3d(' + lx + 'px,' + ly + 'px,0)!important;' +
    'transition:transform 80ms linear!important;' +
    'filter:drop-shadow(0 3px 8px rgba(0,0,0,0.7))!important;' +
    'display:block!important;visibility:visible!important;opacity:1!important;';
  c.innerHTML =
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" ' +
    'xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5 3 L5 19 L9 15 L11 21 L14 20 L12 14 L18 14 Z" ' +
    'fill="#FFFFFF" stroke="#0E0F0C" stroke-width="2" ' +
    'stroke-linejoin="round"/></svg>';
  root.appendChild(c);
  const move = (e) => {
    c.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    try { sessionStorage.setItem('__probe_cursor_pos', e.clientX + ',' + e.clientY); } catch (e2) {}
  };
  if (!window.__probeCursorListenerAdded) {
    window.addEventListener('mousemove', move, { capture: true });
    window.__probeCursorListenerAdded = true;
  }
  // Click ripple.
  const ring = document.createElement('div');
  ring.id = '__probe_cursor_ring';
  ring.style.cssText =
    'position:fixed!important;left:0!important;top:0!important;' +
    'width:44px!important;height:44px!important;border-radius:50%!important;' +
    'border:3px solid #5BBA3B!important;pointer-events:none!important;' +
    'z-index:2147483646!important;' +
    'transform:translate3d(-100px,-100px,0) scale(0.3);opacity:0;';
  root.appendChild(ring);
  if (!window.__probeRingListenerAdded) {
    window.addEventListener('mousedown', (e) => {
      ring.style.transition = 'none';
      ring.style.transform = 'translate3d(' + (e.clientX-22) + 'px,' + (e.clientY-22) + 'px,0) scale(0.3)';
      ring.style.opacity = '1';
      requestAnimationFrame(() => {
        ring.style.transition = 'transform 500ms ease-out,opacity 500ms ease-out';
        ring.style.transform = 'translate3d(' + (e.clientX-22) + 'px,' + (e.clientY-22) + 'px,0) scale(1.6)';
        ring.style.opacity = '0';
      });
    }, { capture: true });
    window.__probeRingListenerAdded = true;
  }
  window.__probeCursorReady = true;
  // Watchdog: occasionally re-attach if a heavy SPA wipes the overlay. Was
  // 200ms — that's 5 DOM mutations/sec against React, which can interfere
  // with transient overlays like message compose dialogs (the parent
  // MutationObserver of the React tree re-runs and stomps state). Slower
  // tick + only mutate when actually missing avoids that.
  if (!window.__probeCursorWatchdog) {
    let consecutiveOk = 0;
    window.__probeCursorWatchdog = setInterval(() => {
      const rootNow = document.documentElement || document.body;
      if (!rootNow) return;
      const cursorOk = !!document.getElementById('__probe_cursor');
      const ringOk = !!document.getElementById('__probe_cursor_ring');
      if (cursorOk && ringOk) {
        consecutiveOk++;
        // Once we've been stable for 10 ticks (~15s), stop polling. The
        // MutationObserver in addInitScript will catch any later wipe.
        if (consecutiveOk >= 10) {
          clearInterval(window.__probeCursorWatchdog);
          window.__probeCursorWatchdog = null;
        }
        return;
      }
      consecutiveOk = 0;
      if (!cursorOk) rootNow.appendChild(c);
      if (!ringOk) rootNow.appendChild(ring);
    }, 1500);
  }
  return 'installed';
})()`

async function ensureCursor(page: Page): Promise<void> {
  try {
    await page.evaluate(CURSOR_INJECT_SCRIPT)
  } catch {
    /* page may be navigating — addInitScript will re-install on next load */
  }
}

/**
 * Smoothly move Playwright's mouse to the center of a located element so the
 * virtual cursor overlay traces a visible path across the screencast before
 * the click/fill fires. Best-effort — if the element can't be located/measured
 * we just no-op and let the action proceed.
 */
async function animateMouseTo(page: Page, loc: ReturnType<Page['locator']>): Promise<void> {
  try {
    // Belt + suspenders: re-inject the cursor right before we animate, in
    // case the SPA wiped it since the last action.
    await ensureCursor(page)
    const box = await loc.first().boundingBox({ timeout: 2_000 })
    if (!box) return
    const targetX = box.x + box.width / 2
    const targetY = box.y + box.height / 2
    // Slow the move so the ~800ms BrowserView poll captures the cursor mid-
    // path, then dwell at the target so a poll lands while it's hovering.
    await page.mouse.move(targetX, targetY, { steps: 60 })
    await page.waitForTimeout(500)
  } catch {
    /* swallow — the action will proceed without the cursor animation */
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n…[truncated, ${s.length - n} more chars]` : s
}

/* --------------------------- tools ---------------------------- */

/**
 * The test-plan tool. When bound to an agent (plan mode) its result IS the
 * write: the proposed steps are saved straight to that agent's canvas in the
 * DB — the canvas is the single source of truth, so there is nothing to
 * mirror through the frontend and nothing to drift.
 */
export function proposeTestPlanTool(agentId?: string) {
  return tool({
    description:
      'Propose or update a structured, step-by-step test plan. Call this whenever you and the user have agreed on what to test, and again whenever the plan should change. List every step in order — the plan appears on the workspace canvas.',
    inputSchema: z.object({
      title: z
        .string()
        .describe('Short title for the plan, e.g. "Thinking Line — signup & login flow".'),
      steps: z
        .array(
          z.object({
            kind: z
              .enum(['navigate', 'act', 'assert', 'login', 'screenshot', 'github', 'integration'])
              .describe(
                'Step type: navigate (open a URL), act (click/fill/interact), assert (verify an expectation), login (enter credentials), screenshot (capture the page), github (report the run result to the connected repo), integration (act on a connected app — Slack, Gmail, Notion, etc.).',
              ),
            label: z
              .string()
              .describe('Imperative one-line description, e.g. "Click the Sign Up link".'),
            detail: z
              .string()
              .optional()
              .describe('Optional extra context, e.g. the URL, the data to enter, or what to verify.'),
          }),
        )
        .min(1)
        .describe('The ordered list of test steps.'),
    }),
    execute: async ({ title, steps }) => {
      // No agent bound (the Editor's free planning) → nothing to persist.
      if (!agentId) return { ok: true, title, stepCount: steps.length }
      // Plan mode: write the plan straight onto the workspace canvas.
      const canvas: TestStep[] = steps.map((s) => ({
        id: crypto.randomUUID(),
        kind: s.kind,
        label: s.label,
        ...(s.detail ? { detail: s.detail } : {}),
      }))
      await updateAgent(agentId, { steps: canvas })
      return { ok: true, saved: true, title, stepCount: canvas.length }
    },
  })
}

const planStepSchema = z.object({
  kind: z
    .enum(['navigate', 'act', 'assert', 'login', 'screenshot', 'github', 'integration'])
    .describe('Step type: navigate, act, assert, login, screenshot, github (report to GitHub), integration (act on a connected app).'),
  label: z.string().describe('Imperative one-line description of the step.'),
  detail: z.string().optional().describe('Optional extra context — a URL, data to enter, what to verify.'),
})

/** Read the current test plan from the workspace canvas (the source of truth). */
export function getCanvasTool(agentId: string) {
  return tool({
    description:
      'Read the current test plan from the workspace canvas — the single source of truth. The user can hand-edit the canvas directly at any time, so call this to know the real current plan, especially before changing it.',
    inputSchema: z.object({}),
    execute: async () => {
      const agent = await getAgent(agentId)
      const steps = (agent?.steps ?? []).map((s, i) => ({
        index: i + 1,
        kind: s.kind,
        label: s.label,
        ...(s.detail ? { detail: s.detail } : {}),
      }))
      return { ok: true, stepCount: steps.length, steps }
    },
  })
}

/** Replace the workspace canvas with a new plan — this IS the plan. */
export function updateCanvasTool(agentId: string) {
  return tool({
    description:
      'Replace the test plan on the workspace canvas with a new ordered list of steps. Whatever you pass here BECOMES the canvas. Call get_canvas first so you build on the current plan (which the user may have hand-edited), then pass the COMPLETE updated list — every step, in order, not a delta.',
    inputSchema: z.object({
      steps: z.array(planStepSchema).describe('The complete ordered test plan that becomes the canvas.'),
    }),
    execute: async ({ steps }) => {
      const canvas: TestStep[] = steps.map((s) => ({
        id: crypto.randomUUID(),
        kind: s.kind,
        label: s.label,
        ...(s.detail ? { detail: s.detail } : {}),
      }))
      await updateAgent(agentId, { steps: canvas })
      return { ok: true, saved: true, stepCount: canvas.length }
    },
  })
}

/**
 * Planning-only tool set — the workspace chat brainstorms a plan, no browser.
 * The plan lives only on the canvas: the agent reads it with get_canvas and
 * changes it with update_canvas. There is no propose_test_plan here, so no
 * second copy of the plan can ever drift from the canvas.
 */
export function buildPlanTools(agentId?: string) {
  if (!agentId) return { propose_test_plan: proposeTestPlanTool() }
  return {
    get_canvas: getCanvasTool(agentId),
    update_canvas: updateCanvasTool(agentId),
  }
}

/**
 * Build the full browser tool set bound to one chat's session. Passed
 * straight into streamText() so the model can call them in its ReAct loop.
 * `ctx.agent` unlocks the account / GitHub tools.
 */
export function buildBrowserTools(chatId: string, ctx: AgentContext = {}) {
  const agent = ctx.agent
  // userId resolution: workspace runs get it via agent.userId; Quick chat
  // gets it via ctx.userId passed from runAgent. Either way, the per-user
  // flow attachments are scoped to this id.
  const userId = ctx.userId || agent?.userId

  return {
    navigate: tool({
      description:
        'Open a URL in the browser. Always the first step when testing a page. Returns the final URL, HTTP status, and page title.',
      inputSchema: z.object({
        url: z.string().describe('Full URL including https://, e.g. "https://example.com/checkout".'),
      }),
      execute: async ({ url }) => {
        const { page } = await getSession(chatId)
        try {
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          // Let the page settle. networkidle is best-effort; we don't want to
          // fail the call just because a long-poll keeps the connection open.
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
          // Install the cursor on the freshly loaded page so it's visible from
          // the first /api/browser/frame poll even before any click.
          await ensureCursor(page)
          return { ok: true, url: page.url(), title: await page.title(), status: resp?.status() ?? null }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    inspect_page: tool({
      description:
        'Your PRIMARY way to look at the page. Returns the accessibility tree (every link, button, input, heading with its accessible name) PLUS a list of selector hints for inputs and clickable elements whose accessible name is missing (gives you placeholder, data-testid, type, nearby text — enough to act on them without get_html). Use this between actions. Only fall back to get_html when this returns something incomplete or you need a region of raw markup.',
      inputSchema: z.object({}),
      execute: async () => {
        const { page } = await getSession(chatId)
        try {
          // If a navigation is in flight, wait for it to settle so neither
          // ariaSnapshot nor evaluate runs against a doomed execution context.
          await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {})
          const tree = await page
            .locator('body')
            .ariaSnapshot()
            .catch(() => '')
          // "Hints" — non-accessibility attributes that help target unnamed
          // inputs, custom-widget buttons, and testid-tagged elements. The
          // model can use these as CSS selectors or as `name` for getByText.
          // Wrapped in its own try so a mid-navigation context-destroyed error
          // degrades to "just the aria tree" instead of failing the whole call.
          let hints: unknown[] = []
          try {
            // Passed as a STRING literal, not a function expression. tsx/esbuild
            // wraps function literals in __name() calls that aren't defined in
            // the browser context, which breaks page.evaluate. String form
            // doesn't get rewritten — same trick we use for ENUMERATE_BUTTONS_SCRIPT.
            hints = (await page.evaluate(HINTS_SCRIPT)) as unknown[]
          } catch (evalErr) {
            // Page was probably mid-navigation — log and continue with just
            // the aria tree. Tomorrow's call (after the model uses look/
            // waits) will have hints again. Returning ok:false here would
            // poison the agent into giving up on the whole step.
            console.log(
              `[inspect_page] hints unavailable (page in transition): ${String(evalErr).slice(0, 120)}`,
            )
          }
          // ALSO surface buttons + inputs in the active scope (dialog/menu/main).
          // This catches icon-only buttons (e.g. send/close/attach) that are
          // missing or hard to identify in the aria tree alone. Generic shape:
          // each entry has iconOnly + svgHint + rect so the model can pick a
          // button by position/icon when names aren't unique.
          const scope = await page
            .evaluate(ENUMERATE_BUTTONS_SCRIPT)
            .catch(() => null) as null | { scope?: string; buttons?: unknown[]; inputs?: unknown[] }
          return {
            ok: true,
            url: page.url(),
            tree: truncate(tree, 6_000),
            hints,
            activeScope: scope?.scope,
            scopeButtons: scope?.buttons ?? [],
            scopeInputs: scope?.inputs ?? [],
          }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    get_html: tool({
      description:
        'Get the real HTML/DOM of the page — every element, its tag and ALL attributes (id, class, type, name, placeholder, data-*, href, role…) and the nesting structure. This is your ground truth: it shows elements the accessibility tree hides or leaves unnamed, and works for anything clickable — buttons, links, divs, spans, icons, custom widgets. Use it to find a precise CSS selector, then pass that selector to click() or fill(). Pass an optional `selector` to zoom into one region (e.g. "form", "#login", "nav").',
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe('Optional CSS selector to scope output to one region. Omit for the whole page.'),
      }),
      execute: async ({ selector }) => {
        const { page } = await getSession(chatId)
        try {
          const html = await page.evaluate((sel) => {
            const root = sel ? document.querySelector(sel) : document.body
            if (!root) return null
            const clone = root.cloneNode(true) as Element
            clone.querySelectorAll('script,style,noscript,svg,template,link,meta').forEach((n) => n.remove())
            return clone.outerHTML.replace(/\s+/g, ' ').trim()
          }, selector ?? null)
          if (html == null) return { ok: false, error: `No element matches selector "${selector}"` }
          return { ok: true, url: page.url(), html: truncate(html, 9_000) }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    click: tool({
      description:
        'Click ANY element on the page. PREFER accessibility locators (role + name) — they map 1:1 to what inspect_page just showed you and survive class-name changes. CSS selector is the fallback for elements with no accessible name.',
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe('CSS selector — fallback for unnamed/custom elements only. Example: "button.submit", "[data-testid=continue]".'),
        role: z.string().optional().describe('ARIA role from inspect_page, e.g. "link", "button", "checkbox". Used with `name`.'),
        name: z.string().optional().describe('Accessible name from inspect_page, e.g. "Sign in", "Continue".'),
        exact: z
          .boolean()
          .optional()
          .describe('Require an EXACT name match (default true). Set false only if you intentionally want a substring match — e.g. matching "Sign in with Google" by passing name="Google" with exact=false.'),
        nth: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based index — use when a previous click() returned ambiguous:true with multiple alternatives sharing the same name. Pick the alternative whose `index` you want (e.g. nth:2 picks alternatives[1]). When nth is set, the ambiguity check is skipped and the Nth match is clicked directly.'),
      }),
      execute: async ({ selector, role, name, exact, nth }) => {
        const { page } = await getSession(chatId)
        const target = selector ?? `${role ?? ''} "${name ?? ''}"`.trim()
        try {
          const beforeUrl = page.url()

          // ── Locator resolution ────────────────────────────────────────────
          // Strategy: try the SPECIFIC thing the model asked for first
          // (exact role+name), then progressively widen to handle the common
          // failure modes WITHOUT making the model retry across LLM rounds:
          //   1. selector or exact role+name match
          //   2. fuzzy role+name (case the model's name was a substring)
          //   3. ANY role + name (model guessed wrong role: link vs button)
          //   4. getByText (catches role-less divs, contenteditables,
          //      icon-only controls whose only "label" is the text inside)
          // We pick the first stage that returns a count > 0. If everything
          // is empty, we FAIL FAST instead of waiting 8s for a phantom click.
          let loc
          if (selector) {
            loc = page.locator(selector)
          } else if (name) {
            const useExact = exact !== false
            // Try the specific thing the model asked for first, then progressively
            // widen for the common failure modes (wrong role, role-less text).
            // We do NOT scope to <main> or any other container — that's a
            // site-shaped heuristic. When multiple elements match, we surface
            // the ambiguity and let the model pick the unique full name from
            // the candidates (same approach Webwright takes: tools are dumb,
            // the agent disambiguates using unique aria-tree names).
            const tryStages = [
              page.getByRole(role as never, { name, exact: true }),
              ...(useExact ? [page.getByRole(role as never, { name })] : []),
              ...(['link', 'button', 'menuitem', 'tab', 'treeitem'] as const)
                .filter((r) => r !== role)
                .map((r) => page.getByRole(r as never, { name, exact: true })),
              page.getByText(name, { exact: false }),
            ]
            for (const stage of tryStages) {
              if ((await stage.count()) > 0) {
                loc = stage
                break
              }
            }
          } else {
            return { ok: false, error: 'click() needs either `selector` or `name`.' }
          }

          // No match → fail fast with candidates so the model can pick the
          // right ariaLabel/role on the next call.
          if (!loc || (await loc.count()) === 0) {
            const diag = (await page
              .evaluate(ENUMERATE_BUTTONS_SCRIPT)
              .catch(() => null)) as null | { scope?: string; buttons?: unknown[]; inputs?: unknown[] }
            return {
              ok: false,
              error: `No element matches ${target} (tried exact role+name, fuzzy role+name, other common roles, and getByText).`,
              scope: diag?.scope,
              candidates: diag?.buttons ?? [],
              inputCandidates: diag?.inputs ?? [],
              hint: 'Pick from candidates by ariaLabel/text. If target isn\'t there, the page may have a dialog/menu open intercepting input. Last resort: run_playwright_code.',
            }
          }

          // Ambiguous match (>1 elements with this exact role+name) — surface
          // all matches with their unique full aria-labels, rects, AND
          // surrounding context (nearest heading, parent text) so the model
          // can either re-call with a more specific name OR pass nth:N to
          // pick by index when names are identical. Picking .first() blindly
          // is wrong because DOM order rarely matches user intent.
          const matchCount = await loc.count()
          // If the model already disambiguated with nth, skip the ambiguity
          // check and use the Nth match. nth is 1-based for prompt clarity.
          if (matchCount > 1 && !nth) {
            // Enumerate up to the first 20 matches with distinguishing info.
            // We include parentText + nearestHeading so even when N items
            // share the same accessible name (e.g. multiple "Edit" buttons
            // in a list), the model can identify which row/section each
            // belongs to. Use new Function() so esbuild doesn't rewrite the
            // arrow function (and so Playwright gets a real function, not a
            // string evaluated as an expression).
            const handles = await loc.elementHandles()
            const alternatives: Array<Record<string, unknown>> = []
            let altErrors = 0
            for (let i = 0; i < Math.min(handles.length, 20); i++) {
              try {
                const info = await handles[i].evaluate((el) => {
                  const r = el.getBoundingClientRect()
                  const v = (el as HTMLInputElement).value
                  const text = ((el as HTMLElement).innerText || v || '').trim().replace(/\s+/g, ' ').slice(0, 100)
                  let nearestHeading: string | undefined
                  let parentText: string | undefined
                  let inActiveDialog = false
                  let dialogLabel: string | undefined
                  let n: Element | null = el.parentElement
                  let depth = 0
                  while (n && depth < 12) {
                    if (!nearestHeading) {
                      const h = n.querySelector('h1,h2,h3,h4,[role="heading"]')
                      if (h) {
                        const ht = (h.textContent || '').trim().replace(/\s+/g, ' ')
                        if (ht) nearestHeading = ht.slice(0, 80)
                      }
                    }
                    if (!parentText && depth >= 1) {
                      const pt = ((n as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ')
                      if (pt && pt !== text) parentText = pt.slice(0, 120)
                    }
                    if (!inActiveDialog) {
                      const role = n.getAttribute && n.getAttribute('role')
                      if (n.tagName === 'DIALOG' || role === 'dialog' || role === 'alertdialog' || role === 'menu' || role === 'listbox') {
                        inActiveDialog = true
                        const dl = n.getAttribute('aria-label') || ''
                        if (dl) dialogLabel = dl.slice(0, 60)
                      }
                    }
                    if (nearestHeading && parentText && inActiveDialog) break
                    n = n.parentElement
                    depth++
                  }
                  return {
                    ariaLabel: el.getAttribute('aria-label') || undefined,
                    text: text || undefined,
                    href: el.tagName === 'A' ? (el.getAttribute('href') || undefined) : undefined,
                    tag: el.tagName.toLowerCase(),
                    role: el.getAttribute('role') || undefined,
                    nearestHeading,
                    parentText,
                    inActiveDialog: inActiveDialog || undefined,
                    dialogLabel,
                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                  }
                })
                if (info) {
                  alternatives.push({ index: i + 1, ...(info as Record<string, unknown>) })
                }
              } catch (altErr) {
                altErrors++
                console.error(
                  `[click] alternatives evaluate FAILED for handle ${i}/${handles.length}:`,
                  String(altErr).slice(0, 250),
                )
              }
            }
            // Sort: alternatives INSIDE an active dialog/menu come first.
            // When a modal is open, the agent almost certainly meant the
            // dialog-internal match — generic across any modal-based app.
            alternatives.sort((a, b) => (b.inActiveDialog ? 1 : 0) - (a.inActiveDialog ? 1 : 0))
            const dialogMatches = alternatives.filter((a) => a.inActiveDialog).length
            // If a dialog is open but no name-matches landed inside it, the
            // target is probably an icon-only button (no text matches "Send"
            // because the real button has aria-label="Press Enter to send"
            // or no name at all). Surface the dialog's iconOnly buttons so
            // the agent can pick by testid / svgHint / rect — generic for
            // any modal with an icon-only primary action.
            let dialogIconButtons: unknown[] | undefined
            if (dialogMatches === 0) {
              const scopeInfo = (await page
                .evaluate(ENUMERATE_BUTTONS_SCRIPT)
                .catch(() => null)) as null | { scope?: string; buttons?: Array<Record<string, unknown>> }
              if (scopeInfo?.scope === 'dialog' || scopeInfo?.scope === 'menu') {
                dialogIconButtons = (scopeInfo.buttons ?? []).filter((b) => b.iconOnly)
              }
            }
            console.log(
              `[click] AMBIGUOUS target=${JSON.stringify(target)} matchCount=${matchCount} alternativesBuilt=${alternatives.length} dialogMatches=${dialogMatches} evalErrors=${altErrors}`,
            )
            for (let i = 0; i < alternatives.length; i++) {
              console.log(`  alt[${i}] →`, JSON.stringify(alternatives[i]).slice(0, 400))
            }
            return {
              ok: false,
              ambiguous: true,
              matchCount,
              error: `${matchCount} elements match ${target}. To disambiguate, call click again with the SAME args plus nth:<index> where index is from the alternatives below.`,
              alternatives,
              dialogIconButtons,
              hint:
                dialogMatches > 0
                  ? `A dialog/menu is currently open and ${dialogMatches} of the alternatives are INSIDE it (inActiveDialog:true, sorted first). Pick the dialog-internal one with nth — the others are unrelated matches from the underlying page.`
                  : dialogIconButtons && dialogIconButtons.length > 0
                    ? `A dialog is open but NONE of the name-matches are inside it. The target is likely an icon-only button (SVG, no visible text "${name ?? target}"). dialogIconButtons lists the icon-only buttons inside the dialog with their testid / svgHint / rect — pick by data-testid (call click with selector:"[data-testid=...]") or by the icon button closest to bottom-right of the dialog (that is conventionally the primary action / send).`
                    : 'No dialog open. Use nth:N to pick the alternative whose nearestHeading/parentText matches your intent. Do NOT guess CSS selectors — identical elements share the same selector pattern.',
            }
          }
          // nth path: pick the Nth match (1-based). Bound-check; if nth is out
          // of range, fall through with an error rather than clicking a
          // wrong element.
          if (nth && matchCount > 0) {
            if (nth > matchCount) {
              return {
                ok: false,
                error: `nth:${nth} is out of range — only ${matchCount} match${matchCount === 1 ? '' : 'es'} for ${target}.`,
              }
            }
            loc = loc.nth(nth - 1)
          }

          await animateMouseTo(page, loc)
          // Try a normal click first. If Playwright's actionability checks
          // fail (overlay intercepts pointer events, element outside viewport,
          // not visible yet), recover automatically instead of bubbling up
          // as a generic failure. The model shouldn't have to write
          // run_playwright_code just because a cookie banner is in the way.
          let clickStrategy = 'normal'
          try {
            await loc.first().click({ timeout: 6_000 })
          } catch (e1) {
            const msg1 = String(e1)
            const isActionabilityErr =
              /intercept|not visible|outside.*viewport|element is not stable|element is not enabled/i.test(
                msg1,
              )
            if (!isActionabilityErr) throw e1
            // Stage 1 recovery: scroll into view + force click (skips
            // actionability checks, including the overlay-intercept check).
            try {
              await loc.first().scrollIntoViewIfNeeded({ timeout: 3_000 })
              await loc.first().click({ force: true, timeout: 4_000 })
              clickStrategy = 'force'
            } catch (e2) {
              // Stage 2 recovery: dispatch the click event directly. This
              // fires the JS click handler without simulating a real mouse
              // click at all — bypasses any overlay covering the element
              // because we're not going through the hit-test pipeline.
              await loc.first().dispatchEvent('click')
              clickStrategy = 'dispatch'
            }
          }

          // Navigation handling — the click may have triggered same-page state
          // change OR full navigation (especially cross-subdomain, e.g.
          // cal.com -> app.cal.com which takes 2-8s). Wait properly for the
          // new page to settle so the next tool call doesn't run against a
          // mid-transition page (which is what destroyed inspect_page's
          // execution context in prior failures).
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
          } catch {
            /* navigation may not have happened — fine, fall through */
          }
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
          // Re-install the cursor on the (possibly new) page so subsequent
          // polls keep showing it. addInitScript runs first but a server-side
          // injection is the reliable fallback.
          await ensureCursor(page)

          const afterUrl = page.url()
          return {
            ok: true,
            clicked: target,
            url: afterUrl,
            navigated: beforeUrl !== afterUrl,
            previousUrl: beforeUrl !== afterUrl ? beforeUrl : undefined,
            // 'normal' = clean click; 'force' = skipped actionability checks
            // (overlay was in the way); 'dispatch' = fired JS event directly
            // (real mouse click was blocked). 'force' or 'dispatch' is fine
            // for triggering the action but signals the page has overlays.
            strategy: clickStrategy === 'normal' ? undefined : clickStrategy,
          }
        } catch (e) {
          // Self-diagnose: enumerate visible buttons in the active scope so
          // the model can identify icon-only / oddly-labeled controls in the
          // SAME observation without another round-trip.
          const diag = await page
            .evaluate(ENUMERATE_BUTTONS_SCRIPT)
            .catch(() => null) as null | { scope?: string; buttons?: unknown[]; inputs?: unknown[] }
          return {
            ok: false,
            error: `Could not click ${target}: ${String(e)}`,
            scope: diag?.scope,
            candidates: diag?.buttons ?? [],
            inputCandidates: diag?.inputs ?? [],
            hint: 'Atomic click failed. Inspect the candidates above (look at iconOnly + svgHint + rect — the send/submit button is usually the icon-only button at the bottom-right of a dialog). If nothing here matches, use run_playwright_code to enumerate or click by position.',
          }
        }
      },
    }),

    fill: tool({
      description:
        'Type text into an input, textarea, or contenteditable element. Prefer a precise CSS `selector` from get_html — that is the only reliable way to target a field whose accessible name is missing or duplicated (e.g. distinguishing a username box from a password box). Or use accessible `name` for clearly-labelled fields.',
      inputSchema: z.object({
        text: z.string().describe('The text to type.'),
        selector: z
          .string()
          .optional()
          .describe('CSS selector of the field, e.g. "input[type=password]", "#email". Most reliable.'),
        name: z.string().optional().describe('Accessible name / label, used only when no selector is given.'),
        role: z.string().default('textbox').describe('Role of the field when using name; usually "textbox".'),
        exact: z
          .boolean()
          .optional()
          .describe('Require an EXACT name match (default true). Set false to allow substring matching.'),
        nth: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based index — use when multiple fields share the same accessible name (e.g. two "Password" inputs on a sign-up form). The Nth match is filled directly.'),
      }),
      execute: async ({ text, selector, name, role, exact, nth }) => {
        const { page } = await getSession(chatId)
        const target = selector ?? name ?? '(unspecified)'
        try {
          // Same progressive-widening strategy as click(): try specific then
          // generic, fail fast if nothing matches. Covers the contenteditable
          // case (textarea[role=textbox] vs div[role=textbox] vs no role at all).
          let loc
          if (selector) {
            loc = page.locator(selector)
          } else if (name) {
            const useExact = exact !== false
            // Same Webwright-style philosophy as click(): don't scope, just
            // try the specific thing the agent asked for, progressively widen,
            // and surface ambiguity rather than blindly picking .first().
            const tryStages = [
              page.getByRole(role as never, { name, exact: true }),
              ...(useExact ? [page.getByRole(role as never, { name })] : []),
              page.getByRole('textbox' as never, { name, exact: true }),
              page.getByRole('searchbox' as never, { name, exact: true }),
              page.getByRole('combobox' as never, { name, exact: true }),
              page.getByLabel(name, { exact: true }),
              page.getByPlaceholder(name, { exact: false }),
            ]
            for (const stage of tryStages) {
              if ((await stage.count()) > 0) {
                loc = stage
                break
              }
            }
          } else {
            return { ok: false, error: 'fill() needs either `selector` or `name`.' }
          }

          if (!loc || (await loc.count()) === 0) {
            const diag = (await page
              .evaluate(ENUMERATE_BUTTONS_SCRIPT)
              .catch(() => null)) as null | { scope?: string; buttons?: unknown[]; inputs?: unknown[] }
            return {
              ok: false,
              error: `No input field matches ${target} (tried role+name with several roles, getByLabel, getByPlaceholder).`,
              scope: diag?.scope,
              inputCandidates: diag?.inputs ?? [],
              candidates: diag?.buttons ?? [],
              hint: 'Pick from inputCandidates above by ariaLabel/ariaPlaceholder/placeholder/role. If your target field is missing, the active scope may be wrong (no dialog open yet, or wrong dialog).',
            }
          }

          const fillCount = await loc.count()
          if (nth) {
            if (nth > fillCount) {
              return { ok: false, error: `nth:${nth} is out of range — only ${fillCount} field${fillCount === 1 ? '' : 's'} match ${target}.` }
            }
            loc = loc.nth(nth - 1)
          } else if (fillCount > 1) {
            return {
              ok: false,
              ambiguous: true,
              matchCount: fillCount,
              error: `${fillCount} input fields match ${target}. Call fill again with the same args plus nth:<1-based index> to pick one, or use a more specific name/selector.`,
              hint: 'Identical-named fields are usually paired (e.g. password + confirm-password). Use nth:1 for the first occurrence and nth:2 for the second — DOM order matches visual order.',
            }
          }

          await animateMouseTo(page, loc)
          await loc.first().fill(text, { timeout: 8_000 })
          return { ok: true, filled: target }
        } catch (e) {
          return { ok: false, error: `Could not fill ${target}: ${String(e)}` }
        }
      },
    }),

    press_key: tool({
      description: 'Press a keyboard key on the page, e.g. "Enter", "Tab", "Escape".',
      inputSchema: z.object({ key: z.string().describe('A Playwright key name, e.g. "Enter".') }),
      execute: async ({ key }) => {
        const { page } = await getSession(chatId)
        try {
          await page.keyboard.press(key)
          await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {})
          return { ok: true, pressed: key }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    wait_for: tool({
      description:
        'Wait until the page reaches a condition before continuing. Use this after triggering anything slow — a video/report generation, an upload, a long load, a form submit that processes — instead of asserting immediately or polling with screenshots. It waits server-side in a single call. YOU decide how long: set timeoutSeconds to however long the action realistically needs (e.g. 300 for something that may take about five minutes).',
      inputSchema: z.object({
        text: z
          .string()
          .optional()
          .describe('Wait for this visible text to appear (or, with state "hidden", to disappear).'),
        selector: z
          .string()
          .optional()
          .describe('CSS selector to wait for. Provide either text or selector.'),
        state: z
          .enum(['visible', 'hidden', 'attached', 'detached'])
          .default('visible')
          .describe(
            'Condition: "visible" (appears), "hidden" (disappears — e.g. a loading spinner), "attached", or "detached".',
          ),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(600)
          .default(60)
          .describe(
            'How long to wait, in seconds — set it as high as the action realistically needs. Max 600 (10 minutes).',
          ),
      }),
      execute: async ({ text, selector, state, timeoutSeconds }) => {
        if (!text && !selector) {
          return { ok: false, error: 'wait_for needs either `text` or `selector`.' }
        }
        const session = await getSession(chatId)
        session.lastUsed = Date.now() // keep the session alive through a long wait
        const { page } = session
        const timeout = Math.min(Math.max(timeoutSeconds ?? 60, 1), 600) * 1000
        const startedAt = Date.now()
        try {
          const loc = text
            ? page.getByText(text, { exact: false }).first()
            : page.locator(selector as string).first()
          await loc.waitFor({ state, timeout })
          return {
            ok: true,
            waitedMs: Date.now() - startedAt,
            url: page.url(),
            waitedFor: text ? `text "${text}"` : `${selector} (${state})`,
          }
        } catch (e) {
          return {
            ok: false,
            timedOut: true,
            waitedMs: Date.now() - startedAt,
            error: `Condition not met within ${Math.round(timeout / 1000)}s: ${String(e)}`,
          }
        }
      },
    }),

    get_page_text: tool({
      description: 'Get the visible text content of the current page. Use to read results or verify wording.',
      inputSchema: z.object({}),
      execute: async () => {
        const { page } = await getSession(chatId)
        try {
          return { ok: true, text: truncate(await page.locator('body').innerText(), 4_000) }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    check: tool({
      description:
        'Assert that a piece of text is present and visible on the current page. Records a PASS or FAIL. Use it for every expectation the user asked you to verify.',
      inputSchema: z.object({
        expectation: z.string().describe('What you are verifying, e.g. "Order confirmation is shown".'),
        text: z.string().describe('The exact visible text that must be present for this check to pass.'),
      }),
      execute: async ({ expectation, text }) => {
        const { page } = await getSession(chatId)
        const pass = await page
          .getByText(text, { exact: false })
          .first()
          .isVisible({ timeout: 5_000 })
          .catch(() => false)
        return { ok: true, expectation, pass, result: pass ? 'PASS' : 'FAIL' }
      },
    }),

    screenshot: tool({
      description:
        'Capture a screenshot of the current page AND SEE it. The image is delivered to you as the most-recent-screenshot picture in the conversation — look at it to understand the page visually: layout, what is rendered, where things are, what looks broken. Then use get_html for the exact CSS selector of whatever you decided to act on. Take a screenshot after navigating, when unsure what the page looks like, or to verify an action.',
      inputSchema: z.object({}),
      execute: async () => {
        const { page } = await getSession(chatId)
        try {
          mkdirSync(SHOTS_DIR, { recursive: true })
          const file = join(SHOTS_DIR, `${chatId}-${Date.now()}.jpg`)
          // JPEG, not PNG — a screenshot the model only needs to glance at
          // does not warrant lossless bytes, and tokens are scarce.
          const buf = await page.screenshot({ path: file, type: 'jpeg', quality: 55 })
          return { ok: true, saved: file, image: buf.toString('base64') }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
      // Hand the actual image to the multimodal model as a file-data part.
      toModelOutput: ({ output }) => {
        const o = output as { ok?: boolean; image?: string; error?: string }
        if (!o?.ok || !o.image) {
          return {
            type: 'content',
            value: [{ type: 'text', text: `Screenshot failed: ${o?.error ?? 'unknown error'}` }],
          }
        }
        return {
          type: 'content',
          value: [
            { type: 'text', text: 'Screenshot of the current page:' },
            { type: 'file-data', data: o.image, mediaType: 'image/jpeg' },
          ],
        }
      },
    }),

    look: tool({
      description:
        'Look at the page in one call: screenshot (image) + accessibility tree + selector hints + url + title + any new console errors. Prefer this over screenshot/inspect_page/get_console_errors separately when you just want to see what is on the page between actions — it saves round-trips and keeps your context tight.',
      inputSchema: z.object({}),
      execute: async () => {
        const { page } = await getSession(chatId)
        const url = page.url()
        try {
          // Always read text observations first — they survive even when the
          // page is in a heavy/checkpoint state that hangs screenshots.
          const title = await page.title().catch(() => '')
          const tree = await page.locator('body').ariaSnapshot({ timeout: 5_000 }).catch(() => '')

          // Screenshot has its own short timeout (8s instead of Playwright's
          // 30s default) so a slow/blocked page doesn't take down the whole
          // tool. If it times out we still return the textual observation —
          // never blank a look() because the image couldn't be captured.
          mkdirSync(SHOTS_DIR, { recursive: true })
          const file = join(SHOTS_DIR, `${chatId}-${Date.now()}.jpg`)
          let imageBase64: string | undefined
          let imageError: string | undefined
          try {
            const buf = await page.screenshot({
              path: file,
              type: 'jpeg',
              quality: 55,
              timeout: 8_000,
            })
            imageBase64 = buf.toString('base64')
          } catch (shotErr) {
            imageError = String(shotErr).slice(0, 200)
            console.log(`[look] screenshot timed out (url=${url}): ${imageError}`)
          }

          console.log(
            `[look] chat=${chatId.slice(0, 8)} url=${url} title=${JSON.stringify(title).slice(0, 80)}` +
              ` tree=${tree.length}chars image=${imageBase64 ? Math.round(imageBase64.length * 0.75 / 1024) + 'KB' : 'failed'}`,
          )
          console.log(`[look] tree-head:\n${tree.slice(0, 400)}${tree.length > 400 ? '\n…(truncated)' : ''}`)

          return {
            ok: true,
            url,
            title,
            tree: truncate(tree, 5_000),
            image: imageBase64,
            imageError,
          }
        } catch (e) {
          console.error('[look] error:', e)
          return { ok: false, url, error: String(e) }
        }
      },
      // Same pattern as screenshot — hand the JPEG to the multimodal model as
      // a file-data part, plus the textual context next to it. The image is
      // best-effort: if a slow / blocked page made the screenshot time out
      // we still hand back the URL + aria tree so the agent isn't blinded.
      toModelOutput: ({ output }) => {
        const o = output as {
          ok?: boolean
          image?: string
          url?: string
          title?: string
          tree?: string
          imageError?: string
          error?: string
        }
        if (!o?.ok) {
          return {
            type: 'content',
            value: [
              { type: 'text', text: `Look failed: ${o?.error ?? 'unknown error'}\nURL: ${o?.url ?? ''}` },
            ],
          }
        }
        const txt =
          `URL: ${o.url ?? ''}\nTitle: ${o.title ?? ''}` +
          (o.imageError ? `\n[image unavailable: ${o.imageError}]` : '') +
          `\n\nAccessibility tree:\n${o.tree ?? ''}`
        const parts: Array<{ type: 'text'; text: string } | { type: 'file-data'; data: string; mediaType: string }> = [
          { type: 'text', text: txt },
        ]
        if (o.image) parts.push({ type: 'file-data', data: o.image, mediaType: 'image/jpeg' })
        return { type: 'content', value: parts }
      },
    }),

    do_steps: tool({
      description:
        'Run multiple atomic browser actions in ONE call instead of round-tripping one at a time. Use it whenever a flow needs 2+ consecutive steps with no decision in between — e.g. fill email, fill password, click submit, wait_for "Welcome". Stops on the first failure and reports which step failed.',
      inputSchema: z.object({
        actions: z
          .array(
            z.union([
              z.object({
                type: z.literal('click'),
                selector: z.string().optional(),
                role: z.string().optional(),
                name: z.string().optional(),
              }),
              z.object({
                type: z.literal('fill'),
                text: z.string(),
                selector: z.string().optional(),
                name: z.string().optional(),
                role: z.string().default('textbox'),
              }),
              z.object({
                type: z.literal('press_key'),
                key: z.string(),
              }),
              z.object({
                type: z.literal('wait_for'),
                text: z.string().optional(),
                selector: z.string().optional(),
                state: z.enum(['visible', 'hidden', 'attached', 'detached']).default('visible'),
                timeoutSeconds: z.number().int().min(1).max(600).default(30),
              }),
              z.object({
                type: z.literal('goto'),
                url: z.string(),
              }),
            ]),
          )
          .min(1)
          .describe('Ordered list of actions to perform in sequence.'),
      }),
      execute: async ({ actions }) => {
        const session = await getSession(chatId)
        const { page } = session
        const results: Array<Record<string, unknown>> = []
        for (let i = 0; i < actions.length; i++) {
          const a = actions[i]
          session.lastUsed = Date.now()
          try {
            if (a.type === 'goto') {
              const resp = await page.goto(a.url, {
                waitUntil: 'domcontentloaded',
                timeout: 30_000,
              })
              await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
              results.push({
                step: i + 1,
                type: 'goto',
                ok: true,
                url: page.url(),
                status: resp?.status() ?? null,
              })
            } else if (a.type === 'click') {
              const target = a.selector ?? `${a.role ?? ''} "${a.name ?? ''}"`.trim()
              let loc
              if (a.selector) {
                loc = page.locator(a.selector)
              } else {
                const exactLoc = page.getByRole((a.role as never) ?? 'button', {
                  name: a.name ?? '',
                  exact: true,
                })
                loc =
                  (await exactLoc.count()) > 0
                    ? exactLoc
                    : page.getByRole((a.role as never) ?? 'button', { name: a.name ?? '' })
              }
              await animateMouseTo(page, loc)
              await loc.first().click({ timeout: 8_000 })
              await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {})
              results.push({ step: i + 1, type: 'click', ok: true, target, url: page.url() })
            } else if (a.type === 'fill') {
              const target = a.selector ?? a.name ?? '(unspecified)'
              let loc
              if (a.selector) {
                loc = page.locator(a.selector)
              } else {
                const exactLoc = page.getByRole((a.role as never) ?? 'textbox', {
                  name: a.name ?? '',
                  exact: true,
                })
                loc =
                  (await exactLoc.count()) > 0
                    ? exactLoc
                    : page.getByRole((a.role as never) ?? 'textbox', { name: a.name ?? '' })
              }
              await animateMouseTo(page, loc)
              await loc.first().fill(a.text, { timeout: 8_000 })
              results.push({ step: i + 1, type: 'fill', ok: true, target })
            } else if (a.type === 'press_key') {
              await page.keyboard.press(a.key)
              await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {})
              results.push({ step: i + 1, type: 'press_key', ok: true, pressed: a.key })
            } else if (a.type === 'wait_for') {
              if (!a.text && !a.selector) {
                results.push({
                  step: i + 1,
                  type: 'wait_for',
                  ok: false,
                  error: 'wait_for needs either text or selector',
                })
                return { ok: false, completed: i, results }
              }
              const timeout = (a.timeoutSeconds ?? 30) * 1000
              const loc = a.text
                ? page.getByText(a.text, { exact: false }).first()
                : page.locator(a.selector as string).first()
              const startedAt = Date.now()
              await loc.waitFor({ state: a.state, timeout })
              results.push({
                step: i + 1,
                type: 'wait_for',
                ok: true,
                waitedMs: Date.now() - startedAt,
              })
            }
          } catch (e) {
            results.push({ step: i + 1, type: a.type, ok: false, error: String(e) })
            return { ok: false, completed: i, results, failedAt: i + 1 }
          }
        }
        return { ok: true, completed: actions.length, results, url: page.url() }
      },
    }),

    run_playwright_code: tool({
      description:
        'Escape hatch — execute arbitrary Playwright JavaScript against the current page. Use when atomic tools cannot express what you need: picking among ambiguous matches inline, falling back across multiple selectors, inspecting state mid-action, or any short multi-step logic with conditions. The function receives `page` and `context` (Playwright objects) and runs against the SAME persistent browser session as all other tools. Capture evidence with console.log — anything you log is returned to you as the observation. Keep scripts under ~30 lines; for longer flows, split across turns.',
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            'JavaScript that runs as an async function body with `page` and `context` in scope. Use console.log to surface observations (URL, aria snapshot, what worked). Example: `for (const sel of [\'textarea[aria-label*="message"]\', \'[role="textbox"]\']) { const loc = page.locator(sel); if (await loc.count() > 0) { await loc.first().fill("hello"); console.log("filled via", sel); break; } } console.log("URL:", page.url());`',
          ),
      }),
      execute: async ({ code }) => {
        const { page, context } = await getSession(chatId)
        // Wrap user code in an async function body. We intercept console.log
        // so the agent sees its own prints back as the observation (same
        // pattern Webwright uses with python's redirect_stdout).
        const wrapped =
          'const __logs = [];\n' +
          'const __fmt = (a) => typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })();\n' +
          'const console = { log: (...a) => __logs.push(a.map(__fmt).join(" ")), error: (...a) => __logs.push("ERR: " + a.map(__fmt).join(" ")), warn: (...a) => __logs.push("WARN: " + a.map(__fmt).join(" ")), info: (...a) => __logs.push(a.map(__fmt).join(" ")) };\n' +
          'try {\n' +
          code +
          '\n} catch (__err) { __logs.push("THROWN: " + (__err && __err.stack ? __err.stack : String(__err))); throw __err; }\n' +
          'return __logs.join("\\n");'
        const startedAt = Date.now()
        try {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
          const fn = new Function(
            'page',
            'context',
            `return (async () => { ${wrapped} })()`,
          )
          const output = await fn(page, context)
          await ensureCursor(page).catch(() => {})
          return {
            ok: true,
            durationMs: Date.now() - startedAt,
            url: page.url(),
            output: truncate(String(output ?? ''), 8_000),
          }
        } catch (e) {
          // Try to still surface any logs the script wrote before it threw.
          await ensureCursor(page).catch(() => {})
          return {
            ok: false,
            durationMs: Date.now() - startedAt,
            url: page.url(),
            error: String(e),
          }
        }
      },
    }),

    propose_test_plan: proposeTestPlanTool(),

    step_status: tool({
      description:
        'Report progress on the approved test plan during a workspace run. Call with status "running" right BEFORE you begin a plan step, and "passed" or "failed" right AFTER you finish it. stepIndex is the 1-based number of the plan step.',
      inputSchema: z.object({
        stepIndex: z.number().int().describe('1-based number of the plan step.'),
        status: z.enum(['running', 'passed', 'failed']).describe('Current state of that step.'),
        note: z.string().optional().describe('Short note — especially the reason on a failure.'),
      }),
      execute: async ({ stepIndex, status, note }) => ({ ok: true, stepIndex, status, note }),
    }),

    list_test_accounts: tool({
      description:
        'List the saved test accounts available for this workspace (labels only, no passwords). Use this when a test needs to sign in, then call use_test_account to get the credentials.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!agent) return { ok: false, error: 'No workspace — test accounts are unavailable.' }
        return {
          ok: true,
          accounts: agent.testAccounts.map((a) => ({ label: a.label, username: a.username, notes: a.notes ?? '' })),
        }
      },
    }),

    use_test_account: tool({
      description:
        'Get the username and password of a saved test account so you can fill a login/signup form. Pass the account label exactly as list_test_accounts reports it.',
      inputSchema: z.object({
        label: z.string().describe('The label of the test account to use.'),
      }),
      execute: async ({ label }) => {
        if (!agent) return { ok: false, error: 'No workspace — test accounts are unavailable.' }
        const acc = agent.testAccounts.find(
          (a) => a.label.toLowerCase() === label.toLowerCase(),
        )
        if (!acc) {
          return {
            ok: false,
            error: `No test account labelled "${label}". Available: ${
              agent.testAccounts.map((a) => a.label).join(', ') || '(none)'
            }`,
          }
        }
        return { ok: true, label: acc.label, username: acc.username, password: acc.password }
      },
    }),

    report_to_github: tool({
      description:
        'File the test result as a GitHub issue on the workspace repository. Use this at the end of a run when you found a bug or want to record the outcome. Only works if a repo and token are configured in the workspace settings.',
      inputSchema: z.object({
        title: z.string().describe('Issue title — concise summary of the result.'),
        body: z.string().describe('Issue body — the full report in markdown.'),
      }),
      execute: async ({ title, body }) => {
        const repo = agent?.settings.githubRepo?.trim()
        if (!repo) return { ok: false, error: 'No GitHub repository selected — choose one in PR Testing.' }
        const fullBody = `${body}\n\n— filed by Probe agent`
        // Prefer the user's Composio GitHub connection.
        if (agent?.userId) {
          const r = await githubCreateIssue(agent.userId, repo, title, fullBody)
          if (r.ok) return { ok: true, url: r.url, number: r.number }
        }
        // Fall back to a manual personal access token if one is set.
        const token = agent?.settings.githubToken?.trim()
        if (!token) {
          return { ok: false, error: 'GitHub is not connected — connect it in the Integrations tab.' }
        }
        try {
          const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title, body: fullBody }),
          })
          if (!res.ok) {
            return { ok: false, error: `GitHub API ${res.status}: ${await res.text()}` }
          }
          const issue = (await res.json()) as { html_url?: string; number?: number }
          return { ok: true, url: issue.html_url, number: issue.number }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
    }),

    get_console_errors: tool({
      description:
        'Return JavaScript console errors and failed network requests captured since the page was opened. Use to catch hidden bugs before reporting.',
      inputSchema: z.object({}),
      execute: async () => {
        const { consoleErrors } = await getSession(chatId)
        return { ok: true, count: consoleErrors.length, errors: consoleErrors.slice(-30) }
      },
    }),

    list_flows: tool({
      description:
        'List the recorded flows the user ATTACHED to this chat. Returns name + purpose + step count only — call get_flow to read a flow\'s actual steps and stored page data. Use this to discover which flow (if any) matches the user\'s current request by reading each `purpose` string.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!userId) return { ok: false, error: 'No user context — flows are per-user.' }
        const attached = await listAttachedFlows(userId, chatId)
        return {
          ok: true,
          flows: attached.map((f) => ({
            name: f.name,
            purpose: f.purpose,
            steps: f.steps.length,
            params: f.meta.params,
            pagesKnown: f.pages.length,
          })),
          hint:
            attached.length === 0
              ? 'No flows are attached. Use atomic browser tools (navigate, click, fill, etc.) only.'
              : 'Pick the flow whose purpose matches the user request, then call get_flow(name) to read its steps + pages. EXECUTE the flow yourself using your atomic tools — there is no replay tool.',
        }
      },
    }),

    get_flow: tool({
      description:
        'Read the full data of a recorded flow attached to this chat: the ordered list of demonstrated steps (each with kind, captured selector, role+name, value, paramName) AND the page index — for every URL the recording visited, every interactive element pre-resolved with its selector / role / name / rect / in-dialog flag / svg hint. THIS DATA IS YOUR GUIDE: walk the steps yourself with navigate/click/fill, using each step\'s captured selector AND role+name as your primary targets, and the page index as backup when a selector doesn\'t match. If the live page diverges from the recording, you decide whether to adapt or stop. Substitute any paramName values from the user\'s request (e.g. {"username": "..."}).',
      inputSchema: z.object({
        name: z.string().describe('Flow name exactly as list_flows shows it.'),
      }),
      execute: async ({ name }) => {
        if (!userId) return { ok: false, error: 'No user context — flows are per-user.' }
        const attached = await listAttachedFlows(userId, chatId)
        const flow = attached.find((f) => f.name === name)
        if (!flow) {
          return {
            ok: false,
            error: `No flow named "${name}" is attached. Call list_flows to see what's attached.`,
          }
        }
        await touchFlowUsed(userId, flow.id).catch(() => {})
        return {
          ok: true,
          name: flow.name,
          purpose: flow.purpose,
          params: flow.meta.params,
          // Steps the human demonstrated, in order. Carry every captured
          // field so the agent can pick the most reliable target per step.
          steps: flow.steps.map((s, i) => ({
            index: i + 1,
            kind: s.kind,
            label: s.label,
            selector: s.selector,
            role: s.role,
            name: s.name,
            value: s.value,
            paramName: s.paramName,
            waitText: s.waitText,
          })),
          // Pre-computed element index per URL pattern. When the agent
          // navigates to one of these URLs during execution, it can read
          // the cached `elements` / `inputs` to know exactly what's on
          // the page without inspect_page.
          pages: flow.pages.map((p) => ({
            url: p.url,
            urlPattern: p.urlPattern,
            title: p.title,
            elements: p.elements,
            inputs: p.inputs,
            networkSignatures: p.networkSignatures,
          })),
          hint:
            'Walk these steps with your atomic tools. Each step gives you the captured selector + role+name — try the selector first via click(selector:...) or fill(selector:..., text:...), and fall back to click(role, name) if it misses. For navigate steps, call navigate(url) with the captured value (or the substituted param). After each step, briefly verify the page matches expectations (look() or inspect_page) and adapt if it diverges — do NOT plow forward blindly. If the user provided random/test values for required params and the flow needs real data (auth credentials, valid email format, etc.), stop and ask before continuing.',
        }
      },
    }),
  }
}
