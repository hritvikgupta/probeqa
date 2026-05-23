/** Drizzle client — Neon Postgres over HTTP. */
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (check probe-app/.env)')

export const db = drizzle(neon(url), { schema })
export * from './schema.ts'
