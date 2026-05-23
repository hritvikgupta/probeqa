import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '../types'

interface Limits {
  projects: number | null
  agents: number | null
  runs: number
  credits: number | null
  creditsPerRun: number
}
interface SubscriptionInfo {
  status: string
  nextBillingDate: string | null
  cancelAtNextBillingDate: boolean
}
interface BillingInfo {
  plan: 'free' | 'pro'
  limits: Limits
  usage: { projects: number; agents: number; runs: number }
  subscription: SubscriptionInfo | null
  enabled: boolean
}

interface Props {
  user: User
  onToast: (msg: string) => void
  onUserUpdate: (u: User) => void
}

function fmtLimit(n: number | null): string {
  return n == null ? 'Unlimited' : n.toLocaleString()
}
function pct(used: number, total: number | null): number {
  if (total == null || total <= 0) return 0
  return Math.min(100, Math.round((used / total) * 100))
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Dodo's CancellationFeedback enum — keep in sync with server/billing.ts. */
const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'missing_features', label: 'Missing features' },
  { value: 'switched_service', label: 'Switched to another tool' },
  { value: 'unused', label: "Not using it enough" },
  { value: 'customer_service', label: 'Support experience' },
  { value: 'low_quality', label: 'Quality issues' },
  { value: 'too_complex', label: 'Too hard to use' },
  { value: 'other', label: 'Something else' },
]

export default function Billing({ onToast, onUserUpdate }: Props) {
  const [info, setInfo] = useState<BillingInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [feedback, setFeedback] = useState<string>('')
  const [comment, setComment] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/billing/info')
      if (!r.ok) return
      const d = (await r.json()) as BillingInfo
      setInfo(d)
    } catch {
      /* surface only if a user action fails */
    }
  }
  useEffect(() => {
    load()
  }, [])

  // Lock body scroll + dismiss on Escape while the cancel modal is open.
  useEffect(() => {
    if (!showCancel) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setShowCancel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [showCancel, busy])

  async function refreshMe() {
    try {
      const r = await fetch('/api/auth/me')
      if (r.ok) {
        const d = await r.json()
        if (d?.user) onUserUpdate(d.user)
      }
    } catch {
      /* non-fatal */
    }
  }

  async function upgrade() {
    setBusy(true)
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.checkout_url) {
        onToast(d.error || 'Could not start checkout')
        setBusy(false)
        return
      }
      window.location.href = d.checkout_url
    } catch {
      onToast('Could not start checkout')
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    setCancelError(null)
    try {
      const r = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: feedback || undefined,
          comment: comment.trim() || undefined,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = d.error || `Could not cancel subscription (HTTP ${r.status})`
        setCancelError(msg)
        onToast(msg)
        return
      }
      onToast('Subscription will end at the next billing date')
      await Promise.all([load(), refreshMe()])
      setShowCancel(false)
      setFeedback('')
      setComment('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not cancel subscription'
      setCancelError(msg)
      onToast(msg)
    } finally {
      setBusy(false)
    }
  }

  async function forceDowngrade() {
    setBusy(true)
    try {
      const r = await fetch('/api/billing/force-downgrade', { method: 'POST' })
      if (!r.ok) {
        onToast('Could not downgrade')
        return
      }
      onToast('Moved to Free locally')
      await Promise.all([load(), refreshMe()])
      setShowCancel(false)
      setCancelError(null)
    } catch {
      onToast('Could not downgrade')
    } finally {
      setBusy(false)
    }
  }

  if (!info) {
    return (
      <section className="page">
        <div className="muted">Loading billing…</div>
      </section>
    )
  }

  const { plan, limits, usage, subscription } = info
  const isPro = plan === 'pro'
  const cancelling = Boolean(subscription?.cancelAtNextBillingDate)
  const creditsUsed = limits.creditsPerRun * usage.runs
  const statusLabel = cancelling
    ? 'Cancels at period end'
    : isPro
      ? 'Active'
      : 'Free'

  return (
    <section className="page">
      {/* ---- Plan ---- */}
      <div className="panel" style={{ padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="field-label" style={{ marginBottom: 4 }}>Current plan</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
                {isPro ? 'Pro' : 'Free'}
              </div>
              <div className="muted">{isPro ? '$49 / month' : '$0 / month'}</div>
            </div>
          </div>
          <span
            className={`plan-badge${isPro && !cancelling ? ' pro' : ''}`}
            style={{ marginLeft: 'auto' }}
          >
            {statusLabel}
          </span>
        </div>

        {subscription && isPro && (
          <div className="muted" style={{ marginTop: 14, fontSize: 13 }}>
            {cancelling ? (
              <>
                Your Pro plan ends on <b>{fmtDate(subscription.nextBillingDate)}</b>. You'll move
                back to Free after that.
              </>
            ) : (
              <>
                Next renewal on <b>{fmtDate(subscription.nextBillingDate)}</b>.
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          {!isPro && (
            <button className="btn" onClick={upgrade} disabled={busy}>
              {busy ? 'Starting checkout…' : 'Upgrade to Pro — $49/mo'}
            </button>
          )}
          {isPro && !cancelling && (
            <button
              className="btn ghost"
              onClick={() => setShowCancel(true)}
              disabled={busy}
            >
              Cancel subscription
            </button>
          )}
        </div>
      </div>

      {/* ---- Usage ---- */}
      <div className="panel" style={{ padding: 28, marginTop: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Usage this period</div>
        <div className="sub" style={{ marginTop: 5, maxWidth: 540 }}>
          {isPro
            ? 'Pro gives you 1,500 credits per month — each agent run consumes 15 credits.'
            : 'Free includes 1 project, 1 agent and 5 runs in total. Upgrade for more.'}
        </div>

        <div className="usage-rows">
          <UsageRow label="Projects" used={usage.projects} limit={limits.projects} />
          <UsageRow label="Agents" used={usage.agents} limit={limits.agents} />
          <UsageRow label="Runs" used={usage.runs} limit={limits.runs} />
          {isPro && limits.credits != null && (
            <UsageRow
              label="Credits"
              used={creditsUsed}
              limit={limits.credits}
              note={`${limits.creditsPerRun} credits per run`}
            />
          )}
        </div>
      </div>

      {/* ---- Cancellation modal — portalled into <body> so it sits above the
              whole app (sidebar included), not just the main column. ---- */}
      {showCancel && createPortal(
        <div
          className="bm-overlay"
          onClick={() => {
            if (!busy) setShowCancel(false)
          }}
        >
          <div
            className="bm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bm-h">Cancel Probe Pro?</div>
            <p className="bm-p">
              You'll keep Pro access until{' '}
              <b>{fmtDate(info.subscription?.nextBillingDate)}</b>. After that you'll
              move back to Free — no further charges.
            </p>

            <div className="field-label" style={{ marginTop: 18 }}>
              What's the main reason? <span className="muted">(optional)</span>
            </div>
            <div className="bm-reason-grid">
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`bm-reason-pill${feedback === r.value ? ' on' : ''}`}
                  onClick={() => setFeedback(feedback === r.value ? '' : r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="field-label" style={{ marginTop: 16 }}>
              Anything we should know? <span className="muted">(optional)</span>
            </div>
            <textarea
              className="field-input"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us what could have made Probe better."
              style={{ resize: 'vertical' }}
            />

            {cancelError && (
              <div className="bm-error">
                <div>{cancelError}</div>
                <button
                  type="button"
                  className="bm-link"
                  onClick={forceDowngrade}
                  disabled={busy}
                >
                  Downgrade locally instead →
                </button>
              </div>
            )}

            <div className="bm-actions">
              <button
                className="btn ghost"
                onClick={() => setShowCancel(false)}
                disabled={busy}
              >
                Keep Pro
              </button>
              <button className="btn danger" onClick={cancel} disabled={busy}>
                {busy ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ---- Plan comparison ---- */}
      <div className="panel" style={{ padding: 28, marginTop: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Plans</div>
        <div className="plans-grid">
          <div className={`bp-card${!isPro ? ' current' : ''}`}>
            <div className="bp-name">Free</div>
            <div className="bp-price">
              $0<span>/mo</span>
            </div>
            <ul>
              <li>1 test project</li>
              <li>1 agent</li>
              <li>5 runs total</li>
              <li>Community support</li>
            </ul>
            {!isPro && <div className="bp-pill">Current plan</div>}
          </div>
          <div className={`bp-card featured${isPro ? ' current' : ''}`}>
            <div className="bp-name">Pro</div>
            <div className="bp-price">
              $49<span>/mo</span>
            </div>
            <ul>
              <li>1,500 credits per month</li>
              <li>Unlimited projects &amp; agents</li>
              <li>100 runs (15 credits each)</li>
              <li>Integrations &amp; priority support</li>
            </ul>
            {isPro && <div className="bp-pill">Current plan</div>}
          </div>
        </div>
      </div>
    </section>
  )
}

function UsageRow({
  label,
  used,
  limit,
  note,
}: {
  label: string
  used: number
  limit: number | null
  note?: string
}) {
  const p = pct(used, limit)
  const over = limit != null && used >= limit
  return (
    <div className="usage-row">
      <div className="usage-row-h">
        <span className="usage-label">{label}</span>
        <span className="usage-val">
          {used.toLocaleString()} <span className="muted">/ {fmtLimit(limit)}</span>
        </span>
      </div>
      <div className="usage-bar">
        <div
          className={`usage-bar-fill${over ? ' over' : ''}`}
          style={{
            width: limit == null ? '100%' : `${p}%`,
            opacity: limit == null ? 0.18 : 1,
          }}
        />
      </div>
      {note && <div className="usage-note">{note}</div>}
    </div>
  )
}
