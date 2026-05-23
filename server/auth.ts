/**
 * Auth — email + password, with server-side session tokens.
 *
 * Passwords are hashed with scrypt (node:crypto, no extra dependency).
 * A session row holds an opaque token; the browser keeps it in an
 * httpOnly cookie, so no secret ever reaches frontend code.
 */
import { eq } from 'drizzle-orm'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { db, users, sessions } from './db/index.ts'

export interface SafeUser {
  id: string
  email: string
  name: string
  /** Billing tier — 'free' or 'pro'. Updated by the Dodo Payments webhook. */
  plan: string
}
type AuthResult = { user: SafeUser; token: string } | { error: string }

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`
}

function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(pw, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex')
  await db.insert(sessions).values({ token, userId })
  return token
}

export async function registerUser(
  emailRaw: string,
  password: string,
  nameRaw?: string,
): Promise<AuthResult> {
  const email = (emailRaw || '').trim().toLowerCase()
  if (!email.includes('@')) return { error: 'Enter a valid email address.' }
  if (!password || password.length < 6) return { error: 'Password must be at least 6 characters.' }

  const existing = await db.select().from(users).where(eq(users.email, email))
  if (existing[0]) return { error: 'An account with that email already exists.' }

  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: hashPassword(password),
      name: (nameRaw || '').trim() || email.split('@')[0],
    })
    .returning()
  const token = await createSession(u.id)
  return { user: { id: u.id, email: u.email, name: u.name, plan: u.plan }, token }
}

export async function loginUser(emailRaw: string, password: string): Promise<AuthResult> {
  const email = (emailRaw || '').trim().toLowerCase()
  const rows = await db.select().from(users).where(eq(users.email, email))
  const u = rows[0]
  if (!u || !verifyPassword(password || '', u.passwordHash)) {
    return { error: 'Wrong email or password.' }
  }
  const token = await createSession(u.id)
  return { user: { id: u.id, email: u.email, name: u.name, plan: u.plan }, token }
}

/** Resolve the user behind a session token, or null. */
export async function userForToken(token?: string): Promise<SafeUser | null> {
  if (!token) return null
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, plan: users.plan })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
  return rows[0] ?? null
}

export async function logout(token?: string): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.token, token))
}

/** Update the signed-in user's display name. */
export async function updateUserName(
  userId: string,
  nameRaw: string,
): Promise<SafeUser | { error: string }> {
  const name = (nameRaw || '').trim()
  if (!name) return { error: 'Name cannot be empty.' }
  if (name.length > 80) return { error: 'Name is too long (80 characters max).' }
  const [u] = await db.update(users).set({ name }).where(eq(users.id, userId)).returning()
  if (!u) return { error: 'User not found.' }
  return { id: u.id, email: u.email, name: u.name, plan: u.plan }
}

/** Change the signed-in user's password after verifying the current one. */
export async function changePassword(
  userId: string,
  currentPw: string,
  newPw: string,
): Promise<{ ok: true } | { error: string }> {
  if (!newPw || newPw.length < 6) {
    return { error: 'New password must be at least 6 characters.' }
  }
  const rows = await db.select().from(users).where(eq(users.id, userId))
  const u = rows[0]
  if (!u) return { error: 'User not found.' }
  if (!verifyPassword(currentPw || '', u.passwordHash)) {
    return { error: 'Current password is incorrect.' }
  }
  await db.update(users).set({ passwordHash: hashPassword(newPw) }).where(eq(users.id, userId))
  return { ok: true }
}
