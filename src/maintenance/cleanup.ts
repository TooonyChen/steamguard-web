import type { Bindings } from '../types'

// Retention policy applied by the scheduled (cron) handler. All timestamps are
// ISO strings, so lexicographic SQL comparison is safe.
const REVOKED_SESSION_RETENTION_DAYS = 30
const FLOW_RETENTION_HOURS = 24
const LOGIN_ATTEMPT_RETENTION_HOURS = 24
const DEFAULT_AUDIT_RETENTION_DAYS = 365

export type CleanupSummary = {
  sessionsDeleted: number
  flowsDeleted: number
  loginAttemptsDeleted: number
  auditEventsDeleted: number
}

function isoBefore(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function auditRetentionDays(env: Bindings): number {
  const parsed = Number(env.AUDIT_RETENTION_DAYS)
  if (Number.isFinite(parsed)) return Math.trunc(parsed)
  return DEFAULT_AUDIT_RETENTION_DAYS
}

function changes(meta: Record<string, unknown>): number {
  return Number(meta.changes ?? 0)
}

export async function runCleanup(env: Bindings): Promise<CleanupSummary> {
  const now = new Date().toISOString()

  const sessions = await env.DB
    .prepare('DELETE FROM sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)')
    .bind(now, isoBefore(REVOKED_SESSION_RETENTION_DAYS * 24 * 3600_000))
    .run()

  const flows = await env.DB
    .prepare('DELETE FROM auth_flows WHERE expires_at <= ?')
    .bind(isoBefore(FLOW_RETENTION_HOURS * 3600_000))
    .run()

  const loginAttempts = await env.DB
    .prepare('DELETE FROM login_attempts WHERE (locked_until IS NULL OR locked_until <= ?) AND window_started_at <= ?')
    .bind(now, isoBefore(LOGIN_ATTEMPT_RETENTION_HOURS * 3600_000))
    .run()

  // AUDIT_RETENTION_DAYS <= 0 means "keep forever".
  const retentionDays = auditRetentionDays(env)
  let auditEventsDeleted = 0
  if (retentionDays > 0) {
    const audit = await env.DB
      .prepare('DELETE FROM audit_events WHERE created_at <= ?')
      .bind(isoBefore(retentionDays * 24 * 3600_000))
      .run()
    auditEventsDeleted = changes(audit.meta)
  }

  return {
    sessionsDeleted: changes(sessions.meta),
    flowsDeleted: changes(flows.meta),
    loginAttemptsDeleted: changes(loginAttempts.meta),
    auditEventsDeleted,
  }
}
