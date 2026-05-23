/**
 * Billing — Dodo Payments ($49/mo Pro subscription).
 *
 * Flow:
 *   1. The signed-in user hits POST /api/billing/checkout — we create a Dodo
 *      checkout session for the Pro product and hand back its checkout_url.
 *   2. Dodo redirects them back to /billing/success after payment.
 *   3. Dodo calls our webhook (POST /api/billing/webhook) with the real
 *      subscription state — that webhook is the source of truth for `plan`.
 *
 * All secrets come from .env; nothing here is ever sent to the browser.
 */
import DodoPayments from 'dodopayments'
import { eq } from 'drizzle-orm'
import { db, users } from './db/index.ts'
import type { SafeUser } from './auth.ts'
import { countUsage } from './store.ts'

/**
 * Per-plan quotas. `null` means unlimited. Mirrored to the client through
 * /api/billing/info so the UI can render usage bars; enforced on the server
 * at the endpoints that create projects / agents / start runs.
 */
export const PLAN_LIMITS = {
  free: { projects: 1, agents: 1, runs: 5, credits: null as number | null, creditsPerRun: 0 },
  pro: { projects: null as number | null, agents: null as number | null, runs: 100, credits: 1500, creditsPerRun: 15 },
} as const

export type PlanName = keyof typeof PLAN_LIMITS
export type LimitKind = 'projects' | 'agents' | 'runs'

const KIND_LABEL: Record<LimitKind, string> = {
  projects: 'projects',
  agents: 'agents',
  runs: 'agent runs',
}

function normalizePlan(plan: string): PlanName {
  return plan === 'pro' ? 'pro' : 'free'
}

/**
 * Check whether the user has room for one more {projects | agents | runs}.
 * Returns `{ ok: true }` when room is available, otherwise a structured error
 * the caller can ship straight to the client as a 402.
 */
export async function checkLimit(
  userId: string,
  plan: string,
  kind: LimitKind,
): Promise<
  | { ok: true }
  | { ok: false; error: string; code: 'limit_reached'; usage: number; limit: number; plan: PlanName }
> {
  const planName = normalizePlan(plan)
  const limit = PLAN_LIMITS[planName][kind]
  if (limit == null) return { ok: true }
  const usage = await countUsage(userId)
  const used = usage[kind]
  if (used >= limit) {
    const tail =
      planName === 'pro'
        ? ' Contact support to extend your quota.'
        : ' Upgrade to Pro to unlock more.'
    return {
      ok: false,
      code: 'limit_reached',
      usage: used,
      limit,
      plan: planName,
      error: `You've reached your ${planName === 'pro' ? 'Pro' : 'Free'}-plan limit of ${limit} ${KIND_LABEL[kind]} (${used}/${limit}).${tail}`,
    }
  }
  return { ok: true }
}

const ENV: 'test_mode' | 'live_mode' =
  process.env.DODO_ENV === 'test_mode' ? 'test_mode' : 'live_mode'
const API_KEY = process.env.DODO_API_KEY || ''
const PRODUCT_ID = process.env.DODO_PRODUCT_ID || ''
const WEBHOOK_KEY = process.env.DODO_WEBHOOK_KEY || ''

/** Checkout works with just the API key + product id; the webhook also needs the key. */
export const dodoEnabled = Boolean(API_KEY && PRODUCT_ID)

const dodo = dodoEnabled
  ? new DodoPayments({ bearerToken: API_KEY, environment: ENV, webhookKey: WEBHOOK_KEY })
  : null

export interface SubscriptionDetails {
  status: string
  nextBillingDate: string | null
  cancelAtNextBillingDate: boolean
}

/** Fetch live subscription state from Dodo (renewal date, cancel flag, …). */
export async function fetchSubscriptionDetails(
  subId: string,
): Promise<SubscriptionDetails | null> {
  if (!dodo) return null
  try {
    const sub = (await dodo.subscriptions.retrieve(subId)) as unknown as Record<string, unknown>
    return {
      status: typeof sub.status === 'string' ? sub.status : 'unknown',
      nextBillingDate:
        typeof sub.next_billing_date === 'string' ? sub.next_billing_date : null,
      cancelAtNextBillingDate: Boolean(sub.cancel_at_next_billing_date),
    }
  } catch (err) {
    console.error('[dodo] retrieve subscription failed:', err)
    return null
  }
}

/** Dodo's churn-reason enum — collected from the user and passed through verbatim. */
export type CancellationFeedback =
  | 'too_expensive'
  | 'missing_features'
  | 'switched_service'
  | 'unused'
  | 'customer_service'
  | 'low_quality'
  | 'too_complex'
  | 'other'

const VALID_FEEDBACK: ReadonlySet<string> = new Set([
  'too_expensive',
  'missing_features',
  'switched_service',
  'unused',
  'customer_service',
  'low_quality',
  'too_complex',
  'other',
])

export interface CancelReason {
  feedback?: string
  comment?: string
}

type SubItem = { subscription_id?: string; status?: string }
type CustItem = { customer_id?: string; email?: string }

/**
 * Find an active subscription on Dodo for a given customer id. Used as a
 * fallback when our DB lost track of (or never captured) the subscription id.
 */
/** Statuses that mean "nothing left to cancel" — anything else is fair game. */
const TERMINAL_SUB_STATUSES = new Set(['cancelled', 'expired', 'failed'])

export async function findActiveSubscriptionForCustomer(
  customerId: string,
): Promise<string | null> {
  if (!dodo) return null
  try {
    // Don't filter by status server-side — a sub on a free trial often comes
    // back as `pending`, not `active`, and would be hidden by `status:'active'`.
    const page = (await dodo.subscriptions.list({
      customer_id: customerId,
    })) as unknown as { items?: SubItem[] }
    const items = page.items ?? []
    const live = items.find((s) => s.status && !TERMINAL_SUB_STATUSES.has(s.status))
    console.log(
      `[dodo] list subs for customer=${customerId}: ${items.length} found ` +
        `(statuses: ${items.map((s) => s.status ?? '?').join(', ') || 'none'}) ` +
        `→ ${live?.subscription_id ?? 'none usable'}`,
    )
    return live?.subscription_id ?? null
  } catch (err) {
    console.error('[dodo] list subscriptions by customer failed:', err)
    return null
  }
}

/**
 * Find an active subscription on Dodo using the user's email — used when even
 * the customer id is missing locally (e.g. the verify endpoint never ran or
 * the payment response didn't expose either id).
 */
export async function findActiveSubscriptionByEmail(
  email: string,
): Promise<{ subId: string; customerId: string } | null> {
  if (!dodo || !email) return null
  try {
    const custs = (await dodo.customers.list({ email })) as unknown as {
      items?: CustItem[]
    }
    const customerId = custs.items?.[0]?.customer_id
    console.log(
      `[dodo] list customers by email=${email}: ${custs.items?.length ?? 0} found → ${customerId ?? 'none'}`,
    )
    if (!customerId) return null
    const subId = await findActiveSubscriptionForCustomer(customerId)
    if (!subId) return null
    return { subId, customerId }
  } catch (err) {
    console.error('[dodo] list customers by email failed:', err)
    return null
  }
}

/**
 * Last-ditch discovery — list recent subscriptions across the whole account
 * (no customer filter, which sometimes returns nothing on Dodo) and pick the
 * most recent non-terminal sub whose customer email matches the user's.
 */
export async function findSubscriptionByScan(
  email: string,
): Promise<string | null> {
  if (!dodo || !email) return null
  try {
    const page = (await dodo.subscriptions.list({})) as unknown as {
      items?: Array<{
        subscription_id?: string
        status?: string
        customer?: { email?: string; customer_id?: string }
      }>
    }
    const items = page.items ?? []
    const wanted = email.toLowerCase()
    const live = items.find(
      (s) =>
        s.status &&
        !TERMINAL_SUB_STATUSES.has(s.status) &&
        s.customer?.email?.toLowerCase() === wanted,
    )
    console.log(
      `[dodo] scan all subs (${items.length}) for email=${email} → ${
        live?.subscription_id ?? 'none usable'
      }`,
    )
    return live?.subscription_id ?? null
  } catch (err) {
    console.error('[dodo] scan subscriptions failed:', err)
    return null
  }
}

/**
 * Soft-cancel — the user keeps Pro until the current billing period ends.
 * Follows the Dodo PATCH /subscriptions guideline: pair the schedule flag
 * with cancel_reason + cancellation_feedback + cancellation_comment so the
 * merchant captures churn signal at the point of cancellation.
 */
export async function cancelSubscription(
  subId: string,
  reason?: CancelReason,
): Promise<SubscriptionDetails | null> {
  if (!dodo) throw new Error('Dodo Payments is not configured')
  // Only pass through a feedback value that matches Dodo's enum, so the API
  // never rejects the cancel call over a typo we sent.
  const feedback =
    reason?.feedback && VALID_FEEDBACK.has(reason.feedback)
      ? (reason.feedback as CancellationFeedback)
      : null
  const comment = reason?.comment?.trim() || null
  await dodo.subscriptions.update(subId, {
    cancel_at_next_billing_date: true,
    cancel_reason: 'cancelled_by_customer',
    cancellation_feedback: feedback,
    cancellation_comment: comment,
  })
  return fetchSubscriptionDetails(subId)
}

/** Create a Dodo checkout session for the Pro subscription. Returns the hosted URL. */
export async function createCheckout(user: SafeUser, returnUrl: string): Promise<string> {
  if (!dodo) throw new Error('Dodo Payments is not configured')
  const session = await dodo.checkoutSessions.create({
    product_cart: [{ product_id: PRODUCT_ID, quantity: 1 }],
    customer: { email: user.email, name: user.name },
    return_url: returnUrl,
    // Echoed back on the subscription so the webhook can find this user.
    metadata: { userId: user.id },
  })
  if (!session.checkout_url) throw new Error('Dodo did not return a checkout URL')
  return session.checkout_url
}

/**
 * Fallback for when the webhook isn't reachable (e.g. localhost without ngrok):
 * the success page POSTs the payment_id from the redirect, we verify it with
 * Dodo, and if it succeeded for this user we flip them to Pro ourselves.
 */
export async function verifyAndApplyPayment(
  userId: string,
  ids: { paymentId?: string | null; subscriptionId?: string | null },
  fallbackEmail?: string,
): Promise<{ ok: boolean; plan: string }> {
  if (!dodo) throw new Error('Dodo Payments is not configured')

  console.log(
    `[billing] verify: paymentId=${ids.paymentId ?? '∅'} subscriptionId=${ids.subscriptionId ?? '∅'}`,
  )

  let paymentStatus = 'unknown'
  let payment: Record<string, unknown> | null = null

  // 1) If Dodo redirected with payment_id, look up the payment.
  if (ids.paymentId) {
    payment = (await dodo.payments
      .retrieve(ids.paymentId)
      .catch((err) => {
        console.error('[dodo] payment retrieve failed:', err)
        return null
      })) as unknown as Record<string, unknown> | null
    paymentStatus = typeof payment?.status === 'string' ? payment.status : 'unknown'
    console.log(`[billing] verify: payment ${ids.paymentId} status=${paymentStatus}`)

    // Cross-check metadata so a stolen payment_id can't upgrade someone else.
    const metadata = (payment?.metadata ?? {}) as Record<string, unknown>
    if (typeof metadata.userId === 'string' && metadata.userId !== userId) {
      console.warn(`[billing] verify: payment ${ids.paymentId} belongs to a different user`)
      return { ok: false, plan: 'free' }
    }
  }

  const customer = (payment?.customer ?? {}) as Record<string, unknown>
  // Prefer the explicit subscription_id Dodo redirected with for sub products.
  let subId =
    (typeof ids.subscriptionId === 'string' ? ids.subscriptionId : undefined) ??
    (typeof payment?.subscription_id === 'string' ? payment.subscription_id : undefined)
  let customerId =
    typeof customer.customer_id === 'string' ? customer.customer_id : undefined
  const emailForLookup =
    (typeof customer.email === 'string' ? customer.email : undefined) ?? fallbackEmail

  // 2) Subscription discovery — for trial signups the payment may not carry
  //    subscription_id, or status may be 'pending'. Look up the subscription
  //    on Dodo by customer or email and use its status as the source of truth.
  let subStatus: string | null = null
  if (!subId && customerId) {
    subId = (await findActiveSubscriptionForCustomer(customerId)) ?? undefined
  }
  if (!subId && emailForLookup) {
    const found = await findActiveSubscriptionByEmail(emailForLookup)
    if (found) {
      subId = found.subId
      customerId = customerId ?? found.customerId
    }
  }
  if (!subId && emailForLookup) {
    subId = (await findSubscriptionByScan(emailForLookup)) ?? undefined
  }
  if (subId) {
    const details = await fetchSubscriptionDetails(subId)
    subStatus = details?.status ?? null
    console.log(`[billing] verify: discovered sub=${subId} status=${subStatus ?? '?'}`)
  }

  // 3) Decide. Pro applies when the payment succeeded OR a non-terminal
  //    subscription exists (covers trials with $0 / pending first payment).
  const paymentOk = paymentStatus === 'succeeded'
  const subOk = !!subStatus && !TERMINAL_SUB_STATUSES.has(subStatus)
  if (!paymentOk && !subOk) {
    console.warn(
      `[billing] verify: no go — payment=${paymentStatus} sub=${subStatus ?? 'none'}`,
    )
    return { ok: false, plan: 'free' }
  }

  const patch: {
    plan: string
    subStatus: string
    dodoSubscriptionId?: string
    dodoCustomerId?: string
  } = { plan: 'pro', subStatus: subStatus ?? 'active' }
  if (subId) patch.dodoSubscriptionId = subId
  if (customerId) patch.dodoCustomerId = customerId
  await db.update(users).set(patch).where(eq(users.id, userId))
  console.log(
    `[billing] verify: user=${userId} → Pro (subId=${subId ?? '∅'} customer=${customerId ?? '∅'})`,
  )
  return { ok: true, plan: 'pro' }
}

/** Persist subscription state against whichever user the event identifies. */
async function applySubscription(
  data: Record<string, unknown>,
  plan: 'free' | 'pro',
  status: string,
): Promise<void> {
  const customer = (data.customer ?? {}) as Record<string, unknown>
  const metadata = (data.metadata ?? {}) as Record<string, unknown>
  const userId = typeof metadata.userId === 'string' ? metadata.userId : undefined
  const subId = typeof data.subscription_id === 'string' ? data.subscription_id : undefined
  const customerId = typeof customer.customer_id === 'string' ? customer.customer_id : undefined
  const email = typeof customer.email === 'string' ? customer.email.toLowerCase() : undefined

  // Identify the user: metadata is most reliable, then a known subscription id,
  // then the customer email as a last resort.
  const where = userId
    ? eq(users.id, userId)
    : subId
      ? eq(users.dodoSubscriptionId, subId)
      : email
        ? eq(users.email, email)
        : null
  if (!where) {
    console.warn('[dodo webhook] could not identify a user for event')
    return
  }

  const patch: {
    plan: string
    subStatus: string
    dodoSubscriptionId?: string
    dodoCustomerId?: string
  } = { plan, subStatus: status }
  if (subId) patch.dodoSubscriptionId = subId
  if (customerId) patch.dodoCustomerId = customerId
  await db.update(users).set(patch).where(where)
}

/**
 * Verify and process a Dodo webhook. `unwrap()` throws if the signature is
 * invalid, so callers should treat a throw as a 401.
 */
export async function handleWebhook(
  rawBody: string,
  headers: { 'webhook-id': string; 'webhook-signature': string; 'webhook-timestamp': string },
): Promise<void> {
  if (!dodo) throw new Error('Dodo Payments is not configured')
  // unwrap() verifies the Standard Webhooks signature and throws on mismatch.
  const event = dodo.webhooks.unwrap(rawBody, { headers })
  const type = event.type ?? ''
  const data = (event.data ?? {}) as unknown as Record<string, unknown>

  if (type === 'subscription.active' || type === 'subscription.renewed') {
    await applySubscription(data, 'pro', 'active')
  } else if (
    type === 'subscription.cancelled' ||
    type === 'subscription.expired' ||
    type === 'subscription.failed' ||
    type === 'subscription.on_hold'
  ) {
    await applySubscription(data, 'free', type.replace('subscription.', ''))
  }
  // Other events (payment.*, dispute.*, refund.*) are acknowledged but not acted on.
}
