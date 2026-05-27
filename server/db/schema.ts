/**
 * Database schema (Drizzle / Postgres).
 *
 * Nested per-agent data (steps, accounts, memory, files, runs, settings) is
 * stored as jsonb — it is always read and written as a whole agent, so a
 * column-per-field split would buy nothing.
 */
import { pgTable, text, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core'

export interface TestStep {
  id: string
  kind: 'navigate' | 'act' | 'assert' | 'login' | 'screenshot' | 'github' | 'integration'
  label: string
  detail?: string
}
export interface TestAccount {
  id: string
  label: string
  username: string
  password: string
  notes?: string
}
export interface MemoryDoc {
  id: string
  category: 'site_structure' | 'test_insights' | 'user_preferences'
  importance: 'low' | 'medium' | 'high'
  title: string
  body: string
}
export interface FileDoc {
  id: string
  name: string
  content: string
}
export interface RunStep {
  index: number
  label: string
  kind: string
  status: 'passed' | 'failed' | 'running' | 'pending'
  note?: string
}
export interface RunRecord {
  id: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  status: 'running' | 'passed' | 'failed' | 'issues'
  summary?: string
  /** Per plan-step result, derived from the agent's step_status calls. */
  steps?: RunStep[]
  /** base64 JPEG — the last screenshot the agent captured during the run. */
  screenshot?: string
}
export interface AgentSettings {
  autoAccept: boolean
  githubRepo: string
  githubToken: string
}

/** Automatic scheduled runs — a cron-style job for this agent. */
export interface AgentSchedule {
  enabled: boolean
  frequency: 'minute' | 'hourly' | 'daily' | 'monthly'
  /** Hour of day (0–23) — used by the daily and monthly frequencies. */
  hour: number
  /** Day of month (1–28) — used by the monthly frequency. */
  dayOfMonth: number
  /** ISO timestamp of the last scheduled run, or null if never. */
  lastRunAt: string | null
}

const DEFAULT_SETTINGS: AgentSettings = { autoAccept: false, githubRepo: '', githubToken: '' }
const DEFAULT_SCHEDULE: AgentSchedule = {
  enabled: false,
  frequency: 'daily',
  hour: 9,
  dayOfMonth: 1,
  lastRunAt: null,
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Billing — Dodo Payments subscription state. `plan` is the source of truth
  // the app gates features on; the rest is bookkeeping for the webhook.
  plan: text('plan').notNull().default('free'),
  dodoCustomerId: text('dodo_customer_id'),
  dodoSubscriptionId: text('dodo_subscription_id'),
  subStatus: text('sub_status'),
})

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

/** A project groups a user's agents (the sidebar-level grouping). */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Optional grouping — agents without a project show under "All agents".
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  url: text('url').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  steps: jsonb('steps').$type<TestStep[]>().notNull().default([]),
  testAccounts: jsonb('test_accounts').$type<TestAccount[]>().notNull().default([]),
  memory: jsonb('memory').$type<MemoryDoc[]>().notNull().default([]),
  files: jsonb('files').$type<FileDoc[]>().notNull().default([]),
  runs: jsonb('runs').$type<RunRecord[]>().notNull().default([]),
  settings: jsonb('settings').$type<AgentSettings>().notNull().default(DEFAULT_SETTINGS),
  schedule: jsonb('schedule').$type<AgentSchedule>().notNull().default(DEFAULT_SCHEDULE),
})

/**
 * Sticky-routing table — which Fly machine currently holds the live browser
 * session for a given chatId. Set on the first /api/agent request for a chat;
 * subsequent requests get fly-replay'd to that machine so the browser tab
 * stays usable across the multi-machine pool.
 */
export const chatOwners = pgTable('chat_owners', {
  chatId: text('chat_id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/**
 * A saved chat conversation. Scoped either to an agent (the workspace
 * "Planning" chat) or to a project (the Editor chat) — exactly one of
 * agentId / projectId identifies where it belongs.
 */
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New chat'),
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/**
 * One captured step in a recording / flow. Mirrors a subset of the agent's
 * browser tools so a flow can be replayed by calling the same primitives.
 *
 * `value` carries the typed text on fill steps; UI promotes it to a named
 * `paramName` so the same flow can run with different inputs later.
 */
export interface FlowStep {
  kind: 'navigate' | 'click' | 'fill' | 'press_key' | 'wait_for'
  /** Best-selector chosen at capture time (testid > id > role+name > short CSS). */
  selector?: string
  /** Accessible role+name fallback when CSS selector is fragile. */
  role?: string
  name?: string
  /** Typed text for fill, or URL for navigate, or key for press_key. */
  value?: string
  /** When this step is parameterized, the placeholder name (e.g. "message_body"). */
  paramName?: string
  /** Human-readable label rendered in the UI step list. */
  label: string
  /** Visible-text expectation for wait_for steps. */
  waitText?: string
  /** Captured at this timestamp (epoch ms) for replay debugging only. */
  at?: number
}

/** A row from recorded_flows — a saved, replayable flow. */
export interface RecordedFlowMeta {
  /** Parameter names exposed by this flow (subset of step paramNames). */
  params: string[]
  /** Last URL when recording ended — used as the default start URL on replay. */
  endUrl?: string
}

/**
 * One interactive element captured during recording. The pre-computed
 * lookup the agent's click/fill tools consult instead of doing a fresh
 * DOM scan on a known page.
 */
export interface PageElement {
  /** Best CSS-or-Playwright selector at capture time. */
  selector: string
  role: string
  name: string
  /** Visible text snippet (truncated). */
  text?: string
  /** aria-label, if any. */
  ariaLabel?: string
  /** data-testid, if any. */
  testid?: string
  /** Bounding rect at capture time, in viewport coords. */
  rect?: { x: number; y: number; w: number; h: number }
  /** True if any ancestor is role=dialog/menu/listbox/alertdialog. */
  inDialog?: boolean
  /** True if the element has an SVG child with no visible text (send/like/icon buttons). */
  iconOnly?: boolean
  /** Short hint about the SVG (aria-label or <title> inside it). */
  svgHint?: string
  /** href on links. */
  href?: string
  /** placeholder on inputs. */
  placeholder?: string
  /** contenteditable input? */
  contenteditable?: boolean
}

/**
 * One snapshot of a page visited during a recording. The agent uses these as
 * pre-computed lookups for click/fill/inspect_page on URLs that match the
 * pattern — no live DOM scan needed.
 */
export interface PageSnapshot {
  /** Last URL seen for this snapshot. */
  url: string
  /** Normalized: scheme://host/path with numeric/uuid segments → :id, :slug. */
  urlPattern: string
  title: string
  /** Output of body.ariaSnapshot() — the semantic tree shown in the UI. */
  semanticTree: string
  /** Every interactive element on the page, with selectors ready to use. */
  elements: PageElement[]
  /** Every text input on the page. */
  inputs: PageElement[]
  /** XHR / fetch endpoints fired while the page settled. */
  networkSignatures: string[]
  /** Epoch ms when captured. */
  capturedAt: number
}

/**
 * In-progress recording session — created when the user clicks "Start" in the
 * Recording tab, finalized into recorded_flows when they save. Steps are
 * appended as the capture script emits events from the live browser.
 */
export const recordingSessions = pgTable('recording_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('recording'),
  startUrl: text('start_url').notNull().default(''),
  steps: jsonb('steps').$type<FlowStep[]>().notNull().default([]),
  /** Per-URL element index built up during the recording. */
  pages: jsonb('pages').$type<PageSnapshot[]>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
})

/**
 * Saved flow library — per-user, named. Replayed by the run_flow agent tool
 * or by the scheduled-run system. Promoted from a recording_sessions row
 * (the auto-saved unnamed flow path) or written directly when the user names
 * a recording before stopping.
 */
export const recordedFlows = pgTable('recorded_flows', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /**
   * The "Use this flow when..." instruction the user wrote at save time.
   * MANDATORY — this is how the agent decides whether the flow applies
   * to a given user request. Empty string means the flow is unusable
   * by the agent (only viewable in the library).
   */
  purpose: text('purpose').notNull().default(''),
  steps: jsonb('steps').$type<FlowStep[]>().notNull().default([]),
  /**
   * Per-URL element index — pre-computed selectors / roles / names for every
   * interactive element on every page visited during the recording. Agent
   * tools consult this instead of running a fresh DOM scan on known pages.
   */
  pages: jsonb('pages').$type<PageSnapshot[]>().notNull().default([]),
  meta: jsonb('meta').$type<RecordedFlowMeta>().notNull().default({ params: [] }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
})

/**
 * Per-chat flow attachment. The user explicitly attaches flows to a chat
 * (Quick chat) or an agent workspace; the agent only sees those flows
 * when calling list_flows. Composite unique on (chatId, flowId).
 */
export const chatFlowAttachments = pgTable('chat_flow_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** chatId — for Quick chat this is the conversation id; for an agent run, the agent id. */
  chatId: text('chat_id').notNull(),
  flowId: uuid('flow_id')
    .notNull()
    .references(() => recordedFlows.id, { onDelete: 'cascade' }),
  attachedAt: timestamp('attached_at').notNull().defaultNow(),
})

export type StepKind = TestStep['kind']
export type MemoryCategory = MemoryDoc['category']
export type MemoryImportance = MemoryDoc['importance']

export type UserRow = typeof users.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type ConversationRow = typeof conversations.$inferSelect
export type ChatOwnerRow = typeof chatOwners.$inferSelect
export type RecordingSessionRow = typeof recordingSessions.$inferSelect
export type RecordedFlowRow = typeof recordedFlows.$inferSelect
export type ChatFlowAttachmentRow = typeof chatFlowAttachments.$inferSelect
