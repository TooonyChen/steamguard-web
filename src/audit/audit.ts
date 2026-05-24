import type { Bindings } from '../types'
import { nowIso, randomId, sha256Base64Url } from '../crypto/webcrypto'

export async function audit(env: Bindings, input: {
  actorUserId?: string | null
  accountId?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  outcome: 'success' | 'failure' | 'denied'
  metadata?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
}): Promise<void> {
  const ipHash = input.ip ? await sha256Base64Url(input.ip) : null
  const uaHash = input.userAgent ? await sha256Base64Url(input.userAgent) : null
  await env.DB.prepare(
    `INSERT INTO audit_events (
      id, actor_user_id, account_id, action, target_type, target_id,
      ip_hash, user_agent_hash, outcome, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId('audit_'),
      input.actorUserId ?? null,
      input.accountId ?? null,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      ipHash,
      uaHash,
      input.outcome,
      input.metadata ? JSON.stringify(input.metadata) : null,
      nowIso(),
    )
    .run()
}
