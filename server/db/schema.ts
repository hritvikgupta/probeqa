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

export type StepKind = TestStep['kind']
export type MemoryCategory = MemoryDoc['category']
export type MemoryImportance = MemoryDoc['importance']

export type UserRow = typeof users.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type ConversationRow = typeof conversations.$inferSelect
export type ChatOwnerRow = typeof chatOwners.$inferSelect
