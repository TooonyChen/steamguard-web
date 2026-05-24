import type { Bindings, SteamAccountRow, AuthUser } from '../types'
import type { SteamGuardAccount } from '../steam/account'
import { conflict, notFound } from '../http/errors'
import { encryptWithRawKey, decryptWithRawKey, newAccountKey, nowIso, randomId } from '../crypto/webcrypto'
import { ensureDefaultVault } from './queries'
import { appSecretGrantWrapScheme, wrapAccountKey } from '../vault/vault'

const ACCOUNT_BLOB_SCHEMA_VERSION = 1
const ACCOUNT_BLOB_SCHEME = 'account-key/aes-256-gcm:v1'

export function accountBlobAad(accountId: string): string {
  return `account:${accountId}:schema:${ACCOUNT_BLOB_SCHEMA_VERSION}`
}

export type ImportedAccount = {
  row: SteamAccountRow
  accountKey: string
}

export async function createEncryptedAccount(
  env: Bindings,
  account: SteamGuardAccount,
  actor: AuthUser,
): Promise<ImportedAccount> {
  const vaultId = await ensureDefaultVault(env)
  const now = nowIso()
  const accountId = randomId('acct_')
  const accountKey = newAccountKey()
  const encrypted = await encryptWithRawKey(accountKey, account, accountBlobAad(accountId))

  const activeAdmins = await env.DB
    .prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'")
    .all<{ id: string }>()
  const adminGrantStatements = await Promise.all((activeAdmins.results ?? []).map(async (admin) => {
    const wrapped = await wrapAccountKey(env, admin.id, accountId, accountKey)
    return env.DB
      .prepare(
        `INSERT INTO account_key_grants (
          id, user_id, account_id, wrapped_account_key, wrap_scheme, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(randomId('grant_'), admin.id, accountId, wrapped, appSecretGrantWrapScheme(), actor.id, now)
  }))

  try {
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO steam_accounts (
            id, vault_id, account_name, steam_id, status, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(accountId, vaultId, account.account_name, String(account.steam_id || ''), 'active', actor.id, now, now),
      env.DB
        .prepare(
          `INSERT INTO steam_account_secrets (
            account_id, encrypted_blob, encryption_scheme, blob_schema_version, updated_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(accountId, encrypted, ACCOUNT_BLOB_SCHEME, ACCOUNT_BLOB_SCHEMA_VERSION, now),
      ...adminGrantStatements,
    ])
  } catch (error) {
    if (String(error).includes('UNIQUE')) conflict('Account name already exists in this vault')
    throw error
  }

  const row = await env.DB.prepare('SELECT * FROM steam_accounts WHERE id = ?').bind(accountId).first<SteamAccountRow>()
  if (!row) throw new Error('Failed to load created account')
  return { row, accountKey }
}

export async function loadEncryptedAccount(env: Bindings, accountId: string): Promise<{
  row: SteamAccountRow
  encryptedBlob: string
}> {
  const row = await env.DB.prepare('SELECT * FROM steam_accounts WHERE id = ?').bind(accountId).first<SteamAccountRow>()
  if (!row) notFound('Account not found')
  const secret = await env.DB
    .prepare('SELECT encrypted_blob FROM steam_account_secrets WHERE account_id = ?')
    .bind(accountId)
    .first<{ encrypted_blob: string }>()
  if (!secret) notFound('Account secret not found')
  return { row, encryptedBlob: secret.encrypted_blob }
}

export async function decryptAccountSecret(
  env: Bindings,
  accountId: string,
  accountKey: string,
): Promise<SteamGuardAccount> {
  const { encryptedBlob } = await loadEncryptedAccount(env, accountId)
  return decryptWithRawKey<SteamGuardAccount>(accountKey, encryptedBlob, accountBlobAad(accountId))
}

export async function saveAccountSecret(
  env: Bindings,
  accountId: string,
  accountKey: string,
  account: SteamGuardAccount,
): Promise<void> {
  const encrypted = await encryptWithRawKey(accountKey, account, accountBlobAad(accountId))
  await env.DB
    .prepare('UPDATE steam_account_secrets SET encrypted_blob = ?, updated_at = ? WHERE account_id = ?')
    .bind(encrypted, nowIso(), accountId)
    .run()
}

export async function grantAccountToUser(env: Bindings, input: {
  accountId: string
  userId: string
  accountKey: string
  actorUserId: string
  canViewCode?: boolean
  canViewStatus?: boolean
}): Promise<void> {
  const now = nowIso()
  const wrapped = await wrapAccountKey(env, input.userId, input.accountId, input.accountKey)
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO account_key_grants (
          id, user_id, account_id, wrapped_account_key, wrap_scheme, created_by, created_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(user_id, account_id) DO UPDATE SET
          wrapped_account_key = excluded.wrapped_account_key,
          wrap_scheme = excluded.wrap_scheme,
          created_by = excluded.created_by,
          created_at = excluded.created_at,
          revoked_at = NULL`,
      )
      .bind(randomId('grant_'), input.userId, input.accountId, wrapped, appSecretGrantWrapScheme(), input.actorUserId, now),
    env.DB
      .prepare(
        `INSERT INTO account_permissions (
          id, user_id, account_id, can_view_code, can_view_status, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, account_id) DO UPDATE SET
          can_view_code = excluded.can_view_code,
          can_view_status = excluded.can_view_status,
          created_by = excluded.created_by,
          created_at = excluded.created_at`,
      )
      .bind(
        randomId('perm_'),
        input.userId,
        input.accountId,
        input.canViewCode === false ? 0 : 1,
        input.canViewStatus === false ? 0 : 1,
        input.actorUserId,
        now,
      ),
  ])
}

export async function revokeAccountFromUser(env: Bindings, userId: string, accountId: string): Promise<void> {
  await env.DB.batch([
    env.DB
      .prepare('UPDATE account_key_grants SET revoked_at = ? WHERE user_id = ? AND account_id = ? AND revoked_at IS NULL')
      .bind(nowIso(), userId, accountId),
    env.DB.prepare('DELETE FROM account_permissions WHERE user_id = ? AND account_id = ?').bind(userId, accountId),
  ])
}
