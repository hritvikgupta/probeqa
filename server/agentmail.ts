/**
 * AgentMail — the email agent's own inbox.
 *
 * One inbox is created on first boot; its id is persisted to a local file so
 * restarts reuse the same address. The email agent (emailAgent.ts) polls this
 * inbox and replies into the same thread. The API key stays server-side.
 */
import { AgentMailClient } from 'agentmail'

const apiKey = process.env.AGENTMAIL_API_KEY

let client: AgentMailClient | null = null
let inbox: { id: string; address: string } | null = null

function getClient(): AgentMailClient | null {
  if (!apiKey) return null
  if (!client) client = new AgentMailClient({ apiKey })
  return client
}

export function agentMailEnabled(): boolean {
  return !!apiKey
}

export function inboxAddress(): string | null {
  return inbox?.address ?? null
}

type Obj = Record<string, any>

/** First defined value among the given keys — tolerates snake/camel casing. */
function pick(o: Obj | undefined, ...keys: string[]): any {
  if (!o) return undefined
  for (const k of keys) if (o[k] != null) return o[k]
  return undefined
}

/** Pull an item array out of whatever shape the SDK returns. */
function asArray(res: any): Obj[] {
  if (Array.isArray(res)) return res
  return res?.messages ?? res?.threads ?? res?.inboxes ?? res?.data ?? []
}

/**
 * The agent's inbox — use the account's existing inbox (the API key is
 * scoped to it), falling back to creating one if the account has none.
 */
export async function ensureInbox(): Promise<{ id: string; address: string } | null> {
  const c = getClient()
  if (!c) return null
  if (inbox) return inbox
  try {
    const existing = asArray(await c.inboxes.list())[0]
    if (existing) {
      const id = pick(existing, 'inboxId', 'inbox_id', 'id', 'email')
      const address = pick(existing, 'email', 'inboxAddress', 'inbox_address', 'address') ?? id
      inbox = { id: String(id), address: String(address) }
      return inbox
    }
    const created: Obj = await c.inboxes.create({})
    const id = pick(created, 'inboxId', 'inbox_id', 'id', 'email')
    const address = pick(created, 'email', 'inboxAddress', 'inbox_address', 'address') ?? id
    if (!id) throw new Error('inbox create returned no id')
    inbox = { id: String(id), address: String(address) }
    return inbox
  } catch (e) {
    console.error('[agentmail] ensureInbox failed:', e)
    return null
  }
}

export interface Mail {
  messageId: string
  threadId: string
  from: string
  subject: string
  text: string
}

/** Bare email address from a `From` header — "Name <a@b.com>" → "a@b.com". */
function parseEmail(raw: unknown): string {
  const s = String(raw ?? '').trim()
  const m = s.match(/<([^>]+)>/)
  return (m ? m[1] : s).toLowerCase().trim()
}

function normMsg(m: Obj): Mail {
  return {
    messageId: String(pick(m, 'messageId', 'message_id', 'id') ?? ''),
    threadId: String(pick(m, 'threadId', 'thread_id') ?? ''),
    from: parseEmail(pick(m, 'from', 'fromAddress', 'from_address')),
    subject: String(pick(m, 'subject') ?? ''),
    text: String(pick(m, 'extractedText', 'extracted_text', 'text', 'preview') ?? '').trim(),
  }
}

/** Recent messages in the inbox, normalised. */
export async function listMessages(): Promise<Mail[]> {
  const c = getClient()
  const box = await ensureInbox()
  if (!c || !box) return []
  try {
    const res = await c.inboxes.messages.list(box.id, { limit: 100 })
    return asArray(res).map(normMsg)
  } catch (e) {
    console.error('[agentmail] listMessages failed:', e)
    return []
  }
}

/** One message's full body by id. */
export async function getMessage(messageId: string): Promise<Mail | null> {
  const c = getClient()
  const box = await ensureInbox()
  if (!c || !box) return null
  try {
    const m = await c.inboxes.messages.get(box.id, messageId)
    return normMsg(m as Obj)
  } catch (e) {
    console.error('[agentmail] getMessage failed:', e)
    return null
  }
}

/** Every message in a thread, oldest first — the conversation history. */
export async function getThreadMessages(threadId: string): Promise<Mail[]> {
  const c = getClient()
  await ensureInbox() // loads `inbox` so isOutbound() can classify messages
  if (!c || !threadId) return []
  try {
    const t = await c.threads.get(threadId)
    return asArray(t).map(normMsg)
  } catch (e) {
    console.error('[agentmail] getThreadMessages failed:', e)
    return []
  }
}

/** Reply into a thread, threaded under `messageId`. */
export async function reply(messageId: string, text: string): Promise<boolean> {
  const c = getClient()
  const box = await ensureInbox()
  if (!c || !box || !messageId) return false
  try {
    await c.inboxes.messages.reply(box.id, messageId, { text })
    return true
  } catch (e) {
    console.error('[agentmail] reply failed:', e)
    return false
  }
}

/** True if this message was sent BY our own inbox (i.e. not inbound). */
export function isOutbound(m: Mail): boolean {
  return !!inbox && m.from === inbox.address.toLowerCase()
}
