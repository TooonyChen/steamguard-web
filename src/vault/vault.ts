import type { AppEnv, AuthUser } from '../types'
import { forbidden } from '../http/errors'
import { decryptJson, encryptJson, encryptedPayloadVersion } from '../crypto/webcrypto'

const GRANT_WRAP_SCHEME = 'app-secret/aes-256-gcm:v2'

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
  const accountKey = await unwrapAccountKey(env, user.id, accountId, grant.wrapped_account_key)
  if (encryptedPayloadVersion(grant.wrapped_account_key) === 1) {
    await upgradeLegacyGrantWrap(env, user.id, accountId, accountKey)
  }
  return accountKey
}

// Rewraps a legacy PBKDF2-wrapped (v1) grant with the HKDF (v2) scheme so the
// 100k-iteration derivation is paid at most once per grant. Best effort: a
// failed upgrade must never break the request that unwrapped successfully.
async function upgradeLegacyGrantWrap(env: AppEnv['Bindings'], userId: string, accountId: string, accountKey: string): Promise<void> {
  try {
    const rewrapped = await wrapAccountKey(env, userId, accountId, accountKey)
    await env.DB
      .prepare(
        `UPDATE account_key_grants SET wrapped_account_key = ?, wrap_scheme = ?
         WHERE user_id = ? AND account_id = ? AND revoked_at IS NULL`,
      )
      .bind(rewrapped, GRANT_WRAP_SCHEME, userId, accountId)
      .run()
  } catch (error) {
    console.error('Failed to upgrade legacy grant wrap', error)
  }
}
