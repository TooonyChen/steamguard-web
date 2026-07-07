import type { Bindings } from '../types'
import { sha256Base64Url } from '../crypto/webcrypto'
import { tooManyRequests } from '../http/errors'

// Fixed-window login throttling backed by the login_attempts table. Checked
// before password verification so locked-out attempts never reach PBKDF2.
// Counters use a read-then-upsert (not atomic); a race can undercount by one
// attempt, which is acceptable for throttling.
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const MAX_FAILURES_PER_USER = 5
const MAX_FAILURES_PER_IP = 20

type AttemptRow = {
  key: string
  failed_count: number
  window_started_at: string
  locked_until: string | null
}

async function throttleKeys(username: string, ip: string | null): Promise<string[]> {
  const keys = [`user:${username.toLowerCase()}`]
  if (ip) keys.push(`ip:${await sha256Base64Url(ip)}`)
  return keys
}

function failureLimit(key: string): number {
  return key.startsWith('user:') ? MAX_FAILURES_PER_USER : MAX_FAILURES_PER_IP
}

export async function assertLoginAllowed(env: Bindings, username: string, ip: string | null): Promise<void> {
  const keys = await throttleKeys(username, ip)
  const now = new Date().toISOString()
  for (const key of keys) {
    const row = await env.DB
      .prepare('SELECT locked_until FROM login_attempts WHERE key = ?')
      .bind(key)
      .first<{ locked_until: string | null }>()
    if (row?.locked_until && row.locked_until > now) {
      tooManyRequests('Too many failed login attempts. Try again later.')
    }
  }
}

export async function recordLoginFailure(env: Bindings, username: string, ip: string | null): Promise<void> {
  const keys = await throttleKeys(username, ip)
  const now = Date.now()
  for (const key of keys) {
    const row = await env.DB
      .prepare('SELECT * FROM login_attempts WHERE key = ?')
      .bind(key)
      .first<AttemptRow>()
    const windowExpired = !row || Date.parse(row.window_started_at) <= now - WINDOW_MS
    const failedCount = windowExpired ? 1 : row.failed_count + 1
    const windowStartedAt = windowExpired ? new Date(now).toISOString() : row.window_started_at
    const lockedUntil = failedCount >= failureLimit(key) ? new Date(now + LOCK_MS).toISOString() : null
    await env.DB
      .prepare(
        `INSERT INTO login_attempts (key, failed_count, window_started_at, locked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           failed_count = excluded.failed_count,
           window_started_at = excluded.window_started_at,
           locked_until = excluded.locked_until`,
      )
      .bind(key, failedCount, windowStartedAt, lockedUntil)
      .run()
  }
}

// Clears only the per-username counter. The per-IP counter is left alone so a
// successful login from a shared IP cannot reset an attacker's IP budget.
export async function clearLoginFailures(env: Bindings, username: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(`user:${username.toLowerCase()}`).run()
}
