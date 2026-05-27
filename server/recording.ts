/**
 * Human-driven flow recording.
 *
 * The user opens the Recording tab, hits Start, types a URL — we launch a
 * Playwright session, inject a capture script via addInitScript that listens
 * for click / input / keydown events in the page, and persist each event as
 * a FlowStep on a recording_sessions row. On Stop the row is finalized; the
 * user can then promote it to a named recorded_flows entry.
 *
 * Replay (the run_flow agent tool) walks the same FlowStep[] using the
 * existing navigate / click / fill / press_key / wait_for primitives.
 */
import { eq, and, desc } from 'drizzle-orm'
import {
  db,
  recordingSessions,
  recordedFlows,
  chatFlowAttachments,
  type FlowStep,
  type RecordedFlowRow,
  type PageSnapshot,
  type PageElement,
} from './db/index.ts'
import { getSession, resetSession } from './browser.ts'
import type { Page } from 'playwright'

/** In-memory bookkeeping for active recording sessions. */
interface ActiveRecording {
  recordingId: string
  userId: string
  /** chatId used to look up the underlying browser session in browser.ts. */
  chatId: string
  /** Last navigation we recorded — used to dedupe rapid same-URL framenavigated events. */
  lastUrl: string
  /** Buffered fill value per element id, flushed on blur/keydown(Enter). */
  pendingFill: Map<string, FlowStep>
  /** URL patterns we've already snapshotted in this recording (don't re-snap on every revisit). */
  snappedPatterns: Set<string>
  /** Debounce timer for the next snapshot attempt. */
  snapshotTimer: ReturnType<typeof setTimeout> | null
  /** Network requests observed since the most recent navigation (capped). */
  recentNetwork: string[]
}

const active = new Map<string, ActiveRecording>()

/**
 * Normalize a URL to a pattern by replacing numeric / uuid / hex / slug-like
 * segments with placeholders. Lets `/users/123` and `/users/789` share one
 * cached page index — exactly the StableBrowse "knows the SHAPE of this page"
 * behavior. Keeps the scheme + host + path; drops query + hash because most
 * sites use query params for filters and a separate cache per filter combo
 * would explode the index.
 */
function normalizeUrlPattern(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    const segments = u.pathname.split('/').map((seg) => {
      if (!seg) return seg
      // Pure number → :id
      if (/^\d+$/.test(seg)) return ':id'
      // UUID → :id
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id'
      // Long hex token → :id
      if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id'
      // Mixed slug with digits-in-the-middle → :slug
      if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(seg) && /\d/.test(seg)) return ':slug'
      return seg
    })
    return `${u.protocol}//${u.host}${segments.join('/')}`
  } catch {
    return rawUrl
  }
}

/**
 * Snapshot the full interactive element index of a page. Two evaluates:
 *   1. ariaSnapshot → the semantic tree (top-level structure)
 *   2. enumerate(buttons, links, role-tagged elements, inputs) → flat list
 *      with the best selector pre-resolved for each (testid > id > role+
 *      aria-label > href > short CSS).
 * Result is the index the agent will use INSTEAD of a live DOM scan when
 * it encounters this URL pattern.
 */
async function snapshotPage(page: Page, recentNetwork: string[]): Promise<PageSnapshot | null> {
  let url = ''
  let title = ''
  let semanticTree = ''
  try {
    url = page.url()
    title = await page.title().catch(() => '')
  } catch {
    return null
  }
  if (!url || url === 'about:blank') return null
  try {
    semanticTree = await page.locator('body').ariaSnapshot({ timeout: 4_000 }).catch(() => '')
  } catch {
    /* tolerate — element index alone is still useful */
  }
  let elementsRaw: { elements: PageElement[]; inputs: PageElement[] } | null = null
  try {
    elementsRaw = await page.evaluate(() => {
      const cssEscape = (s: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c))
      const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
      const isVisible = (el: Element) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return false
        const cs = getComputedStyle(el)
        return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0
      }
      const inDialog = (el: Element): boolean => {
        let n: Element | null = el.parentElement
        for (let i = 0; i < 12 && n; i++) {
          const role = n.getAttribute && n.getAttribute('role')
          if (
            n.tagName === 'DIALOG' ||
            role === 'dialog' ||
            role === 'alertdialog' ||
            role === 'menu' ||
            role === 'listbox'
          )
            return true
          n = n.parentElement
        }
        return false
      }
      const uniqueOnce = (sel: string) => {
        try {
          return document.querySelectorAll(sel).length === 1
        } catch {
          return false
        }
      }
      const bestSelector = (el: Element): string => {
        const testid = el.getAttribute && el.getAttribute('data-testid')
        if (testid) return `[data-testid="${cssEscape(testid)}"]`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const id = (el as any).id as string | undefined
        if (id && /^[a-zA-Z][\w-]*$/.test(id) && uniqueOnce('#' + cssEscape(id))) {
          return '#' + cssEscape(id)
        }
        const aria = el.getAttribute && el.getAttribute('aria-label')
        if (aria) {
          const sel = `[aria-label="${cssEscape(aria)}"]`
          if (uniqueOnce(sel)) return sel
        }
        const tag = el.tagName.toLowerCase()
        const href = tag === 'a' ? el.getAttribute('href') || '' : ''
        if (tag === 'a' && href) {
          const sel = `a[href="${cssEscape(href)}"]`
          if (uniqueOnce(sel)) return sel
        }
        // Short text content for buttons/links — Playwright-flavored.
        const text = ((el as HTMLElement).innerText || '').trim()
        if ((tag === 'button' || tag === 'a') && text && text.length < 50) {
          return `${tag}:has-text("${text.replace(/"/g, '\\"')}")`
        }
        // Fall back to a short CSS path.
        const parts: string[] = []
        let n: Element | null = el
        for (let i = 0; i < 5 && n && n.tagName !== 'BODY'; i++) {
          let part = n.tagName.toLowerCase()
          if (n.classList && n.classList.length) {
            const cls = Array.from(n.classList)
              .filter((c) => /^[a-zA-Z][\w-]*$/.test(c))
              .slice(0, 2)
            if (cls.length) part += '.' + cls.join('.')
          }
          parts.unshift(part)
          n = n.parentElement
        }
        return parts.join(' > ')
      }
      const accessibleName = (el: Element): string => {
        const aria = el.getAttribute && el.getAttribute('aria-label')
        if (aria) return trunc(aria.trim(), 100)
        const ll = el.getAttribute && el.getAttribute('aria-labelledby')
        if (ll) {
          const id = ll.split(' ')[0]
          const tgt = id && document.getElementById(id)
          if (tgt) return trunc((tgt.textContent || '').trim(), 100)
        }
        const text = ((el as HTMLElement).innerText || '').trim()
        if (text) return trunc(text, 100)
        const ph = el.getAttribute && el.getAttribute('placeholder')
        if (ph) return trunc(ph, 100)
        return ''
      }
      const elements: PageElement[] = []
      const inputs: PageElement[] = []
      const interactiveSelector =
        'button, [role="button"], a, [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], input[type="submit"], input[type="button"]'
      document.querySelectorAll(interactiveSelector).forEach((el) => {
        if (!isVisible(el)) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((el as any).disabled) return
        const r = el.getBoundingClientRect()
        const text = ((el as HTMLElement).innerText || '').trim()
        const tag = el.tagName.toLowerCase()
        const role =
          el.getAttribute('role') ||
          (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'input' ? 'button' : tag)
        const svg = el.querySelector('svg')
        const iconOnly = !!svg && !text
        const svgHint = svg
          ? trunc((svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '').trim(), 60)
          : undefined
        elements.push({
          selector: bestSelector(el),
          role,
          name: accessibleName(el),
          text: text || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          testid: el.getAttribute('data-testid') || undefined,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          inDialog: inDialog(el) || undefined,
          iconOnly: iconOnly || undefined,
          svgHint: svgHint || undefined,
          href: tag === 'a' ? el.getAttribute('href') || undefined : undefined,
        })
      })
      document
        .querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]')
        .forEach((el) => {
          if (!isVisible(el)) return
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((el as any).disabled) return
          const r = el.getBoundingClientRect()
          const ce = el.getAttribute('contenteditable') === 'true'
          const tag = el.tagName.toLowerCase()
          inputs.push({
            selector: bestSelector(el),
            role: el.getAttribute('role') || (tag === 'input' ? 'textbox' : tag),
            name: accessibleName(el),
            placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            testid: el.getAttribute('data-testid') || undefined,
            contenteditable: ce || undefined,
            inDialog: inDialog(el) || undefined,
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          })
        })
      return { elements, inputs }
    })
  } catch {
    /* page may have navigated away — return partial snapshot */
  }
  return {
    url,
    urlPattern: normalizeUrlPattern(url),
    title,
    semanticTree,
    elements: elementsRaw?.elements ?? [],
    inputs: elementsRaw?.inputs ?? [],
    networkSignatures: Array.from(new Set(recentNetwork)).slice(0, 30),
    capturedAt: Date.now(),
  }
}

/** Persist a PageSnapshot onto the recording's pages array. */
async function appendPage(recordingId: string, snap: PageSnapshot): Promise<void> {
  const [row] = await db
    .select()
    .from(recordingSessions)
    .where(eq(recordingSessions.id, recordingId))
  if (!row) return
  // Replace any existing snapshot for the same urlPattern so the most recent
  // observation wins (the user may have navigated through the page twice).
  const filtered = row.pages.filter((p) => p.urlPattern !== snap.urlPattern)
  await db
    .update(recordingSessions)
    .set({ pages: [...filtered, snap] })
    .where(eq(recordingSessions.id, recordingId))
}

/** Capture script — runs INSIDE the browser on every page load. */
const CAPTURE_SCRIPT = `
(() => {
  if (window.__probeRecorderInstalled) return
  window.__probeRecorderInstalled = true

  // ---- best-selector builder (in-browser) ----
  // Priority: data-testid > stable id > role+aria-label > unique role+text
  //         > short css path. The replayer treats selector as Playwright-flavor
  //         (so role+name and getByText forms are fine).
  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\\\' + c))
  const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) : s)

  function uniqueSelector(sel) {
    try { return document.querySelectorAll(sel).length === 1 } catch { return false }
  }

  function cssPath(el, depth) {
    const parts = []
    let n = el
    for (let i = 0; i < depth && n && n.nodeType === 1 && n.tagName !== 'BODY'; i++) {
      let part = n.tagName.toLowerCase()
      if (n.id && /^[a-zA-Z][\\w-]*$/.test(n.id)) {
        part = '#' + n.id
        parts.unshift(part)
        break
      }
      if (n.classList && n.classList.length) {
        const cls = Array.from(n.classList).filter((c) => /^[a-zA-Z][\\w-]*$/.test(c)).slice(0, 2)
        if (cls.length) part += '.' + cls.join('.')
      }
      const parent = n.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === n.tagName)
        if (siblings.length > 1) {
          const idx = siblings.indexOf(n) + 1
          part += ':nth-of-type(' + idx + ')'
        }
      }
      parts.unshift(part)
      n = n.parentElement
    }
    return parts.join(' > ')
  }

  function bestSelector(el) {
    if (!el || el.nodeType !== 1) return ''
    const testid = el.getAttribute && el.getAttribute('data-testid')
    if (testid) return '[data-testid="' + cssEscape(testid) + '"]'
    if (el.id && /^[a-zA-Z][\\w-]*$/.test(el.id) && uniqueSelector('#' + cssEscape(el.id))) {
      return '#' + cssEscape(el.id)
    }
    const aria = el.getAttribute && el.getAttribute('aria-label')
    const explicitRole = el.getAttribute && el.getAttribute('role')
    const tag = el.tagName.toLowerCase()
    const role = explicitRole || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'input' ? 'textbox' : '')
    if (aria) {
      const sel = '[aria-label="' + cssEscape(aria) + '"]'
      if (uniqueSelector(sel)) return sel
    }
    // Short text on buttons/links — Playwright understands :has-text but we
    // emit a CSS selector + carry role+name separately for replay fallback.
    return cssPath(el, 5)
  }

  function accessibleName(el) {
    const aria = el.getAttribute && el.getAttribute('aria-label')
    if (aria) return truncate(aria.trim(), 120)
    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const id = labelledBy.split(' ')[0]
      const target = id && document.getElementById(id)
      if (target) return truncate((target.textContent || '').trim(), 120)
    }
    // <label for="...">
    if (el.id) {
      const lbl = document.querySelector('label[for="' + cssEscape(el.id) + '"]')
      if (lbl) return truncate((lbl.textContent || '').trim(), 120)
    }
    const tag = el.tagName
    const isField = tag === 'INPUT' || tag === 'TEXTAREA' || (el.getAttribute && el.getAttribute('contenteditable') === 'true')
    // For text fields, NEVER fall back to .value — that's the data the user
    // just typed, not a label, and would produce 'Fill "hritvik" with "hritvik"'.
    // Prefer placeholder, then aria-placeholder, then the field's name attr,
    // then an enclosing fieldset/label text. innerText/value only used for
    // buttons and links (where the visible text IS the label).
    if (isField) {
      const placeholder = el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('aria-placeholder'))
      if (placeholder) return truncate(placeholder, 120)
      const nameAttr = el.getAttribute && el.getAttribute('name')
      if (nameAttr) return truncate(nameAttr, 60)
      // Walk up to a containing label or fieldset legend.
      let n = el.parentElement
      for (let i = 0; i < 4 && n; i++) {
        if (n.tagName === 'LABEL') {
          const lt = (n.textContent || '').trim()
          if (lt) return truncate(lt, 80)
        }
        const legend = n.querySelector ? n.querySelector('legend') : null
        if (legend) {
          const lt = (legend.textContent || '').trim()
          if (lt) return truncate(lt, 80)
        }
        n = n.parentElement
      }
      return ''
    }
    const text = (el.innerText || '').trim()
    if (text) return truncate(text, 120)
    const placeholder = el.getAttribute && el.getAttribute('placeholder')
    if (placeholder) return truncate(placeholder, 120)
    return ''
  }

  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase()
      if (t === 'submit' || t === 'button') return 'button'
      if (t === 'checkbox') return 'checkbox'
      if (t === 'radio') return 'radio'
      return 'textbox'
    }
    if (tag === 'textarea') return 'textbox'
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return 'textbox'
    return tag
  }

  function emit(step) {
    try {
      // Each recorded step gets a wall-clock timestamp so the UI can show
      // pacing. The server is the source of truth; the in-browser timestamp
      // is just a hint.
      step.at = Date.now()
      if (window.__probeCapture) window.__probeCapture(step)
    } catch (e) { /* server may have gone away during navigation; tolerable */ }
  }

  // ---- click capture ----
  // Capture phase so we record the click BEFORE any handler swaps the DOM.
  // Skip the cursor overlay we inject in browser.ts — that's chrome, not page.
  document.addEventListener('click', (e) => {
    const t = e.target
    if (!t || !(t instanceof Element)) return
    if (t.closest('#__probe_cursor, #__probe_cursor_ring')) return
    // Walk up to the nearest interactive ancestor so clicking the <span> inside
    // a <button> still records the button.
    let el = t
    for (let depth = 0; depth < 6 && el; depth++) {
      const tag = el.tagName
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
          (el.getAttribute && (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link' || el.getAttribute('role') === 'menuitem' || el.getAttribute('role') === 'tab'))) {
        break
      }
      el = el.parentElement
    }
    if (!el) el = t
    const selector = bestSelector(el)
    const role = roleOf(el)
    const name = accessibleName(el)
    const label = 'Click ' + (role || 'element') + (name ? ' "' + truncate(name, 40) + '"' : '')
    emit({ kind: 'click', selector, role, name, label })
  }, { capture: true })

  // ---- fill capture (input + change) ----
  // We debounce by flushing on blur OR keydown(Enter/Tab). Each typing burst
  // becomes ONE fill step with the final value — replay does fill(text),
  // not keystroke-by-keystroke.
  const pendingByEl = new WeakMap()
  function onInput(e) {
    const el = e.target
    if (!el || !(el instanceof Element)) return
    const tag = el.tagName
    const isCE = el.getAttribute && el.getAttribute('contenteditable') === 'true'
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !isCE) return
    const value = isCE ? (el.innerText || '').trim() : (el.value ?? '')
    pendingByEl.set(el, value)
  }
  function flushPending(el) {
    if (!el || !pendingByEl.has(el)) return
    const value = pendingByEl.get(el)
    pendingByEl.delete(el)
    if (value === '' || value == null) return
    const selector = bestSelector(el)
    const role = roleOf(el)
    const name = accessibleName(el)
    const label = 'Fill ' + (name ? '"' + truncate(name, 40) + '"' : (role || 'field')) + ' with "' + truncate(String(value), 30) + '"'
    emit({ kind: 'fill', selector, role, name, value: String(value), label })
  }
  document.addEventListener('input', onInput, { capture: true })
  document.addEventListener('change', onInput, { capture: true })
  document.addEventListener('blur', (e) => flushPending(e.target), { capture: true })

  document.addEventListener('keydown', (e) => {
    const k = e.key
    if (k === 'Enter' || k === 'Tab') {
      // Flush any pending fill on this element first so the resulting fill
      // step lands BEFORE the press_key step.
      flushPending(e.target)
      emit({ kind: 'press_key', value: k, label: 'Press ' + k })
    } else if (k === 'Escape') {
      flushPending(e.target)
      emit({ kind: 'press_key', value: k, label: 'Press Escape' })
    }
  }, { capture: true })

  // beforeunload: flush any in-flight fill so navigations don't drop the last input
  window.addEventListener('beforeunload', () => {
    const focused = document.activeElement
    if (focused) flushPending(focused)
  }, { capture: true })
})()
`

/**
 * Start a new recording. Spins up (or reuses) a browser session for the
 * recording chatId, injects the capture script, navigates to the start URL,
 * and persists a row in recording_sessions.
 */
export async function startRecording(
  userId: string,
  startUrl: string,
): Promise<{ recordingId: string; chatId: string }> {
  const [row] = await db
    .insert(recordingSessions)
    .values({ userId, startUrl, steps: [], status: 'recording' })
    .returning()
  const recordingId = row.id
  const chatId = `rec-${recordingId}`

  // getSession creates a fresh BrowserContext for this chatId. The cursor
  // overlay (injected in browser.ts) is harmless during recording.
  const session = await getSession(chatId)

  // Expose the bridge BEFORE installing the init script. Each call from the
  // page lands here and gets appended to the DB row. We tolerate errors so
  // a broken DB connection during recording doesn't kill the page.
  await session.context.exposeFunction('__probeCapture', async (step: FlowStep) => {
    try {
      await appendStep(recordingId, step)
    } catch (e) {
      console.error('[recording] append failed:', String(e).slice(0, 200))
    }
  })

  // addInitScript runs on every navigation in this context, so the capture
  // script survives client-side route changes and OAuth redirects.
  await session.context.addInitScript({ content: CAPTURE_SCRIPT })

  // First step is always the start navigation — captured server-side because
  // the script isn't installed in the in-flight page until after this goto.
  await appendStep(recordingId, {
    kind: 'navigate',
    value: startUrl,
    label: `Open ${startUrl}`,
  })

  // Also record same-tab navigations the user triggers (clicking a link,
  // form submission, manually typing a new URL). Skip identical URLs and
  // about:blank-style transient frames.
  session.page.on('framenavigated', (frame) => {
    if (frame !== session.page.mainFrame()) return
    const url = frame.url()
    const rec = active.get(chatId)
    if (!rec) return
    if (!url || url === 'about:blank') return
    if (url === rec.lastUrl) return
    rec.lastUrl = url
    rec.recentNetwork = []
    void appendStep(recordingId, {
      kind: 'navigate',
      value: url,
      label: `Navigate to ${url}`,
    })
    // Schedule a page snapshot once the new page settles. Debounce so a
    // chain of redirects collapses into one snapshot of the final URL.
    if (rec.snapshotTimer) clearTimeout(rec.snapshotTimer)
    rec.snapshotTimer = setTimeout(() => {
      void capturePageSnapshot(rec)
    }, 1_400)
  })

  // Track XHR/fetch endpoints fired since the most recent navigation. These
  // become networkSignatures on the page snapshot — the agent's replay can
  // wait for these instead of generic networkidle.
  session.page.on('request', (req) => {
    const rec = active.get(chatId)
    if (!rec) return
    const t = req.resourceType()
    if (t !== 'xhr' && t !== 'fetch') return
    try {
      const u = new URL(req.url())
      // Path-only signature — query strings would explode the cache.
      const sig = `${req.method()} ${u.pathname}`
      if (!rec.recentNetwork.includes(sig)) rec.recentNetwork.push(sig)
      if (rec.recentNetwork.length > 60) rec.recentNetwork = rec.recentNetwork.slice(-60)
    } catch {
      /* malformed URL — ignore */
    }
  })

  try {
    await session.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  } catch (e) {
    // Don't fail the whole start — the user might have given a slow URL.
    console.warn('[recording] initial goto warning:', String(e).slice(0, 200))
  }

  const rec: ActiveRecording = {
    recordingId,
    userId,
    chatId,
    lastUrl: startUrl,
    pendingFill: new Map(),
    snappedPatterns: new Set(),
    snapshotTimer: null,
    recentNetwork: [],
  }
  active.set(chatId, rec)
  // Snapshot the initial page once it settles. The framenavigated listener
  // already covers subsequent navigations, but the first goto fired before
  // we attached the listener so we trigger this one manually.
  rec.snapshotTimer = setTimeout(() => {
    void capturePageSnapshot(rec)
  }, 1_500)

  return { recordingId, chatId }
}

/**
 * Take a snapshot of the active page, if we haven't already snapshotted
 * this URL pattern in this recording. Called from the framenavigated
 * debounce and from the initial start delay.
 */
async function capturePageSnapshot(rec: ActiveRecording): Promise<void> {
  const session = await getSession(rec.chatId).catch(() => null)
  if (!session) return
  try {
    // Wait briefly for networkidle so dynamic content has settled.
    await session.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {})
    const snap = await snapshotPage(session.page, rec.recentNetwork)
    if (!snap) return
    if (rec.snappedPatterns.has(snap.urlPattern)) {
      // Update in place — the user revisited; capture the latest state.
    }
    rec.snappedPatterns.add(snap.urlPattern)
    await appendPage(rec.recordingId, snap)
  } catch {
    /* recording may have stopped — fine */
  }
}

/** Append a step to a recording. Concurrent-safe via PG jsonb ||. */
async function appendStep(recordingId: string, step: FlowStep): Promise<void> {
  // Drizzle doesn't expose a clean jsonb_append, so we read-modify-write.
  // The recording is single-writer (one user, one tab) — race risk is low,
  // and event volume is small (a few clicks/sec at most).
  const [row] = await db
    .select()
    .from(recordingSessions)
    .where(eq(recordingSessions.id, recordingId))
  if (!row) return
  const prev = row.steps[row.steps.length - 1]
  // Collapse double-emits: if the most recent step is the same KIND + SAME
  // selector + SAME value, the second one is almost always a duplicate
  // (input + change events both firing, or rapid re-blur). Replace instead
  // of appending so the step list stays clean. Navigates are exempt —
  // duplicate navigates can legitimately occur on hard reload.
  let next: FlowStep[]
  if (
    prev &&
    prev.kind === step.kind &&
    prev.kind !== 'navigate' &&
    prev.selector === step.selector &&
    prev.value === step.value
  ) {
    next = [...row.steps.slice(0, -1), step]
  } else {
    next = [...row.steps, step]
  }
  await db
    .update(recordingSessions)
    .set({ steps: next })
    .where(eq(recordingSessions.id, recordingId))
}

/** Stop a recording. Marks ended, returns the final step list. */
export async function stopRecording(
  userId: string,
  recordingId: string,
): Promise<{ steps: FlowStep[]; startUrl: string; endUrl: string } | null> {
  const [row] = await db
    .select()
    .from(recordingSessions)
    .where(and(eq(recordingSessions.id, recordingId), eq(recordingSessions.userId, userId)))
  if (!row) return null
  const chatId = `rec-${recordingId}`
  const rec = active.get(chatId)
  let endUrl = row.startUrl
  if (rec) {
    endUrl = rec.lastUrl || endUrl
    if (rec.snapshotTimer) clearTimeout(rec.snapshotTimer)
    // One final snapshot so the very last page the user landed on is in
    // the index — they may have stopped right after a navigation.
    await capturePageSnapshot(rec).catch(() => {})
  }
  await db
    .update(recordingSessions)
    .set({ status: 'stopped', endedAt: new Date() })
    .where(eq(recordingSessions.id, recordingId))
  active.delete(chatId)
  await resetSession(chatId).catch(() => {})
  return { steps: row.steps, startUrl: row.startUrl, endUrl }
}

/* ---- per-chat flow attachments ---- */

/** Attach a flow to a chat/agent. Idempotent: re-attaching is a no-op. */
export async function attachFlow(userId: string, chatId: string, flowId: string): Promise<void> {
  // Make sure the flow actually belongs to this user before attaching.
  const owner = await getFlow(userId, flowId)
  if (!owner) return
  const existing = await db
    .select()
    .from(chatFlowAttachments)
    .where(
      and(
        eq(chatFlowAttachments.userId, userId),
        eq(chatFlowAttachments.chatId, chatId),
        eq(chatFlowAttachments.flowId, flowId),
      ),
    )
  if (existing.length > 0) return
  await db.insert(chatFlowAttachments).values({ userId, chatId, flowId })
}

export async function detachFlow(userId: string, chatId: string, flowId: string): Promise<void> {
  await db
    .delete(chatFlowAttachments)
    .where(
      and(
        eq(chatFlowAttachments.userId, userId),
        eq(chatFlowAttachments.chatId, chatId),
        eq(chatFlowAttachments.flowId, flowId),
      ),
    )
}

/** List flow rows attached to a chat — the SCOPED set the agent's list_flows reads. */
export async function listAttachedFlows(userId: string, chatId: string): Promise<RecordedFlowRow[]> {
  const attachments = await db
    .select()
    .from(chatFlowAttachments)
    .where(and(eq(chatFlowAttachments.userId, userId), eq(chatFlowAttachments.chatId, chatId)))
  if (attachments.length === 0) return []
  const flowIds = attachments.map((a) => a.flowId)
  const rows = await db.select().from(recordedFlows).where(eq(recordedFlows.userId, userId))
  return rows.filter((f) => flowIds.includes(f.id))
}

/** Live read of a recording's current steps (for the UI step list). */
export async function getRecordingSteps(
  userId: string,
  recordingId: string,
): Promise<FlowStep[] | null> {
  const [row] = await db
    .select()
    .from(recordingSessions)
    .where(and(eq(recordingSessions.id, recordingId), eq(recordingSessions.userId, userId)))
  return row ? row.steps : null
}

/**
 * Promote a recording into a named, saved flow. The user supplies a name +
 * description and optionally a list of step indices whose fill values should
 * become parameters (the placeholder name replaces the literal value at
 * replay time).
 */
export async function saveAsFlow(
  userId: string,
  recordingId: string,
  name: string,
  description: string,
  purpose: string,
  paramAssignments: Record<number, string>,
): Promise<RecordedFlowRow | null> {
  const [row] = await db
    .select()
    .from(recordingSessions)
    .where(and(eq(recordingSessions.id, recordingId), eq(recordingSessions.userId, userId)))
  if (!row) return null

  const params: string[] = []
  const steps = row.steps.map((step, idx) => {
    const paramName = paramAssignments[idx]
    if (paramName && step.kind === 'fill') {
      if (!params.includes(paramName)) params.push(paramName)
      return { ...step, paramName }
    }
    return step
  })

  const lastNav = [...steps].reverse().find((s) => s.kind === 'navigate')
  const endUrl = lastNav?.value ?? row.startUrl

  const [saved] = await db
    .insert(recordedFlows)
    .values({
      userId,
      name: name.trim() || `Recording ${new Date(row.createdAt).toLocaleString()}`,
      description: description.trim(),
      purpose: purpose.trim(),
      steps,
      // Carry the recording's element index into the saved flow so the agent
      // can use it as a precomputed lookup on subsequent visits.
      pages: row.pages,
      meta: { params, endUrl },
    })
    .returning()
  return saved
}

/** List the user's saved flows, most recently used first. */
export async function listFlows(userId: string): Promise<RecordedFlowRow[]> {
  return db
    .select()
    .from(recordedFlows)
    .where(eq(recordedFlows.userId, userId))
    .orderBy(desc(recordedFlows.lastUsedAt), desc(recordedFlows.createdAt))
}

/** Get one flow by id (scoped to user). */
export async function getFlow(userId: string, flowId: string): Promise<RecordedFlowRow | null> {
  const [row] = await db
    .select()
    .from(recordedFlows)
    .where(and(eq(recordedFlows.id, flowId), eq(recordedFlows.userId, userId)))
  return row ?? null
}

/** Get a flow by NAME for the agent's run_flow tool. */
export async function getFlowByName(userId: string, name: string): Promise<RecordedFlowRow | null> {
  const [row] = await db
    .select()
    .from(recordedFlows)
    .where(and(eq(recordedFlows.name, name), eq(recordedFlows.userId, userId)))
  return row ?? null
}

export async function renameFlow(
  userId: string,
  flowId: string,
  name: string,
  description?: string,
): Promise<void> {
  await db
    .update(recordedFlows)
    .set({ name: name.trim(), ...(description != null ? { description: description.trim() } : {}) })
    .where(and(eq(recordedFlows.id, flowId), eq(recordedFlows.userId, userId)))
}

export async function deleteFlow(userId: string, flowId: string): Promise<void> {
  await db
    .delete(recordedFlows)
    .where(and(eq(recordedFlows.id, flowId), eq(recordedFlows.userId, userId)))
}

export async function touchFlowUsed(userId: string, flowId: string): Promise<void> {
  await db
    .update(recordedFlows)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(recordedFlows.id, flowId), eq(recordedFlows.userId, userId)))
}
