import type { AppEnv, AuthUser } from '../types'
import { forbidden } from '../http/errors'
import { decryptJson, encryptJson } from '../crypto/webcrypto'

const GRANT_WRAP_SCHEME = 'app-secret/aes-256-gcm:v1'

function grantPurpose(userId: string, accountId: string): string {
  return `account-grant:${userId}:${accountId}`
}

export async function wrapAccountKey(env: AppEnv['Bindings'], userId: string, accountId: string, accountKeyB64: string): Promise<string> {
  return encryptJson(env.APP_SECRET, grantPurpose(userId, accountId), { accountKey: accountKeyB64 }, `${userId}:${accountId}`)
}

export async function unwrapAccountKey(env: AppEnv['Bindings'], userId: string, accountId: string, wrapped: string): Promise<string> {
  const value = await decryptJson<{ accountKey: string }>(env.APP_SECRET, grantPurpose(userId, accountId), wrapped, `${userId}:${accountId}`)
  return value.accountKey
}

export function appSecretGrantWrapScheme(): string {
  return GRANT_WRAP_SCHEME
}

export async function loadAccountKeyForUser(env: AppEnv['Bindings'], user: AuthUser, accountId: string): Promise<string> {
  const grant = await env.DB
    .prepare(
      `SELECT wrapped_account_key FROM account_key_grants
       WHERE user_id = ? AND account_id = ? AND revoked_at IS NULL`,
    )
    .bind(user.id, accountId)
    .first<{ wrapped_account_key: string }>()
  if (!grant) forbidden('Account key grant not found for this user')
  return unwrapAccountKey(env, user.id, accountId, grant.wrapped_account_key)
}
