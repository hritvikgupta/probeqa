import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { User } from '../types'

interface Props {
  onUserUpdate: (u: User) => void
}

/**
 * Landing page Dodo redirects to after checkout. The webhook that flips the
 * user to Pro can arrive a beat after the redirect, so we poll /api/auth/me
 * a few times before settling on a final message.
 */
export default function BillingSuccess({ onUserUpdate }: Props) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Dodo returns ?payment_id=… for one-time purchases and ?subscription_id=…
  // for subscriptions. We accept either and let the server resolve it.
  const paymentId = params.get('payment_id')
  const subscriptionId = params.get('subscription_id')
  const [state, setState] = useState<'checking' | 'pro' | 'pending'>('checking')

  useEffect(() => {
    let stopped = false

    async function refreshMe(): Promise<string | null> {
      try {
        const r = await fetch('/api/auth/me')
        if (!r.ok) return null
        const d = await r.json()
        if (d?.user) onUserUpdate(d.user)
        return d?.user?.plan ?? null
      } catch {
        return null
      }
    }

    async function run() {
      // Fast path: if Dodo gave us a payment_id OR a subscription_id, verify
      // server-side. The server resolves either id into a subscription and
      // flips the user to Pro without needing the webhook to be reachable.
      if (paymentId || subscriptionId) {
        try {
          await fetch('/api/billing/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId, subscriptionId }),
          })
        } catch {
          /* fall through to polling */
        }
        const plan = await refreshMe()
        if (!stopped) setState(plan === 'pro' ? 'pro' : 'pending')
        return
      }
      // Otherwise poll /api/auth/me — the webhook may land a beat later.
      let tries = 0
      const tick = async () => {
        const plan = await refreshMe()
        if (plan === 'pro') {
          if (!stopped) setState('pro')
          return
        }
        tries += 1
        if (tries < 6 && !stopped) setTimeout(tick, 2000)
        else if (!stopped) setState('pending')
      }
      tick()
    }
    run()
    return () => {
      stopped = true
    }
  }, [onUserUpdate, paymentId, subscriptionId])

  // Once Pro is confirmed, hand off to the Billing page on its own.
  useEffect(() => {
    if (state !== 'pro') return
    const t = setTimeout(() => navigate('/billing', { replace: true }), 1200)
    return () => clearTimeout(t)
  }, [state, navigate])

  return (
    <div className="billing-success">
      <div className="billing-card">
        <div className={`billing-mark${state === 'checking' ? ' spin' : ''}`}>
          {state === 'checking' ? (
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg>
          ) : (
            <svg viewBox="0 0 24 24"><polyline points="5 13 10 18 19 6" /></svg>
          )}
        </div>
        <h1>
          {state === 'checking'
            ? 'Confirming your payment…'
            : state === 'pro'
              ? 'Welcome to Probe Pro'
              : 'Payment received'}
        </h1>
        <p>
          {state === 'checking'
            ? 'Hang tight while we activate your subscription.'
            : state === 'pro'
              ? 'Your Pro plan is active — taking you to Billing…'
              : "Thanks! Your Pro plan will activate within a minute — refresh Billing if it hasn't yet."}
        </p>
        <div className="billing-actions">
          <button className="bs-btn primary" onClick={() => navigate('/overview')}>
            Go to dashboard
          </button>
          <button className="bs-btn" onClick={() => navigate('/settings')}>
            View plan
          </button>
        </div>
      </div>
    </div>
  )
}
