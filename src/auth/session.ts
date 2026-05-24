import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import type { AppEnv, AuthUser, UserRow } from '../types'
import { unauthorized, forbidden } from '../http/errors'
import { findUserById, toAuthUser } from '../db/queries'
import { nowIso, randomId, randomToken, sha256Base64Url } from '../crypto/webcrypto'

const SESSION_COOKIE = 'sg_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

function cookieOptions(c: Context<AppEnv>) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax' as const,
    path: '/',
  }
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken()
  const sessionHash = await sha256Base64Url(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)
  await c.env.DB
    .prepare('INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(randomId('sess_'), userId, sessionHash, expiresAt.toISOString(), now.toISOString())
    .run()
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c), maxAge: SESSION_TTL_SECONDS, expires: expiresAt })
}

export async function revokeSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const hash = await sha256Base64Url(token)
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL').bind(nowIso(), hash).run()
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export async function authMiddleware(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) unauthorized()
  const hash = await sha256Base64Url(token)
  const row = await c.env.DB
    .prepare(
      `SELECT s.id AS session_id, u.* FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .bind(hash, nowIso())
    .first<UserRow & { session_id: string }>()
  if (!row || row.status !== 'active') unauthorized()
  c.set('sessionId', row.session_id)
  c.set('user', toAuthUser(row))
  await next()
}

export function requireAdmin(user: AuthUser): void {
  if (user.role !== 'admin') forbidden('Admin role required')
}

export async function currentFreshUser(c: Context<AppEnv>): Promise<UserRow> {
  const user = c.get('user')
  const row = await findUserById(c.env, user.id)
  if (!row || row.status !== 'active') unauthorized()
  return row
}
