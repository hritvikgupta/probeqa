export type StatusType = 'ok' | 'fail' | 'run' | 'warn';

export interface User {
  id: string;
  email: string;
  name: string;
  /** Billing tier — 'free' or 'pro'. */
  plan: string;
}
export type EditorMode = 'page' | 'api';

export interface Run {
  id: number;
  n: string;
  ty: 'web' | 'api' | 'page';
  tgt: string;
  a: string;
  dur: string;
  when: string;
  s: StatusType;
  err?: string | null;
  loc?: string;
  steps: [string, string, string][];
}

export interface Target {
  n: string;
  ty: string;
  url: string;
  a: string;
  s: StatusType;
}

export interface AgentData {
  n: string;
  p: string;
  cov: string;
  last: string;
  sr: string;
  ic: string;
}

/** A GitHub issue from a repo one of the user's agents is connected to. */
export interface Ticket {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  author: string;
  labels: string[];
  createdAt: string;
  repo: string;
  agentName: string;
}

export interface TicketsResponse {
  enabled: boolean;
  connected: boolean;
  repos: string[];
  tickets: Ticket[];
  error?: string;
}

export interface EditorTarget {
  n: string;
  url: string;
  mode: EditorMode;
}

export interface ChatMsg {
  id: number;
  who: 'you' | 'agent';
  body: string;
  time?: string;
  tools: ToolCallItem[];
  isTyping?: boolean;
}

export interface ToolCallItem {
  id: number;
  label: string;
  value: string;
  status: 'run' | 'ok' | 'fail';
  time?: string;
}

export interface StepItem {
  status: '' | 'run' | 'ok' | 'fail';
  label: string;
}

/* ---- agent workspace (agents) ---- */

export type StepKind = 'navigate' | 'act' | 'assert' | 'login' | 'screenshot' | 'github' | 'integration';

export interface TestStep {
  id: string;
  kind: StepKind;
  label: string;
  detail?: string;
}
export interface TestAccount {
  id: string;
  label: string;
  username: string;
  password: string;
  notes?: string;
}
export type MemoryCategory = 'site_structure' | 'test_insights' | 'user_preferences';
export type MemoryImportance = 'low' | 'medium' | 'high';
export interface MemoryDoc {
  id: string;
  category: MemoryCategory;
  importance: MemoryImportance;
  title: string;
  body: string;
}
export interface FileDoc {
  id: string;
  name: string;
  content: string;
}
export interface RunStep {
  index: number;
  label: string;
  kind: string;
  status: 'passed' | 'failed' | 'running' | 'pending';
  note?: string;
}
export interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'running' | 'passed' | 'failed' | 'issues';
  summary?: string;
  steps?: RunStep[];
  screenshot?: string;
}
export interface ProjectSettings {
  autoAccept: boolean;
  githubRepo: string;
  githubToken: string;
}
export interface AgentSchedule {
  enabled: boolean;
  frequency: 'minute' | 'hourly' | 'daily' | 'monthly';
  hour: number;
  dayOfMonth: number;
  lastRunAt: string | null;
}
export interface Agent {
  id: string;
  name: string;
  url: string;
  projectId: string | null;
  createdAt: string;
  steps: TestStep[];
  testAccounts: TestAccount[];
  memory: MemoryDoc[];
  files: FileDoc[];
  runs: RunRecord[];
  settings: ProjectSettings;
  schedule: AgentSchedule;
}

/** A project groups agents — the sidebar-level switcher. */
export interface Project {
  id: string;
  name: string;
}

/** A saved chat conversation, as shown in the history dropdown. */
export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: string;
}

/** A run flattened with the agent it belongs to (from /api/overview). */
export interface OverviewRun extends RunRecord {
  agentId: string;
  agentName: string;
  agentUrl: string;
}

export interface Overview {
  stats: {
    agents: number;
    totalRuns: number;
    passRate: number | null;
    running: number;
  };
  runs: OverviewRun[];
}

/** Map a RunRecord status onto the shared StatusType used by badges. */
export const RUN_STATUS: Record<RunRecord['status'], StatusType> = {
  running: 'run',
  passed: 'ok',
  failed: 'fail',
  issues: 'warn',
};
