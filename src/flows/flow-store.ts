import type { Bindings, AuthUser } from '../types'
import { decryptJson, encryptJson, nowIso, randomId } from '../crypto/webcrypto'
import { notFound, forbidden } from '../http/errors'

export async function createFlow(env: Bindings, input: {
  kind: string
  actor: AuthUser
  accountId?: string | null
  state?: Record<string, unknown>
  ttlSeconds?: number
}): Promise<{ id: string; status: string }> {
  const id = randomId('flow_')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? 15 * 60) * 1000)
  await env.DB
    .prepare(
      `INSERT INTO auth_flows (
        id, kind, status, created_by, account_id, state_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.kind,
      'pending',
      input.actor.id,
      input.accountId ?? null,
      JSON.stringify(input.state ?? {}),
      expiresAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run()
  return { id, status: 'pending' }
}

export type FlowRow = {
  id: string
  kind: string
  status: string
  created_by: string
  account_id: string | null
  state_json: string
  expires_at: string
  created_at: string
  updated_at: string
}

export async function createEncryptedFlow<TState extends Record<string, unknown>>(env: Bindings, input: {
  kind: string
  actor: AuthUser
  accountId?: string | null
  state: TState
  status?: string
  ttlSeconds?: number
}): Promise<{ id: string; status: string; state: TState }> {
  const id = randomId('flow_')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? 15 * 60) * 1000)
  const encrypted = await encryptJson(env.APP_SECRET, `auth-flow:${id}`, input.state, id)
  await env.DB
    .prepare(
      `INSERT INTO auth_flows (
        id, kind, status, created_by, account_id, state_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.kind,
      input.status ?? 'pending',
      input.actor.id,
      input.accountId ?? null,
      encrypted,
      expiresAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run()
  return { id, status: input.status ?? 'pending', state: input.state }
}

export async function loadEncryptedFlow<TState extends Record<string, unknown>>(env: Bindings, flowId: string, actor: AuthUser, kind?: string): Promise<{
  row: FlowRow
  state: TState
}> {
  const row = await env.DB
    .prepare('SELECT * FROM auth_flows WHERE id = ?')
    .bind(flowId)
    .first<FlowRow>()
  if (!row) notFound('Flow not found')
  if (row.created_by !== actor.id) forbidden('Flow belongs to a different user')
  if (kind && row.kind !== kind) forbidden('Unexpected flow type')
  if (row.expires_at <= nowIso()) forbidden('Flow expired')
  const state = await decryptJson<TState>(env.APP_SECRET, `auth-flow:${flowId}`, row.state_json, flowId)
  return { row, state }
}

export async function updateEncryptedFlow<TState extends Record<string, unknown>>(env: Bindings, flowId: string, state: TState, status?: string): Promise<void> {
  const encrypted = await encryptJson(env.APP_SECRET, `auth-flow:${flowId}`, state, flowId)
  await env.DB
    .prepare(`UPDATE auth_flows SET state_json = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?`)
    .bind(encrypted, status ?? null, nowIso(), flowId)
    .run()
}

export async function markFlowFailed(env: Bindings, flowId: string, reason: string): Promise<void> {
  await env.DB
    .prepare('UPDATE auth_flows SET status = ?, state_json = ?, updated_at = ? WHERE id = ?')
    .bind('failed', JSON.stringify({ reason }), nowIso(), flowId)
    .run()
}
