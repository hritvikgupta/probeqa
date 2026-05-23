/**
 * Composio integrations — Slack, GitHub, Notion, Google Sheets, etc.
 *
 * The COMPOSIO_API_KEY stays server-side. Each user's connected accounts are
 * scoped to their DB user id, so one user's Slack/GitHub never leaks to
 * another. The actions of whatever a user has connected are merged into the
 * testing agent's tool set at run time, so the agent can use them.
 */
import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'

/** Integrations surfaced in the workspace Integrations tab. slug = Composio toolkit slug. */
export const INTEGRATIONS: { slug: string; name: string; description: string }[] = [
  { slug: 'github', name: 'GitHub', description: 'Issues, pull requests and repositories.' },
  { slug: 'slack', name: 'Slack', description: 'Post messages and alerts to channels.' },
  { slug: 'notion', name: 'Notion', description: 'Create and update pages and databases.' },
  { slug: 'googlesheets', name: 'Google Sheets', description: 'Read and write spreadsheet data.' },
  { slug: 'gmail', name: 'Gmail', description: 'Send and read email.' },
  { slug: 'linear', name: 'Linear', description: 'Create and track issues.' },
  { slug: 'googlecalendar', name: 'Google Calendar', description: 'Create and read calendar events.' },
]

const apiKey = process.env.COMPOSIO_API_KEY
let client: Composio<VercelProvider> | null = null

function composio(): Composio<VercelProvider> | null {
  if (!apiKey) return null
  if (!client) client = new Composio({ apiKey, provider: new VercelProvider() })
  return client
}

export function composioEnabled(): boolean {
  return !!apiKey
}

/** Toolkit slugs the user currently has an ACTIVE connection for. */
export async function connectedToolkits(userId: string): Promise<string[]> {
  const c = composio()
  if (!c) return []
  try {
    const res = await c.connectedAccounts.list({ userIds: [userId], statuses: ['ACTIVE'] })
    const slugs = new Set<string>()
    for (const a of res.items ?? []) {
      const slug = a.toolkit?.slug?.toLowerCase()
      if (slug) slugs.add(slug)
    }
    return [...slugs]
  } catch (e) {
    console.error('[composio] connectedToolkits failed:', e)
    return []
  }
}

/** Start an OAuth connection for a toolkit — returns the URL to send the user to. */
export async function connectToolkit(
  userId: string,
  slug: string,
): Promise<{ redirectUrl: string } | { error: string }> {
  const c = composio()
  if (!c) return { error: 'Composio is not configured on the server.' }
  try {
    const req = await c.toolkits.authorize(userId, slug)
    const url = (req as { redirectUrl?: string | null }).redirectUrl
    if (!url) return { error: 'No authorization URL was returned for this integration.' }
    return { redirectUrl: url }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** True if the user has an active GitHub connection. */
export async function isGithubConnected(userId: string): Promise<boolean> {
  return (await connectedToolkits(userId)).includes('github')
}

/** Execute one Composio tool server-side. Defensive — never throws. */
async function execTool(
  userId: string,
  slug: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const c = composio()
  if (!c) return { ok: false, data: null, error: 'Composio is not configured.' }
  try {
    const res = (await c.tools.execute(slug, {
      userId,
      arguments: args,
      // Manual execution requires a toolkit version; use the latest.
      dangerouslySkipVersionCheck: true,
    })) as {
      data?: unknown
      error?: string | null
      successful?: boolean
    }
    return { ok: res.successful !== false, data: res.data ?? null, error: res.error ?? undefined }
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

type Obj = Record<string, unknown>

/** Recursively collect every object in a nested value that matches `pred`. */
function collect(value: unknown, pred: (o: Obj) => boolean, out: Obj[] = []): Obj[] {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, pred, out)
  } else if (value && typeof value === 'object') {
    const o = value as Obj
    if (pred(o)) out.push(o)
    for (const v of Object.values(o)) collect(v, pred, out)
  }
  return out
}

/**
 * The user's GitHub repositories ("owner/repo"), for the PR-tab dropdown.
 * GitHub paginates at 100/page, so we page through until exhausted —
 * otherwise repos (public or private) past the first page are dropped.
 */
export async function githubRepos(userId: string): Promise<{ repos: string[]; error?: string }> {
  const names: string[] = []
  let lastError: string | undefined
  for (let page = 1; page <= 10; page++) {
    const r = await execTool(userId, 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER', {
      visibility: 'all',
      per_page: 100,
      page,
    })
    if (!r.ok) {
      lastError = r.error
      break
    }
    const found = collect(r.data, (o) => typeof o.full_name === 'string').map(
      (o) => o.full_name as string,
    )
    names.push(...found)
    if (found.length < 100) break // last page reached
  }
  if (names.length === 0 && lastError) return { repos: [], error: lastError }
  return { repos: [...new Set(names)].sort() }
}

interface GhItem {
  number: number
  title: string
  url: string
  author: string
  state: string
  createdAt: string
  labels: string[]
}

function normItem(o: Obj): GhItem {
  const user = o.user as Obj | undefined
  const labels = Array.isArray(o.labels)
    ? (o.labels as unknown[])
        .map((l) => (l && typeof l === 'object' ? String((l as Obj).name ?? '') : String(l)))
        .filter(Boolean)
    : []
  return {
    number: Number(o.number),
    title: String(o.title ?? ''),
    url: String(o.html_url ?? ''),
    author: String(user?.login ?? 'unknown'),
    state: String(o.state ?? 'open'),
    createdAt: String(o.created_at ?? ''),
    labels,
  }
}

/** Open PRs and issues for a repo, fetched through the Composio connection. */
export async function githubItems(
  userId: string,
  repo: string,
): Promise<{ ok: boolean; prs: GhItem[]; issues: GhItem[]; error?: string }> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) return { ok: false, prs: [], issues: [], error: 'Repo must be "owner/repo".' }
  const pr = await execTool(userId, 'GITHUB_LIST_PULL_REQUESTS', { owner, repo: name, state: 'open' })
  const is = await execTool(userId, 'GITHUB_LIST_REPOSITORY_ISSUES', { owner, repo: name, state: 'open' })
  const isItem = (o: Obj) => typeof o.number === 'number' && typeof o.title === 'string'
  const prs = collect(pr.data, isItem).map(normItem)
  // The issues endpoint returns issues AND PRs — keep only true issues.
  const issues = collect(is.data, (o) => isItem(o) && o.pull_request === undefined).map(normItem)
  if (!pr.ok && !is.ok) return { ok: false, prs: [], issues: [], error: pr.error || is.error }
  return { ok: true, prs, issues }
}

/**
 * Every issue (open + closed) for a repo — backs the Tickets page, which
 * aggregates issues across the repos a user's agents are connected to.
 */
export async function githubIssues(
  userId: string,
  repo: string,
): Promise<{ ok: boolean; issues: GhItem[]; error?: string }> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) return { ok: false, issues: [], error: 'Repo must be "owner/repo".' }
  const is = await execTool(userId, 'GITHUB_LIST_REPOSITORY_ISSUES', {
    owner,
    repo: name,
    state: 'all',
    per_page: 100,
  })
  if (!is.ok) return { ok: false, issues: [], error: is.error }
  const isItem = (o: Obj) => typeof o.number === 'number' && typeof o.title === 'string'
  // The issues endpoint returns issues AND PRs — keep only true issues.
  const issues = collect(is.data, (o) => isItem(o) && o.pull_request === undefined).map(normItem)
  return { ok: true, issues }
}

/** File a GitHub issue through the Composio connection. */
export async function githubCreateIssue(
  userId: string,
  repo: string,
  title: string,
  body: string,
): Promise<{ ok: boolean; url?: string; number?: number; error?: string }> {
  const [owner, name] = repo.split('/')
  if (!owner || !name) return { ok: false, error: 'Repo must be "owner/repo".' }
  const r = await execTool(userId, 'GITHUB_CREATE_AN_ISSUE', { owner, repo: name, title, body })
  if (!r.ok) return { ok: false, error: r.error }
  const issue = collect(r.data, (o) => typeof o.html_url === 'string' && typeof o.number === 'number')[0]
  return { ok: true, url: issue?.html_url as string | undefined, number: issue?.number as number | undefined }
}

/**
 * Recursively strip `enum` constraints that the model's tool-schema engine
 * rejects. xAI (Grok) fails the WHOLE request — "'/' in 'enum' string value
 * is currently not supported" — if any enum value contains a slash, which
 * Composio tools routinely produce (file paths, label paths, git refs).
 * Dropping the enum just degrades the field to a free-form string; the tool
 * still works and the model is still guided by the field description.
 */
function stripUnsupportedEnums(node: unknown): void {
  if (Array.isArray(node)) {
    for (const v of node) stripUnsupportedEnums(v)
    return
  }
  if (!node || typeof node !== 'object') return
  const o = node as Record<string, unknown>
  if (Array.isArray(o.enum) && o.enum.some((v) => typeof v === 'string' && v.includes('/'))) {
    delete o.enum
  }
  for (const v of Object.values(o)) stripUnsupportedEnums(v)
}

/**
 * AI-SDK tools for the given connected toolkits — merged into the agent's
 * tools so it can act on Slack/GitHub/Notion/etc. Empty if the list is empty
 * or Composio is not configured.
 */
export async function composioToolsFor(
  userId: string,
  toolkits: string[],
): Promise<Record<string, unknown>> {
  const c = composio()
  if (!c || toolkits.length === 0) return {}
  // Fetch per toolkit so EVERY connected app contributes its important tools.
  // A single combined call with a flat limit lets one big toolkit (GitHub has
  // hundreds of tools) crowd the others out entirely.
  const merged: Record<string, unknown> = {}
  for (const tk of toolkits) {
    try {
      // A high limit so a toolkit's whole action set is covered — a small
      // limit truncates alphabetically and drops late tools (e.g. SEND_EMAIL).
      // modifySchema runs BEFORE the schema reaches the model, so the bad
      // enums never make it into the LLM tool-call request.
      const tools = await c.tools.get(
        userId,
        { toolkits: [tk], limit: 100 },
        {
          modifySchema: ({ schema }) => {
            if (schema.inputParameters) stripUnsupportedEnums(schema.inputParameters)
            return schema
          },
        },
      )
      Object.assign(merged, tools as Record<string, unknown>)
    } catch (e) {
      console.error(`[composio] tools for "${tk}" failed:`, e)
    }
  }
  return merged
}
