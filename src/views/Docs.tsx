import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './Docs.css'

/* The voxel cube mark — same logo used on the landing page, inlined so the
   docs page has no coupling to other components. */
function ProbeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true">
      <polygon points="12,2 22,7 12,12 2,7" fill="#A8A8A8" />
      <polygon points="12,2 22,7 12,12 2,7" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
      <polygon points="2,7 12,12 12,22 2,17" fill="#545454" />
      <polygon points="2,7 12,12 12,22 2,17" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
      <polygon points="22,7 12,12 12,22 22,17" fill="#3A3A3A" />
      <polygon points="22,7 12,12 12,22 22,17" fill="none" stroke="#1A1A1A" strokeWidth="0.5" />
    </svg>
  )
}

/* ─── Page definitions ─────────────────────────────────────────────── */
type PageId = 'introduction' | 'quickstart' | 'email-agent' | 'integrations'

interface NavPage {
  id: PageId
  label: string
  group: string
  sections: { id: string; label: string }[]
}

const PAGES: NavPage[] = [
  {
    id: 'introduction',
    label: 'Introduction',
    group: 'Getting started',
    sections: [
      { id: 'what-is', label: 'What is Probe?' },
      { id: 'how-it-works', label: 'How it works' },
      { id: 'concepts', label: 'Key concepts' },
    ],
  },
  {
    id: 'quickstart',
    label: 'Quickstart',
    group: 'Getting started',
    sections: [
      { id: 'create-agent', label: 'Create an agent' },
      { id: 'write-plan', label: 'Write a test plan' },
      { id: 'run', label: 'Run the test' },
      { id: 'read-results', label: 'Read the results' },
      { id: 'schedule', label: 'Schedule runs' },
    ],
  },
  {
    id: 'email-agent',
    label: 'Email agent',
    group: 'Guides',
    sections: [
      { id: 'setup', label: 'Get your address' },
      { id: 'chatting', label: 'Chatting with the agent' },
      { id: 'examples', label: 'Example requests' },
      { id: 'identity', label: 'Sender verification' },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    group: 'Guides',
    sections: [
      { id: 'github', label: 'GitHub' },
      { id: 'slack', label: 'Slack' },
      { id: 'others', label: 'Other tools' },
    ],
  },
]

const SEARCH_INDEX = PAGES.flatMap((p) =>
  p.sections.map((s) => ({ pageId: p.id, pageLabel: p.label, group: p.group, ...s })),
)

/* ─── Code block + lightweight syntax highlighting ──────────────────── */
function highlight(code: string, lang: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let key = 0
  const lc = lang.toLowerCase()

  if (lc === 'shell' || lc === 'env' || lc === 'text' || lc === 'email') {
    code.split('\n').forEach((line, idx, arr) => {
      const isComment = /^\s*#/.test(line)
      out.push(
        <span key={key++} className={isComment ? 'tk-c' : undefined}>
          {line}
        </span>,
      )
      if (idx < arr.length - 1) out.push('\n')
    })
    return out
  }
  if (lc === 'json') {
    const re = /("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|\b(?:true|false|null)\b)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) {
      if (m.index > last) out.push(code.slice(last, m.index))
      const tok = m[0]
      let cls = 'tk-s'
      if (tok.endsWith(':')) cls = 'tk-t'
      else if (/^[\d-]/.test(tok)) cls = 'tk-n'
      else if (/^(true|false|null)$/.test(tok)) cls = 'tk-k'
      out.push(
        <span key={key++} className={cls}>
          {tok}
        </span>,
      )
      last = re.lastIndex
    }
    if (last < code.length) out.push(code.slice(last))
    return out
  }

  // JavaScript / TypeScript
  const kw = /^(import|from|export|const|let|var|function|return|if|else|for|while|await|async|new|class|extends|try|catch|finally|throw|typeof|of|in|default)$/
  const tokenRe = /(\/\/[^\n]*|`(?:[^`\\]|\\.)*`|"[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b|[{}()[\]<>;,.:!?=+\-*/&|]+|\s+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const tok = m[0]
    let cls: string | undefined
    if (tok.startsWith('//')) cls = 'tk-c'
    else if (/^[`'"]/.test(tok)) cls = 'tk-s'
    else if (/^\d/.test(tok)) cls = 'tk-n'
    else if (kw.test(tok)) cls = 'tk-k'
    else if (/^[A-Z]/.test(tok)) cls = 'tk-t'
    else if (/^[a-z_$]/.test(tok) && code[tokenRe.lastIndex] === '(') cls = 'tk-fn'
    if (cls)
      out.push(
        <span key={key++} className={cls}>
          {tok}
        </span>,
      )
    else out.push(tok)
    last = tokenRe.lastIndex
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

type CopyHandler = React.MouseEventHandler<HTMLButtonElement>

function CodeBlock({
  lang,
  file,
  code,
  copyCode,
}: {
  lang: string
  file?: string
  code: string
  copyCode: CopyHandler
}) {
  return (
    <div className="code-wrap">
      <div className="code-head">
        <span className="lang">{lang.toUpperCase()}</span>
        {file && <span className="file">{file}</span>}
        <button className="copy" onClick={copyCode}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          Copy
        </button>
      </div>
      <pre>
        <code>{highlight(code, lang)}</code>
      </pre>
    </div>
  )
}

const TipIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
    <circle cx="12" cy="12" r="4" />
  </svg>
)
const WarnIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

const META = (label: string) => (
  <div className="page-meta">
    <div>probe-docs</div>
    <div className="id">{label}</div>
  </div>
)

function Anchor({ id }: { id: string }) {
  return <span className="anchor">#{id}</span>
}

/* ─── Page: Introduction ────────────────────────────────────────────── */
function IntroductionPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Introduction</h1>
          <p className="page-sub">
            Probe is a platform for autonomous QA. You describe what to test in plain English, and
            agents drive your web app, mobile views and APIs end-to-end — finding regressions and
            filing them where your team already works.
          </p>
        </div>
        {META('v2.0')}
      </header>

      <div className="status-row">
        <span className="pill live">
          <span className="dot" />
          Stable
        </span>
        <span className="pill">
          <span className="dot" style={{ background: 'var(--accent)' }} />
          No scripts to maintain
        </span>
        <span className="pill">
          <span className="dot" style={{ background: 'var(--ink-4)' }} />
          Pay per run
        </span>
      </div>

      <h2 id="what-is">
        What is Probe? <Anchor id="what-is" />
      </h2>
      <p>
        Traditional end-to-end tests are brittle: they rot the moment a selector changes, and
        someone has to maintain them forever. Probe replaces that with <strong>agents</strong> — they
        read a plain-English test plan, open the real site in a real browser, and behave like a user:
        navigating, clicking, typing, and checking that each assertion holds.
      </p>
      <p>
        When something breaks, the agent writes a complete, reproducible ticket — title, severity,
        the exact steps, and screenshots — and opens it on GitHub for you.
      </p>

      <h2 id="how-it-works">
        How it works <Anchor id="how-it-works" />
      </h2>
      <p>Every run moves through four stages:</p>
      <div className="card-grid">
        <div className="card">
          <div className="card-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M3 20h2M3 4h18M3 12h12" />
            </svg>
          </div>
          <div className="card-title">Plan</div>
          <div className="card-desc">Probe expands your intent into a full list of test steps and assertions.</div>
        </div>
        <div className="card">
          <div className="card-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="m10 8 6 4-6 4Z" />
            </svg>
          </div>
          <div className="card-title">Drive</div>
          <div className="card-desc">The agent opens each surface and performs every step like a real user.</div>
        </div>
        <div className="card">
          <div className="card-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="card-title">Observe</div>
          <div className="card-desc">It records the result of each step — screenshots, console errors, timings.</div>
        </div>
        <div className="card">
          <div className="card-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3v5h5M9 13h6M9 17h6M5 21V3h9l5 5v13Z" />
            </svg>
          </div>
          <div className="card-title">File</div>
          <div className="card-desc">Failures become ready-to-fix tickets on GitHub, Linear or Jira.</div>
        </div>
      </div>

      <h2 id="concepts">
        Key concepts <Anchor id="concepts" />
      </h2>
      <table className="props-table">
        <thead>
          <tr>
            <th style={{ width: '22%' }}>Concept</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="name">Agent</span>
            </td>
            <td className="desc">
              A test workspace bound to one website. It holds the target URL, a saved test plan,
              test accounts, and the history of every run.
            </td>
          </tr>
          <tr>
            <td>
              <span className="name">Test plan</span>
            </td>
            <td className="desc">
              The ordered list of steps the agent executes — each step is a <code>NAVIGATE</code>,{' '}
              <code>ACT</code>, <code>ASSERT</code> or <code>SCREENSHOT</code>.
            </td>
          </tr>
          <tr>
            <td>
              <span className="name">Run</span>
            </td>
            <td className="desc">
              One execution of an agent's plan. It ends as <code>passed</code>, <code>failed</code>,{' '}
              <code>issues</code> — and carries per-step results and a final report.
            </td>
          </tr>
          <tr>
            <td>
              <span className="name">Project</span>
            </td>
            <td className="desc">A folder that groups related agents — usually one product or team.</td>
          </tr>
        </tbody>
      </table>

      <div className="callout tip">
        <TipIcon />
        <div>
          <p>
            <strong>New here?</strong> The fastest path to a green run is the{' '}
            <a className="inline" href="#quickstart">
              Quickstart
            </a>{' '}
            — create an agent, write a plan, and run it in a few minutes.
          </p>
        </div>
      </div>
    </>
  )
}

/* ─── Page: Quickstart ──────────────────────────────────────────────── */
function QuickstartPage({ copyCode }: { copyCode: CopyHandler }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Quickstart</h1>
          <p className="page-sub">
            From an empty workspace to a passing run. We'll create an agent, give it a plain-English
            test plan, run it, and read the report.
          </p>
        </div>
        {META('5 steps')}
      </header>

      <div className="status-row">
        <span className="pill live">
          <span className="dot" />5 steps
        </span>
        <span className="pill">
          <span className="dot" style={{ background: 'var(--ink-4)' }} />~5 min
        </span>
      </div>

      <h2 id="create-agent">
        1. Create an agent <Anchor id="create-agent" />
      </h2>
      <p>
        From the <strong>Agents</strong> page, click <strong>New agent</strong>. Give it a name and
        the URL you want to test. That URL is the only surface this agent will ever touch.
      </p>
      <table className="props-table">
        <thead>
          <tr>
            <th style={{ width: '24%' }}>Field</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="name">Name</span>
            </td>
            <td className="desc">A short label, e.g. <code>checkout-flow</code>.</td>
          </tr>
          <tr>
            <td>
              <span className="name">Target URL</span>
            </td>
            <td className="desc">The site under test — <code>https://shop.acme.com</code>.</td>
          </tr>
          <tr>
            <td>
              <span className="name">Project</span>
            </td>
            <td className="desc">Optional — the project this agent belongs to.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="write-plan">
        2. Write a test plan <Anchor id="write-plan" />
      </h2>
      <p>
        Open the agent and describe what to test in the planning chat. No selectors, no fixtures —
        plain English. Probe expands it into concrete steps you can edit before running.
      </p>
      <CodeBlock
        lang="text"
        file="planning chat"
        copyCode={copyCode}
        code={`Test the checkout flow. Add an item to the cart, go to
checkout, pay with card 4242 4242 4242 4242, and confirm the
order summary shows the right total and a 200 response.`}
      />
      <p>The plan it produces is a list of typed steps:</p>
      <table className="props-table">
        <thead>
          <tr>
            <th style={{ width: '24%' }}>Step kind</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>NAVIGATE</code>
            </td>
            <td className="desc">Open a URL or follow a link.</td>
          </tr>
          <tr>
            <td>
              <code>ACT</code>
            </td>
            <td className="desc">Click, type, or otherwise interact with the page.</td>
          </tr>
          <tr>
            <td>
              <code>ASSERT</code>
            </td>
            <td className="desc">Check that a condition holds — text, status code, state.</td>
          </tr>
          <tr>
            <td>
              <code>SCREENSHOT</code>
            </td>
            <td className="desc">Capture the page at this point in the run.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="run">
        3. Run the test <Anchor id="run" />
      </h2>
      <p>
        Click <strong>Run</strong>. The agent opens a real browser, performs every step in order,
        and records the result of each. You can watch it live or come back to the report.
      </p>
      <div className="callout tip">
        <TipIcon />
        <div>
          <p>
            <strong>Need a login?</strong> Add a test account under the agent's settings. The agent
            uses it to sign in before running steps that require an authenticated session.
          </p>
        </div>
      </div>

      <h2 id="read-results">
        4. Read the results <Anchor id="read-results" />
      </h2>
      <p>
        Each run ends with a status and a report. Open a run from the <strong>Runs</strong> page to
        see every step, its screenshot, and what passed or failed.
      </p>
      <table className="props-table">
        <thead>
          <tr>
            <th style={{ width: '24%' }}>Status</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>passed</code>
            </td>
            <td className="desc">Every step and assertion succeeded.</td>
          </tr>
          <tr>
            <td>
              <code>issues</code>
            </td>
            <td className="desc">The run completed but the agent flagged something worth a look.</td>
          </tr>
          <tr>
            <td>
              <code>failed</code>
            </td>
            <td className="desc">An assertion failed or the agent couldn't finish a step.</td>
          </tr>
        </tbody>
      </table>
      <p>
        When a run fails and the agent has a GitHub repo connected, it opens an issue automatically
        — see <a className="inline" href="#integrations">Integrations</a>.
      </p>

      <h2 id="schedule">
        5. Schedule runs <Anchor id="schedule" />
      </h2>
      <p>
        Open the agent's <strong>Schedule</strong> settings to run the saved plan automatically — for
        example, every morning before standup. Scheduled runs file tickets just like manual ones.
      </p>

      <div className="footer-nav">
        <span className="fnav prev" style={{ visibility: 'hidden' }} />
      </div>
    </>
  )
}

/* ─── Page: Email agent ─────────────────────────────────────────────── */
function EmailAgentPage({ copyCode }: { copyCode: CopyHandler }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Email agent</h1>
          <p className="page-sub">
            You don't have to open the app to use Probe. Email the agent in plain English — it can
            create agents, run tests, and email you the results, all inside the email thread.
          </p>
        </div>
        {META('guide')}
      </header>

      <h2 id="setup">
        Get your address <Anchor id="setup" />
      </h2>
      <p>
        Open <strong>Settings → Email agent</strong> in the app to find the address to write to.
        Send mail to it from the email on your Probe account so it knows who you are.
      </p>
      <CodeBlock lang="text" file="Settings → Email agent" copyCode={copyCode} code={`probeqa@agentmail.to`} />

      <h2 id="chatting">
        Chatting with the agent <Anchor id="chatting" />
      </h2>
      <p>
        The email thread <em>is</em> the conversation. Write naturally; the agent reads the whole
        thread for context and replies in-line. Ask it what agents you have, ask it to run one, or
        ask it to test something new.
      </p>
      <p>When you ask it to run a test, the run happens in the background and the agent replies again — in the same thread — with the report once it finishes.</p>

      <h2 id="examples">
        Example requests <Anchor id="examples" />
      </h2>
      <CodeBlock
        lang="email"
        file="To: probeqa@agentmail.to"
        copyCode={copyCode}
        code={`# list what you have
What testing agents do I have?

# run an existing one
Run the checkout-flow agent and send me the report.

# create and test something new
Create an agent for https://shop.acme.com and test
that the signup form rejects an invalid email.`}
      />
      <p>A reply for a finished run looks like this:</p>
      <CodeBlock
        lang="email"
        file="From: probeqa@agentmail.to"
        copyCode={copyCode}
        code={`I finished testing "checkout-flow".

Overall verdict: PASSED — all 7 steps completed.
A GitHub issue was opened for a minor console warning:
github.com/acme/shop/issues/42

Anything else I can help with?`}
      />

      <h2 id="identity">
        Sender verification <Anchor id="identity" />
      </h2>
      <p>
        The agent matches the <code>From</code> address of your email to a Probe account and acts
        only on <strong>that</strong> account's agents and data. Mail from an address with no
        matching account is ignored.
      </p>
      <div className="callout warn">
        <WarnIcon />
        <div>
          <p>
            <strong>Use a verified address.</strong> Always write from the email on your Probe
            account. To drive your account from another address, link and verify it first under{' '}
            <strong>Settings → Email agent</strong>.
          </p>
        </div>
      </div>
    </>
  )
}

/* ─── Page: Integrations ────────────────────────────────────────────── */
function IntegrationsPage({ copyCode }: { copyCode: CopyHandler }) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-sub">
            Probe routes findings to the tools your team already lives in. Connect a destination
            once, and every failing run lands there with a full repro.
          </p>
        </div>
        {META('guide')}
      </header>

      <h2 id="github">
        GitHub <Anchor id="github" />
      </h2>
      <p>
        Connect a repository in the agent's settings, then add a token with <code>issues</code>{' '}
        scope. When a run fails, Probe opens an issue with the verdict, the steps it took, and
        screenshots — ready for a developer to pick up.
      </p>
      <CodeBlock
        lang="text"
        file="GitHub issue · opened by Probe"
        copyCode={copyCode}
        code={`Test Plan Execution Report for shop.acme.com

Overall Verdict: FAILED — checkout returned HTTP 500.

Steps to reproduce:
1. Navigate to /checkout
2. Fill card 4242 4242 4242 4242
3. Submit the payment form  ← server returned 500

Attached: console log, network trace, 3 screenshots.`}
      />
      <div className="callout tip">
        <TipIcon />
        <div>
          <p>
            <strong>Tokens stay server-side.</strong> Probe stores your GitHub token encrypted and
            never returns it to the browser — the UI only ever shows a masked value.
          </p>
        </div>
      </div>

      <h2 id="slack">
        Slack <Anchor id="slack" />
      </h2>
      <p>
        Connect a Slack workspace to post run results into a channel — a one-line summary for passes
        and a full breakdown for failures, so the whole team sees regressions as they happen.
      </p>

      <h2 id="others">
        Other tools <Anchor id="others" />
      </h2>
      <p>Probe connects to the rest of your stack through the same integrations panel:</p>
      <ul className="bullets">
        <li>
          <strong>Linear &amp; Jira</strong> — file failing runs as tickets in your tracker.
        </li>
        <li>
          <strong>Gmail</strong> — email digests and the conversational email agent.
        </li>
        <li>
          <strong>Notion &amp; Google Sheets</strong> — export run history and coverage.
        </li>
        <li>
          <strong>Google Calendar</strong> — schedule recurring test runs.
        </li>
      </ul>
    </>
  )
}

/* ─── Main docs shell ───────────────────────────────────────────────── */
export default function Docs() {
  const navigate = useNavigate()
  const [currentPage, setCurrentPage] = useState<PageId>('introduction')
  const [activeSection, setActiveSection] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const mainRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const page = PAGES.find((p) => p.id === currentPage)!

  /* ⌘K / Esc */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsSearchOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setIsSearchOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (isSearchOpen) setTimeout(() => inputRef.current?.focus(), 30)
    else setSearchQuery('')
  }, [isSearchOpen])

  /* Scroll-spy */
  useEffect(() => {
    const sc = mainRef.current
    if (!sc) return
    const headings = Array.from(sc.querySelectorAll('h2[id]')) as HTMLHeadingElement[]
    const onScroll = () => {
      const y = sc.scrollTop + 80
      let active = headings[0]?.id || ''
      for (const h of headings) if (h.offsetTop <= y) active = h.id
      setActiveSection(active)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => sc.removeEventListener('scroll', onScroll)
  }, [currentPage])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
    setActiveSection(page.sections[0]?.id || '')
  }, [currentPage, page.sections])

  const navigateTo = (pageId: PageId) => {
    setCurrentPage(pageId)
    setActiveSection('')
  }

  const jumpToSection = (id: string) => {
    const sc = mainRef.current
    const target = sc?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null
    if (target && sc) {
      sc.scrollTo({ top: Math.max(target.offsetTop - 24, 0), behavior: 'smooth' })
      setActiveSection(id)
    }
  }

  const copyCode: CopyHandler = (e) => {
    const btn = e.currentTarget
    const pre = btn.closest('.code-wrap')?.querySelector('pre')
    if (pre) {
      navigator.clipboard.writeText((pre as HTMLElement).innerText)
      const original = btn.innerHTML
      btn.innerHTML = 'Copied'
      setTimeout(() => {
        btn.innerHTML = original
      }, 1200)
    }
  }

  const groups = Array.from(new Set(PAGES.map((p) => p.group)))
  const crumbs = ['Docs', page.group, page.label]

  const q = searchQuery.trim().toLowerCase()
  const filtered = q
    ? SEARCH_INDEX.filter(
        (it) => it.label.toLowerCase().includes(q) || it.pageLabel.toLowerCase().includes(q),
      )
    : SEARCH_INDEX

  return (
    <div className="docs-body">
      <div className="docs-app">
        {/* ── Sidebar ── */}
        <nav className="sidenav">
          <div className="brand" onClick={() => navigate('/')}>
            <div className="brand-mark">
              <ProbeMark size={22} />
            </div>
            <div className="brand-name">
              Probe <span>docs</span>
            </div>
          </div>

          <div
            className="doc-search"
            role="button"
            tabIndex={0}
            onClick={() => setIsSearchOpen(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input placeholder="Search docs" readOnly />
            <span className="kbd">⌘K</span>
          </div>

          {groups.map((group, gIdx) => (
            <React.Fragment key={group}>
              <div className={`nav-label ${gIdx === 0 ? 'first' : ''}`}>{group}</div>
              <ul className="nav-list">
                {PAGES.filter((p) => p.group === group).map((p) => (
                  <li key={p.id}>
                    <a
                      className={`nav-item nav-page ${currentPage === p.id ? 'current' : ''}`}
                      href={`#${p.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        navigateTo(p.id)
                      }}
                    >
                      <span
                        className="dot"
                        style={currentPage === p.id ? { background: 'var(--accent)' } : {}}
                      />
                      {p.label}
                    </a>
                    {currentPage === p.id && (
                      <ul className="nav-list" style={{ marginTop: 2, marginLeft: 16 }}>
                        {p.sections.map((s) => (
                          <li key={s.id}>
                            <a
                              className={`nav-item ${activeSection === s.id ? 'active' : ''}`}
                              href={`#${s.id}`}
                              onClick={(e) => {
                                e.preventDefault()
                                jumpToSection(s.id)
                              }}
                              style={{ fontSize: '12px', paddingTop: 3, paddingBottom: 3 }}
                            >
                              <span className="dot" style={{ width: 4, height: 4 }} />
                              {s.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </React.Fragment>
          ))}
        </nav>

        {/* ── Main ── */}
        <main className="main" ref={mainRef}>
          <div className="crumbs">
            {crumbs.map((crumb, i, arr) => (
              <React.Fragment key={crumb}>
                {i < arr.length - 1 ? (
                  <a href="#" onClick={(e) => e.preventDefault()}>
                    {crumb}
                  </a>
                ) : (
                  <span>{crumb}</span>
                )}
                {i < arr.length - 1 && <span className="sep">/</span>}
              </React.Fragment>
            ))}
          </div>

          {currentPage === 'introduction' && <IntroductionPage />}
          {currentPage === 'quickstart' && <QuickstartPage copyCode={copyCode} />}
          {currentPage === 'email-agent' && <EmailAgentPage copyCode={copyCode} />}
          {currentPage === 'integrations' && <IntegrationsPage copyCode={copyCode} />}
        </main>

        {/* ── TOC ── */}
        <aside className="toc">
          <h4>On this page</h4>
          <ul>
            {page.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={activeSection === s.id ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault()
                    jumpToSection(s.id)
                  }}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="toc-meta">
            <div>
              <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>
                ← Back to probe.dev
              </a>
            </div>
            <div style={{ marginTop: '10px' }}>Last updated May 22, 2026</div>
          </div>
        </aside>
      </div>

      {/* ── Search modal ── */}
      {isSearchOpen && (
        <div
          className="modal-backdrop open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsSearchOpen(false)
          }}
        >
          <div className="modal" role="document">
            <div className="modal-search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                placeholder="Search documentation…"
                autoComplete="off"
                spellCheck={false}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="esc" onClick={() => setIsSearchOpen(false)}>
                esc
              </span>
            </div>
            <div className="modal-results">
              {filtered.length === 0 ? (
                <div className="res-empty">
                  <div className="em-mark">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m21 21-4.3-4.3" />
                    </svg>
                  </div>
                  No results for &quot;{searchQuery}&quot;
                </div>
              ) : (
                <div style={{ padding: '8px 0' }}>
                  {filtered.map((item) => (
                    <a
                      key={`${item.pageId}-${item.id}`}
                      href={`#${item.id}`}
                      className="res-item"
                      onClick={(e) => {
                        e.preventDefault()
                        navigateTo(item.pageId as PageId)
                        setIsSearchOpen(false)
                        setTimeout(() => jumpToSection(item.id), 90)
                      }}
                    >
                      <span className="res-crumb">
                        {item.group} / {item.pageLabel}
                      </span>
                      <span className="res-label">{item.label}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <span>
                <span className="key">↵</span>to open
              </span>
              <span>
                <span className="key">esc</span>to close
              </span>
              <span className="grow" />
              <span className="brand-tag">
                <ProbeMark size={13} />
                Probe
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
