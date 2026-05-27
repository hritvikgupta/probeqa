/**
 * Agent store — now backed by Postgres (Drizzle). Every agent belongs to a
 * user; all reads/writes are async DB calls.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, agents, projects, conversations, users, chatOwners } from './db/index.ts'
import type { AgentRow, ProjectRow, ConversationRow, RunRecord, UserRow } from './db/schema.ts'

export type Agent = AgentRow
export type Project = ProjectRow
export type Conversation = ConversationRow
export type {
  TestStep,
  TestAccount,
  MemoryDoc,
  MemoryCategory,
  MemoryImportance,
  FileDoc,
  RunRecord,
  RunStep,
  AgentSettings,
  AgentSchedule,
  StepKind,
} from './db/schema.ts'

/** Strip secrets before sending an agent to the browser. */
export function publicAgent(a: Agent): Agent {
  return {
    ...a,
    testAccounts: a.testAccounts.map((x) => ({ ...x, password: x.password ? '••••••••' : '' })),
    settings: { ...a.settings, githubToken: a.settings.githubToken ? '••••••••' : '' },
  }
}

/** List a user's agents, optionally narrowed to one project. */
/** Read just the Dodo subscription id from the users row. */
export async function getUserSubscriptionId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ subId: users.dodoSubscriptionId })
    .from(users)
    .where(eq(users.id, userId))
  return rows[0]?.subId ?? null
}

/** Read both Dodo ids — used by the cancel flow's fallback lookup. */
export async function getUserDodoIds(
  userId: string,
): Promise<{ subId: string | null; customerId: string | null }> {
  const rows = await db
    .select({ subId: users.dodoSubscriptionId, customerId: users.dodoCustomerId })
    .from(users)
    .where(eq(users.id, userId))
  return {
    subId: rows[0]?.subId ?? null,
    customerId: rows[0]?.customerId ?? null,
  }
}

/** Persist a discovered subscription id back onto the users row. */
export async function setUserSubscriptionId(userId: string, subId: string): Promise<void> {
  await db.update(users).set({ dodoSubscriptionId: subId }).where(eq(users.id, userId))
}

/** Force-set the user's plan — used by the "downgrade locally" escape hatch. */
export async function setUserPlan(
  userId: string,
  plan: string,
  subStatus: string,
): Promise<void> {
  await db.update(users).set({ plan, subStatus }).where(eq(users.id, userId))
}

/**
 * Aggregate quota-relevant counts for a user — used by the Billing page to
 * show usage against the plan's limits.
 */
export async function countUsage(
  userId: string,
): Promise<{ projects: number; agents: number; runs: number }> {
  const [agentRows, projectRows] = await Promise.all([
    db.select({ runs: agents.runs }).from(agents).where(eq(agents.userId, userId)),
    db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)),
  ])
  const runs = agentRows.reduce((sum, r) => sum + ((r.runs as RunRecord[] | null)?.length ?? 0), 0)
  return { projects: projectRows.length, agents: agentRows.length, runs }
}

export async function listAgents(userId: string, projectId?: string): Promise<Agent[]> {
  const where = projectId
    ? and(eq(agents.userId, userId), eq(agents.projectId, projectId))
    : eq(agents.userId, userId)
  const rows = await db.select().from(agents).where(where)
  return rows.map(publicAgent)
}

/** A user by email address — backs the email agent's sender → account match. */
export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
  return rows[0]
}

/** Raw agent by id (no user scoping — callers verify ownership). */
export async function getAgent(id: string): Promise<Agent | undefined> {
  const rows = await db.select().from(agents).where(eq(agents.id, id))
  return rows[0]
}

export async function createAgent(
  userId: string,
  name: string,
  url: string,
  projectId?: string | null,
): Promise<Agent> {
  const [row] = await db
    .insert(agents)
    .values({
      userId,
      name: name.trim() || 'Untitled test agent',
      url: url.trim(),
      projectId: projectId || null,
    })
    .returning()
  return row
}

/* ----------------------------- projects ----------------------------- */

export async function listProjects(userId: string): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(projects.createdAt)
}

/** A project by id (no user scoping — callers verify ownership). */
export async function getProject(id: string): Promise<Project | undefined> {
  const rows = await db.select().from(projects).where(eq(projects.id, id))
  return rows[0]
}

export async function createProject(userId: string, name: string): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({ userId, name: name.trim() || 'Untitled project' })
    .returning()
  return row
}

export async function deleteProject(id: string): Promise<boolean> {
  const res = await db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id })
  return res.length > 0
}

/* --------------------------- conversations -------------------------- */

export interface ConversationMeta {
  id: string
  title: string
  updatedAt: string
}

/**
 * List a user's saved chats. Pass `agentId` for a workspace's Planning
 * chats, or `projectId` (with no agentId) for an Editor project's chats.
 * Message bodies are omitted — this is the history-dropdown list.
 */
export async function listConversations(
  userId: string,
  scope: { agentId?: string; projectId?: string },
): Promise<ConversationMeta[]> {
  const filters = [eq(conversations.userId, userId)]
  if (scope.agentId) {
    filters.push(eq(conversations.agentId, scope.agentId))
  } else {
    // Editor chats: not tied to an agent.
    filters.push(isNull(conversations.agentId))
    if (scope.projectId) filters.push(eq(conversations.projectId, scope.projectId))
  }
  const rows = await db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(...filters))
    .orderBy(desc(conversations.updatedAt))
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }))
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const rows = await db.select().from(conversations).where(eq(conversations.id, id))
  return rows[0]
}

export async function createConversation(
  userId: string,
  scope: { agentId?: string | null; projectId?: string | null; title?: string },
): Promise<Conversation> {
  const [row] = await db
    .insert(conversations)
    .values({
      userId,
      agentId: scope.agentId || null,
      projectId: scope.projectId || null,
      title: scope.title?.trim() || 'New chat',
    })
    .returning()
  return row
}

export async function updateConversation(
  id: string,
  patch: { messages?: unknown[]; title?: string },
): Promise<Conversation | undefined> {
  const next: Partial<typeof conversations.$inferInsert> = { updatedAt: new Date() }
  if (patch.messages !== undefined) next.messages = patch.messages
  if (patch.title !== undefined && patch.title.trim()) next.title = patch.title.trim().slice(0, 80)
  const [row] = await db.update(conversations).set(next).where(eq(conversations.id, id)).returning()
  return row
}

export async function deleteConversation(id: string): Promise<boolean> {
  const res = await db
    .delete(conversations)
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id })
  return res.length > 0
}

/* ----------------------------- overview ----------------------------- */

export interface OverviewRun extends RunRecord {
  agentId: string
  agentName: string
  agentUrl: string
}
export interface Overview {
  stats: { agents: number; totalRuns: number; passRate: number | null; running: number }
  runs: OverviewRun[]
}

/** Aggregate run stats across a user's agents (optionally one project). */
export async function overview(userId: string, projectId?: string): Promise<Overview> {
  const list = await listAgents(userId, projectId)
  const runs: OverviewRun[] = []
  for (const a of list) {
    for (const r of a.runs) {
      // Drop the screenshot here — it's heavy; the Drawer fetches it per run.
      const { screenshot: _omit, ...light } = r
      runs.push({ ...light, agentId: a.id, agentName: a.name, agentUrl: a.url })
    }
  }
  runs.sort((x, y) => +new Date(y.startedAt) - +new Date(x.startedAt))

  const passed = runs.filter((r) => r.status === 'passed').length
  const failed = runs.filter((r) => r.status === 'failed').length
  const issues = runs.filter((r) => r.status === 'issues').length
  const running = runs.filter((r) => r.status === 'running').length
  const settled = passed + failed + issues

  return {
    stats: {
      agents: list.length,
      totalRuns: runs.length,
      passRate: settled ? Math.round((passed / settled) * 1000) / 10 : null,
      running,
    },
    runs,
  }
}

/**
 * Shallow-merge a patch into an agent. Secret fields (account passwords,
 * github token) are only overwritten when a real value is supplied — the
 * masked "••••••••" coming back from the client is ignored.
 */
export async function updateAgent(id: string, patch: Partial<Agent>): Promise<Agent | undefined> {
  const current = await getAgent(id)
  if (!current) return undefined

  const next: Partial<typeof agents.$inferInsert> = {}
  if (patch.name !== undefined) next.name = patch.name
  if (patch.url !== undefined) next.url = patch.url
  if (patch.steps !== undefined) next.steps = patch.steps
  if (patch.memory !== undefined) next.memory = patch.memory
  if (patch.files !== undefined) next.files = patch.files
  if (patch.runs !== undefined) next.runs = patch.runs
  if (patch.schedule !== undefined) next.schedule = patch.schedule

  if (patch.testAccounts !== undefined) {
    next.testAccounts = patch.testAccounts.map((incoming) => {
      const prev = current.testAccounts.find((a) => a.id === incoming.id)
      const masked = incoming.password === '••••••••'
      return { ...incoming, password: masked && prev ? prev.password : incoming.password }
    })
  }

  if (patch.settings !== undefined) {
    const s = patch.settings
    next.settings = {
      autoAccept: s.autoAccept ?? current.settings.autoAccept,
      githubRepo: s.githubRepo ?? current.settings.githubRepo,
      githubToken:
        s.githubToken !== undefined && s.githubToken !== '••••••••'
          ? s.githubToken
          : current.settings.githubToken,
    }
  }

  if (Object.keys(next).length === 0) return current
  const [row] = await db.update(agents).set(next).where(eq(agents.id, id)).returning()
  return row
}

/** Every agent with an enabled schedule (across all users) — for the scheduler. */
export async function listScheduledAgents(): Promise<Agent[]> {
  const rows = await db.select().from(agents)
  return rows.filter((a) => a.schedule?.enabled)
}

export async function deleteAgent(id: string): Promise<boolean> {
  const res = await db.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id })
  return res.length > 0
}

export async function addRun(id: string, run: RunRecord): Promise<void> {
  const current = await getAgent(id)
  if (!current) return
  const runs = [run, ...current.runs].slice(0, 50)
  await db.update(agents).set({ runs }).where(eq(agents.id, id))
}

/**
 * Update an existing run in place, matched by id — used to flip a 'running'
 * record to its final 'passed'/'failed'/'issues' state when the run ends.
 * Falls back to prepending if the run id isn't found.
 */
export async function updateRun(id: string, run: RunRecord): Promise<void> {
  const current = await getAgent(id)
  if (!current) return
  const exists = current.runs.some((r) => r.id === run.id)
  const runs = exists
    ? current.runs.map((r) => (r.id === run.id ? run : r))
    : [run, ...current.runs].slice(0, 50)
  await db.update(agents).set({ runs }).where(eq(agents.id, id))
}

/* --------------------------- chat owners --------------------------- */

// Sticky routing for the multi-machine Fly pool: each chat's live browser
// session lives on exactly one machine. The first /api/agent request for a
// chatId claims it; later requests on other machines see the claim and
// fly-replay back to the owning machine.

/** Read the Fly machine that owns this chat, if any. */
export async function getChatOwner(chatId: string): Promise<string | null> {
  const rows = await db
    .select({ instanceId: chatOwners.instanceId })
    .from(chatOwners)
    .where(eq(chatOwners.chatId, chatId))
  return rows[0]?.instanceId ?? null
}

/**
 * Claim a chat for this machine. If another machine already owns it, the
 * row is left alone and the caller learns about the conflict from the
 * `claimed` flag in the return value.
 */
export async function claimChat(
  chatId: string,
  instanceId: string,
): Promise<{ ownerId: string; claimed: boolean }> {
  // ON CONFLICT DO NOTHING — first writer wins, everyone else reads back.
  await db
    .insert(chatOwners)
    .values({ chatId, instanceId })
    .onConflictDoNothing({ target: chatOwners.chatId })
  const ownerId = (await getChatOwner(chatId)) ?? instanceId
  return { ownerId, claimed: ownerId === instanceId }
}

/** Refresh the lastSeen timestamp on an existing claim. */
export async function touchChatOwner(chatId: string): Promise<void> {
  await db
    .update(chatOwners)
    .set({ updatedAt: sql`now()` })
    .where(eq(chatOwners.chatId, chatId))
}

/** Release a chat — called from the "New run" / reset path. */
export async function releaseChat(chatId: string): Promise<void> {
  await db.delete(chatOwners).where(eq(chatOwners.chatId, chatId))
}
